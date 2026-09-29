/**
 * The agent betting pass: open markets in, decisions and real transactions out.
 *
 * ## The order of operations is the safety argument
 *
 *   reconcile ──> resume ──> screen ──> ask a model ──> gate ──> row ──> intent
 *
 * Reading it right to left is more useful. An intent is created **only** after a decision row
 * exists and carries the gate's reasons, and its idempotency key is derived from that row's id —
 * so a crash anywhere between the two leaves a row whose intent is missing rather than an intent
 * nobody authorised. `resumeApproved` then finishes it. There is no path that produces a bet
 * without a recorded reason for it, and none that produces two bets from one decision.
 *
 * `reconcile` runs first and unconditionally, including when every kill switch is on: a tick that
 * cannot bet can still learn that yesterday's bet confirmed, and a page showing `TX_PENDING`
 * forever because the pass returned early would be lying about the chain.
 *
 * ## Bounded, like every other stage
 *
 * A pass considers at most `MAX_PAIRS_PER_PASS` (market, member) pairs and takes at most
 * `MAX_DECISIONS_PER_PASS` decisions, on top of whatever the LLM budget allows. It is not a loop
 * that runs until the work is done — it has to finish inside a 60-second serverless function, and
 * the backlog is drained by the next tick.
 *
 * ## Why agents only bet on human-approved markets
 *
 * The market query requires `proposal_id IS NOT NULL`. Partly that is mechanical — the category
 * and the resolution criteria an agent reasons about live in the approved spec, and a market
 * created by a smoke test has neither. But it is also the property worth having: **no agent can
 * stake anything on a market a human did not sign for.** The three Phase 1 and 2 test markets are
 * on chain, open in state, and no agent will ever touch them.
 */

import { and, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  agentDecisions,
  auditLog,
  eventItems,
  markets,
  onchainIntents,
  proposals,
  rawItems,
  sources,
} from "../db/schema";
import { readMarket } from "../chain/auspex";
import { getProvider } from "../chain/provider";
import type { MarketSpec } from "../chain/spec";
import { createIntent } from "../intents/engine";
import type { LlmBudget } from "../llm/client";
import {
  MIN_SECONDS_BEFORE_CLOSE,
  policyGate,
  screenAgent,
  type GateDecision,
  type MarketFacts,
} from "../policy/policyGate";
import { proposeBet, type BetResearchInput, type ProposeBetOptions } from "./analyst";
import { globalKillSwitch, listBettingMembers, type MemberRow } from "./members";
import { readOnChainLimits } from "./registry";

/** (market, member) pairs examined per pass. Each one costs two `eth_call`s. */
const MAX_PAIRS_PER_PASS = 8;

/** Decision rows written per pass, approvals and rejections together. */
const MAX_DECISIONS_PER_PASS = 4;

/** Open markets considered. More than the number on chain today, deliberately. */
const MAX_MARKETS = 10;

/** Articles shown to an agent per market. */
const MAX_ARTICLES = 5;

/**
 * Wei held back in every agent wallet for gas.
 *
 * 0.001 tMSTC, against a measured cost of roughly 0.0001 per `placeBet` at this chain's 1 gwei
 * priority fee and zero base fee — so about ten transactions of headroom. The reserve exists at
 * all because an agent that staked its whole balance could not pay to claim its own winnings.
 */
const GAS_RESERVE_WEI = 10n ** 15n;

export type AgentReport = {
  /** Open, human-approved markets found. */
  markets: number;
  /** Members with an agent wallet and a policy. */
  members: number;
  /** Pairs with no decision at this round, before the cap was applied. */
  pending: number;
  /** Pairs deferred before any model was asked. No rows written; retried next tick. */
  deferred: number;
  /** Deferral reasons, deduplicated, for the audit entry and the tick report. */
  deferrals: string[];
  /** Pairs refused by the screen, before any model was asked. Rows written. */
  screenRejected: number;
  /** Models actually asked. */
  asked: number;
  /** Proposals the gate allowed — each one is a real transaction. */
  approved: number;
  /** Proposals the gate refused, plus model output that failed validation. Rows written. */
  rejected: number;
  /** Pairs where no model answered. No rows written. */
  unavailable: number;
  /** Approved rows whose intent was missing and has now been created. */
  resumed: number;
  /** Decision rows brought up to date from a settled intent. */
  reconciled: number;
  haltedBecause: string | null;
};

