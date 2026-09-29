/**
 * Read-only queries behind `/agents`. Nothing here mutates anything.
 *
 * ## Where each number on that page comes from, and why it matters
 *
 * The page's whole job is to make two limits visible at once, so it is careful about provenance:
 *
 *   **the off-chain policy** is read from `agent_policies` — our own row, editable by an operator;
 *   **the on-chain registry** is read with `eth_call` against the contract, every page load, with
 *   no cache and no fallback.
 *
 * They are fetched from different places on purpose and rendered side by side, because a reader who
 * cannot tell which is which cannot evaluate the claim. If the chain cannot be reached the page
 * says so and shows the policy alone, rather than filling the on-chain column with our own numbers
 * — which would be exactly the fabricated data hard rule #1 prohibits.
 *
 * ## A decision's status comes from its transaction, not from its own status column
 *
 * `agent_decisions.status` is a projection that a reconcile pass advances. The truth is the intent
 * row, which carries the receipt. So `chainStatus` is derived from the joined intent and the
 * decision's own column is only a fallback — the same ordering `/markets` uses for pools (ADR-028),
 * for the same reason: the failure mode of a mirror is showing yesterday's state as current.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, hasDatabase } from "../db/client";
import { agentDecisions, markets, onchainIntents } from "../db/schema";
import { getProvider } from "../chain/provider";
import { readAgent, readAgentRemainingOnMarket } from "../chain/auspex";
import { globalKillSwitch, listBettingMembers, onChainCapsFor, seedNoteFor } from "./members";

export type DecisionView = {
  id: string;
  handle: string;
  round: number;
  onchainId: number | null;
  question: string;
  status: (typeof agentDecisions.$inferSelect)["status"];
  /** What the chain actually did, from the intent's receipt. Null when there is no transaction. */
  chainStatus: (typeof onchainIntents.$inferSelect)["status"] | null;
  side: "YES" | "NO" | null;
  confidence: number | null;
  requestedStakeWei: bigint | null;
  finalStakeWei: bigint | null;
  rationale: string | null;
  sources: string[];
  /** The gate's own words, rendered verbatim. Approvals and refusals alike. */
  reasons: string[];
  txHash: string | null;
  blockNumber: number | null;
  revertReason: string | null;
  createdAt: Date;
};

export type MarketSpend = {
  onchainId: number;
  question: string;
  /** From the contract: per-market cap minus remaining headroom. */
  stakedWei: bigint;
  perMarketCapWei: bigint;
};

export type AgentPanel = {
  memberId: string;
  handle: string;
  note: string | null;
  ownerAddress: string;
  agentAddress: string;
  /** Live native balance of the agent wallet. Null when the chain could not be read. */
  balanceWei: bigint | null;
  policy: {
    perTxCapWei: bigint;
    dailyBudgetWei: bigint;
    minConfidence: number;
    allowedCategories: string[];
    killSwitch: boolean;
  };
  /** Read from the contract. Null when the chain could not be read. */
  onChain: {
    registered: boolean;
    active: boolean;
    perTxCapWei: bigint;
    perMarketCapWei: bigint;
    owner: string;
  } | null;
  /** What `onChainCapsFor` says the contract should hold, for comparison. */
  expectedOnChain: { perTxCapWei: bigint; perMarketCapWei: bigint };
  /** Non-null when the chain and the policy disagree. Shown, never silently repaired. */
  drift: string | null;
  spentTodayWei: bigint;
  /** Per-market headroom, for markets this agent has a confirmed bet on. */
  marketSpend: MarketSpend[];
};

export type AgentsPayload = {
  globalKillSwitch: boolean;
  panels: AgentPanel[];
  decisions: DecisionView[];
  /** Real error text when the chain could not be read. The page shows it rather than nothing. */
  chainError: string | null;
  /** Real error text when the database could not be read. */
  dbError: string | null;
};

function toBigInt(value: string | null): bigint | null {
  return value === null ? null : BigInt(value);
}

