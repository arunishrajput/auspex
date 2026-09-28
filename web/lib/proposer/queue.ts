/**
 * Read-only queries behind `/review`. Nothing here mutates anything.
 *
 * The page needs three things the proposal row alone does not carry, and all three are there
 * for the same reason: a reviewer has to be able to check the spec against something.
 *
 *  - **the source articles**, so "resolves at reuters.com" can be clicked rather than believed
 *  - **the injection flags** on each one, so a hostile source is visible at the moment of
 *    decision rather than in a log afterwards
 *  - **the on-chain intent**, so an approved proposal shows its transaction and its fate
 */

import { desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db/client";
import { eventItems, events, onchainIntents, proposals, rawItems, sources } from "../db/schema";
import type { MarketSpec } from "../chain/spec";
import { resolutionUrlFor } from "./run";

export type QueueArticle = {
  title: string;
  url: string;
  domain: string;
  independenceGroup: string;
  allowlisted: boolean;
  injectionFlags: string[];
  similarity: number;
  /** The label this article was given in the prompt, when it was one of the issued sources. */
  label: string | null;
  /** True when this link is an aggregator redirect, so its spec would use the front page. */
  redirectLink: boolean;
};

export type QueueProposal = {
  id: string;
  status: (typeof proposals.$inferSelect)["status"];
  eventId: string;
  eventTitle: string;
  distinctSourceCount: number;
  spec: MarketSpec | null;
  specHash: string | null;
  warnings: string[];
  rejectionReason: string | null;
  rawModelOutput: string | null;
  model: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  articles: QueueArticle[];
  intent: {
    id: string;
    status: (typeof onchainIntents.$inferSelect)["status"];
    txHash: string | null;
    blockNumber: number | null;
    revertReason: string | null;
  } | null;
};

function asSpec(raw: Record<string, unknown> | null): MarketSpec | null {
  if (raw === null) return null;
  const spec = raw as Partial<MarketSpec>;
  return typeof spec.question === "string" && typeof spec.closeTime === "number"
    ? (raw as unknown as MarketSpec)
    : null;
}

/**
 * Loads proposals with everything the reviewer needs, in four queries regardless of count.
 *
 * Batched for the same reason every write in Phase 3 is batched: a per-row query here would
 * make the review page's latency a function of the queue length, against a database whose
 * round trip is ~0.5s from a laptop (ADR-033).
 */
async function hydrate(rows: (typeof proposals.$inferSelect)[]): Promise<QueueProposal[]> {
  if (rows.length === 0) return [];

  const eventIds = [...new Set(rows.map((row) => row.eventId))];

  const [eventRows, articleRows, intentRows] = await Promise.all([
    db
      .select({
        id: events.id,
        title: events.title,
        distinctSourceCount: events.distinctSourceCount,
      })
      .from(events)
      .where(inArray(events.id, eventIds)),
    db
      .select({
        eventId: eventItems.eventId,
        title: rawItems.title,
        url: rawItems.url,
        domain: sources.domain,
        independenceGroup: sources.independenceGroup,
        allowlisted: sources.allowlisted,
        injectionFlags: rawItems.injectionFlags,
        similarity: eventItems.similarity,
      })
      .from(eventItems)
      .innerJoin(rawItems, eq(eventItems.rawItemId, rawItems.id))
      .innerJoin(sources, eq(rawItems.sourceId, sources.id))
      .where(inArray(eventItems.eventId, eventIds))
      .orderBy(desc(eventItems.similarity)),
    db
      .select({
        id: onchainIntents.id,
        idempotencyKey: onchainIntents.idempotencyKey,
        status: onchainIntents.status,
        txHash: onchainIntents.txHash,
        blockNumber: onchainIntents.blockNumber,
        revertReason: onchainIntents.revertReason,
      })
      .from(onchainIntents)
      .where(
        inArray(
          onchainIntents.idempotencyKey,
          rows.map((row) => `proposal:${row.id}:create-market`),
        ),
      ),
  ]);

  const eventById = new Map(eventRows.map((row) => [row.id, row]));
  const intentByKey = new Map(intentRows.map((row) => [row.idempotencyKey, row]));

  const articlesByEvent = new Map<string, QueueArticle[]>();
  for (const row of articleRows) {
    const bucket = articlesByEvent.get(row.eventId) ?? [];
    // Labels are derived with the same predicate and the same ordering the proposer used, so
    // the label shown beside an article is the label the model actually saw. Deriving rather
    // than storing keeps one rule in one place: if these two ever disagreed, the page would be
    // misrepresenting what was asked, which is worse than not showing labels at all.
    const resolution = resolutionUrlFor(row.url, row.domain, row.allowlisted);
    const label =
      resolution === null
        ? null
        : `SOURCE_${bucket.filter((article) => article.label !== null).length + 1}`;
    bucket.push({ ...row, label, redirectLink: resolution !== null && !resolution.direct });
    articlesByEvent.set(row.eventId, bucket);
  }

  return rows.map((row) => {
    const event = eventById.get(row.eventId);
    const intent = intentByKey.get(`proposal:${row.id}:create-market`);
    return {
      id: row.id,
      status: row.status,
      eventId: row.eventId,
      eventTitle: event?.title ?? "(event not found)",
      distinctSourceCount: event?.distinctSourceCount ?? 0,
      spec: asSpec(row.spec),
      specHash: row.specHash,
      warnings: row.warnings,
      rejectionReason: row.rejectionReason,
      rawModelOutput: row.rawModelOutput,
      model: row.model,
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt,
      createdAt: row.createdAt,
      articles: articlesByEvent.get(row.eventId) ?? [],
      intent:
        intent === undefined
          ? null
          : {
              id: intent.id,
              status: intent.status,
              txHash: intent.txHash,
              blockNumber: intent.blockNumber,
              revertReason: intent.revertReason,
            },
    };
  });
}

/** The queue itself: everything awaiting a human decision, oldest first. */
export async function pendingReview(limit = 10): Promise<QueueProposal[]> {
  const rows = await db
    .select()
    .from(proposals)
    .where(eq(proposals.status, "PENDING_REVIEW"))
    .orderBy(proposals.createdAt)
    .limit(limit);
  return hydrate(rows);
}

/**
 * Everything already decided — approved, rejected, and schema-rejected.
 *
 * Shown on the same page as the queue on purpose. Hard rule #7: the rejections are what prove
 * the gate is real, and a page that showed only what got through would be evidence of nothing.
 */
export async function decidedProposals(limit = 12): Promise<QueueProposal[]> {
  const rows = await db
    .select()
    .from(proposals)
    .where(ne(proposals.status, "PENDING_REVIEW"))
    .orderBy(desc(proposals.updatedAt))
    .limit(limit);
  return hydrate(rows);
}

export type QueueCounts = {
  pendingReview: number;
  approved: number;
  rejected: number;
  schemaRejected: number;
  /** Confirmed events with no proposal row yet — what the next tick will look at. */
  awaitingProposal: number;
};

export async function queueCounts(): Promise<QueueCounts> {
  const [byStatus] = await db
    .select({
      pendingReview: sql<number>`count(*) filter (where ${proposals.status} = 'PENDING_REVIEW')::int`,
      approved: sql<number>`count(*) filter (where ${proposals.status} = 'APPROVED')::int`,
      rejected: sql<number>`count(*) filter (where ${proposals.status} = 'REJECTED')::int`,
      schemaRejected: sql<number>`count(*) filter (where ${proposals.status} = 'SCHEMA_REJECTED')::int`,
    })
    .from(proposals);

  const [awaiting] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(events)
    .where(
      sql`${events.status} = 'CONFIRMED' and not exists (
        select 1 from ${proposals} where ${proposals.eventId} = ${events.id}
      )`,
    );

  return {
    pendingReview: byStatus?.pendingReview ?? 0,
    approved: byStatus?.approved ?? 0,
    rejected: byStatus?.rejected ?? 0,
    schemaRejected: byStatus?.schemaRejected ?? 0,
    awaitingProposal: awaiting?.count ?? 0,
  };
}
