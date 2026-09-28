/**
 * Drizzle schema — the pipeline's entire persistent state.
 *
 * Implements the table list in docs/ARCHITECTURE.md §8. Two principles run through it:
 *
 * 1. **Every unique constraint here is load-bearing.** They are what makes "a crashed and
 *    re-run worker cannot double-create a market or double-place a bet" a property of the
 *    database rather than a property of careful coding. If you delete one, you delete an
 *    idempotency guarantee. Each is commented with the guarantee it carries.
 *
 * 2. **Illegal states are unrepresentable where cheap.** Pipeline stages are Postgres enums,
 *    not free text, so a typo in a status string fails at INSERT rather than silently
 *    creating a row no worker will ever pick up.
 *
 * Money is `numeric(78, 0)` — the exact decimal width of a uint256. Never a float, and never
 * a JS `number`: 1 tMSTC is 1e18 wei, which is already past `Number.MAX_SAFE_INTEGER`.
 * Drizzle returns these as strings; convert at the boundary with `BigInt()`.
 */

import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** uint256 wei. 78 digits is the decimal width of 2^256 - 1. */
const wei = (name: string) => numeric(name, { precision: 78, scale: 0 });

/** A 0x-prefixed 32-byte hash: 66 characters. */
const hash32 = (name: string) => varchar(name, { length: 66 });

/** A 0x-prefixed 20-byte address: 42 characters. Stored lowercase — see `normalizeAddress`. */
const address = (name: string) => varchar(name, { length: 42 });

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Enums — the pipeline state machine from docs/ARCHITECTURE.md §3
// ---------------------------------------------------------------------------

export const eventStatusEnum = pgEnum("event_status", ["OBSERVED", "CONFIRMED", "REJECTED"]);

export const proposalStatusEnum = pgEnum("proposal_status", [
  "DRAFTED",
  "VALIDATED",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  /** Model output failed the API schema or the Zod re-validation. Never reaches the queue. */
  "SCHEMA_REJECTED",
]);

/**
 * Mirrors the contract's `STATE_*` constants, plus one off-chain-only state.
 *
 * `ONCHAIN_PENDING` exists off-chain only: a human has approved the spec and an intent is in
 * flight, but no `MarketCreated` event has been indexed yet. It is the only state in this
 * enum that is not a value the contract can return, and it always resolves to `OPEN` (the
 * tx confirmed) or back to the proposal (the tx failed).
 */
export const marketStateEnum = pgEnum("market_state", [
  "ONCHAIN_PENDING",
  "OPEN",
  "CLOSED",
  "RESOLUTION_PROPOSED",
  "FINALIZED",
  "INVALIDATED",
]);

/** Mirrors the contract's `OUTCOME_*` constants exactly. */
export const outcomeEnum = pgEnum("outcome", ["UNRESOLVED", "YES", "NO", "INVALID"]);

export const agentDecisionStatusEnum = pgEnum("agent_decision_status", [
  "PROPOSED",
  "POLICY_APPROVED",
  "POLICY_REJECTED",
  "TX_PENDING",
  "TX_CONFIRMED",
  "TX_FAILED",
]);

/**
 * The lifecycle of one intended write to the chain.
 *
 * The ordering matters: a transaction is **signed and persisted before it is broadcast**, so
 * `SIGNED` is a real, recoverable state rather than an implementation detail. See
 * docs/DECISIONS.md ADR-027 and `lib/intents/engine.ts`.
 *
 * `ABANDONED` is the only terminal state that never touched the chain.
 */
export const intentStatusEnum = pgEnum("intent_status", [
  "PENDING",
  "SIGNED",
  "BROADCAST",
  "CONFIRMED",
  "REVERTED",
  "ABANDONED",
]);

/** Which contract call an intent performs. Constrains what the engine may ever send. */
export const intentKindEnum = pgEnum("intent_kind", [
  "CREATE_MARKET",
  "PLACE_BET",
  "CLOSE_MARKET",
  "PROPOSE_RESOLUTION",
  "CHALLENGE_RESOLUTION",
  "FINALIZE_RESOLUTION",
  "CLAIM",
  "REGISTER_AGENT",
]);

export const notificationStatusEnum = pgEnum("notification_status", [
  "PENDING",
  "SENT",
  "FAILED",
  "SKIPPED",
]);

