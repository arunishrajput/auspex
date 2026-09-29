/**
 * Read models for `/resolve`, `/markets/[id]` and the resolution counters on `/`.
 *
 * One rule runs through this file: **where a number decides money, it is read from the chain.**
 * The draft text, the rationale and the audit trail come from Postgres because that is where they
 * live and the chain has never heard of them. The market's state, its challenge deadline and what
 * the contract owes each agent come from `eth_call` on every request, because the failure mode of
 * a mirror is showing yesterday's state as current — and here that would mean offering a resolver
 * a button to resolve a market somebody else already resolved.
 *
 * Nothing here throws on a chain failure. A row whose chain read failed carries the error text and
 * the page shows it, because a queue that silently drops the market it could not read is worse
 * than one that says so.
 */

import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  markets,
  proposals,
  resolutionDrafts,
  type ResolutionDraftStatus,
} from "../db/schema";
import { readMarket, type OnChainMarket } from "../chain/auspex";
import { getProvider } from "../chain/provider";
import type { MarketSpec } from "../chain/spec";
import { isProposable, roundFor } from "./validate";

export type DraftRow = {
  id: string;
  marketRowId: string;
  onchainId: number | null;
  question: string;
  resolutionCriteria: string | null;
  resolutionSourceUrl: string;
  round: number;
  status: ResolutionDraftStatus;
  outcome: string;
  evidenceUrl: string | null;
  rationale: string | null;
  settledByQuote: string | null;
  warnings: string[];
  rejectionReason: string | null;
  rawModelOutput: string | null;
  model: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  /** Live chain state for this market, or null when the read failed. */
  chain: OnChainMarket | null;
  chainError: string | null;
  /** Non-null when this draft cannot be signed right now, with the reason a resolver needs. */
  blockedBecause: string | null;
};

async function selectDrafts(statuses: readonly ResolutionDraftStatus[], limit: number) {
  return db
    .select({
      id: resolutionDrafts.id,
      marketRowId: resolutionDrafts.marketId,
      round: resolutionDrafts.round,
      status: resolutionDrafts.status,
      outcome: resolutionDrafts.outcome,
      evidenceUrl: resolutionDrafts.evidenceUrl,
      rationale: resolutionDrafts.rationale,
      settledByQuote: resolutionDrafts.settledByQuote,
      warnings: resolutionDrafts.warnings,
      rejectionReason: resolutionDrafts.rejectionReason,
      rawModelOutput: resolutionDrafts.rawModelOutput,
      model: resolutionDrafts.model,
      reviewedBy: resolutionDrafts.reviewedBy,
      reviewedAt: resolutionDrafts.reviewedAt,
      createdAt: resolutionDrafts.createdAt,
      onchainId: markets.onchainId,
      question: markets.question,
      resolutionSourceUrl: markets.resolutionSourceUrl,
      spec: proposals.spec,
    })
    .from(resolutionDrafts)
    .innerJoin(markets, eq(resolutionDrafts.marketId, markets.id))
    .leftJoin(proposals, eq(markets.proposalId, proposals.id))
    .where(inArray(resolutionDrafts.status, statuses as never))
    .orderBy(desc(resolutionDrafts.createdAt))
    .limit(limit);
}

/**
 * Attaches live chain state to each draft, and says why a draft cannot be signed.
 *
 * `blockedBecause` is computed rather than inferred from the row's own status, and it is the
 * difference between a page that is honest and a page that is merely tidy: a draft can be
 * `PENDING_REVIEW` in Postgres and completely unusable on chain — challenged into a new round,
 * finalised by someone else, or belonging to a market that is somehow still open. The resolver is
 * told which, before they click.
 */
async function withChainState(
  rows: Awaited<ReturnType<typeof selectDrafts>>,
): Promise<DraftRow[]> {
  const provider = getProvider();
  const nowSeconds = Math.floor(Date.now() / 1000);

  return Promise.all(
    rows.map(async (row) => {
      const spec = row.spec as unknown as MarketSpec | null;
      let chain: OnChainMarket | null = null;
      let chainError: string | null = null;

      if (row.onchainId !== null) {
        try {
          chain = await readMarket(row.onchainId, provider);
        } catch (error) {
          chainError = error instanceof Error ? error.message : String(error);
        }
      }

      let blockedBecause: string | null = null;
      if (row.onchainId === null) {
        blockedBecause = "this market is not on chain yet";
      } else if (chain === null) {
        blockedBecause = `the contract could not be read: ${chainError ?? "unknown error"}`;
      } else {
        const proposable = isProposable(chain, nowSeconds);
        if (!proposable.ok) blockedBecause = proposable.reason;
        else if (roundFor(chain) !== row.round) {
          blockedBecause =
            `this draft is for round ${row.round} and the market is at round ${roundFor(chain)} — ` +
            `it has been challenged since, so a fresh outcome is needed`;
        }
      }

      return {
        id: row.id,
        marketRowId: row.marketRowId,
        onchainId: row.onchainId,
        question: row.question,
        resolutionCriteria: spec?.resolutionCriteria ?? null,
        resolutionSourceUrl: row.resolutionSourceUrl,
        round: row.round,
        status: row.status,
        outcome: row.outcome,
        evidenceUrl: row.evidenceUrl,
        rationale: row.rationale,
        settledByQuote: row.settledByQuote,
        warnings: row.warnings,
        rejectionReason: row.rejectionReason,
        rawModelOutput: row.rawModelOutput,
        model: row.model,
        reviewedBy: row.reviewedBy,
        reviewedAt: row.reviewedAt,
        createdAt: row.createdAt,
        chain,
        chainError,
        blockedBecause,
      };
    }),
  );
}

