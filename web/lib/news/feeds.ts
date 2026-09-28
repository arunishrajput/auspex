/**
 * Fetching the feeds. The only module in `lib/news/` that touches the network.
 *
 * Everything here is **keyless**. No NewsAPI: its free tier only serves `localhost`, so it
 * would work in development and fail on Vercel — the worst possible failure shape for a demo.
 * Google News RSS, publisher RSS and GDELT DOC 2.0 all serve anonymous requests.
 *
 * **A failing feed is not a failing tick.** Every fetch is individually timed out and
 * individually caught; the error is recorded in the report and the remaining feeds still run.
 * Hard rule #6 — fail safe, stay up — applies to a blocked publisher exactly as it applies to
 * a rate-limited model.
 */

import { parseFeedItems, parseGdelt, type FeedItem } from "./parse";

export type FeedKind = "GOOGLE_NEWS" | "PUBLISHER_RSS" | "GDELT";

export type FeedDefinition = {
  id: string;
  kind: FeedKind;
  url: string;
  /** Only set for single-publisher feeds, where the domain is known before parsing. */
  fixedDomain: string | null;
  /** Overrides `DEFAULT_FEED_TIMEOUT_MS` for a source known to be slow. */
  timeoutMs?: number;
};

/** Per-feed network timeout. A slow publisher must not eat the function's 60s budget. */
const DEFAULT_FEED_TIMEOUT_MS = 12_000;

/**
 * GDELT needs its own, larger budget.
 *
 * Measured on 2026-09-29: a minimal `ArtList` query took **12.6 seconds** to return HTTP 200 —
 * just past the 12s default, so the feed failed every tick with a bare "fetch failed" that
 * looked like an outage rather than a timeout. It also answers 429 to a second query issued
 * moments later, which is why the feed list carries exactly one GDELT entry with a simple
 * query rather than several narrow ones.
 *
 * Feeds run concurrently, so the slowest one sets the stage's duration, not the sum.
 */
const GDELT_TIMEOUT_MS = 25_000;

/** Hard cap on items taken from any one feed, so one chatty source cannot dominate a tick. */
export const MAX_ITEMS_PER_FEED = 40;

/**
 * A browser-shaped User-Agent.
 *
 * Several publishers return 403 to an unrecognised agent. This is not evasion of a bot
 * defence — these are public RSS endpoints published for syndication, fetched at a handful of
 * requests per tick, with no login and no paywall crossed.
 */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/141.0.0.0 Safari/537.36 AuspeX/0.1 (+https://github.com/arunishrajput/auspex)";

function googleNews(query: string): string {
  const params = new URLSearchParams({
    q: query,
    hl: "en-US",
    gl: "US",
    ceid: "US:en",
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

function gdelt(query: string): string {
  // Kept minimal on purpose: every extra operator measurably slows the response, and this
  // endpoint is already the slowest thing a tick touches.
  const params = new URLSearchParams({
    query,
    mode: "ArtList",
    format: "json",
    maxrecords: "50",
    timespan: "24h",
  });
  return `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`;
}

/**
 * The feeds one tick reads.
 *
 * Topic-scoped rather than "all world news": a prediction market needs a *resolvable* question,
 * and these four areas reliably produce events with a definite outcome and a public record to
 * resolve against. A feed of human-interest stories would produce beautifully-clustered events
 * that no one could ever settle.
 */
export const FEEDS: readonly FeedDefinition[] = [
  {
    id: "google-news-markets",
    kind: "GOOGLE_NEWS",
    url: googleNews("central bank OR inflation OR interest rates OR GDP"),
    fixedDomain: null,
  },
  {
    id: "google-news-geopolitics",
    kind: "GOOGLE_NEWS",
    url: googleNews("election OR summit OR treaty OR sanctions"),
    fixedDomain: null,
  },
  {
    id: "google-news-tech",
    kind: "GOOGLE_NEWS",
    url: googleNews("acquisition OR IPO OR regulator OR antitrust"),
    fixedDomain: null,
  },
  {
    id: "bbc-world",
    kind: "PUBLISHER_RSS",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    fixedDomain: "bbc.co.uk",
  },
  {
    id: "aljazeera-all",
    kind: "PUBLISHER_RSS",
    url: "https://www.aljazeera.com/xml/rss/all.xml",
    fixedDomain: "aljazeera.com",
  },
  {
    id: "guardian-world",
    kind: "PUBLISHER_RSS",
    url: "https://www.theguardian.com/world/rss",
    fixedDomain: "theguardian.com",
  },
  {
    id: "npr-world",
    kind: "PUBLISHER_RSS",
    url: "https://feeds.npr.org/1004/rss.xml",
    fixedDomain: "npr.org",
  },
  {
    id: "gdelt-24h",
    kind: "GDELT",
    url: gdelt("central bank"),
    fixedDomain: null,
    timeoutMs: GDELT_TIMEOUT_MS,
  },
];

export type FeedResult = {
  feedId: string;
  kind: FeedKind;
  /** Carried through from the definition so attribution needs no lookup table. */
  fixedDomain: string | null;
  ok: boolean;
  items: FeedItem[];
  /** Populated when `ok` is false. Surfaced in the tick report, never swallowed. */
  error: string | null;
  durationMs: number;
};

async function fetchOne(feed: FeedDefinition): Promise<FeedResult> {
  const startedAt = Date.now();
  const base = { feedId: feed.id, kind: feed.kind, fixedDomain: feed.fixedDomain, durationMs: 0 };

  try {
    const response = await fetch(feed.url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: feed.kind === "GDELT" ? "application/json" : "application/rss+xml, application/xml, text/xml",
      },
      signal: AbortSignal.timeout(feed.timeoutMs ?? DEFAULT_FEED_TIMEOUT_MS),
      // Never let a CDN hand us a cached copy of a news feed.
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        ...base,
        ok: false,
        items: [],
        error: `HTTP ${response.status}`,
        durationMs: Date.now() - startedAt,
      };
    }

    const body = await response.text();
    const parsed = feed.kind === "GDELT" ? parseGdelt(body) : parseFeedItems(body);

    // A 200 that parses to nothing is a real condition worth reporting — it is what a feed
    // that has moved, or is serving an error page with a 200, looks like.
    return {
      ...base,
      ok: true,
      items: parsed.slice(0, MAX_ITEMS_PER_FEED),
      error: parsed.length === 0 ? "parsed 0 items from a 200 response" : null,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, ok: false, items: [], error: message, durationMs: Date.now() - startedAt };
  }
}

/**
 * Fetches every feed concurrently.
 *
 * `allSettled` semantics by construction — `fetchOne` never rejects — so one dead publisher
 * cannot take the others down with it.
 */
export async function fetchAllFeeds(
  feeds: readonly FeedDefinition[] = FEEDS,
): Promise<FeedResult[]> {
  return Promise.all(feeds.map(fetchOne));
}