// ---------------------------------------------------------------------------
// News ingestion  (populated in Phase 3)
// ---------------------------------------------------------------------------

/**
 * Publisher allowlist and independence grouping.
 *
 * `independenceGroup` is what stops syndication from counting as confirmation: Reuters and a
 * paper reprinting the Reuters wire share a group, so two items from them are one source, not
 * two. docs/ARCHITECTURE.md §11 states plainly that this is heuristic, not airtight.
 */
export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Bare publisher domain, lowercase, no scheme or `www.` — e.g. `reuters.com`. */
    domain: varchar("domain", { length: 253 }).notNull(),
    name: text("name").notNull(),
    /** Publishers sharing a group are NOT independent of each other. */
    independenceGroup: varchar("independence_group", { length: 64 }).notNull(),
    allowlisted: boolean("allowlisted").notNull().default(true),
    createdAt,
  },
  (t) => [
    // One row per publisher, so re-seeding the allowlist is idempotent.
    uniqueIndex("sources_domain_key").on(t.domain),
  ],
);

/**
 * One ingested article, exactly as fetched.
 *
 * `UNIQUE(source_id, source_guid)` is the idempotency guarantee for ingestion: re-running a
 * tick over the same feed is a no-op rather than a duplicate. The insert path uses
 * `ON CONFLICT DO NOTHING`, so the constraint is the mechanism, not a safety net behind one.
 */
export const rawItems = pgTable(
  "raw_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "restrict" }),
    /** The feed's own stable identifier (RSS `<guid>`, GDELT doc id, …). */
    sourceGuid: varchar("source_guid", { length: 512 }).notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    summary: text("summary"),
    /** SHA-256 of normalised title+summary. Lets us cache LLM work against content. */
    contentHash: hash32("content_hash").notNull(),
    /** Deterministic prompt-injection signature hits. Empty array = clean. */
    injectionFlags: jsonb("injection_flags")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    ingestedAt: createdAt,
  },
  (t) => [
    // THE ingestion idempotency guarantee. Re-ingesting a feed inserts nothing new.
    uniqueIndex("raw_items_source_guid_key").on(t.sourceId, t.sourceGuid),
    index("raw_items_content_hash_idx").on(t.contentHash),
    index("raw_items_published_at_idx").on(t.publishedAt),
  ],
);

/** A canonical deduplicated story: one real-world event, assembled from many articles. */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stable key derived from the cluster's seed item, so clustering is re-runnable. */
    clusterKey: varchar("cluster_key", { length: 128 }).notNull(),
    title: text("title").notNull(),
    status: eventStatusEnum("status").notNull().default("OBSERVED"),
    /** Count of DISTINCT independence groups. `CONFIRMED` requires ≥ 2. */
    distinctSourceCount: integer("distinct_source_count").notNull().default(0),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [
    // Re-running clustering re-derives the same key and updates rather than duplicating.
    uniqueIndex("events_cluster_key_key").on(t.clusterKey),
    index("events_status_idx").on(t.status),
  ],
);

/** Join: which raw items were judged to be the same story. */
export const eventItems = pgTable(
  "event_items",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    rawItemId: uuid("raw_item_id")
      .notNull()
      .references(() => rawItems.id, { onDelete: "cascade" }),
    /** Jaccard similarity to the cluster seed. ≥ 0.6 is deterministic; 0.4–0.6 is LLM-adjudicated. */
    similarity: real("similarity").notNull(),
    /** True when an LLM broke the tie, so the UI can show which links are model judgements. */
    adjudicatedByLlm: boolean("adjudicated_by_llm").notNull().default(false),
    createdAt,
  },
  (t) => [
    // An article belongs to a cluster once. Re-clustering cannot double-count a publisher
    // and so cannot manufacture the second source that `CONFIRMED` requires.
    primaryKey({ columns: [t.eventId, t.rawItemId] }),
  ],
);

// ---------------------------------------------------------------------------
// Proposals  (populated in Phase 4)
// ---------------------------------------------------------------------------

/**
 * A drafted market specification and what happened to it.
 *
 * `UNIQUE(event_id)` means one confirmed event yields at most one proposal, so a re-run tick
 * cannot flood the human review queue with copies of the same market.
 *
 * Rows with `SCHEMA_REJECTED` are kept deliberately: they are the evidence that the schema
 * gate is real, and they are what the demo shows.
 */