function emptyReport(): AgentReport {
  return {
    markets: 0,
    members: 0,
    pending: 0,
    deferred: 0,
    deferrals: [],
    screenRejected: 0,
    asked: 0,
    approved: 0,
    rejected: 0,
    unavailable: 0,
    resumed: 0,
    reconciled: 0,
    haltedBecause: null,
  };
}

type OpenMarket = {
  /** The `markets` row id — the foreign key `agent_decisions` needs. */
  rowId: string;
  onchainId: number;
  question: string;
  spec: MarketSpec;
};

/**
 * Open markets that came through the human gate, newest first.
 *
 * `close_time > now()` is enforced in SQL as well as by the gate, because the three test markets
 * from Phases 1 and 2 are still `OPEN` in state with close times in the past — `closeMarket` is
 * permissionless and nobody has called it. Filtering here means they are never even read from the
 * chain, and their presence cannot cost a pass its budget.
 */
async function openApprovedMarkets(): Promise<OpenMarket[]> {
  const rows = await db
    .select({
      rowId: markets.id,
      onchainId: markets.onchainId,
      question: markets.question,
      spec: proposals.spec,
    })
    .from(markets)
    .innerJoin(proposals, eq(markets.proposalId, proposals.id))
    .where(
      and(
        eq(markets.state, "OPEN"),
        isNotNull(markets.onchainId),
        gt(markets.closeTime, sql`now() + make_interval(secs => ${MIN_SECONDS_BEFORE_CLOSE})`),
      ),
    )
    .orderBy(desc(markets.closeTime))
    .limit(MAX_MARKETS);

  return rows.flatMap((row) => {
    const spec = row.spec as unknown as MarketSpec | null;
    if (row.onchainId === null || spec === null) return [];
    return [{ rowId: row.rowId, onchainId: row.onchainId, question: row.question, spec }];
  });
}

/**
 * The articles behind a market, for the agent to read.
 *
 * Best-matching first, so `SOURCE_1` is the article closest to the cluster seed — the same
 * ordering `/review` showed the human who approved the market. The agent and the reviewer are
 * looking at the same evidence in the same order.
 */
async function articlesForMarket(marketRowId: string): Promise<BetResearchInput["articles"]> {
  const rows = await db
    .select({
      title: rawItems.title,
      summary: rawItems.summary,
      domain: sources.domain,
    })
    .from(markets)
    .innerJoin(proposals, eq(markets.proposalId, proposals.id))
    .innerJoin(eventItems, eq(eventItems.eventId, proposals.eventId))
    .innerJoin(rawItems, eq(eventItems.rawItemId, rawItems.id))
    .innerJoin(sources, eq(rawItems.sourceId, sources.id))
    .where(eq(markets.id, marketRowId))
    .orderBy(desc(eventItems.similarity))
    .limit(MAX_ARTICLES);

  return rows;
}

/**
 * Wei this member has committed today, across every market. Counts pending bets.
 *
 * The day boundary is written `date_trunc('day', now() at time zone 'utc') at time zone 'utc'` and
 * the trailing conversion is load-bearing. `date_trunc` returns a naive timestamp, and comparing a
 * `timestamptz` against a naive one makes Postgres interpret the naive side in the **session**
 * time zone. This database's session is GMT today, so the shorter form happened to be right; on a
 * session set to Asia/Kolkata it would move the budget window by five and a half hours and an
 * agent would silently get a second day's allowance in the evening. Converting back to
 * `timestamptz` explicitly anchors it in UTC whatever the session says.
 */
