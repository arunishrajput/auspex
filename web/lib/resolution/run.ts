/**
 * The resolution pass: closed markets in, drafts in the resolver's queue out.
 *
 * ## Retrieval is deterministic, and that is the load-bearing part
 *
 * A market asks "will X happen?" and closes. To resolve it, something has to find the articles
 * that might report X. **That selection is not made by a model.** It is IDF-weighted *coverage* of
 * the question's own terms by each article (`retrieve.ts`), restricted to articles ingested since
 * the market was created.
 *
 * The first version of this reused Phase 3's headline-versus-headline Jaccard and returned **zero
 * candidates for all four live markets**. That was structural, not a tuning problem — Jaccard
 * divides by the union, so a long question against a short headline collapses however relevant the
 * article is. ADR-060 has the measurement. The lesson is the same one ADR-029 and ADR-049 both
 * record: a threshold is a property *of a measure*, and a measure is a property of the question it
 * is asked.
 *
 * Letting a model choose its own evidence would hand it the one decision that matters: a model
 * that picks which sources to read has already chosen the answer. Here it gets six articles it
 * did not select, in an order it did not set, and its job is to say whether any of them settles
 * the question.
 *
 * The recency filter is the other half. An article published before the market opened cannot
 * report the thing the market asked about — it is, at best, the story the market was *created*
 * from. Those are excluded from ranking and, when one slips through on a missing publication
 * date, `validate.ts` turns it into a warning the human sees.
 *
 * ## Bounded, like every other stage
 *
 * At most `MAX_MARKETS_PER_PASS` markets are drafted per tick and the LLM budget is the real
 * ceiling. Nothing loops until the work is done; a backlog costs another tick.
 *
 * ## Idempotency is `UNIQUE(resolution_drafts.market_id, round)`
 *
 * The round comes from the chain's own `challengeCount`, so a re-run derives the same round and
 * conflicts instead of asking a human to read the same outcome twice. A challenge increments
 * that count on chain, which is what makes a *second* draft for the same market legitimate.
 */

import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  auditLog,
  markets,
  proposals,
  rawItems,
  resolutionDrafts,
  sources,
} from "../db/schema";
import { readMarket } from "../chain/auspex";
import { getProvider } from "../chain/provider";
import type { MarketSpec } from "../chain/spec";
import type { LlmBudget } from "../llm/client";
import { resolutionUrlFor } from "../proposer/run";
import { MIN_QUESTION_COVERAGE, rankByCoverage } from "./retrieve";
import {
  draftResolution,
  type ResolutionDraftOptions,
  type ResolutionInput,
} from "./draft";
import { roundFor, type ResolvableMarket } from "./validate";

/** Markets drafted per pass. The queue is drained by a human, not by us. */
const MAX_MARKETS_PER_PASS = 2;

/**
 * Markets examined to find that many draftable ones.
 *
 * Larger than the draft limit because a closed market can have no candidate evidence at all, and
 * without headroom two such markets at the head of the queue would block every tick from
 * reaching a draftable one behind them. The same reasoning as `MAX_EVENTS_SCANNED`.
 */
const MAX_MARKETS_SCANNED = 8;

/** Articles considered per market before ranking. Bounded so a tick stays round-trip-cheap. */
const MAX_CANDIDATES_SCANNED = 150;

/** Candidates handed to the model, after ranking. */
const MAX_CANDIDATES_USED = 6;

export type ResolutionReport = {
  /** Closed markets with no draft at their current round. */
  pending: number;
  attempted: number;
  /** Drafts queued for the human resolver. */
  drafted: number;
  /** Markets the model read and said are not settled yet. No rows written. */
  unsettled: number;
  /** Model output that failed validation. Rows written, kept as evidence. */
  schemaRejected: number;
  /** Markets left alone because no model answered. Retried next tick. */
  unavailable: number;
  /** Markets with no candidate article to read. No rows written. */
  skippedNoEvidence: number;
  /** Drafts marked STALE because the market moved on before they were used. */
  staled: number;
  haltedBecause: string | null;
};

