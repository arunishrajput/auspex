/**
 * Feed parsing. **Pure** — takes a string, returns items. No network.
 *
 * ## Why this is hand-rolled and not a dependency
 *
 * We extract six fields from RSS 2.0 and Atom. A general XML parser would bring a dependency
 * whose behaviour on hostile input becomes ours to defend, for the sake of a document shape
 * that has not changed in twenty years. The extraction below is deliberately *tolerant*: it
 * never throws, a malformed entry is skipped rather than failing the feed, and everything it
 * returns is plain text with markup already stripped — the output is treated as untrusted
 * regardless, by `lib/llm/prompt.ts`.
 *
 * The one thing it must get right is the **publisher**. Google News gives every item a
 * `news.google.com` link and puts the real outlet in `<source url="…">`, so a parser that
 * reads the link would record every story on Earth as coming from one domain, and the
 * two-source rule would become meaningless. That is what `publisherDomainHint` exists for.
 */

export type FeedItem = {
  /** The feed's own stable id, or the URL when it offers none. */
  guid: string;
  title: string;
  url: string;
  publishedAt: Date | null;
  summary: string | null;
  /** From Google News `<source url>`: the real outlet, not the aggregator. */
  publisherDomainHint: string | null;
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * CDATA out, tags out, entities decoded, whitespace collapsed. Always returns a string.
 *
 * Tags are stripped **twice, either side of a single decode pass**, and that is not belt and
 * braces — it is required. Google News entity-encodes the markup in its `<description>`, so the
 * field arrives as `&lt;a href="x"&gt;ECB raises rates&lt;/a&gt;`. Strip-then-decode leaves a
 * literal `<a href="x">` in the text, which would then be stored in `raw_items.summary`,
 * rendered on the dashboard, and sent to a model. Decoding first and stripping once would miss
 * feeds that send real markup. Doing both, in this order, handles both shapes.
 *
 * Only one decode pass runs, deliberately: a second would turn a literal `&amp;lt;` — which is
 * how a feed correctly escapes the text "&lt;" — back into a tag delimiter.
 */
export function cleanText(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  const withoutCdata = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const stripped = withoutCdata.replace(/<[^>]*>/g, " ");
  const decoded = decodeEntities(stripped);
  return decoded.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** First matching element's inner text, or null. Tag names are matched case-insensitively. */
function tagText(block: string, ...tags: string[]): string | null {
  for (const tag of tags) {
    const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(block);
    if (match !== null) {
      const text = cleanText(match[1]);
      if (text.length > 0) return text;
    }
  }
  return null;
}

/** Value of an attribute on the first occurrence of a tag, or null. */
function tagAttr(block: string, tag: string, attr: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*["']([^"']+)["']`, "i").exec(block);
  return match === null ? null : decodeEntities(match[1]).trim();
}

/**
 * A date the feed supplied, or null.
 *
 * Null is a real answer and is stored as null — never replaced with "now". A fabricated
 * timestamp would flow into cluster seed selection and quietly reorder history.
 */
function parseDate(raw: string | null): Date | null {
  if (raw === null) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Parses RSS 2.0 `<item>` and Atom `<entry>` elements.
 *
 * An entry missing a title or a link is dropped: without both it cannot be deduplicated or
 * attributed, and a row we cannot attribute is worse than no row.
 */
export function parseFeedItems(xml: string): FeedItem[] {
  const blocks = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) ?? [];
  const items: FeedItem[] = [];

  for (const block of blocks) {
    const title = tagText(block, "title");
    // RSS puts the URL in <link>'s text; Atom puts it in <link href="…">.
    const url = tagText(block, "link") ?? tagAttr(block, "link", "href");
    if (title === null || url === null) continue;

    const guid = tagText(block, "guid", "id") ?? url;
    const summary = tagText(block, "description", "summary", "content");
    const publishedAt = parseDate(
      tagText(block, "pubDate", "published", "updated", "dc:date"),
    );

    // Google News: <source url="https://www.bbc.com">BBC News</source>
    const sourceUrl = tagAttr(block, "source", "url");
    let publisherDomainHint: string | null = null;
    if (sourceUrl !== null) {
      try {
        const host = new URL(sourceUrl).hostname.toLowerCase();
        publisherDomainHint = host.startsWith("www.") ? host.slice(4) : host;
      } catch {
        publisherDomainHint = null;
      }
    }

    items.push({ guid, title, url, publishedAt, summary, publisherDomainHint });
  }

  return items;
}

/** One GDELT DOC 2.0 article, as the `ArtList` JSON mode returns it. */
type GdeltArticle = {
  url?: unknown;
  title?: unknown;
  seendate?: unknown;
  domain?: unknown;
};

/**
 * GDELT stamps dates as `YYYYMMDDTHHMMSSZ`, which `new Date()` does not accept.
 * Rewritten to ISO 8601 rather than hand-rolling a parser.
 */
function parseGdeltDate(raw: string): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(raw);
  if (match === null) return parseDate(raw);
  const [, y, mo, d, h, mi, s] = match;
  const parsed = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Parses a GDELT DOC 2.0 `ArtList` response.
 *
 * GDELT returns no summary text, only a title and a URL. That is why it is a *supplementary*
 * source: with title-only text the comparable vocabulary is thin, so GDELT items cluster less
 * readily than RSS items. They still ingest, still display, and still count as a publisher.
 */
export function parseGdelt(body: string): FeedItem[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return []; // GDELT answers overload with an HTML error page. Not an exception here.
  }

  const articles = (payload as { articles?: unknown })?.articles;
  if (!Array.isArray(articles)) return [];

  const items: FeedItem[] = [];
  for (const raw of articles as GdeltArticle[]) {
    const url = typeof raw.url === "string" ? raw.url : null;
    const title = typeof raw.title === "string" ? cleanText(raw.title) : "";
    if (url === null || title.length === 0) continue;

    items.push({
      guid: url,
      title,
      url,
      publishedAt: typeof raw.seendate === "string" ? parseGdeltDate(raw.seendate) : null,
      summary: null,
      publisherDomainHint: typeof raw.domain === "string" ? raw.domain.toLowerCase() : null,
    });
  }
  return items;
}