export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    status: proposalStatusEnum("status").notNull().default("DRAFTED"),
    /** The validated spec. Shape is owned by Phase 4's Zod schema, not by this table. */
    spec: jsonb("spec").$type<Record<string, unknown>>(),
    /** keccak256 of the canonical spec encoding. Must equal the on-chain `specHash`. */
    specHash: hash32("spec_hash"),
    /** Raw model text, kept when validation failed so the rejection is auditable. */
    rawModelOutput: text("raw_model_output"),
    rejectionReason: text("rejection_reason"),
    model: varchar("model", { length: 64 }),
    reviewedBy: address("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [
    // One proposal per event — a re-run tick cannot duplicate the review queue.
    uniqueIndex("proposals_event_id_key").on(t.eventId),
    index("proposals_status_idx").on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// Markets — the off-chain mirror of on-chain truth
// ---------------------------------------------------------------------------

/**
 * A market. **The chain is authoritative; this table is a projection of it.**
 *
 * Every column below `onchainId` is written by the indexer from indexed logs, never from what
 * we intended to happen. If the two ever disagree, the chain wins and this row is wrong —
 * which is why `/markets` links each row to MSTScan for the reader to check.
 */
export const markets = pgTable(
  "markets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The contract's market id. Null only while `ONCHAIN_PENDING`. */
    onchainId: bigint("onchain_id", { mode: "number" }),
    specHash: hash32("spec_hash").notNull(),
    proposalId: uuid("proposal_id").references(() => proposals.id, { onDelete: "set null" }),

    question: text("question").notNull(),
    resolutionSourceUrl: text("resolution_source_url").notNull(),
    closeTime: timestamp("close_time", { withTimezone: true }).notNull(),
    resolveDeadline: timestamp("resolve_deadline", { withTimezone: true }).notNull(),

    state: marketStateEnum("state").notNull().default("ONCHAIN_PENDING"),
    outcome: outcomeEnum("outcome").notNull().default("UNRESOLVED"),
    poolYesWei: wei("pool_yes_wei").notNull().default("0"),
    poolNoWei: wei("pool_no_wei").notNull().default("0"),

    evidenceUrl: text("evidence_url"),
    proposedBy: address("proposed_by"),
    challengeEndsAt: timestamp("challenge_ends_at", { withTimezone: true }),
    challengeCount: smallint("challenge_count").notNull().default(0),

    creator: address("creator"),
    createdTxHash: hash32("created_tx_hash"),
    createdBlock: bigint("created_block", { mode: "number" }),
    createdAt,
    updatedAt,
  },
  (t) => [
    // The same guarantee the contract enforces, mirrored off-chain: one market per spec.
    // Two independent mechanisms, neither relying on the other (ARCHITECTURE §4).
    uniqueIndex("markets_spec_hash_key").on(t.specHash),
    // Partial: many rows may be ONCHAIN_PENDING with a null id, but a confirmed id is unique.
    uniqueIndex("markets_onchain_id_key")
      .on(t.onchainId)
      .where(sql`${t.onchainId} is not null`),
    index("markets_state_idx").on(t.state),
  ],
);

// ---------------------------------------------------------------------------
// Members and their agents  (populated in Phase 5)
// ---------------------------------------------------------------------------

export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    handle: varchar("handle", { length: 64 }).notNull(),
    /** The member's own wallet (BridgeKey). Winnings are paid here, never to the agent. */
    ownerAddress: address("owner_address").notNull(),
    /** The server-held burner EOA that actually signs `placeBet`. */
    agentAddress: address("agent_address"),
    /** AES-256-GCM ciphertext of the agent key. Hygiene — the on-chain caps are the real bound. */
    agentKeyCiphertext: text("agent_key_ciphertext"),
    createdAt,
  },
  (t) => [
    uniqueIndex("members_handle_key").on(t.handle),
    // One agent wallet serves exactly one member, so a decision can never be attributed
    // to the wrong owner — and `claim()` therefore cannot pay the wrong person.
    uniqueIndex("members_agent_address_key")
      .on(t.agentAddress)
      .where(sql`${t.agentAddress} is not null`),
  ],
);

/**
 * The off-chain half of the two-layer limit. The on-chain half lives in the contract's
 * agent registry and is the one that holds even if this row is tampered with.
 */
