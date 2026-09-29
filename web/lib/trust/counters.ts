/**
 * The refusal counters behind `/trust`.
 *
 * ## Why the refusals are the headline and not the successes
 *
 * "An AI drafted a market and a human approved it" is a claim any demo can make. "An AI drafted
 * 14 things, code refused 3 of them before a human saw them, a human refused 2 more, the policy
 * gate refused 11 bets, and the chain refused 4 transactions our own server had signed" is a claim
 * that can only be made by a system where the gates are load-bearing. So every number here counts
 * something that was *stopped*, and every one is a `GROUP BY` over a real table — nothing is a
 * constant and nothing is computed in a template.
 *
 * Four layers, each strictly stronger than the one above it:
 *
 *   `schema`  the model's output was refused by Zod before any code read it     — cheapest
 *   `gate`    a deterministic pure function refused the decision                — off-chain
 *   `human`   a person read it and said no, with a signature or a reason        — judgement
 *   `chain`   the contract refused a transaction this server had already signed — final
 *
 * The last one is the only one that survives the server being compromised, which is why it is
 * broken down by the contract's own error name rather than being shown as a single total.
 */

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  agentDecisions,
  auditLog,
  onchainIntents,
  proposals,
  resolutionDrafts,
} from "../db/schema";

/** A named refusal and how many times it has happened. */
export type RefusalBucket = { label: string; count: number };

export type TrustCounters = {
  /** Model outputs refused by the schema layer, before any code acted on them. */
  schemaRefused: { proposals: number; resolutionDrafts: number };
  /** Refusals by the deterministic policy gate, broken down by its own reason code. */
  gate: { total: number; byReason: RefusalBucket[] };
  /** Refusals by a person: an unsigned market spec, an unsigned resolution. */
  human: { proposals: number; resolutionDrafts: number };
  /** Transactions the chain refused, by the contract's own decoded custom error. */
  chain: { total: number; byError: RefusalBucket[] };
  /** For context: what did get through, so the refusals are read as a ratio and not a total. */
  allowed: {
    marketsCreated: number;
    betsConfirmed: number;
    resolutionsProposed: number;
    claimsPaid: number;
  };
  /** Audit rows, and how many carry a reason. Hard rule #7, counted. */
  audit: { total: number; withReason: number };
};

/**
 * The machine-readable prefix of a gate reason.
 *
 * Every reason the gate writes is `CODE: a sentence` — see `policyGate.ts`. Grouping on the prefix
 * turns free text into a histogram without storing the code in a second column, and the sentence
 * stays in the row where a reader can see it. A reason with no prefix is bucketed as `UNLABELLED`
 * rather than dropped, because a gate reason nobody can group is a defect worth seeing.
 */
function reasonCode(reason: string): string {
  const match = /^([A-Z][A-Z0-9_]{2,})\s*:/.exec(reason.trim());
  return match === null ? "UNLABELLED" : match[1];
}

/**
 * The contract error name out of a decoded revert reason.
 *
 * `revert_reason` holds what `describeRevert` produced — `AgentPerTxCapExceeded(2e17, 1e17)` — so
 * the name is everything before the first parenthesis. Arguments are deliberately dropped here:
 * they differ per transaction and would make every revert its own bucket, which is the opposite of
 * what a counter is for. They are still on `/agents` and on the explorer, in full.
 */
function revertErrorName(reason: string | null): string {
  if (reason === null || reason.trim() === "") return "not decoded";
  const name = reason.split("(")[0].trim();
  return name === "" ? "not decoded" : name;
}