async function spentTodayByMember(): Promise<Map<string, bigint>> {
  const rows = await db
    .select({
      memberId: agentDecisions.memberId,
      total: sql<string>`coalesce(sum(${agentDecisions.finalStakeWei}), 0)`,
    })
    .from(agentDecisions)
    .where(
      and(
        // A bet in flight counts. Only a bet the chain REFUSED is excluded, because that money
        // never left the wallet — and an over-cap attempt must not silently consume the budget
        // of the agent it was testing.
        inArray(agentDecisions.status, ["POLICY_APPROVED", "TX_PENDING", "TX_CONFIRMED"]),
        sql`${agentDecisions.createdAt} >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')`,
      ),
    )
    .groupBy(agentDecisions.memberId);

  return new Map(rows.map((row) => [row.memberId, BigInt(row.total)]));
}

/** Creates the `placeBet` intent for an approved decision and links it back to the row. */
async function placeBetIntentFor(input: {
  decisionId: string;
  agentAddress: string;
  onchainId: number;
  backsYes: boolean;
  stakeWei: bigint;
}): Promise<string> {
  const intent = await createIntent({
    // Derived from the decision row, so two passes racing on the same decision create one intent
    // and therefore one bet. This is the betting half of the guarantee `UNIQUE(idempotency_key)`
    // carries for market creation.
    idempotencyKey: `decision:${input.decisionId}:place-bet`,
    kind: "PLACE_BET",
    // SERVER, because the key *is* ours — encrypted in `members.agent_key_ciphertext`. The
    // `signer` column exists precisely so "not the deployer" stops meaning "not ours" (ADR-037).
    signer: "SERVER",
    from: input.agentAddress,
    functionName: "placeBet",
    args: [input.onchainId, input.backsYes],
    valueWei: input.stakeWei,
  });

  await db
    .update(agentDecisions)
    .set({ intentId: intent.id, status: "TX_PENDING", updatedAt: new Date() })
    .where(eq(agentDecisions.id, input.decisionId));

  return intent.id;
}

/**
 * Finishes any approved decision whose intent never got created.
 *
 * The window is one statement wide — between inserting the decision row and inserting the intent
 * — and on a serverless platform a one-statement window is a window that will eventually be hit.
 * Without this the pair would be skipped for ever after, because a decision row already exists
 * for it, and an approved bet would sit on the page having never been sent.
 */
async function resumeApproved(report: AgentReport): Promise<void> {
  const stranded = await db
    .select({
      id: agentDecisions.id,
      memberId: agentDecisions.memberId,
      marketId: agentDecisions.marketId,
      backsYes: agentDecisions.backsYes,
      finalStakeWei: agentDecisions.finalStakeWei,
      onchainId: markets.onchainId,
    })
    .from(agentDecisions)
    .innerJoin(markets, eq(agentDecisions.marketId, markets.id))
    .where(and(eq(agentDecisions.status, "POLICY_APPROVED"), sql`${agentDecisions.intentId} is null`))
    .limit(MAX_DECISIONS_PER_PASS);

  if (stranded.length === 0) return;

  const members = await listBettingMembers();

  for (const row of stranded) {
    const member = members.find((candidate) => candidate.id === row.memberId);
    if (member === undefined || row.onchainId === null) continue;
    if (row.backsYes === null || row.finalStakeWei === null) continue;

    await placeBetIntentFor({
      decisionId: row.id,
      agentAddress: member.agentAddress,
      onchainId: row.onchainId,
      backsYes: row.backsYes,
      stakeWei: BigInt(row.finalStakeWei),
    });
    report.resumed += 1;
  }
}

/**
 * Brings decision rows up to date with the intents they created.
 *
 * `TX_FAILED` is written for a reverted transaction, with the decoded revert reason copied onto
 * the row — and for this project a revert is frequently the *point*, not a fault. The over-cap
 * attempt ends here, as a row that says the server allowed a bet and the chain refused it.
 */