export const agentPolicies = pgTable(
  "agent_policies",
  {
    memberId: uuid("member_id")
      .primaryKey()
      .references(() => members.id, { onDelete: "cascade" }),
    perTxCapWei: wei("per_tx_cap_wei").notNull(),
    dailyBudgetWei: wei("daily_budget_wei").notNull(),
    /** 0–1. A proposal below this is rejected by the gate without reaching the chain. */
    minConfidence: real("min_confidence").notNull().default(0.6),
    /** Market categories this agent may bet on. Anything else is rejected. */
    allowedCategories: jsonb("allowed_categories")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Per-member kill switch. Stops betting without touching the contract. */
    killSwitch: boolean("kill_switch").notNull().default(false),
    updatedAt,
  },
);

/**
 * Every agent proposal and what the deterministic gate did with it — including the rejections.
 *
 * Hard rule #7: rejected decisions are kept and shown. They are the proof that the gate is
 * real rather than decorative.
 */
export const agentDecisions = pgTable(
  "agent_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    /** Bumped only by a deliberate re-run, never by a retry. See the unique index below. */
    round: integer("round").notNull().default(1),

    backsYes: boolean("backs_yes"),
    confidence: real("confidence"),
    stakeRequestedWei: wei("stake_requested_wei"),
    /** What the gate actually allowed: min(requested, every cap). Null when rejected. */
    finalStakeWei: wei("final_stake_wei"),
    rationale: text("rationale"),
    sources: jsonb("sources")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    status: agentDecisionStatusEnum("status").notNull().default("PROPOSED"),
    /** Machine-readable gate reasons, approve and reject alike. Rendered verbatim in /agents. */
    reasons: jsonb("reasons")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    intentId: uuid("intent_id"),
    createdAt,
    updatedAt,
  },
  (t) => [
    // THE betting idempotency guarantee: one decision per agent per market per round, so a
    // crashed-and-restarted tick re-uses the existing row instead of betting twice.
    uniqueIndex("agent_decisions_market_member_round_key").on(t.marketId, t.memberId, t.round),
    index("agent_decisions_status_idx").on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// The chain write path
// ---------------------------------------------------------------------------

/**
 * Every intended write to the chain. **Nothing else in this codebase may broadcast.**
 *
 * The dangerous window is "we broadcast, then crashed before recording anything". This table
 * closes it by storing the *signed raw transaction* before the first broadcast: recovery
 * re-broadcasts byte-identical bytes, which the network deduplicates by hash. A retry can
 * therefore never produce a second transaction. See `lib/intents/engine.ts` and ADR-027.
 */
export const onchainIntents = pgTable(
  "onchain_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Caller-supplied, derived from the business fact ("bet for decision X"), never random.
     * This is what makes "create the intent" itself idempotent — the step before which no
     * amount of transaction-level care would help.
     */
    idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
    kind: intentKindEnum("kind").notNull(),
    status: intentStatusEnum("status").notNull().default("PENDING"),

    fromAddress: address("from_address").notNull(),
    toAddress: address("to_address").notNull(),
    functionName: varchar("function_name", { length: 64 }).notNull(),
    /** ABI-encoded calldata, fixed at creation. The engine never re-encodes on retry. */
    data: text("data").notNull(),
    valueWei: wei("value_wei").notNull().default("0"),

    nonce: integer("nonce"),
    gasLimit: bigint("gas_limit", { mode: "number" }),
    /** The signed transaction, persisted BEFORE the first broadcast. The crux of ADR-027. */
    signedRawTx: text("signed_raw_tx"),
    txHash: hash32("tx_hash"),

    blockNumber: bigint("block_number", { mode: "number" }),
    gasUsed: bigint("gas_used", { mode: "number" }),
    /** Decoded custom error for a reverted tx — e.g. `AgentPerTxCapExceeded(2e17, 1e17)`. */
    revertReason: text("revert_reason"),

    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set while a worker holds the row. Advisory only — the row lock is the real mutex. */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimedBy: varchar("claimed_by", { length: 64 }),

    createdAt,
    updatedAt,
  },
  (t) => [
    // THE chain-write idempotency guarantee. Two ticks racing to create the same intent:
    // one inserts, the other conflicts. Neither can produce a second transaction.
    uniqueIndex("onchain_intents_idempotency_key_key").on(t.idempotencyKey),
    // One transaction hash belongs to one intent. Catches a rebroadcast being mis-attributed.
    uniqueIndex("onchain_intents_tx_hash_key")
      .on(t.txHash)
      .where(sql`${t.txHash} is not null`),
    // The claim query's index: workers scan for due, unfinished work only.
    index("onchain_intents_claimable_idx").on(t.status, t.nextAttemptAt),
  ],
);