/** Every decision ever taken, newest first, with the transaction that carried it. */
export async function agentDecisionLog(limit = 40): Promise<DecisionView[]> {
  const rows = await db
    .select({
      id: agentDecisions.id,
      round: agentDecisions.round,
      memberId: agentDecisions.memberId,
      status: agentDecisions.status,
      backsYes: agentDecisions.backsYes,
      confidence: agentDecisions.confidence,
      stakeRequestedWei: agentDecisions.stakeRequestedWei,
      finalStakeWei: agentDecisions.finalStakeWei,
      rationale: agentDecisions.rationale,
      sources: agentDecisions.sources,
      reasons: agentDecisions.reasons,
      createdAt: agentDecisions.createdAt,
      onchainId: markets.onchainId,
      question: markets.question,
      intentStatus: onchainIntents.status,
      txHash: onchainIntents.txHash,
      blockNumber: onchainIntents.blockNumber,
      revertReason: onchainIntents.revertReason,
    })
    .from(agentDecisions)
    .innerJoin(markets, eq(agentDecisions.marketId, markets.id))
    .leftJoin(onchainIntents, eq(agentDecisions.intentId, onchainIntents.id))
    .orderBy(desc(agentDecisions.createdAt))
    .limit(limit);

  const members = await listBettingMembers();
  const handleById = new Map(members.map((member) => [member.id, member.handle]));

  return rows.map((row) => ({
    id: row.id,
    handle: handleById.get(row.memberId) ?? "(removed member)",
    round: row.round,
    onchainId: row.onchainId === null ? null : Number(row.onchainId),
    question: row.question,
    status: row.status,
    chainStatus: row.intentStatus ?? null,
    side: row.backsYes === null ? null : row.backsYes ? "YES" : "NO",
    confidence: row.confidence,
    requestedStakeWei: toBigInt(row.stakeRequestedWei),
    finalStakeWei: toBigInt(row.finalStakeWei),
    rationale: row.rationale,
    sources: row.sources,
    reasons: row.reasons,
    txHash: row.txHash,
    blockNumber: row.blockNumber === null ? null : Number(row.blockNumber),
    revertReason: row.revertReason,
    createdAt: row.createdAt,
  }));
}

/** Wei each member has committed today. Mirrors `spentTodayByMember` in `run.ts`. */
async function spentToday(): Promise<Map<string, bigint>> {
  const rows = await db
    .select({
      memberId: agentDecisions.memberId,
      total: sql<string>`coalesce(sum(${agentDecisions.finalStakeWei}), 0)`,
    })
    .from(agentDecisions)
    .where(
      and(
        inArray(agentDecisions.status, ["POLICY_APPROVED", "TX_PENDING", "TX_CONFIRMED"]),
        sql`${agentDecisions.createdAt} >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')`,
      ),
    )
    .groupBy(agentDecisions.memberId);

  return new Map(rows.map((row) => [row.memberId, BigInt(row.total)]));
}

/** Markets each member has a confirmed bet on, so per-market bars are bounded by real activity. */
async function marketsBetOn(): Promise<Map<string, { rowId: string; onchainId: number; question: string }[]>> {
  const rows = await db
    .selectDistinct({
      memberId: agentDecisions.memberId,
      rowId: markets.id,
      onchainId: markets.onchainId,
      question: markets.question,
    })
    .from(agentDecisions)
    .innerJoin(markets, eq(agentDecisions.marketId, markets.id))
    .where(eq(agentDecisions.status, "TX_CONFIRMED"));

  const out = new Map<string, { rowId: string; onchainId: number; question: string }[]>();
  for (const row of rows) {
    if (row.onchainId === null) continue;
    const list = out.get(row.memberId) ?? [];
    list.push({ rowId: row.rowId, onchainId: Number(row.onchainId), question: row.question });
    out.set(row.memberId, list);
  }
  return out;
}

/**
 * Everything `/agents` renders.
 *
 * Never throws. A chain failure and a database failure are both reported as text the page
 * displays, because a blank page is indistinguishable from "there are no agents".
 */