function emptyReport(): ResolutionReport {
  return {
    pending: 0,
    attempted: 0,
    drafted: 0,
    unsettled: 0,
    schemaRejected: 0,
    unavailable: 0,
    skippedNoEvidence: 0,
    staled: 0,
    haltedBecause: null,
  };
}

type ClosedMarket = {
  rowId: string;
  onchainId: number;
  question: string;
  spec: MarketSpec;
  /** When the market row was created off-chain. The recency floor for evidence. */
  createdAt: Date;
};

/**
 * Markets that came through the human gate, are past close, and are not settled.
 *
 * `proposal_id IS NOT NULL` for the same two reasons the agent pass has it: the
 * `resolutionCriteria` the agent reasons about lives in the approved spec, and a market no human
 * signed for should not be resolved by our pipeline either. The Phase 1 and 2 test markets are
 * closed and past their deadlines and this pass will never touch them — they are driven by hand
 * in `scripts/lifecycle.ts`, which says so in its own audit entries.
 *
 * `state IN (OPEN, CLOSED)` matches what `proposeResolution` accepts, with the SQL close-time
 * filter standing in for the contract's own auto-close.
 */
async function resolvableMarkets(limit: number): Promise<ClosedMarket[]> {
  const rows = await db
    .select({
      rowId: markets.id,
      onchainId: markets.onchainId,
      question: markets.question,
      spec: proposals.spec,
      createdAt: markets.createdAt,
    })
    .from(markets)
    .innerJoin(proposals, eq(markets.proposalId, proposals.id))
    .where(
      and(
        isNotNull(markets.onchainId),
        sql`${markets.state} in ('OPEN', 'CLOSED')`,
        sql`${markets.closeTime} <= now()`,
      ),
    )
    .orderBy(desc(markets.closeTime))
    .limit(limit);

  return rows.flatMap((row) => {
    const spec = row.spec as unknown as MarketSpec | null;
    if (row.onchainId === null || spec === null) return [];
    return [
      {
        rowId: row.rowId,
        onchainId: row.onchainId,
        question: row.question,
        spec,
        createdAt: row.createdAt,
      },
    ];
  });
}

/**
 * Candidate evidence for one market, ranked and **scored**. **No model involved.**
 *
 * Returns every candidate with its coverage score, including the ones below the floor, so
 * `resolution:dry-run` can print what was considered and what was rejected. Retrieval returning
 * nothing is the failure that is invisible from the outside — the first live run scored zero on all
 * four markets because the measure was wrong (see `retrieve.ts`) — so the scores are a first-class
 * output rather than something to reconstruct afterwards.
 *
 * Ordering is the labelling order, so `EVIDENCE_1` is the article covering most of the question.
 */