/**
 * Indexed contract logs, verbatim.
 *
 * `UNIQUE(tx_hash, log_index)` is what makes re-running the indexer from block 0 a no-op: a
 * log identifies itself, so replay collides rather than duplicating. Nothing downstream needs
 * to know whether it is seeing a log for the first time.
 */
export const chainEvents = pgTable(
  "chain_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    txHash: hash32("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: bigint("block_number", { mode: "number" }).notNull(),
    blockHash: hash32("block_hash").notNull(),
    blockTime: timestamp("block_time", { withTimezone: true }),
    address: address("address").notNull(),
    /** Decoded name, or null when the topic0 is not in our ABI (we still store the raw log). */
    eventName: varchar("event_name", { length: 64 }),
    /** Decoded arguments, with every uint rendered as a decimal string. */
    args: jsonb("args").$type<Record<string, unknown>>(),
    topic0: hash32("topic0").notNull(),
    rawTopics: jsonb("raw_topics").$type<string[]>().notNull(),
    rawData: text("raw_data").notNull(),
    indexedAt: createdAt,
  },
  (t) => [
    // THE indexer idempotency guarantee. Replay from block 0 inserts nothing it already has.
    uniqueIndex("chain_events_tx_log_key").on(t.txHash, t.logIndex),
    index("chain_events_block_idx").on(t.blockNumber, t.logIndex),
    index("chain_events_name_idx").on(t.eventName),
  ],
);

/**
 * How far the indexer has read. One row per named stream.
 *
 * Deliberately *not* the `MAX(block_number)` of `chain_events`: a range of blocks containing
 * no logs at all is still progress, and re-scanning it every tick would grow without bound.
 */
export const indexerCursors = pgTable("indexer_cursors", {
  name: varchar("name", { length: 64 }).primaryKey(),
  /** Highest block whose logs are fully persisted. Exclusive of anything above it. */
  lastBlock: bigint("last_block", { mode: "number" }).notNull(),
  /** Blocks left unread below the head, as re-org insurance. */
  confirmations: integer("confirmations").notNull().default(3),
  updatedAt,
});

// ---------------------------------------------------------------------------
// Feed and audit
// ---------------------------------------------------------------------------

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: varchar("kind", { length: 48 }).notNull(),
    marketId: uuid("market_id").references(() => markets.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body"),
    /** The tx that justifies this notification. Nothing fires before it is confirmed. */
    txHash: hash32("tx_hash"),
    discordStatus: notificationStatusEnum("discord_status").notNull().default("PENDING"),
    discordSentAt: timestamp("discord_sent_at", { withTimezone: true }),
    /** Dedupe key — the same on-chain fact notifies once, however many ticks observe it. */
    dedupeKey: varchar("dedupe_key", { length: 200 }).notNull(),
    createdAt,
  },
  (t) => [uniqueIndex("notifications_dedupe_key_key").on(t.dedupeKey)],
);

/**
 * Append-only. Nothing in this codebase deletes or updates a row here.
 *
 * This is the spine of the `/audit` page and of hard rule #7 ("log every decision with a
 * reason — approved *and* rejected"). The rejections are the interesting half.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Who acted: `system`, `indexer`, `agent:<address>`, `human:<address>`. */
    actor: varchar("actor", { length: 128 }).notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    subjectType: varchar("subject_type", { length: 32 }),
    subjectId: varchar("subject_id", { length: 128 }),
    /** Why. Required — an audit entry without a reason is not evidence of anything. */
    reason: text("reason").notNull(),
    txHash: hash32("tx_hash"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt,
  },
  (t) => [
    index("audit_log_created_at_idx").on(t.createdAt),
    index("audit_log_subject_idx").on(t.subjectType, t.subjectId),
  ],
);

export type Market = typeof markets.$inferSelect;
export type NewMarket = typeof markets.$inferInsert;
export type OnchainIntent = typeof onchainIntents.$inferSelect;
export type ChainEvent = typeof chainEvents.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