export async function reconcileDecisions(): Promise<number> {
  const settled = await db
    .select({
      decisionId: agentDecisions.id,
      reasons: agentDecisions.reasons,
      intentStatus: onchainIntents.status,
      txHash: onchainIntents.txHash,
      blockNumber: onchainIntents.blockNumber,
      revertReason: onchainIntents.revertReason,
    })
    .from(agentDecisions)
    .innerJoin(onchainIntents, eq(agentDecisions.intentId, onchainIntents.id))
    .where(
      and(
        eq(agentDecisions.status, "TX_PENDING"),
        inArray(onchainIntents.status, ["CONFIRMED", "REVERTED", "ABANDONED"]),
      ),
    );

  let updated = 0;

  for (const row of settled) {
    const confirmed = row.intentStatus === "CONFIRMED";
    const outcome = confirmed
      ? `CHAIN_CONFIRMED: mined in block ${row.blockNumber}.`
      : row.intentStatus === "REVERTED"
        ? `CHAIN_REFUSED: the contract reverted this bet — ${row.revertReason ?? "reason not decoded"}. ` +
          `Nothing was staked. This is the on-chain limit doing its job, not a server error.`
        : `CHAIN_ABANDONED: the transaction was never broadcast successfully.`;

    await db
      .update(agentDecisions)
      .set({
        status: confirmed ? "TX_CONFIRMED" : "TX_FAILED",
        reasons: [...row.reasons, outcome],
        updatedAt: new Date(),
      })
      .where(and(eq(agentDecisions.id, row.decisionId), eq(agentDecisions.status, "TX_PENDING")));

    await db.insert(auditLog).values({
      actor: "system:agents",
      action: confirmed ? "agent.bet_confirmed" : "agent.bet_refused",
      subjectType: "agent_decision",
      subjectId: row.decisionId,
      reason: outcome,
      txHash: row.txHash,
    });

    updated += 1;
  }

  return updated;
}

export type AgentPassOptions = ProposeBetOptions & {
  /** Bumped only by a deliberate re-run. A retry must reuse round 1, never invent round 2. */
  round?: number;
  /** Injected so a test can pin the screen's timing. Defaults to now. */
  now?: Date;
  limit?: number;
  /**
   * Epoch ms after which the pass stops taking new decisions and reports why.
   *
   * A call budget bounds how many models are asked; it does not bound how long they take. Each
   * Gemini call is allowed 22s (`GEMINI_TIMEOUT_MS`) and a tick's whole LLM allowance is nine
   * calls across three stages, against a 60s `maxDuration` on the serverless function. Those
   * numbers do not multiply out safely, and the failure mode is the bad one: an over-running
   * tick is killed mid-flight, so the caller gets no response, the report is never returned and
   * the audit row for the tick is never written — "nothing happened" and "nothing ran" become
   * indistinguishable, which is exactly what hard rule #7 exists to prevent.
   *
   * The deadline is **absolute from the start of the tick**, not a budget for this stage, so a
   * pass that arrives late because clustering was slow correctly does less rather than pushing
   * the tick over. Work already committed is never abandoned: the check sits before taking a new
   * decision, never between writing a decision row and creating its intent.
   */
  deadlineMs?: number;
};

/**
 * Runs one agent betting pass.
 *
 * Never throws: it is a tick stage, and returning a report means a pass that placed one bet and
 * then hit a rate limit still reports the bet it placed.
 */