export async function scoredCandidates(
  market: ClosedMarket,
): Promise<{ score: number; candidate: ResolutionInput["candidates"][number] }[]> {
  const rows = await db
    .select({
      title: rawItems.title,
      summary: rawItems.summary,
      url: rawItems.url,
      publishedAt: rawItems.publishedAt,
      injectionFlags: rawItems.injectionFlags,
      domain: sources.domain,
      allowlisted: sources.allowlisted,
    })
    .from(rawItems)
    .innerJoin(sources, eq(rawItems.sourceId, sources.id))
    // Ingested since the market was created. An article older than the market cannot report the
    // outcome of a question the market asked about — see the header.
    .where(and(eq(sources.allowlisted, true), gte(rawItems.ingestedAt, market.createdAt)))
    .orderBy(desc(rawItems.ingestedAt))
    .limit(MAX_CANDIDATES_SCANNED);

  if (rows.length === 0) return [];

  // Scored against the headline AND the summary, not the headline alone. A headline is written to be
  // short; the sentence that settles a question is far more often in the body text the feed gives us.
  // The model's quote is later searched for in that same combined text, so what is scored is exactly
  // what is offered — a mismatch there would reject true quotes for being in a part never shown.
  const ranked = rankByCoverage(market.question, rows, (row) =>
    row.summary === null ? row.title : `${row.title} ${row.summary}`,
  );

  return ranked.flatMap(({ score, document: row }) => {
    // The same URL discipline the proposer uses for a resolution source, for a stronger reason:
    // this URL is written on-chain as the evidence a judge will click. An aggregator redirect
    // degrades to the publisher's front page and is flagged for the human.
    const resolved = resolutionUrlFor(row.url, row.domain, row.allowlisted);
    if (resolved === null) return [];
    return [
      {
        score,
        candidate: {
          title: row.title,
          summary: row.summary,
          evidenceUrl: resolved.url,
          directLink: resolved.direct,
          domain: row.domain,
          publishedAt:
            row.publishedAt === null ? null : Math.floor(row.publishedAt.getTime() / 1000),
          injectionFlags: row.injectionFlags,
        },
      },
    ];
  });
}

/** The candidates that passed the coverage floor, best first, capped. What the model is shown. */
export async function candidateEvidence(
  market: ClosedMarket,
): Promise<ResolutionInput["candidates"]> {
  const scored = await scoredCandidates(market);
  return scored
    .filter((entry) => entry.score >= MIN_QUESTION_COVERAGE)
    .slice(0, MAX_CANDIDATES_USED)
    .map((entry) => entry.candidate);
}

/**
 * Retires drafts whose market has moved past them.
 *
 * A draft is written against one `(market, round)`. If the market gets finalised, invalidated, or
 * challenged into a new round while a draft still sits `PENDING_REVIEW`, that draft can never be
 * signed — `proposeResolution` would revert. Marking it `STALE` is how the resolver's queue stops
 * showing a button that cannot work, and it is idempotent: the `WHERE` clause only touches rows
 * still pending.
 *
 * Read from the projection rather than the chain, deliberately: this is a tidying pass over our
 * own queue, not a decision that moves money, and the projection is refreshed by the indexer in
 * the same tick. The signing path in `propose.ts` reads the chain, because that one *is*.
 */
export async function staleDrafts(): Promise<number> {
  const retired = await db.execute<{ id: string }>(sql`
    update resolution_drafts d
       set status = 'STALE', updated_at = now()
      from markets m
     where d.market_id = m.id
       and d.status = 'PENDING_REVIEW'
       and (
             m.state in ('RESOLUTION_PROPOSED', 'FINALIZED', 'INVALIDATED')
             or d.round <> m.challenge_count + 1
           )
    returning d.id
  `);
  return retired.rows.length;
}

export type ResolutionPassOptions = ResolutionDraftOptions & {
  limit?: number;
  /**
   * Epoch ms after which the pass stops taking new work and reports why.
   *
   * Same reasoning as the agents stage (`agents/run.ts`): a call budget bounds how many models
   * are asked, not how long they take, and an over-running tick is killed before it can return
   * a report or write its audit row. Absolute from the start of the tick, so a pass that arrives
   * late correctly does less rather than pushing the tick over the function's limit. The check
   * never sits between writing a row and creating an intent — this stage creates none.
   */
  deadlineMs?: number;
};

/**
 * Runs one resolution drafting pass.
 *
 * Never throws: it is a tick stage, so a pass that drafted one outcome and then hit a rate limit
 * still reports the draft it made.
 */
