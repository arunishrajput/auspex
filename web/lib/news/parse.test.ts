import { describe, expect, it } from "vitest";
import { cleanText, decodeEntities, parseFeedItems, parseGdelt } from "./parse";
import { publisherDomain, resolvePublisher, describeSource } from "./sources";
import { resolveDomain } from "./ingest";

/**
 * Feed parsing, with emphasis on publisher attribution.
 *
 * Getting the publisher wrong is not a cosmetic bug here: every Google News item links to
 * `news.google.com`, so a parser that trusted the link would record every story on Earth as
 * one publisher and the two-source rule would confirm everything.
 */

const GOOGLE_NEWS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>ECB raises rates in bid to quell inflation - The New York Times</title>
    <link>https://news.google.com/rss/articles/CBMiK2h0dHBz?oc=5</link>
    <guid isPermaLink="false">CBMiK2h0dHBz</guid>
    <pubDate>Mon, 29 Sep 2026 08:14:00 GMT</pubDate>
    <description>&lt;a href="x"&gt;ECB raises rates&lt;/a&gt;&nbsp;The New York Times</description>
    <source url="https://www.nytimes.com">The New York Times</source>
  </item>
  <item>
    <title>Fed holds steady - BBC</title>
    <link>https://news.google.com/rss/articles/XYZ?oc=5</link>
    <guid isPermaLink="false">XYZ</guid>
    <source url="https://www.bbc.co.uk">BBC</source>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title type="html">Markets &amp; bonds rally</title>
    <link rel="alternate" href="https://example.com/a"/>
    <id>tag:example.com,2026:1</id>
    <published>2026-09-29T08:00:00Z</published>
    <summary>Bonds rallied on the news.</summary>
  </entry>
</feed>`;

const RSS_WITH_CDATA = `<rss><channel>
  <item>
    <title><![CDATA[Storm disrupts rail services]]></title>
    <link>https://theguardian.com/world/storm</link>
    <guid>https://theguardian.com/world/storm</guid>
    <description><![CDATA[<p>Operators cancelled dozens of trains.</p>]]></description>
    <pubDate>Tue, 29 Sep 2026 06:00:00 +0000</pubDate>
  </item>
