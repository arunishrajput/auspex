/**
 * Which URL a market is allowed to name as the place its outcome is settled.
 *
 * This exists because of one line in the first live proposer run: a spec whose
 * `resolutionSourceUrl` was `https://news.google.com/rss/articles/CBMiqAFBVV95cUxQUkp6…`. That
 * string would have gone on chain, and it fails three ways at once — opaque to anyone reading
 * MSTScan, expires, and does not demonstrably belong to the publisher we credited.
 *
 * The first fix was to reject those articles outright. Measured against the live database, that
 * starved the queue completely: every confirmed event's links were Google News redirects,
 * because confirmation needs two independent publishers and only the aggregator carries one
 * story from several of them. So instead the redirect degrades to the publisher's front page —
 * real, publisher-owned, stable — and the degradation is reported to the reviewer.
 */

import { describe, expect, it } from "vitest";
import { resolutionUrlFor } from "./run";

describe("resolutionUrlFor — direct links are used as they are", () => {
  it("keeps a link on the publisher's own domain", () => {
    expect(
      resolutionUrlFor(
        "https://www.theguardian.com/us-news/2026/sep/27/giant-pandas-atlanta",
        "theguardian.com",
        true,
      ),
    ).toEqual({
      url: "https://www.theguardian.com/us-news/2026/sep/27/giant-pandas-atlanta",
      direct: true,
    });
  });

  it("keeps a subdomain that resolves to the same publisher", () => {
    const result = resolutionUrlFor("https://edition.cnn.com/2026/09/27/x", "cnn.com", true);
    expect(result).toEqual({ url: "https://edition.cnn.com/2026/09/27/x", direct: true });
  });
});

describe("resolutionUrlFor — redirects degrade to the publisher front page", () => {
  const redirect =
    "https://news.google.com/rss/articles/CBMiqAFBVV95cUxQUkp6dGpnbzF3eXV3aFNWY0tWN0w?oc=5";

  it("never puts an aggregator redirect on chain", () => {
    const result = resolutionUrlFor(redirect, "reuters.com", true);
    expect(result).toEqual({ url: "https://reuters.com/", direct: false });
    expect(result?.url).not.toContain("news.google.com");
  });

  it("uses the publisher we credited, not the host in the link", () => {
    // The domain comes from Phase 3's `<source url>` extraction, never from the redirect.
    expect(resolutionUrlFor(redirect, "apnews.com", true)?.url).toBe("https://apnews.com/");
    expect(resolutionUrlFor(redirect, "bbc.com", true)?.url).toBe("https://bbc.com/");
  });

  it("degrades a link hosted by a different publisher than the one credited", () => {
    // Credited to Reuters, hosted by the BBC: one of the two is wrong, so neither is safe as a
    // specific link — but the credited publisher is still a publisher we vouch for.
    expect(resolutionUrlFor("https://www.bbc.co.uk/news/123", "reuters.com", true)).toEqual({
      url: "https://reuters.com/",
      direct: false,
    });
  });

  it("degrades an unparseable URL rather than throwing", () => {
    expect(resolutionUrlFor("not a url", "reuters.com", true)).toEqual({
      url: "https://reuters.com/",
      direct: false,
    });
  });
});

describe("resolutionUrlFor — unknown publishers have nothing to fall back to", () => {
  it("refuses a publisher that is not on the independence allowlist", () => {
    // There is no front page to degrade to either: we cannot vouch for the domain at all.
    expect(
      resolutionUrlFor("https://unknown-blog.example/post", "unknown-blog.example", false),
    ).toBeNull();
  });
});
