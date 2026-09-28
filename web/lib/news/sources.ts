/**
 * Who counts as a source, and when two sources are really one.
 *
 * `CONFIRMED` requires two **independent** publishers. Two things make that claim weaker than
 * it sounds, and both are handled here rather than hidden:
 *
 * 1. **Ownership.** `bbc.com` and `bbc.co.uk` are one newsroom. They share an
 *    `independenceGroup`, so they count once.
 * 2. **Syndication.** Twelve papers running the same Reuters copy is one report, not twelve.
 *    Group membership cannot catch this, because those papers also do original reporting and
 *    permanently binding them to Reuters' group would be wrong. It is caught at the *item*
 *    level instead — see `SYNDICATION_SIMILARITY` in `events.ts`.
 *
 * `docs/ARCHITECTURE.md` §11 says plainly that this is heuristic. It is a real bound on a real
 * failure mode, not a proof of independence, and the README says so too.
 */

/** A publisher we are willing to count toward confirmation. */
export type KnownPublisher = {
  domain: string;
  name: string;
  /** Publishers sharing a group are NOT independent of each other. */
  independenceGroup: string;
};

/**
 * The independence allowlist.
 *
 * Curated rather than open: anything can put a headline into Google News, and "two sources
 * agreed" is worth nothing if either of them can be created by the person who benefits from
 * the market. Items from publishers outside this list are still ingested and still shown —
 * they just do not count toward the two-source rule, and the UI labels them that way.
 *
 * Groups are the newsroom, not the brand. Wire services each get their own.
 */
export const KNOWN_PUBLISHERS: readonly KnownPublisher[] = [
  { domain: "reuters.com", name: "Reuters", independenceGroup: "reuters" },
  { domain: "apnews.com", name: "Associated Press", independenceGroup: "ap" },
  { domain: "afp.com", name: "Agence France-Presse", independenceGroup: "afp" },
  { domain: "bbc.com", name: "BBC News", independenceGroup: "bbc" },
  { domain: "bbc.co.uk", name: "BBC News", independenceGroup: "bbc" },
  { domain: "aljazeera.com", name: "Al Jazeera", independenceGroup: "aljazeera" },
  { domain: "theguardian.com", name: "The Guardian", independenceGroup: "guardian" },
  { domain: "npr.org", name: "NPR", independenceGroup: "npr" },
  { domain: "dw.com", name: "Deutsche Welle", independenceGroup: "dw" },
  { domain: "france24.com", name: "France 24", independenceGroup: "france24" },
  { domain: "cbc.ca", name: "CBC News", independenceGroup: "cbc" },
  { domain: "abc.net.au", name: "ABC News (Australia)", independenceGroup: "abc-au" },
  { domain: "news.sky.com", name: "Sky News", independenceGroup: "sky" },
  { domain: "cnn.com", name: "CNN", independenceGroup: "cnn" },
  { domain: "nbcnews.com", name: "NBC News", independenceGroup: "nbc" },
  { domain: "cbsnews.com", name: "CBS News", independenceGroup: "cbs" },
  { domain: "abcnews.go.com", name: "ABC News (US)", independenceGroup: "abc-us" },
  { domain: "nytimes.com", name: "The New York Times", independenceGroup: "nyt" },
  { domain: "washingtonpost.com", name: "The Washington Post", independenceGroup: "wapo" },
  { domain: "wsj.com", name: "The Wall Street Journal", independenceGroup: "wsj" },
  { domain: "ft.com", name: "Financial Times", independenceGroup: "ft" },
  { domain: "bloomberg.com", name: "Bloomberg", independenceGroup: "bloomberg" },
  { domain: "cnbc.com", name: "CNBC", independenceGroup: "cnbc" },
  { domain: "economist.com", name: "The Economist", independenceGroup: "economist" },
  { domain: "politico.com", name: "Politico", independenceGroup: "politico" },
  { domain: "axios.com", name: "Axios", independenceGroup: "axios" },
  { domain: "thehill.com", name: "The Hill", independenceGroup: "thehill" },
  { domain: "time.com", name: "TIME", independenceGroup: "time" },
  { domain: "newsweek.com", name: "Newsweek", independenceGroup: "newsweek" },
  { domain: "independent.co.uk", name: "The Independent", independenceGroup: "independent" },
  { domain: "telegraph.co.uk", name: "The Telegraph", independenceGroup: "telegraph" },
  { domain: "thetimes.co.uk", name: "The Times", independenceGroup: "thetimes" },
  { domain: "scmp.com", name: "South China Morning Post", independenceGroup: "scmp" },
  { domain: "japantimes.co.jp", name: "The Japan Times", independenceGroup: "japantimes" },
  { domain: "straitstimes.com", name: "The Straits Times", independenceGroup: "straitstimes" },
  { domain: "thehindu.com", name: "The Hindu", independenceGroup: "thehindu" },
  { domain: "indianexpress.com", name: "The Indian Express", independenceGroup: "indianexpress" },
  { domain: "timesofindia.indiatimes.com", name: "The Times of India", independenceGroup: "toi" },
  { domain: "ndtv.com", name: "NDTV", independenceGroup: "ndtv" },
  { domain: "hindustantimes.com", name: "Hindustan Times", independenceGroup: "ht" },
  { domain: "livemint.com", name: "Mint", independenceGroup: "mint" },
  { domain: "business-standard.com", name: "Business Standard", independenceGroup: "bstandard" },
  { domain: "haaretz.com", name: "Haaretz", independenceGroup: "haaretz" },
  { domain: "timesofisrael.com", name: "The Times of Israel", independenceGroup: "toi-il" },
  { domain: "euronews.com", name: "Euronews", independenceGroup: "euronews" },
  { domain: "politico.eu", name: "Politico Europe", independenceGroup: "politico" },
  { domain: "rte.ie", name: "RTÉ", independenceGroup: "rte" },
  { domain: "irishtimes.com", name: "The Irish Times", independenceGroup: "irishtimes" },
  { domain: "smh.com.au", name: "The Sydney Morning Herald", independenceGroup: "smh" },
  { domain: "theglobeandmail.com", name: "The Globe and Mail", independenceGroup: "globeandmail" },
];

