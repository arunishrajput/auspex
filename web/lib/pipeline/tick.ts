/**
 * One tick of the pipeline state machine.
 *
 * A tick advances the machine by a **bounded** amount and returns a structured report of what
 * moved. It is not a loop that runs until there is nothing left to do. That single decision is
 * what makes the pipeline safe to run from a cron, from a button, twice at once, or after a
 * crash: every stage is idempotent, so the cost of an extra tick is a few queries, and the
 * cost of a missed one is that the next tick does the work.
 *
 * **A failing stage does not fail the tick.** Each stage is caught individually and its error
 * recorded in the report. An RSS feed returning 403, a rate-limited model and a sleeping
 * database are all normal conditions on free infrastructure; a tick that aborted on the first
 * one would leave the pipeline permanently stuck behind whichever dependency was flakiest.
 * Hard rule #6.
 */

import { optionalEnv } from "../env";
import { db } from "../db/client";
import { auditLog } from "../db/schema";
import { runIndexer, type IndexReport } from "../indexer/run";
import { fetchAllFeeds, FEEDS } from "../news/feeds";
import { ingestFeedResults, seedSources, type IngestReport } from "../news/ingest";
import { runClusteringPass, type ClusterReport } from "../news/events";
import { LlmBudget, type LlmCallLog } from "../llm/client";
import { isConfigured } from "../llm/gemini";

/**
 * LLM calls one tick may make, across every stage.
 *
 * Four is deliberately small. Phase 3 spends them only on borderline cluster pairs, eight
 * pairs at a time, so the bound is 32 adjudications per tick — comfortably more than a
 * 48-hour window of news produces, while still being a number that cannot run away if the
 * similarity measure ever starts flagging everything as borderline.
 */
const DEFAULT_LLM_CALLS_PER_TICK = 4;

function llmBudgetSize(): number {
  const raw = Number(optionalEnv("LLM_CALLS_PER_TICK") ?? DEFAULT_LLM_CALLS_PER_TICK);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_LLM_CALLS_PER_TICK;
}

export type StageError = { stage: string; error: string };

export type TickReport = {
  startedAt: string;
  durationMs: number;
  llm: {
    configured: boolean;
    budget: number;
    callsMade: number;
    calls: readonly LlmCallLog[];
  };
  sourcesSeeded: number | null;
  ingest: IngestReport | null;
  cluster: ClusterReport | null;
  index: IndexReport | null;
  /** Stages that failed. An empty array means everything ran. */
  errors: StageError[];
};

/** Runs one stage, converting a throw into a recorded error. Never rethrows. */
async function stage<T>(
  name: string,
  errors: StageError[],
  run: () => Promise<T>,
): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[tick] stage ${name} failed:`, message);
    errors.push({ stage: name, error: message });
    return null;
  }
}

export type TickOptions = {
  /** Skip the chain indexer. The news stages are the slow part to iterate on. */
  skipIndex?: boolean;
  /** Injected so a test can pin the clustering window. */
  now?: Date;
};

export async function runTick(options: TickOptions = {}): Promise<TickReport> {
  const startedAt = new Date();
  const now = options.now ?? startedAt;
  const errors: StageError[] = [];
  const budget = new LlmBudget(llmBudgetSize());

  // 1 — the publisher allowlist. Idempotent, and cheap enough to reassert every tick rather
  //     than adding a migration step that can be forgotten.
  const sourcesSeeded = await stage("seed-sources", errors, () => seedSources());

  // 2 — ingest. Bounded by the feed list and MAX_ITEMS_PER_FEED.
  const ingest = await stage("ingest", errors, async () => {
    const results = await fetchAllFeeds(FEEDS);
    return ingestFeedResults(results);
  });

  // 3 — cluster and confirm. The only stage that may call a model, and it is budget-bounded.
  const cluster = await stage("cluster", errors, () => runClusteringPass(now, budget));

  // 4 — chain indexing. Last because it is the stage whose inputs nothing else depends on.
  const index =
    options.skipIndex === true
      ? null
      : await stage("index", errors, () => runIndexer());

  const report: TickReport = {
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    llm: {
      configured: isConfigured(),
      budget: budget.maxCalls,
      callsMade: budget.spent,
      calls: budget.entries(),
    },
    sourcesSeeded,
    ingest,
    cluster,
    index,
    errors,
  };

  // Hard rule #7: every tick leaves a record with a reason, including the ones that did
  // nothing. "Nothing happened" and "nothing ran" look identical from the outside otherwise.
  await stage("audit", errors, async () => {
    await db.insert(auditLog).values({
      actor: "system",
      action: "pipeline.tick",
      subjectType: "tick",
      subjectId: startedAt.toISOString(),
      reason: summarise(report),
      metadata: {
        ingest: report.ingest ?? undefined,
        cluster: report.cluster ?? undefined,
        llmCalls: report.llm.callsMade,
        errors: report.errors,
      },
    });
    return true;
  });

  return report;
}

/** One line a human can read in `/audit` without expanding the metadata. */
function summarise(report: TickReport): string {
  const parts: string[] = [];

  if (report.ingest !== null) {
    parts.push(
      `ingested ${report.ingest.itemsInserted} new of ${report.ingest.itemsFetched} fetched ` +
        `from ${report.ingest.feedsOk}/${report.ingest.feedsAttempted} feeds ` +
        `(${report.ingest.distinctPublishers} publishers)`,
    );
    if (report.ingest.flaggedForInjection > 0) {
      parts.push(`${report.ingest.flaggedForInjection} flagged for injection signatures`);
    }
  }

  if (report.cluster !== null) {
    parts.push(
      `clustered ${report.cluster.candidates} items into ` +
        `${report.cluster.eventsCreated} new events, ` +
        `${report.cluster.eventsConfirmed} confirmed`,
    );
    if (report.cluster.borderlinePairs > 0) {
      parts.push(
        `${report.cluster.adjudicated}/${report.cluster.borderlinePairs} borderline pairs adjudicated`,
      );
    }
    if (report.cluster.adjudicationHalted !== null) {
      parts.push(`adjudication halted: ${report.cluster.adjudicationHalted}`);
    }
  }

  if (report.index !== null) {
    parts.push(`indexed ${report.index.logsInserted} new logs`);
  }

  if (report.errors.length > 0) {
    parts.push(`errors: ${report.errors.map((e) => `${e.stage} (${e.error})`).join("; ")}`);
  }

  return parts.length === 0 ? "tick ran with no stages completing" : parts.join(" · ");
}
