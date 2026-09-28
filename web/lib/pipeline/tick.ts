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
import { runProposerPass, type ProposeReport } from "../proposer/run";
import { runNotificationPass, type NotifyReport } from "../notify/discord";
import { LlmBudget, type LlmCallLog } from "../llm/client";
import { isConfigured } from "../llm/gemini";
import { runIntentWorker, type ProcessResult } from "../intents/engine";

/**
 * LLM calls one tick may make, per stage.
 *
 * **Two budgets, not one shared allowance.** Clustering runs first, and with one pool a tick
 * whose feeds happened to produce a lot of borderline pairs would spend everything before the
 * proposer was asked anything — so the human review queue would starve exactly on the busy
 * days when it has the most to look at. Separate budgets make each stage's ceiling independent
 * of how the other one's day went.
 *
 * Four for clustering: eight pairs per call, so 32 adjudications per tick. Two for the
 * proposer: one draft plus one fallback model, and a tick only ever considers a couple of
 * events, because the queue is drained by a human and not by us.
 */
const DEFAULT_CLUSTER_CALLS = 4;
const DEFAULT_PROPOSER_CALLS = 2;

function budgetSize(key: string, fallback: number): number {
  const raw = Number(optionalEnv(key) ?? fallback);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : fallback;
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
  propose: ProposeReport | null;
  index: IndexReport | null;
  /** Externally-signed intents settled this tick. Server-signed ones have none to settle yet. */
  intents: ProcessResult[] | null;
  notify: NotifyReport | null;
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
  const clusterBudget = new LlmBudget(budgetSize("LLM_CALLS_PER_TICK", DEFAULT_CLUSTER_CALLS));
  const proposerBudget = new LlmBudget(
    budgetSize("LLM_PROPOSER_CALLS_PER_TICK", DEFAULT_PROPOSER_CALLS),
  );

  // 1 — the publisher allowlist. Idempotent, and cheap enough to reassert every tick rather
  //     than adding a migration step that can be forgotten.
  const sourcesSeeded = await stage("seed-sources", errors, () => seedSources());

  // 2 — ingest. Bounded by the feed list and MAX_ITEMS_PER_FEED.
  const ingest = await stage("ingest", errors, async () => {
    const results = await fetchAllFeeds(FEEDS);
    return ingestFeedResults(results);
  });

  // 3 — cluster and confirm. Budget-bounded; an unavailable model means "do not merge".
  const cluster = await stage("cluster", errors, () => runClusteringPass(now, clusterBudget));

  // 4 — draft market proposals from confirmed events. Writes to the human review queue and
  //     **nowhere else** — no transaction, no notification, no market. That is the phase's
  //     central claim, and it is true here by omission: this stage has no chain client.
  const propose = await stage("propose", errors, () =>
    runProposerPass(proposerBudget, { now }),
  );

  // 5 — settle any transaction a human signed since the last tick. The worker cannot sign an
  //     EXTERNAL intent, so all it does here is poll a receipt and record the outcome.
  const intents = await stage("intents", errors, () => runIntentWorker({ limit: 3 }));

  // 6 — chain indexing, which is what turns a confirmed `MarketCreated` log into a market row.
  const index =
    options.skipIndex === true
      ? null
      : await stage("index", errors, () => runIndexer());

  // 7 — notify, strictly last. It selects on indexed columns, so it cannot fire for a market
  //     that is not yet on chain even if every step above it went wrong.
  const notify =
    options.skipIndex === true
      ? null
      : await stage("notify", errors, () => runNotificationPass());

  const report: TickReport = {
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    llm: {
      configured: isConfigured(),
      budget: clusterBudget.maxCalls + proposerBudget.maxCalls,
      callsMade: clusterBudget.spent + proposerBudget.spent,
      calls: [...clusterBudget.entries(), ...proposerBudget.entries()],
    },
    sourcesSeeded,
    ingest,
    cluster,
    propose,
    index,
    intents,
    notify,
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

  if (report.propose !== null) {
    parts.push(
      `proposer: ${report.propose.proposed} queued for review, ` +
        `${report.propose.schemaRejected} schema-rejected, ` +
        `${report.propose.skippedNoSource} without a known publisher, ` +
        `of ${report.propose.pending} waiting`,
    );
    if (report.propose.haltedBecause !== null) {
      parts.push(`proposer halted: ${report.propose.haltedBecause}`);
    }
  }

  if (report.intents !== null && report.intents.length > 0) {
    parts.push(
      `intents: ${report.intents.map((i) => `${i.status} (${i.note})`).join("; ")}`,
    );
  }

  if (report.index !== null) {
    parts.push(`indexed ${report.index.logsInserted} new logs`);
  }

  if (report.notify !== null && report.notify.created > 0) {
    parts.push(
      `notified ${report.notify.created} market(s): ` +
        `${report.notify.sent} sent, ${report.notify.failed} failed, ${report.notify.skipped} skipped`,
    );
  }

  if (report.errors.length > 0) {
    parts.push(`errors: ${report.errors.map((e) => `${e.stage} (${e.error})`).join("; ")}`);
  }

  return parts.length === 0 ? "tick ran with no stages completing" : parts.join(" · ");
}