function sortDescThenName(buckets: RefusalBucket[]): RefusalBucket[] {
  return buckets.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Reads every counter in one pass of queries.
 *
 * Seven independent `SELECT`s issued together rather than in sequence: a local Neon round trip is
 * ~0.5s, so run in series this page would take three seconds to produce numbers that share no
 * dependency at all (ADR-033, the same lesson the tick learned). The caller wraps it — `/trust`
 * renders an honest failure panel rather than a 500, same as every other page that reads Postgres.
 */
export async function trustCounters(): Promise<TrustCounters> {
  const [
    proposalStatuses,
    draftStatuses,
    decisionStatuses,
    gateReasonRows,
    revertRows,
    intentKinds,
    auditTotals,
  ] = await Promise.all([
    db
      .select({ status: proposals.status, count: sql<string>`count(*)` })
      .from(proposals)
      .groupBy(proposals.status),

    db
      .select({ status: resolutionDrafts.status, count: sql<string>`count(*)` })
      .from(resolutionDrafts)
      .groupBy(resolutionDrafts.status),

    db
      .select({ status: agentDecisions.status, count: sql<string>`count(*)` })
      .from(agentDecisions)
      .groupBy(agentDecisions.status),

    // The reasons are a jsonb array, so the rows are unnested in Postgres rather than pulled into
    // Node and flattened here. One round trip, and the count is correct even for a decision that
    // records several reasons — which most refusals do.
    db
      .select({ reason: sql<string>`jsonb_array_elements_text(${agentDecisions.reasons})` })
      .from(agentDecisions)
      .where(eq(agentDecisions.status, "POLICY_REJECTED")),

    db
      .select({ revertReason: onchainIntents.revertReason, count: sql<string>`count(*)` })
      .from(onchainIntents)
      .where(eq(onchainIntents.status, "REVERTED"))
      .groupBy(onchainIntents.revertReason),

    db
      .select({
        kind: onchainIntents.kind,
        status: onchainIntents.status,
        count: sql<string>`count(*)`,
      })
      .from(onchainIntents)
      .groupBy(onchainIntents.kind, onchainIntents.status),

    db
      .select({
        total: sql<string>`count(*)`,
        withReason: sql<string>`count(*) filter (where ${auditLog.reason} is not null and length(trim(${auditLog.reason})) > 0)`,
      })
      .from(auditLog),
  ]);

  const proposalCount = (status: string): number =>
    Number(proposalStatuses.find((row) => row.status === status)?.count ?? 0);
  const draftCount = (status: string): number =>
    Number(draftStatuses.find((row) => row.status === status)?.count ?? 0);
  const confirmed = (kind: string): number =>
    Number(
      intentKinds.find((row) => row.kind === kind && row.status === "CONFIRMED")?.count ?? 0,
    );

  const gateBuckets = new Map<string, number>();
  for (const row of gateReasonRows) {
    const code = reasonCode(row.reason);
    gateBuckets.set(code, (gateBuckets.get(code) ?? 0) + 1);
  }

  const revertBuckets = new Map<string, number>();
  let revertTotal = 0;
  for (const row of revertRows) {
    const name = revertErrorName(row.revertReason);
    const count = Number(row.count);
    revertBuckets.set(name, (revertBuckets.get(name) ?? 0) + count);
    revertTotal += count;
  }

  return {
    schemaRefused: {
      proposals: proposalCount("SCHEMA_REJECTED"),
      resolutionDrafts: draftCount("SCHEMA_REJECTED"),
    },
    gate: {
      total: Number(
        decisionStatuses.find((row) => row.status === "POLICY_REJECTED")?.count ?? 0,
      ),
      byReason: sortDescThenName(
        [...gateBuckets].map(([label, count]) => ({ label, count })),
      ),
    },
    human: {
      proposals: proposalCount("REJECTED"),
      resolutionDrafts: draftCount("REJECTED"),
    },
    chain: {
      total: revertTotal,
      byError: sortDescThenName([...revertBuckets].map(([label, count]) => ({ label, count }))),
    },
    allowed: {
      marketsCreated: confirmed("CREATE_MARKET"),
      betsConfirmed: confirmed("PLACE_BET"),
      resolutionsProposed: confirmed("PROPOSE_RESOLUTION"),
      claimsPaid: confirmed("CLAIM"),
    },
    audit: {
      total: Number(auditTotals[0]?.total ?? 0),
      withReason: Number(auditTotals[0]?.withReason ?? 0),
    },
  };
}

/** One judge-triggered probe, for the log on `/trust`. */
export type JudgeProbeRow = {
  id: string;
  createdAt: Date;
  reason: string;
  txHash: string | null;
  metadata: Record<string, unknown>;
};

/**
 * The judge-mode probes, newest first.
 *
 * Read from `audit_log` and not from `agent_decisions`, because a probe is not a decision an agent
 * took — no model was asked and no gate ran. See ADR-062: giving it a decision row would put a
 * visitor's button press into a member's trading record.
 */
export async function judgeProbes(limit = 8): Promise<JudgeProbeRow[]> {
  const rows = await db
    .select({
      id: auditLog.id,
      createdAt: auditLog.createdAt,
      reason: auditLog.reason,
      txHash: auditLog.txHash,
      metadata: auditLog.metadata,
    })
    .from(auditLog)
    .where(eq(auditLog.action, "judge.cap_probe"))
    .orderBy(sql`${auditLog.createdAt} desc`)
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    reason: row.reason ?? "",
    txHash: row.txHash,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  }));
}

/**
 * Every transaction the chain refused, with enough context to open it on the explorer.
 *
 * The `/trust` page shows these in full rather than as a count, because a reverted transaction is
 * the single most checkable artifact this project has: a judge can open the hash and read the
 * contract's own refusal without taking our word for anything.
 */
export async function refusedTransactions(limit = 12) {
  return db
    .select({
      id: onchainIntents.id,
      kind: onchainIntents.kind,
      functionName: onchainIntents.functionName,
      fromAddress: onchainIntents.fromAddress,
      valueWei: onchainIntents.valueWei,
      txHash: onchainIntents.txHash,
      blockNumber: onchainIntents.blockNumber,
      revertReason: onchainIntents.revertReason,
      createdAt: onchainIntents.createdAt,
    })
    .from(onchainIntents)
    .where(and(eq(onchainIntents.status, "REVERTED"), isNotNull(onchainIntents.txHash)))
    .orderBy(sql`${onchainIntents.createdAt} desc`)
    .limit(limit);
}

/**
 * Audit rows with no reason. Should always be zero — hard rule #7 in one query.
 *
 * `lib/audit.ts` already exports `reasonlessEntries()`; this is the same idea with the offending
 * actions named, so a non-zero answer points at the code that has to be fixed instead of just
 * saying a number is wrong.
 */
export async function reasonlessActions(): Promise<RefusalBucket[]> {
  const rows = await db
    .select({ action: auditLog.action, count: sql<string>`count(*)` })
    .from(auditLog)
    .where(sql`${auditLog.reason} is null or length(trim(${auditLog.reason})) = 0`)
    .groupBy(auditLog.action);

  return sortDescThenName(
    rows.map((row) => ({ label: row.action, count: Number(row.count) })),
  );
}

/** Exported for the unit tests — these two are the only parsing in this file. */
export { reasonCode, revertErrorName };
