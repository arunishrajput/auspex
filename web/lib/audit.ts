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

/**
 * What the pipeline's cadence and tick duration actually are, measured from the log.
 *
 * **This exists so that no sentence anywhere has to state a cadence.** `heartbeat.yml` asks for a
 * run every half hour; across 46 hours of 2026-09-28/30 GitHub delivered the previous every-five-
 * minutes expression 9 times — 1.6% of what was requested, a mean gap of 5h07m and a spread of
 * 2h57m to 6h44m. Scheduled workflows on a public repository are explicitly best-effort: GitHub
 * delays them under load and drops free runners first. Nothing makes it honour an expression.
 *
 * Writing "runs every five minutes" beside that was the defect Phase 11 existed to fix, and the
 * repair is not a better sentence — it is not having a sentence. A number on a live page comes
 * from a query or it does not go on the page. This is that query: the page states the interval the
 * log actually shows, so whatever GitHub does next, the page is right about it.
 *
 * `durationMs` is read from `metadata`, which only rows written after Phase 11 carry (gap #30), so
 * `measuredDurations` is reported separately from `ticks` rather than quietly averaging over a
 * denominator that includes rows where the column did not exist.
 */
export type CadenceWindow = {
  /** Ticks in this window. */
  ticks: number;
  /** Hours from the oldest to the newest of them. */
  spanHours: number | null;
  /** Mean, shortest and longest gap between consecutive ticks, in ms. */
  meanGapMs: number | null;
  minGapMs: number | null;
  maxGapMs: number | null;
};

export type CadenceReport = {
  /** Every tick in the window, whatever triggered it. The system's observed liveness. */
  all: CadenceWindow;
  /**
   * Only the ticks the cron delivered — the cadence with nobody watching.
   *
   * Empty until enough rows carry a `source`, which only rows written from Phase 11 onward do.
   * Reported separately rather than folded into `all` because the two answer different questions
   * and the difference between them is the whole point: `all` says how live the system has been,
   * `unattended` says how live it is when no one presses anything.
   */
  unattended: CadenceWindow;
  /** Ticks carrying a `source` at all. The honest denominator for `unattended`. */
  tagged: number;
  /** When the most recent tick of any kind ran. */
  lastTickAt: Date | null;
  /**
   * Duration statistics over **serverless** ticks only — those that ran against the route's 60s
   * budget and say so. A CLI tick is given 300s and is round-trip-bound at ~70s, so averaging the
   * two would produce a figure describing neither; a row with no recorded source could be either,
   * so it is excluded rather than assumed. Empty until such a tick has run.
   */
  measuredDurations: number;
  medianDurationMs: number | null;
  maxDurationMs: number | null;
  budgetMs: number | null;
  error: string | null;
};

const EMPTY_WINDOW: CadenceWindow = {
  ticks: 0,
  spanHours: null,
  meanGapMs: null,
  minGapMs: null,
  maxGapMs: null,
};

/** Gap statistics over a set of tick timestamps. Expects epoch ms, any order. */
function window(timesMs: readonly number[]): CadenceWindow {
  if (timesMs.length === 0) return EMPTY_WINDOW;
  const times = [...timesMs].sort((a, b) => a - b);
  if (times.length === 1) return { ...EMPTY_WINDOW, ticks: 1 };

  const gaps: number[] = [];
  for (let i = 1; i < times.length; i += 1) gaps.push(times[i] - times[i - 1]);
  const spanMs = times[times.length - 1] - times[0];

  return {
    ticks: times.length,
    spanHours: spanMs / 3_600_000,
    meanGapMs: Math.round(spanMs / gaps.length),
    minGapMs: Math.min(...gaps),
    maxGapMs: Math.max(...gaps),
  };
}

function emptyCadence(error: string | null): CadenceReport {
  return {
    all: EMPTY_WINDOW,
    unattended: EMPTY_WINDOW,
    tagged: 0,
    lastTickAt: null,
    measuredDurations: 0,
    medianDurationMs: null,
    maxDurationMs: null,
    budgetMs: null,
    error,
  };
}

/**
 * Reads the last `limit` ticks and derives the cadence from their timestamps.
 *
 * Never throws: it feeds a page, and a database that is asleep must not blank the audit trail.
 */
export async function cadenceReport(limit = 50): Promise<CadenceReport> {
  try {
    const rows = await db
      .select({ createdAt: auditLog.createdAt, metadata: auditLog.metadata })
      .from(auditLog)
      .where(eq(auditLog.action, "pipeline.tick"))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);

    if (rows.length === 0) return emptyCadence(null);

    const allTimes: number[] = [];
    const cronTimes: number[] = [];
    const durations: number[] = [];
    let tagged = 0;
    let budgetMs: number | null = null;

    for (const row of rows) {
      const metadata = row.metadata as
        | { durationMs?: unknown; budgetMs?: unknown; source?: unknown }
        | null;
      const at = row.createdAt.getTime();
      allTimes.push(at);

      const source = typeof metadata?.source === "string" ? metadata.source : null;
      if (source !== null) tagged += 1;
      if (source === "cron") cronTimes.push(at);

      // Durations only from ticks that ran against the serverless budget, which means a tick that
      // **says** it did. A CLI tick is given 300s and is round-trip-bound at ~70s, so folding one
      // into this median would describe neither kind of tick — and a row with no source at all is
      // a row from before Phase 11, which could be either. Excluded rather than assumed: an
      // unknown trigger is not evidence of a known one.
      if (source !== null && source !== "cli" && typeof metadata?.durationMs === "number") {
        durations.push(metadata.durationMs);
        if (budgetMs === null && typeof metadata.budgetMs === "number") budgetMs = metadata.budgetMs;
      }
    }

    durations.sort((a, b) => a - b);

    return {
      all: window(allTimes),
      unattended: window(cronTimes),
      tagged,
      lastTickAt: new Date(Math.max(...allTimes)),
      measuredDurations: durations.length,
      medianDurationMs: durations.length === 0 ? null : durations[Math.floor(durations.length / 2)],
      maxDurationMs: durations.length === 0 ? null : durations[durations.length - 1],
      budgetMs,
      error: null,
    };
  } catch (error) {
    return emptyCadence(error instanceof Error ? error.message : String(error));
  }
}