export async function runAgentPass(
  budget: LlmBudget,
  options: AgentPassOptions = {},
): Promise<AgentReport> {
  const report = emptyReport();
  const round = options.round ?? 1;
  const now = options.now ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const maxDecisions = options.limit ?? MAX_DECISIONS_PER_PASS;
  const deadlineMs = options.deadlineMs ?? Number.POSITIVE_INFINITY;
  const outOfTime = (): boolean => Date.now() > deadlineMs;

  // Always, and before anything can return early. See the header.
  report.reconciled = await reconcileDecisions();
  await resumeApproved(report);

  if (globalKillSwitch()) {
    // One record, not one per pair. The switch is a single fact about the deployment, and the
    // evidence that it works is a pass that made no chain reads and wrote no rows.
    report.haltedBecause =
      "AGENTS_KILL_SWITCH is on: no agent was screened, no model was asked, no transaction was " +
      "prepared. The contract was not involved — this is an off-chain halt.";
    report.deferrals = ["GLOBAL_KILL_SWITCH"];
    await db.insert(auditLog).values({
      actor: "system:agents",
      action: "agents.halted",
      subjectType: "tick",
      subjectId: now.toISOString(),
      reason: report.haltedBecause,
    });
    return report;
  }

  const [openMarkets, allMembers] = await Promise.all([openApprovedMarkets(), listBettingMembers()]);
  report.markets = openMarkets.length;
  report.members = allMembers.length;

  if (openMarkets.length === 0 || allMembers.length === 0) {
    report.haltedBecause =
      openMarkets.length === 0
        ? "no open, human-approved market is available to bet on"
        : "no member has both an agent wallet and a policy";
    return report;
  }

  // Pairs already decided at this round are skipped — that is the idempotency guarantee
  // `UNIQUE(market_id, member_id, round)` carries, applied as a read so the pass does no work it
  // is only going to have rolled back by a conflict.
  const decided = await db
    .select({ marketId: agentDecisions.marketId, memberId: agentDecisions.memberId })
    .from(agentDecisions)
    .where(
      and(
        eq(agentDecisions.round, round),
        inArray(
          agentDecisions.marketId,
          openMarkets.map((market) => market.rowId),
        ),
      ),
    );
  const alreadyDecided = new Set(decided.map((row) => `${row.marketId}:${row.memberId}`));

  const pairs = openMarkets.flatMap((market) =>
    allMembers
      .filter((member) => !alreadyDecided.has(`${market.rowId}:${member.id}`))
      .map((member) => ({ market, member })),
  );
  report.pending = pairs.length;

  // Read once per pass, then advanced locally as bets are approved. Re-reading per pair would
  // still be a read of rows this pass itself wrote; keeping a running total is what stops two
  // approvals inside one pass from both passing a daily-budget check that only one of them
  // should have.
  const spentToday = await spentTodayByMember();
  const balances = new Map<string, bigint>();
  const articles = new Map<string, BetResearchInput["articles"]>();
  const deferrals = new Set<string>();
  const provider = getProvider();

  let decisions = 0;
  let examined = 0;

  for (const { market, member } of pairs) {
    if (decisions >= maxDecisions) {
      report.haltedBecause = `reached the ${maxDecisions}-decision limit for one pass`;
      break;
    }
    if (examined >= MAX_PAIRS_PER_PASS) {
      report.haltedBecause = `examined the ${MAX_PAIRS_PER_PASS}-pair limit for one pass`;
      break;
    }
    if (outOfTime()) {
      report.haltedBecause =
        `out of time for this tick after ${examined} pair(s) — the remaining pairs are ` +
        `untouched and the next tick picks them up`;
      break;
    }
    examined += 1;

    if (!balances.has(member.agentAddress)) {
      balances.set(member.agentAddress, await provider.getBalance(member.agentAddress));
    }

    // The chain, not our projection, decides whether this market is open and when it closes.
    // `/markets` makes the same choice for the same reason (ADR-028): the failure mode of a
    // mirror is showing yesterday's state as current, and here that would mean betting into a
    // closed market.
    const onChainMarket = await readMarket(market.onchainId, provider);
    const facts: MarketFacts = {
      onchainId: market.onchainId,
      category: market.spec.category,
      closeTime: onChainMarket.closeTime,
      state: onChainMarket.state,
    };

    const screenInput = {
      globalKillSwitch: false,
      policy: member.policy,
      market: facts,
      onChain: await readOnChainLimits(member.agentAddress, market.onchainId),
      spentTodayWei: spentToday.get(member.id) ?? 0n,
      agentBalanceWei: balances.get(member.agentAddress) ?? 0n,
      gasReserveWei: GAS_RESERVE_WEI,
      memberOwnerAddress: member.ownerAddress,
      now: nowSeconds,
    };

    const screened = screenAgent(screenInput);

    if (screened.verdict === "DEFER") {
      // No row. Nothing about this pair is settled, and writing a terminal row would foreclose a
      // market for a reason that resolves on its own.
      report.deferred += 1;
      for (const reason of screened.reasons) {
        deferrals.add(`${member.handle} on #${market.onchainId}: ${reason.split(":")[0]}`);
      }
      continue;
    }

    if (screened.verdict === "REJECT") {
      await writeDecision({
        market,
        member,
        round,
        status: "POLICY_REJECTED",
        reasons: screened.reasons,
      });
      report.screenRejected += 1;
      decisions += 1;
      continue;
    }

    // --- Only now is a model asked anything. --------------------------------------------------
    if (budget.remaining === 0) {
      report.haltedBecause = `LLM budget spent after ${report.asked} agent call(s)`;
      break;
    }
    // Checked again here, and not only at the top of the loop: the screen above makes two chain
    // calls, so a pair can cross the deadline between being admitted and reaching this line. A
    // model call is the one step that can take 22 seconds on its own.
    if (outOfTime()) {
      report.haltedBecause =
        `out of time for this tick before asking ${member.handle} about #${market.onchainId} — ` +
        `no model was called and nothing was written`;
      break;
    }

    if (!articles.has(market.rowId)) {
      articles.set(market.rowId, await articlesForMarket(market.rowId));
    }

    report.asked += 1;
    const outcome = await proposeBet(
      {
        market: {
          onchainId: market.onchainId,
          question: market.question,
          resolutionCriteria: market.spec.resolutionCriteria,
          resolutionSourceUrl: market.spec.resolutionSourceUrl,
          category: market.spec.category,
          closeTime: onChainMarket.closeTime,
        },
        memberHandle: member.handle,
        articles: articles.get(market.rowId) ?? [],
      },
      budget,
      { transport: options.transport },
    );

    if (outcome.kind === "UNAVAILABLE") {
      report.unavailable += 1;
      report.haltedBecause = outcome.reason;
      await db.insert(auditLog).values({
        actor: `agent:${member.agentAddress}`,
        action: "agent.deferred",
        subjectType: "market",
        subjectId: market.rowId,
        reason:
          `No model answered, so no decision was written and nothing was staked: ${outcome.reason}`,
        metadata: { handle: member.handle, onchainId: market.onchainId },
      });
      // A model unavailable for one pair is unavailable for the next.
      break;
    }

    if (outcome.kind === "REJECTED") {
      await writeDecision({
        market,
        member,
        round,
        status: "POLICY_REJECTED",
        reasons: [`SCHEMA_REJECTED: ${outcome.reason}`],
        model: outcome.model,
      });
      report.rejected += 1;
      decisions += 1;
      continue;
    }

    const gate: GateDecision = policyGate({
      ...screenInput,
      proposal: outcome.proposal,
      issuedLabels: outcome.issuedLabels,
    });

    const decisionId = await writeDecision({
      market,
      member,
      round,
      status: gate.allow ? "POLICY_APPROVED" : "POLICY_REJECTED",
      reasons: gate.reasons,
      model: outcome.model,
      proposal: outcome.proposal,
      gate,
    });

    decisions += 1;

    if (!gate.allow) {
      report.rejected += 1;
      continue;
    }

    if (decisionId === null) {
      // The unique index fired: another pass decided this pair between our read and our write.
      // Its decision stands; ours is discarded rather than retried.
      continue;
    }

    await placeBetIntentFor({
      decisionId,
      agentAddress: member.agentAddress,
      onchainId: market.onchainId,
      backsYes: outcome.proposal.side === "YES",
      stakeWei: gate.finalStakeWei,
    });

    // Advance the running total and the local balance, so the next pair in this same pass sees
    // the money as committed.
    spentToday.set(member.id, (spentToday.get(member.id) ?? 0n) + gate.finalStakeWei);
    balances.set(
      member.agentAddress,
      (balances.get(member.agentAddress) ?? 0n) - gate.finalStakeWei,
    );
    report.approved += 1;
  }

  report.deferrals = [...deferrals];

  if (report.deferrals.length > 0) {
    // One aggregated record per pass rather than one per pair: a member halted by its kill switch
    // would otherwise write four identical audit rows every tick for ever, and hard rule #7 asks
    // for every decision to be recorded with a reason, not for the same reason to be recorded
    // once per row it applies to.
    await db.insert(auditLog).values({
      actor: "system:agents",
      action: "agents.deferred",
      subjectType: "tick",
      subjectId: now.toISOString(),
      reason:
        `${report.deferred} (market, agent) pair(s) were left undecided and will be ` +
        `reconsidered next tick: ${report.deferrals.join(" · ")}`,
      metadata: { deferrals: report.deferrals },
    });
  }

  return report;
}