</channel></rss>`;

describe("decodeEntities", () => {
  it("decodes named, decimal and hex entities", () => {
    expect(decodeEntities("A &amp; B &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x2014;")).toBe(
      `A & B <c> "d" 'e' —`,
    );
  });

  it("leaves an unknown entity alone rather than mangling it", () => {
    expect(decodeEntities("100 &widget; units")).toBe("100 &widget; units");
  });
});

describe("cleanText", () => {
  it("unwraps CDATA, strips tags and collapses whitespace", () => {
    expect(cleanText("<![CDATA[<p>Hello   <b>world</b></p>]]>")).toBe("Hello world");
  });

  it("returns an empty string for missing input rather than throwing", () => {
    expect(cleanText(null)).toBe("");
    expect(cleanText(undefined)).toBe("");
  });
});

describe("parseFeedItems — RSS", () => {
  const items = parseFeedItems(GOOGLE_NEWS);

  it("finds every item", () => {
    expect(items).toHaveLength(2);
  });

  it("takes the publisher from <source url>, not from the Google link", () => {
    // The whole point. The link is news.google.com for both.
    expect(items[0].publisherDomainHint).toBe("nytimes.com");
    expect(items[1].publisherDomainHint).toBe("bbc.co.uk");
  });

  it("strips www. from the source host", () => {
    expect(items[0].publisherDomainHint).not.toContain("www.");
  });

  it("decodes the description and strips its markup", () => {
    expect(items[0].summary).toBe("ECB raises rates The New York Times");
  });

  it("parses the publication date", () => {
    expect(items[0].publishedAt?.toISOString()).toBe("2026-09-29T08:14:00.000Z");
  });

  it("leaves a missing date as null rather than inventing one", () => {
    // A fabricated timestamp would flow into cluster seed selection and reorder history.
    expect(items[1].publishedAt).toBeNull();
  });

  it("uses the feed's guid", () => {
    expect(items[0].guid).toBe("CBMiK2h0dHBz");
  });
});

describe("parseFeedItems — Atom", () => {
  const items = parseFeedItems(ATOM);

  it("reads an entry's link from the href attribute", () => {
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe("https://example.com/a");
  });

  it("decodes entities in the title", () => {
    expect(items[0].title).toBe("Markets & bonds rally");
  });

  it("reads <id> as the guid and <summary> as the summary", () => {
    expect(items[0].guid).toBe("tag:example.com,2026:1");
    expect(items[0].summary).toBe("Bonds rallied on the news.");
  });

  it("has no publisher hint when the feed carries no <source>", () => {
    expect(items[0].publisherDomainHint).toBeNull();
  });
});

describe("parseFeedItems — robustness", () => {
  it("handles CDATA in both title and description", () => {
    const [item] = parseFeedItems(RSS_WITH_CDATA);
    expect(item.title).toBe("Storm disrupts rail services");
    expect(item.summary).toBe("Operators cancelled dozens of trains.");
  });

  it("returns an empty array for junk rather than throwing", () => {
    // A publisher serving an HTML error page with a 200 is a routine event.
    expect(parseFeedItems("<html><body>502 Bad Gateway</body></html>")).toEqual([]);
    expect(parseFeedItems("")).toEqual([]);
  });

  it("drops an item that has no title or no link", () => {
    const xml = `<rss><channel>
      <item><title>No link here</title></item>
      <item><link>https://example.com/x</link></item>
      <item><title>Good</title><link>https://example.com/good</link></item>
    </channel></rss>`;
    const items = parseFeedItems(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Good");
  });

  it("does not choke on a malformed source url", () => {
    const xml = `<rss><channel><item>
      <title>T</title><link>https://example.com/t</link>
      <source url="not a url">X</source>
    </item></channel></rss>`;
    expect(parseFeedItems(xml)[0].publisherDomainHint).toBeNull();
  });
});

describe("parseGdelt", () => {
  it("parses articles and converts GDELT's date format", () => {
    const body = JSON.stringify({
      articles: [
        {
          url: "https://reuters.com/a",
          title: "EU imposes sanctions",
          seendate: "20260929T081400Z",
          domain: "reuters.com",
        },
      ],
    });
    const [item] = parseGdelt(body);
    expect(item.url).toBe("https://reuters.com/a");
    expect(item.publisherDomainHint).toBe("reuters.com");
    expect(item.publishedAt?.toISOString()).toBe("2026-09-29T08:14:00.000Z");
    expect(item.summary).toBeNull();
  });

  it("returns an empty array when GDELT serves an HTML error page", () => {
    expect(parseGdelt("<html>overloaded</html>")).toEqual([]);
  });

  it("returns an empty array when the payload has no articles", () => {
    expect(parseGdelt(JSON.stringify({ status: "ok" }))).toEqual([]);
  });

  it("skips entries missing a url or title", () => {
    const body = JSON.stringify({ articles: [{ url: "https://x.com/a" }, { title: "no url" }] });
    expect(parseGdelt(body)).toEqual([]);
  });
});

describe("publisher resolution", () => {
  it("extracts a bare domain", () => {
    expect(publisherDomain("https://www.BBC.co.uk/news/x")).toBe("bbc.co.uk");
    expect(publisherDomain("https://edition.cnn.com/2026/x")).toBe("edition.cnn.com");
  });

  it("returns null for an unparseable url instead of throwing", () => {
    expect(publisherDomain("not a url")).toBeNull();
  });

  it("resolves a subdomain up to its known publisher", () => {
    expect(resolvePublisher("edition.cnn.com")?.independenceGroup).toBe("cnn");
  });

  it("groups two domains of one newsroom together", () => {
    expect(resolvePublisher("bbc.com")?.independenceGroup).toBe(
      resolvePublisher("bbc.co.uk")?.independenceGroup,
    );
  });

  it("keeps two ABC News outlets in different countries apart", () => {
    expect(resolvePublisher("abc.net.au")?.independenceGroup).not.toBe(
      resolvePublisher("abcnews.go.com")?.independenceGroup,
    );
  });

  it("treats an unknown publisher as independent but not allowlisted", () => {
    const described = describeSource("rumourblog.example");
    expect(described.allowlisted).toBe(false);
    expect(described.independenceGroup).toBe("rumourblog.example");
  });

  it("marks a known publisher as allowlisted", () => {
    expect(describeSource("reuters.com").allowlisted).toBe(true);
  });
});

describe("resolveDomain — attribution priority", () => {
  const item = {
    guid: "g",
    title: "t",
    url: "https://news.google.com/rss/articles/XYZ",
    publishedAt: null,
    summary: null,
    publisherDomainHint: "nytimes.com",
  };

  it("prefers a single-publisher feed's fixed domain", () => {
    expect(resolveDomain(item, "bbc.co.uk")).toBe("bbc.co.uk");
  });

  it("otherwise prefers the <source url> hint over the link", () => {
    expect(resolveDomain(item, null)).toBe("nytimes.com");
  });

  it("falls back to the link only when there is no hint", () => {
    expect(resolveDomain({ ...item, publisherDomainHint: null }, null)).toBe("news.google.com");
  });
});
