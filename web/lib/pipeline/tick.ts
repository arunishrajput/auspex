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
import { reconcileDecisions, runAgentPass, type AgentReport } from "../agents/run";
import { runResolutionPass, type ResolutionReport } from "../resolution/run";
import { reconcileDrafts, runSettlePass, type SettleReport } from "../resolution/settle";
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
 * events, because the queue is drained by a human and not by us. Three for the agents.
 */
const DEFAULT_CLUSTER_CALLS = 4;
const DEFAULT_PROPOSER_CALLS = 2;
/**
 * Three for the member agents: one call per (market, agent) pair it gets to, with no fallback
 * model, because a pair that gets no answer is retried next tick and costs nothing to skip.
 *
 * A **third** budget rather than a share of an existing one, for the reason the other two are
 * separate: with a single pool, a tick whose feeds happened to produce many borderline pairs would
 * spend everything on clustering and the agents would go quiet exactly on the busiest days.
 */
const DEFAULT_AGENT_CALLS = 3;

/**
 * One for the resolution agent. It reads a closed market and proposes an outcome for a human.
 *
 * One rather than two because a resolution draft is the most expensive thing a tick can ask for in
 * wall-clock terms — a single call is allowed 22 seconds — and the queue it feeds is drained by a
 * person, not by us. There is no benefit to drafting two outcomes in one tick that a human will
 * read three minutes apart, and there is a real cost: see the deadline ladder below.
 */
const DEFAULT_RESOLUTION_CALLS = 1;

/**
 * How far into a tick the agents stage may still start new work.
 *
 * `maxDuration` on `POST /api/tick` is 60s. Measured in production: a tick with no agent model
 * calls takes ~15s, and a single Gemini call is allowed 22s. Three stages sharing a nine-call
 * allowance can therefore, in the worst case, exceed the function's limit — and an over-running
 * tick is killed before it returns a report or writes its audit row, which is the one failure
 * this pipeline is built to avoid.
 *
 * 38s leaves roughly 20s for the intent worker, the indexer, the notifier and the audit write.
 * The agents stage yields rather than starting work it cannot finish, and says so in its report.
 */
/**
 * How long a tick may take, and the deadline ladder derived from it.
 *
 * `maxDuration` on `POST /api/tick` is 60s, which is the default here. A tick now has four stages
 * that can call a model, and each call is allowed `GEMINI_TIMEOUT_MS` (22,000). Those numbers do not
 * multiply out safely, and the failure mode is the worst available: an over-running tick is killed
 * before it returns a report **or writes its audit row**, so the one tick that went wrong is the one
 * that leaves no trace (hard rule #7).
 *
 * Every deadline is **absolute from the start of the tick**, not a per-stage budget. That matters: a
 * stage that arrives late because an earlier one was slow correctly does less, rather than pushing the
 * tick over. Each stage yields rather than starting work it cannot finish, and says so in its report —
 * a graceful partial pass, with the backlog drained by the next tick.
 *
 *   resolution drafting   40%  one 22s call can still finish inside the function
 *   member agents         63%  ≈38s at the default, the figure Phase 5 measured against
 *   settlement            80%  chain reads and inserts only, but it precedes an intent worker
 *
 * **The ladder scales from one number**, rather than being three constants, because the CLI has no
 * serverless limit at all. A tick from a laptop is dominated by Neon round trips and takes ~90s
 * (ADR-033), so fixed 60s-shaped deadlines meant `pnpm --filter web tick` silently skipped its last
 * three stages — the tick did less on the machine where you are watching it than in production.
 * `scripts/tick.ts` passes a generous budget; the HTTP route uses the default that matches its own
 * `maxDuration`.
 *
 * Clustering and the proposer are not yet bounded this way; `PROGRESS.md` carries that as a known gap
 * rather than a claim.
 */
const DEFAULT_TICK_BUDGET_MS = 60_000;

const STAGE_DEADLINE_FRACTION = {
  resolution: 0.4,
  agents: 0.63,
  settle: 0.8,
} as const;

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
  agents: AgentReport | null;
  /** Outcomes drafted for closed markets, queued for a human resolver. */
  resolution: ResolutionReport | null;
  /** close / finalize / claim — the permissionless half of the lifecycle. */
  settle: SettleReport | null;
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
  /**
   * How long this tick may take, in ms. Drives every stage deadline.
   *
   * Defaults to 60,000 — the `maxDuration` of `POST /api/tick`. The CLI passes a larger value
   * because it runs with no such limit and a local tick is round-trip-bound, not CPU-bound.
   */
  maxDurationMs?: number;
};