export async function runResolutionPass(
  budget: LlmBudget,
  options: ResolutionPassOptions = {},
): Promise<ResolutionReport> {
  const report = emptyReport();
  const now = options.now ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const limit = options.limit ?? MAX_MARKETS_PER_PASS;
  const deadlineMs = options.deadlineMs ?? Number.POSITIVE_INFINITY;

  // Unconditionally, and before anything can return early: a tick that drafts nothing should
  // still clear a queue entry that the chain has made unusable.
  report.staled = await staleDrafts();

  const candidates = await resolvableMarkets(MAX_MARKETS_SCANNED);
  if (candidates.length === 0) {
    report.haltedBecause = "no human-approved market is past its close time and unsettled";
    return report;
  }

  // Which (market, round) pairs already have a draft. Read once, as a set, so the pass does no
  // work it would only have had rolled back by the unique index.
  const existing = await db
    .select({ marketId: resolutionDrafts.marketId, round: resolutionDrafts.round })
    .from(resolutionDrafts);
  const drafted = new Set(existing.map((row) => `${row.marketId}:${row.round}`));

  const provider = getProvider();
  let attempted = 0;

  for (const market of candidates) {
    if (report.drafted + report.schemaRejected >= limit) {
      report.haltedBecause = `reached the ${limit}-draft limit for one pass`;
      break;
    }
    if (attempted >= MAX_MARKETS_SCANNED) break;
    if (Date.now() > deadlineMs) {
      report.haltedBecause =
        `out of time for this tick after examining ${attempted} market(s) — the rest are ` +
        `untouched and the next tick picks them up`;
      break;
    }

    // The chain decides the state and the challenge count, not our projection. The round is
    // derived from `challengeCount`, so reading it from a stale mirror would key a draft to the
    // wrong round and the unique index would silently hide it.
    const onChain = await readMarket(market.onchainId, provider);
    const facts: ResolvableMarket = {
      onchainId: market.onchainId,
      question: market.question,
      resolutionCriteria: market.spec.resolutionCriteria,
      closeTime: onChain.closeTime,
      state: onChain.state,
      challengeCount: onChain.challengeCount,
    };
    const round = roundFor(facts);

    if (drafted.has(`${market.rowId}:${round}`)) continue;
    if (facts.state !== "OPEN" && facts.state !== "CLOSED") continue;
    if (nowSeconds < facts.closeTime) continue;

    report.pending += 1;

    const evidence = await candidateEvidence(market);
    if (evidence.length === 0) {
      // No row. The feeds keep running, so a market with nothing to read today may have plenty
      // tomorrow — and a terminal row here would spend the round's one draft slot on it.
      report.skippedNoEvidence += 1;
      continue;
    }

    if (budget.remaining === 0) {
      report.haltedBecause = `LLM budget spent after ${attempted} resolution call(s)`;
      break;
    }
    // Checked again here, and not only at the top: reading the market costs a round trip, so a
    // market can cross the deadline between being admitted and reaching the model call — which
    // is the one step that can take 22 seconds on its own.
    if (Date.now() > deadlineMs) {
      report.haltedBecause =
        `out of time for this tick before asking about #${market.onchainId} — no model was ` +
        `called and nothing was written`;
      break;
    }

    attempted += 1;
    report.attempted += 1;

    const outcome = await draftResolution(
      { market: facts, candidates: evidence },
      budget,
      { transport: options.transport, now },
    );

    if (outcome.kind === "UNAVAILABLE") {
      report.unavailable += 1;
      report.haltedBecause = outcome.reason;
      await db.insert(auditLog).values({
        actor: "system:resolver",
        action: "resolution.deferred",
        subjectType: "market",
        subjectId: market.rowId,
        reason:
          `No model answered, so no outcome was drafted and nothing was proposed on chain: ` +
          `${outcome.reason}`,
        metadata: { onchainId: market.onchainId, round },
      });
      // A model unavailable for one market is unavailable for the next.
      break;
    }

    if (outcome.kind === "UNSETTLED") {
      // Deliberately no row. "Not yet" is the expected answer for a market that closed recently,
      // and `UNIQUE(market_id, round)` means a row here would be the market's only draft for
      // this round — so the one market that just needed newer articles would never get them.
      report.unsettled += 1;
      await db.insert(auditLog).values({
        actor: "system:resolver",
        action: "resolution.unsettled",
        subjectType: "market",
        subjectId: market.rowId,
        reason:
          `The resolution agent read ${evidence.length} article(s) and reported that the ` +
          `question is not settled yet, so no outcome was queued for a human: ${outcome.rationale}`,
        metadata: { onchainId: market.onchainId, round, model: outcome.model },
      });
      continue;
    }

    if (outcome.kind === "REJECTED") {
      await writeDraft({
        marketRowId: market.rowId,
        onchainId: market.onchainId,
        round,
        status: "SCHEMA_REJECTED",
        rejectionReason: outcome.reason,
        model: outcome.model,
        rawModelOutput: outcome.rawModelOutput,
      });
      report.schemaRejected += 1;
      continue;
    }

    await writeDraft({
      marketRowId: market.rowId,
      onchainId: market.onchainId,
      round,
      status: "PENDING_REVIEW",
      outcome: outcome.outcome,
      evidenceUrl: outcome.evidence.evidenceUrl,
      rationale: outcome.rationale,
      settledByQuote: outcome.settledByQuote,
      warnings: outcome.warnings,
      model: outcome.model,
      rawModelOutput: outcome.rawModelOutput,
    });
    report.drafted += 1;
  }

  return report;
}