const BY_DOMAIN = new Map(KNOWN_PUBLISHERS.map((p) => [p.domain, p]));

/**
 * Extracts a bare publisher domain from a URL: lowercase, no scheme, no `www.`, no port.
 *
 * Returns null rather than throwing for anything unparseable. A feed that hands us a
 * malformed link should cost us one article, not one tick.
 */
export function publisherDomain(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const bare = host.startsWith("www.") ? host.slice(4) : host;
    return bare.length === 0 ? null : bare;
  } catch {
    return null;
  }
}

/**
 * Resolves a domain to a publisher, walking up one label at a time.
 *
 * `edition.cnn.com` resolves to `cnn.com`; an unknown host resolves to null. The walk stops
 * before the last two labels so that a host under a public suffix can never resolve to the
 * suffix itself.
 */
export function resolvePublisher(domain: string): KnownPublisher | null {
  const exact = BY_DOMAIN.get(domain);
  if (exact !== undefined) return exact;

  const labels = domain.split(".");
  for (let i = 1; labels.length - i >= 2; i += 1) {
    const candidate = labels.slice(i).join(".");
    const match = BY_DOMAIN.get(candidate);
    if (match !== undefined) return match;
  }
  return null;
}

/**
 * What we record for a publisher we have never seen.
 *
 * Its own domain becomes its group — an unknown publisher is independent of everything,
 * including other unknown publishers. It is `allowlisted: false`, so it never contributes to
 * confirmation; it is ingested and displayed, and the UI marks it "not counted".
 */
export function describeSource(domain: string): {
  domain: string;
  name: string;
  independenceGroup: string;
  allowlisted: boolean;
} {
  const known = resolvePublisher(domain);
  if (known !== null) {
    return { ...known, domain, allowlisted: true };
  }
  return { domain, name: domain, independenceGroup: domain, allowlisted: false };
}
