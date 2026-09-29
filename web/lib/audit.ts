/**
 * Read models for `/audit`.
 *
 * `audit_log` is append-only: nothing in this codebase updates or deletes a row in it. That is what
 * makes the page worth showing — it is not a curated highlight reel, it is every decision the
 * pipeline made, in order, with the reason it recorded at the time.
 *
 * The filter below exists because "every decision" is thousands of rows and a reader needs to be
 * able to ask one question at a time. The default view is **unfiltered**, deliberately: a log whose
 * default hid the boring rows would be a log that could hide anything.
 */

import { desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "./db/client";
import { auditLog, type AuditEntry } from "./db/schema";

/**
 * The groups a reader can filter by, and which actions belong to each.
 *
 * Grouped by *who or what was deciding*, not by outcome. "Refusals" cuts across the others on
 * purpose — it is the view that answers "does any of this actually block anything?", which is the
 * question the whole page exists to answer, and hard rule #7 exists to make answerable.
 */
export const AUDIT_GROUPS = {
  all: { label: "everything", actions: [] as string[] },
  human: {
    label: "human decisions",
    actions: [
      "proposal.approved",
      "proposal.rejected",
      "resolution.proposed",
      "resolution.rejected",
      "resolution.challenged",
    ],
  },
  refusals: {
    label: "refusals",
    actions: [
      "proposal.rejected",
      "agent.bet_rejected",
      "agent.bet_refused",
      "resolution.rejected",
      "resolution.schema_rejected",
      "resolution.challenged",
      "intent.reverted",
      "intent.abandoned",
      "agents.halted",
    ],
  },
  agents: {
    label: "agent decisions",
    actions: [
      "agent.bet_approved",
      "agent.bet_rejected",
      "agent.bet_confirmed",
      "agent.bet_refused",
      "agent.deferred",
      "agents.deferred",
      "agents.halted",
    ],
  },
  resolution: {
    label: "resolution",
    actions: [
      "resolution.drafted",
      "resolution.unsettled",
      "resolution.schema_rejected",
      "resolution.proposed",
      "resolution.rejected",
      "resolution.challenged",
      "resolution.propose_failed",
      "resolution.deferred",
      "resolution.finalize_queued",
      "market.close_queued",
      "payout.claim_queued",
    ],
  },
  chain: {
    label: "chain writes",
    actions: [
      "intent.created",
      "intent.signed",
      "intent.broadcast",
      "intent.confirmed",
      "intent.reverted",
      "intent.retry",
      "intent.abandoned",
    ],
  },
} as const;

export type AuditGroup = keyof typeof AUDIT_GROUPS;

export function isAuditGroup(value: string | undefined): value is AuditGroup {
  return value !== undefined && value in AUDIT_GROUPS;
}

export type AuditPage = {
  entries: AuditEntry[];
  /** Total rows in the log, all groups. The honest denominator for "showing N of M". */
  total: number;
  /** Rows matching the current filter. */
  matching: number;
  error: string | null;
};

function groupFilter(group: AuditGroup): SQL | undefined {
  const actions = AUDIT_GROUPS[group].actions;
  if (actions.length === 0) return undefined;
  // `inArray` rather than a hand-written `IN (...)`: drizzle parameterises the list, and the
  // action names come from the constant above, so neither half of this can be user input.
  return inArray(auditLog.action, [...actions]);
}

/** One page of the log, newest first. Never throws — the page renders the error instead. */
export async function auditPage(group: AuditGroup, limit = 60): Promise<AuditPage> {
  try {
    const filter = groupFilter(group);

    const [entries, totals] = await Promise.all([
      db
        .select()
        .from(auditLog)
        .where(filter === undefined ? undefined : filter)
        .orderBy(desc(auditLog.createdAt))
        .limit(limit),
      db.execute<{ total: string; matching: string }>(sql`
        select
          count(*) as total,
          count(*) filter (
            where ${filter === undefined ? sql`true` : filter}
          ) as matching
        from audit_log
      `),
    ]);

    return {
      entries,
      total: Number(totals.rows[0]?.total ?? 0),
      matching: Number(totals.rows[0]?.matching ?? 0),
      error: null,
    };
  } catch (error) {
    return {
      entries: [],
      total: 0,
      matching: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Counts per action, newest activity first. The strip at the top of `/audit`. */
export async function auditActionCounts(): Promise<{ action: string; count: number }[]> {
  const rows = await db
    .select({ action: auditLog.action, count: sql<string>`count(*)` })
    .from(auditLog)
    .groupBy(auditLog.action)
    .orderBy(desc(sql`count(*)`));

  return rows.map((row) => ({ action: row.action, count: Number(row.count) }));
}

/** The most recent tick's summary line, for the header. */
export async function lastTickSummary(): Promise<AuditEntry | null> {
  const [row] = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, "pipeline.tick"))
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Whether every recorded decision carries a reason.
 *
 * `reason` is `NOT NULL` in the schema, so the only way to fail this is an empty string — and a
 * blank reason is an audit entry that is evidence of nothing. Checked and displayed rather than
 * assumed, because hard rule #7 is a claim this page is supposed to substantiate.
 */
export async function reasonlessEntries(): Promise<number> {
  const result = await db.execute<{ count: string }>(
    sql`select count(*) as count from audit_log where btrim(reason) = ''`,
  );
  return Number(result.rows[0]?.count ?? 0);
}
