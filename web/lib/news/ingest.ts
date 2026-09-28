/**
 * Ingestion: feed items → `raw_items` rows.
 *
 * The idempotency mechanism is `UNIQUE(source_id, source_guid)` plus `ON CONFLICT DO NOTHING`.
 * There is deliberately **no** "have we seen this already?" `SELECT` in front of it. A check
 * followed by an insert is two statements with a gap between them, and two ticks racing
 * through that gap both see "no" and both insert. The constraint has no gap.
 *
 * `returning()` counts what was genuinely written, which is what lets the tick report say
 * "42 fetched, 0 new" on a re-run instead of claiming work it did not do. That is the same
 * pattern `lib/indexer/run.ts:persistLogs` established in Phase 2.
 */

import { createHash } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { rawItems, sources } from "../db/schema";
import { scanForInjection } from "./injection";
import { KNOWN_PUBLISHERS, describeSource, publisherDomain } from "./sources";
import type { FeedResult } from "./feeds";
import type { FeedItem } from "./parse";

/**
 * SHA-256 of the article's normalised text, 0x-prefixed to match the `hash32` column.
 *
 * This is a **content identity**, not a similarity input — it is what lets a cluster key be
 * stable and lets Phase 4 cache model work against content. It therefore keeps the summary,
 * even though clustering deliberately ignores it: two articles with the same headline and
 * different bodies are different articles.
 */
export function contentHash(title: string, summary: string | null): string {
  const canonical = `${title}\n${summary ?? ""}`
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return `0x${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/**
 * Writes the curated allowlist into `sources`.
 *
 * Idempotent, and it *updates* rather than ignoring on conflict: the allowlist is code, so
 * editing `KNOWN_PUBLISHERS` and re-running has to be able to correct a row. Rows created on
 * the fly for unknown publishers are untouched — they are not in this list.
 */
export async function seedSources(): Promise<number> {
  const rows = KNOWN_PUBLISHERS.map((publisher) => ({
    domain: publisher.domain,
    name: publisher.name,
    independenceGroup: publisher.independenceGroup,
    allowlisted: true,
  }));

  const result = await db
    .insert(sources)
    .values(rows)
    .onConflictDoUpdate({
      target: sources.domain,
      set: {
        name: sql`excluded.name`,
        independenceGroup: sql`excluded.independence_group`,
        allowlisted: sql`excluded.allowlisted`,
      },
    })
    .returning({ id: sources.id });

  return result.length;
}

export type SourceRow = {
  id: string;
  domain: string;
  independenceGroup: string;
  allowlisted: boolean;
};

/**
 * Get-or-create a `sources` row for every domain, in one write and one read.
 *
 * Unknown domains are created with `allowlisted: false` — ingested and displayed, but never
 * counted toward the two-source rule. See `sources.ts`.
 */
export async function ensureSources(domains: readonly string[]): Promise<Map<string, SourceRow>> {
  const distinct = [...new Set(domains)].filter((domain) => domain.length > 0);
  if (distinct.length === 0) return new Map();

  await db
    .insert(sources)
    .values(distinct.map((domain) => describeSource(domain)))
    .onConflictDoNothing({ target: sources.domain });

  const rows = await db
    .select({
      id: sources.id,
      domain: sources.domain,
      independenceGroup: sources.independenceGroup,
      allowlisted: sources.allowlisted,
    })
    .from(sources)
    .where(inArray(sources.domain, distinct));

  return new Map(rows.map((row) => [row.domain, row]));
}

/**
 * Resolves the publisher for one item.
 *
 * Order matters. A single-publisher RSS feed's `fixedDomain` wins. Otherwise the
 * `<source url>` hint wins, because for Google News the item's own link points at
 * `news.google.com` — trusting it would attribute every story on Earth to the aggregator and
 * make the two-source rule meaningless. Only with neither do we fall back to the link.
 */
export function resolveDomain(item: FeedItem, fixedDomain: string | null): string | null {
  if (fixedDomain !== null) return fixedDomain;
  if (item.publisherDomainHint !== null) return item.publisherDomainHint;
  return publisherDomain(item.url);
}

export type IngestReport = {
  feedsAttempted: number;
  feedsOk: number;
  itemsFetched: number;
  /** Rows actually written. Zero on a replay — that is the point. */
  itemsInserted: number;
  itemsSkippedNoDomain: number;
  flaggedForInjection: number;
  distinctPublishers: number;
  feedErrors: { feedId: string; error: string }[];
};

/**
 * Persists every item from a set of feed results.
 *
 * Duplicate `(source, guid)` pairs *within* one batch are collapsed before the insert.
 * A single `INSERT … ON CONFLICT` cannot resolve a conflict against a row it is inserting in
 * the same command — Postgres raises "cannot affect row a second time" instead of
 * deduplicating — and Google News returns the same story under two topic queries often enough
 * for this to be a routine occurrence rather than an edge case.
 */
export async function ingestFeedResults(results: readonly FeedResult[]): Promise<IngestReport> {
  const feedErrors = results
    .filter((result) => result.error !== null)
    .map((result) => ({ feedId: result.feedId, error: result.error as string }));

  const pending: { item: FeedItem; domain: string }[] = [];
  let itemsFetched = 0;
  let itemsSkippedNoDomain = 0;

  for (const result of results) {
    for (const item of result.items) {
      itemsFetched += 1;
      const domain = resolveDomain(item, result.fixedDomain);
      if (domain === null) {
        itemsSkippedNoDomain += 1;
        continue;
      }
      pending.push({ item, domain });
    }
  }

  const base = {
    feedsAttempted: results.length,
    feedsOk: results.filter((result) => result.ok).length,
    itemsFetched,
    itemsSkippedNoDomain,
    feedErrors,
  };

  if (pending.length === 0) {
    return {
      ...base,
      itemsInserted: 0,
      flaggedForInjection: 0,
      distinctPublishers: 0,
    };
  }

  const sourceRows = await ensureSources(pending.map((entry) => entry.domain));

  const seen = new Set<string>();
  const rows: (typeof rawItems.$inferInsert)[] = [];
  let flaggedForInjection = 0;

  for (const { item, domain } of pending) {
    const source = sourceRows.get(domain);
    if (source === undefined) continue; // could not be placed; skip rather than guess.

    const batchKey = `${source.id}|${item.guid}`;
    if (seen.has(batchKey)) continue;
    seen.add(batchKey);

    const injectionFlags = scanForInjection(item.title, item.summary);
    if (injectionFlags.length > 0) flaggedForInjection += 1;

    rows.push({
      sourceId: source.id,
      // varchar(512): a longer guid is truncated deterministically rather than failing the
      // whole batch. Truncation keeps the prefix, which is where feeds put their entropy.
      sourceGuid: item.guid.slice(0, 512),
      title: item.title,
      url: item.url,
      publishedAt: item.publishedAt,
      summary: item.summary,
      contentHash: contentHash(item.title, item.summary),
      injectionFlags,
    });
  }

  const inserted =
    rows.length === 0
      ? []
      : await db
          .insert(rawItems)
          .values(rows)
          .onConflictDoNothing({ target: [rawItems.sourceId, rawItems.sourceGuid] })
          .returning({ id: rawItems.id });

  return {
    ...base,
    itemsInserted: inserted.length,
    flaggedForInjection,
    distinctPublishers: new Set(pending.map((entry) => entry.domain)).size,
  };
}