/** Drafts waiting for a human resolver, newest first. */
export async function pendingResolutions(limit = 10): Promise<DraftRow[]> {
  return withChainState(await selectDrafts(["PENDING_REVIEW"], limit));
}

/**
 * Drafts a human has already acted on, plus the ones the validator refused.
 *
 * Shown beside the queue for the reason hard rule #7 gives: a resolution log that displayed only
 * what got through would be evidence of nothing. `SCHEMA_REJECTED` rows are the validator's own
 * refusals and are the most useful thing on the page.
 */
export async function decidedResolutions(limit = 12): Promise<DraftRow[]> {
  return withChainState(
    await selectDrafts(["APPROVED", "REJECTED", "SCHEMA_REJECTED", "STALE"], limit),
  );
}

/**
 * Markets whose proposed resolution is inside its challenge window right now.
 *
 * Read from the chain, market by market, because "is the window still open?" changes every three
 * seconds and no projection can be trusted with it. This is what the countdown on `/resolve`
 * renders, and what the challenge button is gated on.
 */
export async function challengeableMarkets(): Promise<
  { marketRowId: string; question: string; chain: OnChainMarket }[]
> {
  const rows = await db
    .select({ rowId: markets.id, onchainId: markets.onchainId, question: markets.question })
    .from(markets)
    .where(and(isNotNull(markets.onchainId), eq(markets.state, "RESOLUTION_PROPOSED")))
    .limit(10);

  const provider = getProvider();
  const out: { marketRowId: string; question: string; chain: OnChainMarket }[] = [];

  for (const row of rows) {
    if (row.onchainId === null) continue;
    try {
      const chain = await readMarket(row.onchainId, provider);
      // The projection said RESOLUTION_PROPOSED; the chain is asked whether that is still true.
      if (chain.state === "RESOLUTION_PROPOSED") {
        out.push({ marketRowId: row.rowId, question: row.question, chain });
      }
    } catch {
      // A market we cannot read is left out of the challenge list rather than shown with an
      // unknown deadline — a challenge button whose window we could not verify is worse than none.
    }
  }

  return out;
}

export type ResolutionCounters = {
  pendingReview: number;
  approved: number;
  rejected: number;
  schemaRejected: number;
  stale: number;
  /** Human-approved markets past close with no draft at their current round. */
  awaitingDraft: number;
};

/** Counters for the home page. Real queries, never constants. */
export async function resolutionCounters(): Promise<ResolutionCounters> {
  const byStatus = await db
    .select({ status: resolutionDrafts.status, count: sql<string>`count(*)` })
    .from(resolutionDrafts)
    .groupBy(resolutionDrafts.status);

  const counts = new Map(byStatus.map((row) => [row.status, Number(row.count)]));

  const awaiting = await db.execute<{ count: string }>(sql`
    select count(*) as count
      from markets m
      join proposals p on p.id = m.proposal_id
     where m.onchain_id is not null
       and m.state in ('OPEN', 'CLOSED')
       and m.close_time <= now()
       and not exists (
             select 1 from resolution_drafts d
              where d.market_id = m.id
                and d.round = m.challenge_count + 1
           )
  `);

  return {
    pendingReview: counts.get("PENDING_REVIEW") ?? 0,
    approved: counts.get("APPROVED") ?? 0,
    rejected: counts.get("REJECTED") ?? 0,
    schemaRejected: counts.get("SCHEMA_REJECTED") ?? 0,
    stale: counts.get("STALE") ?? 0,
    awaitingDraft: Number(awaiting.rows[0]?.count ?? 0),
  };
}

/** Every draft ever written for one market, oldest first. The market detail page's timeline. */
export async function draftsForMarket(marketRowId: string): Promise<DraftRow[]> {
  const rows = await db
    .select({
      id: resolutionDrafts.id,
      marketRowId: resolutionDrafts.marketId,
      round: resolutionDrafts.round,
      status: resolutionDrafts.status,
      outcome: resolutionDrafts.outcome,
      evidenceUrl: resolutionDrafts.evidenceUrl,
      rationale: resolutionDrafts.rationale,
      settledByQuote: resolutionDrafts.settledByQuote,
      warnings: resolutionDrafts.warnings,
      rejectionReason: resolutionDrafts.rejectionReason,
      rawModelOutput: resolutionDrafts.rawModelOutput,
      model: resolutionDrafts.model,
      reviewedBy: resolutionDrafts.reviewedBy,
      reviewedAt: resolutionDrafts.reviewedAt,
      createdAt: resolutionDrafts.createdAt,
      onchainId: markets.onchainId,
      question: markets.question,
      resolutionSourceUrl: markets.resolutionSourceUrl,
      spec: proposals.spec,
    })
    .from(resolutionDrafts)
    .innerJoin(markets, eq(resolutionDrafts.marketId, markets.id))
    .leftJoin(proposals, eq(markets.proposalId, proposals.id))
    .where(eq(resolutionDrafts.marketId, marketRowId))
    .orderBy(resolutionDrafts.round, resolutionDrafts.createdAt);

  return withChainState(rows);
}
