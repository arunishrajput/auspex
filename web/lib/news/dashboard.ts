/**
 * Read-only queries behind the pipeline view on `/`.
 *
 * Kept apart from `events.ts` so the write path and the read path cannot drift into each
 * other. Nothing here mutates anything, and every number the page shows is a `COUNT` or a row
 * from these queries — there are no derived constants and no placeholders.
 */

import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { auditLog, eventItems, events, rawItems, sources } from "../db/schema";

export type PipelineCounts = {
  rawItems: number;
  publishers: number;
  allowlistedPublishers: number;
  events: number;
  observed: number;
  confirmed: number;
  flaggedItems: number;
  llmAdjudicatedLinks: number;
};

export async function pipelineCounts(): Promise<PipelineCounts> {
  const [items] = await db
    .select({
      total: sql<number>`count(*)::int`,
      flagged: sql<number>`count(*) filter (where jsonb_array_length(${rawItems.injectionFlags}) > 0)::int`,
    })
    .from(rawItems);

  const [publishers] = await db
    .select({
      total: sql<number>`count(*)::int`,
      allowlisted: sql<number>`count(*) filter (where ${sources.allowlisted})::int`,
    })
    .from(sources);

  const [eventCounts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      observed: sql<number>`count(*) filter (where ${events.status} = 'OBSERVED')::int`,
      confirmed: sql<number>`count(*) filter (where ${events.status} = 'CONFIRMED')::int`,
    })
    .from(events);

  const [links] = await db
    .select({ adjudicated: sql<number>`count(*) filter (where ${eventItems.adjudicatedByLlm})::int` })
    .from(eventItems);

  return {
    rawItems: items?.total ?? 0,
    flaggedItems: items?.flagged ?? 0,
    publishers: publishers?.total ?? 0,
    allowlistedPublishers: publishers?.allowlisted ?? 0,
    events: eventCounts?.total ?? 0,
    observed: eventCounts?.observed ?? 0,
    confirmed: eventCounts?.confirmed ?? 0,
    llmAdjudicatedLinks: links?.adjudicated ?? 0,
  };
}

export type EventArticle = {
  rawItemId: string;
  title: string;
  url: string;
  domain: string;
  independenceGroup: string;
  allowlisted: boolean;
  publishedAt: Date | null;
  similarity: number;
  adjudicatedByLlm: boolean;
  injectionFlags: string[];
};

export type EventRow = {
  id: string;
  title: string;
  status: "OBSERVED" | "CONFIRMED" | "REJECTED";
  distinctSourceCount: number;
  confirmedAt: Date | null;
  createdAt: Date;
  articles: EventArticle[];
};

/**
 * Recent events with their articles.
 *
 * Multi-source events first, because a cluster of one is the *uninteresting* case and a page
 * that leads with two hundred of them buries the thing the phase exists to show. Within that,
 * newest first.
 */
export async function recentEventsWithArticles(limit = 14): Promise<EventRow[]> {
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      status: events.status,
      distinctSourceCount: events.distinctSourceCount,
      confirmedAt: events.confirmedAt,
      createdAt: events.createdAt,
    })
    .from(events)
    .orderBy(desc(events.distinctSourceCount), desc(events.createdAt))
    .limit(limit);

  if (rows.length === 0) return [];

  const articles = await db
    .select({
      eventId: eventItems.eventId,
      rawItemId: rawItems.id,
      title: rawItems.title,
      url: rawItems.url,
      publishedAt: rawItems.publishedAt,
      similarity: eventItems.similarity,
      adjudicatedByLlm: eventItems.adjudicatedByLlm,
      injectionFlags: rawItems.injectionFlags,
      domain: sources.domain,
      independenceGroup: sources.independenceGroup,
      allowlisted: sources.allowlisted,
    })
    .from(eventItems)
    .innerJoin(rawItems, eq(eventItems.rawItemId, rawItems.id))
    .innerJoin(sources, eq(rawItems.sourceId, sources.id))
    .where(inArray(eventItems.eventId, rows.map((row) => row.id)))
    .orderBy(desc(eventItems.similarity));

  const byEvent = new Map<string, EventArticle[]>();
  for (const article of articles) {
    const bucket = byEvent.get(article.eventId);
    const entry: EventArticle = {
      rawItemId: article.rawItemId,
      title: article.title,
      url: article.url,
      domain: article.domain,
      independenceGroup: article.independenceGroup,
      allowlisted: article.allowlisted,
      publishedAt: article.publishedAt,
      similarity: article.similarity,
      adjudicatedByLlm: article.adjudicatedByLlm,
      injectionFlags: article.injectionFlags,
    };
    if (bucket === undefined) byEvent.set(article.eventId, [entry]);
    else bucket.push(entry);
  }

  return rows.map((row) => ({ ...row, articles: byEvent.get(row.id) ?? [] }));
}

/** Items that tripped an injection signature. These are the interesting rows, not the noise. */
export async function flaggedItems(limit = 8) {
  return db
    .select({
      id: rawItems.id,
      title: rawItems.title,
      url: rawItems.url,
      injectionFlags: rawItems.injectionFlags,
      domain: sources.domain,
      ingestedAt: rawItems.ingestedAt,
    })
    .from(rawItems)
    .innerJoin(sources, eq(rawItems.sourceId, sources.id))
    .where(sql`jsonb_array_length(${rawItems.injectionFlags}) > 0`)
    .orderBy(desc(rawItems.ingestedAt))
    .limit(limit);
}

/** The most recent tick, for "last run" on the page. */
export async function lastTick() {
  const [row] = await db
    .select({ createdAt: auditLog.createdAt, reason: auditLog.reason })
    .from(auditLog)
    .where(eq(auditLog.action, "pipeline.tick"))
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  return row ?? null;
}

/** Recent audit entries — the decision trail, rejections included. */
export async function recentDecisions(limit = 8) {
  return db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      reason: auditLog.reason,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(inArray(auditLog.action, ["event.confirmed", "cluster.merge_deferred"]))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}