/**
 * Writes one decision row, approvals and rejections alike.
 *
 * Returns the new row's id, or null when the unique index refused it because another pass got
 * there first. `ON CONFLICT DO NOTHING` rather than an upsert: a decision is a record of what was
 * decided at a moment, and overwriting one would destroy the evidence this table exists to keep.
 */
async function writeDecision(input: {
  market: OpenMarket;
  member: MemberRow;
  round: number;
  status: "POLICY_APPROVED" | "POLICY_REJECTED";
  reasons: string[];
  model?: string | null;
  proposal?: { side: "YES" | "NO" | "ABSTAIN"; confidence: number; rationale: string; sourceLabels: readonly string[] };
  gate?: GateDecision;
}): Promise<string | null> {
  const [inserted] = await db
    .insert(agentDecisions)
    .values({
      marketId: input.market.rowId,
      memberId: input.member.id,
      round: input.round,
      backsYes:
        input.proposal === undefined || input.proposal.side === "ABSTAIN"
          ? null
          : input.proposal.side === "YES",
      confidence: input.proposal?.confidence ?? null,
      stakeRequestedWei: input.gate?.requestedStakeWei.toString() ?? null,
      // Null on a rejection, so the column means "what was allowed" and never "what was asked".
      // `spentTodayByMember` sums it, and a rejected proposal must not consume a budget.
      finalStakeWei:
        input.status === "POLICY_APPROVED" ? (input.gate?.finalStakeWei.toString() ?? null) : null,
      rationale: input.proposal?.rationale ?? null,
      sources: [...(input.proposal?.sourceLabels ?? [])],
      status: input.status,
      reasons: input.reasons,
    })
    .onConflictDoNothing({
      target: [agentDecisions.marketId, agentDecisions.memberId, agentDecisions.round],
    })
    .returning({ id: agentDecisions.id });

  if (inserted === undefined) return null;

  await db.insert(auditLog).values({
    actor: `agent:${input.member.agentAddress}`,
    action: input.status === "POLICY_APPROVED" ? "agent.bet_approved" : "agent.bet_rejected",
    subjectType: "agent_decision",
    subjectId: inserted.id,
    reason: input.reasons.join(" · "),
    metadata: {
      handle: input.member.handle,
      onchainId: input.market.onchainId,
      model: input.model ?? null,
      requestedStakeWei: input.gate?.requestedStakeWei.toString() ?? null,
      finalStakeWei: input.gate?.finalStakeWei.toString() ?? null,
      boundBy: input.gate?.boundBy ?? null,
    },
  });

  return inserted.id;
}

export { GAS_RESERVE_WEI, MAX_DECISIONS_PER_PASS };