export async function runTick(options: TickOptions = {}): Promise<TickReport> {
  const startedAt = new Date();
  const now = options.now ?? startedAt;
  const errors: StageError[] = [];
  const budgetMs = options.maxDurationMs ?? DEFAULT_TICK_BUDGET_MS;
  const deadline = (stage: keyof typeof STAGE_DEADLINE_FRACTION): number =>
    startedAt.getTime() + Math.floor(budgetMs * STAGE_DEADLINE_FRACTION[stage]);
  const clusterBudget = new LlmBudget(budgetSize("LLM_CALLS_PER_TICK", DEFAULT_CLUSTER_CALLS));
  const proposerBudget = new LlmBudget(
    budgetSize("LLM_PROPOSER_CALLS_PER_TICK", DEFAULT_PROPOSER_CALLS),
  );
  const agentBudget = new LlmBudget(budgetSize("LLM_AGENT_CALLS_PER_TICK", DEFAULT_AGENT_CALLS));
  const resolutionBudget = new LlmBudget(
    budgetSize("LLM_RESOLUTION_CALLS_PER_TICK", DEFAULT_RESOLUTION_CALLS),
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

  // 5 — draft outcomes for markets that have closed. The retrieval of candidate evidence is
  //     deterministic (IDF-weighted similarity to the question, restricted to articles ingested
  //     since the market opened) — a model that chose its own sources would have chosen the
  //     answer. It writes to the resolver's queue and **nowhere else**: no transaction, no
  //     notification, no outcome. Placed before the agents stage because a market that has closed
  //     needs settling more urgently than a market that is still open needs another bet.
  const resolution = await stage("resolve-draft", errors, () =>
    runResolutionPass(resolutionBudget, {
      now,
      deadlineMs: deadline("resolution"),
    }),
  );

  // 6 — member agents. Reads open, human-approved markets, asks each member's agent for a
  //     position, and puts every answer through the deterministic policy gate. Only the gate can
  //     authorise a stake, and it records its reasons for refusals and approvals alike.
  const agents = await stage("agents", errors, () =>
    runAgentPass(agentBudget, {
      now,
      // Absolute, from the start of THIS tick. Leaves the remainder of the budget for the intent
      // worker, the indexer, the notifier and the tick's own audit row — all of which must run for
      // the tick to have told the truth about itself.
      deadlineMs: deadline("agents"),
    }),
  );

  // 7 — settle transactions. This is where a bet the gate approved moments ago is signed with the
  //     agent's own key and broadcast, and where a market a human signed since the last tick has
  //     its receipt polled. The limit is 5 rather than 3 because the agents stage above can now
  //     create several intents in one pass, and an intent left unclaimed for a tick is a bet that
  //     appears on the page as pending for three minutes longer than it needed to.
  const intents = await stage("intents", errors, () => runIntentWorker({ limit: 5 }));

  // 7b — reconcile again, now that the worker above has settled this tick's bets.
  //
  //      `runAgentPass` already reconciles, but it runs *before* the worker, so on its own a bet
  //      approved, signed and confirmed inside one tick would sit at `TX_PENDING` until the next
  //      one — three minutes of a page saying "in flight" about a transaction already in a block.
  //      One extra query closes that, and it is the same idempotent function either way.
  const reconciled = await stage("reconcile", errors, () => reconcileDecisions());
  if (agents !== null && reconciled !== null) agents.reconciled += reconciled;

  // 8 — chain indexing, which is what turns a confirmed `MarketCreated` log into a market row.
  const index =
    options.skipIndex === true
      ? null
      : await stage("index", errors, () => runIndexer());

  // 9 — the permissionless half of the lifecycle: close a market past its close time, finalise a
  //     resolution whose challenge window has elapsed, and claim whatever the contract says it
  //     owes an agent. Placed AFTER the indexer so it reads the freshest projection, and signed by
  //     an agent wallet holding no role — because none of these three calls needs one. That is the
  //     claim, executed rather than asserted: a judge can finalise a market from their own wallet.
  //
  //     Skipped past `SETTLE_STAGE_DEADLINE_MS` because it is followed by an intent worker that
  //     waits for receipts. Nothing is lost: none of these transactions expires, and the next tick
  //     queues them.
  const settleDeadline = deadline("settle");
  const lateForSettle = Date.now() > settleDeadline;
  // A deliberate skip is **not** a stage error. It is recorded as a note on the settle report, so
  // `report.errors` keeps meaning "something went wrong" — the CLI and the cron both exit non-zero
  // on that array, and a tick that correctly declined optional work must not read as a failure.
  const settle =
    options.skipIndex === true
      ? null
      : lateForSettle
        ? {
            closed: 0,
            finalized: 0,
            invalidated: 0,
            claimed: 0,
            claimableWei: "0",
            reconciled: 0,
            notes: [
              `skipped: the tick was already past ${settleDeadline - startedAt.getTime()}ms of its ` +
                `${budgetMs}ms budget, and settlement is followed by an intent worker that waits ` +
                `for receipts. Nothing is lost — none of these transactions expires, and the next ` +
                `tick queues them.`,
            ],
          }
        : await stage("settle", errors, () => runSettlePass({ now }));

  // 9b — sign what settlement just queued, rather than leaving a finalisation or a payout waiting
  //      three minutes for the next tick. Smaller limit than step 7: this runs late in the tick.
  const settleIntents =
    settle === null || lateForSettle
      ? null
      : await stage("settle-intents", errors, () => runIntentWorker({ limit: 3 }));

  // 9c — and bring the draft rows up to date with whatever those intents did.
  await stage("reconcile-drafts", errors, async () => {
    const count = await reconcileDrafts();
    if (settle !== null) settle.reconciled += count;
    return count;
  });

  // 10 — notify, strictly last. It selects on indexed columns, so it cannot fire for a market
  //      that is not yet on chain even if every step above it went wrong.
  const notify =
    options.skipIndex === true
      ? null
      : await stage("notify", errors, () => runNotificationPass());

  const report: TickReport = {
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    llm: {
      configured: isConfigured(),
      budget:
        clusterBudget.maxCalls +
        proposerBudget.maxCalls +
        agentBudget.maxCalls +
        resolutionBudget.maxCalls,
      callsMade:
        clusterBudget.spent + proposerBudget.spent + agentBudget.spent + resolutionBudget.spent,
      calls: [
        ...clusterBudget.entries(),
        ...proposerBudget.entries(),
        ...resolutionBudget.entries(),
        ...agentBudget.entries(),
      ],
    },
    sourcesSeeded,
    ingest,
    cluster,
    propose,
    agents,
    resolution,
    settle,
    index,
    intents: intents === null ? settleIntents : [...intents, ...(settleIntents ?? [])],
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

  if (report.agents !== null) {
    const agents = report.agents;
    parts.push(
      `agents: ${agents.approved} bet(s) approved, ` +
        `${agents.rejected + agents.screenRejected} rejected by the gate, ` +
        `${agents.deferred} deferred, ${agents.asked} model call(s), ` +
        `over ${agents.markets} open market(s) and ${agents.members} member(s)`,
    );
    if (agents.reconciled > 0) parts.push(`${agents.reconciled} decision(s) reconciled with the chain`);
    if (agents.resumed > 0) parts.push(`${agents.resumed} approved decision(s) resumed`);
    if (agents.haltedBecause !== null) parts.push(`agents halted: ${agents.haltedBecause}`);
  }

  if (report.resolution !== null) {
    const resolution = report.resolution;
    parts.push(
      `resolution: ${resolution.drafted} outcome(s) queued for a human, ` +
        `${resolution.unsettled} not settled yet, ${resolution.schemaRejected} refused by the ` +
        `validator, ${resolution.skippedNoEvidence} with no evidence to read, of ` +
        `${resolution.pending} closed market(s)`,
    );
    if (resolution.staled > 0) {
      parts.push(`${resolution.staled} draft(s) retired as stale`);
    }
    if (resolution.haltedBecause !== null) {
      parts.push(`resolution halted: ${resolution.haltedBecause}`);
    }
  }

  if (report.settle !== null) {
    const settle = report.settle;
    parts.push(
      `settle: ${settle.closed} close(s), ${settle.finalized} finalisation(s), ` +
        `${settle.invalidated} invalidation(s), ` +
        `${settle.claimed} claim(s) worth ${settle.claimableWei} wei queued`,
    );
    if (settle.reconciled > 0) {
      parts.push(`${settle.reconciled} resolution draft(s) reconciled with the chain`);
    }
    for (const note of settle.notes) parts.push(`settle note: ${note}`);
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