export async function getAgentsForDisplay(): Promise<AgentsPayload> {
  const payload: AgentsPayload = {
    globalKillSwitch: globalKillSwitch(),
    panels: [],
    decisions: [],
    chainError: null,
    dbError: null,
  };

  if (!hasDatabase()) {
    payload.dbError = "DATABASE_URL is not configured on this deployment.";
    return payload;
  }

  let members: Awaited<ReturnType<typeof listBettingMembers>> = [];
  let spend = new Map<string, bigint>();
  let betOn = new Map<string, { rowId: string; onchainId: number; question: string }[]>();

  try {
    [members, payload.decisions, spend, betOn] = await Promise.all([
      listBettingMembers(),
      agentDecisionLog(),
      spentToday(),
      marketsBetOn(),
    ]);
  } catch (error) {
    payload.dbError = error instanceof Error ? error.message : String(error);
    return payload;
  }

  const provider = getProvider();

  for (const member of members) {
    const expectedOnChain = onChainCapsFor(member.policy);
    const panel: AgentPanel = {
      memberId: member.id,
      handle: member.handle,
      note: seedNoteFor(member.handle),
      ownerAddress: member.ownerAddress,
      agentAddress: member.agentAddress,
      balanceWei: null,
      policy: member.policy,
      onChain: null,
      expectedOnChain,
      drift: null,
      spentTodayWei: spend.get(member.id) ?? 0n,
      marketSpend: [],
    };

    try {
      const [balance, agent] = await Promise.all([
        provider.getBalance(member.agentAddress),
        readAgent(member.agentAddress, provider),
      ]);
      panel.balanceWei = balance;
      panel.onChain = {
        registered: agent.registered,
        active: agent.active,
        perTxCapWei: agent.perTxCapWei,
        perMarketCapWei: agent.perMarketCapWei,
        owner: agent.owner,
      };

      const problems: string[] = [];
      if (!agent.registered) {
        problems.push("the contract has no registry entry for this agent, so it is not yet capped on chain");
      } else {
        if (agent.perTxCapWei !== expectedOnChain.perTxCapWei) {
          problems.push("the on-chain per-tx cap does not match what this policy implies");
        }
        if (agent.perMarketCapWei !== expectedOnChain.perMarketCapWei) {
          problems.push("the on-chain per-market cap does not match what this policy implies");
        }
        if (agent.owner !== member.ownerAddress) {
          problems.push(`the contract pays winnings to ${agent.owner}, not to ${member.ownerAddress}`);
        }
        if (!agent.active) problems.push("the contract has this agent deactivated");
      }
      panel.drift = problems.length === 0 ? null : problems.join("; ");

      // Bounded by markets this agent actually has a confirmed bet on — never the whole market
      // list, so the page's read count does not grow with the contract.
      for (const market of betOn.get(member.id) ?? []) {
        const remaining = await readAgentRemainingOnMarket(
          market.onchainId,
          member.agentAddress,
          provider,
        );
        panel.marketSpend.push({
          onchainId: market.onchainId,
          question: market.question,
          stakedWei: agent.perMarketCapWei - remaining,
          perMarketCapWei: agent.perMarketCapWei,
        });
      }
      panel.marketSpend.sort((a, b) => a.onchainId - b.onchainId);
    } catch (error) {
      // Recorded once for the page, and the policy column still renders. The on-chain column
      // stays empty rather than being filled with our own numbers.
      payload.chainError = error instanceof Error ? error.message : String(error);
    }

    payload.panels.push(panel);
  }

  return payload;
}

export type GateCounters = {
  /** Proposals the gate allowed. */
  approved: number;
  /** Proposals the gate refused. The interesting number — see docs/TRUST_MODEL.md. */
  rejected: number;
  /** Bets the chain confirmed. */
  confirmed: number;
  /** Bets the chain refused. Non-zero means the on-chain cap has been exercised for real. */
  refusedOnChain: number;
  totalStakedWei: bigint;
};

/**
 * Counters for the home page and, in Phase 7, `/trust`.
 *
 * `rejected` and `refusedOnChain` being zero would mean the gates have never been exercised and
 * the demo has proven nothing. They are the evidence, so they are counted as first-class figures
 * rather than derived on the fly in a template.
 */
export async function gateCounters(): Promise<GateCounters> {
  const rows = await db
    .select({
      status: agentDecisions.status,
      count: sql<string>`count(*)`,
      staked: sql<string>`coalesce(sum(${agentDecisions.finalStakeWei}), 0)`,
    })
    .from(agentDecisions)
    .groupBy(agentDecisions.status);

  const counters: GateCounters = {
    approved: 0,
    rejected: 0,
    confirmed: 0,
    refusedOnChain: 0,
    totalStakedWei: 0n,
  };

  for (const row of rows) {
    const count = Number(row.count);
    if (row.status === "POLICY_REJECTED") counters.rejected += count;
    if (row.status === "TX_FAILED") counters.refusedOnChain += count;
    if (row.status === "TX_CONFIRMED") {
      counters.confirmed += count;
      counters.totalStakedWei += BigInt(row.staked);
    }
    if (row.status === "POLICY_APPROVED" || row.status === "TX_PENDING" || row.status === "TX_CONFIRMED") {
      counters.approved += count;
    }
  }

  return counters;
}