/**
 * Writes one draft row, queued and rejected alike.
 *
 * `ON CONFLICT DO NOTHING` rather than an upsert: a draft records what a model said at a moment,
 * and overwriting one would destroy the evidence this table exists to keep. Hard rule #7 — the
 * rejections are the half that proves the gate is real.
 */
async function writeDraft(input: {
  marketRowId: string;
  onchainId: number;
  round: number;
  status: "PENDING_REVIEW" | "SCHEMA_REJECTED";
  outcome?: "YES" | "NO" | "INVALID";
  evidenceUrl?: string;
  rationale?: string;
  settledByQuote?: string;
  warnings?: string[];
  rejectionReason?: string;
  model: string | null;
  rawModelOutput: string | null;
}): Promise<string | null> {
  const [inserted] = await db
    .insert(resolutionDrafts)
    .values({
      marketId: input.marketRowId,
      round: input.round,
      status: input.status,
      outcome: input.outcome ?? "UNRESOLVED",
      evidenceUrl: input.evidenceUrl ?? null,
      rationale: input.rationale ?? null,
      settledByQuote: input.settledByQuote ?? null,
      warnings: input.warnings ?? [],
      rejectionReason: input.rejectionReason ?? null,
      model: input.model,
      rawModelOutput: input.rawModelOutput,
    })
    .onConflictDoNothing({
      target: [resolutionDrafts.marketId, resolutionDrafts.round],
    })
    .returning({ id: resolutionDrafts.id });

  if (inserted === undefined) return null;

  await db.insert(auditLog).values({
    actor: "system:resolver",
    action:
      input.status === "PENDING_REVIEW" ? "resolution.drafted" : "resolution.schema_rejected",
    subjectType: "resolution_draft",
    subjectId: inserted.id,
    reason:
      input.status === "PENDING_REVIEW"
        ? `Drafted ${input.outcome} for market #${input.onchainId} round ${input.round}, ` +
          `evidence ${input.evidenceUrl}. Queued for a human resolver — nothing was sent to the ` +
          `chain. ${input.rationale ?? ""}`.trim()
        : `Resolution draft for market #${input.onchainId} round ${input.round} was refused ` +
          `before any human saw it: ${input.rejectionReason ?? "no reason recorded"}`,
    metadata: {
      onchainId: input.onchainId,
      round: input.round,
      model: input.model,
      outcome: input.outcome ?? null,
    },
  });

  return inserted.id;
}

export { MAX_CANDIDATES_USED, MAX_MARKETS_PER_PASS };
export type { ClosedMarket };
