/**
 * The two-source rule. **Pure.**
 *
 * An event is `CONFIRMED` when at least two *independent* publishers reported it. Everything
 * hard about that sentence is the word "independent", and this module is where the three ways
 * it can be false are handled:
 *
 * 1. **The publisher is not one we vetted.** Anyone can get a headline into Google News. Items
 *    from publishers outside the allowlist are ingested and displayed but never counted —
 *    otherwise "two sources agreed" could be manufactured by whoever benefits from the market.
 * 2. **The two publishers are one newsroom.** `bbc.com` and `bbc.co.uk` share an
 *    `independenceGroup` and count once. Handled by grouping.
 * 3. **The two publishers are running the same wire copy.** This is the one that group
 *    membership cannot catch: a paper that reprints Reuters today writes its own copy
 *    tomorrow, so permanently binding it to Reuters' group would be wrong. It is caught per
 *    *item* instead — two articles from different publishers whose text is near-identical are
 *    one report, not two.
 *
 * What this is not: proof of independence. Two publishers can share a stringer, or both be
 * wrong in the same way. `docs/ARCHITECTURE.md` §11 and the README both say so. It is a real
 * bound on a real failure mode, stated honestly rather than dressed up as an oracle.
 */

import { weightedJaccard, type IdfTable } from "./similarity";

/**
 * Headline similarity above which two publishers are running the same copy.
 *
 * Measured on live feeds (`pnpm --filter web calibrate`):
 *
 * - Yahoo Finance and Bloomberg both carried *"SK Hynix Shares Fall as Solidigm's Potential US
 *   IPO Sours Mood"* — character-identical. One story, republished. Title score **1.00**.
 * - Yahoo Finance and the Motley Fool both carried *"3 ETFs That Could Include Anthropic After
 *   Its IPO in October"*. Also **1.00**.
 * - AP wrote *"European Central Bank raises interest rates a quarter point to quell
 *   energy-fueled inflation"*; the New York Times wrote *"European Central Bank Raises Rates in
 *   Bid to Quell Inflation"*. Same event, two newsrooms. Title score **0.438**.
 *
 * Publishers rewrite headlines as a matter of course; syndicators do not. So the gap between
 * "republished" and "independently reported" is enormous — 1.00 against 0.44 — and 0.85 sits
 * in the middle of it with room on both sides.
 *
 * Being wrong in the *permissive* direction manufactures a second source and confirms an event
 * that one newsroom reported. The threshold is therefore set closer to "identical" than to
 * "similar", and deliberately well above the highest observed independent pair.
 */
export const SYNDICATION_TITLE_SIMILARITY = 0.85;

/** Minimum independent publishers for `CONFIRMED`. From `docs/BUILD_PLAN.md` Phase 3. */
export const REQUIRED_INDEPENDENT_SOURCES = 2;

export type ConfirmationMember = {
  itemId: string;
  independenceGroup: string;
  allowlisted: boolean;
  /** Headline tokens — the same set clustering uses. See `normalize.comparableTokens`. */
  tokens: ReadonlySet<string>;
};

export type ConfirmationVerdict = {
  /** Distinct independent sources after grouping and syndication collapse. */
  independentSources: number;
  confirmed: boolean;
  /** The groups that survived, sorted — rendered in the UI so the count is checkable. */
  countedGroups: string[];
  /** Groups dropped as syndicated copies of another counted group. */
  syndicatedGroups: string[];
  /** Groups present but not allowlisted, so never eligible. */
  ignoredGroups: string[];
};

/**
 * Counts genuinely independent sources for one cluster.
 *
 * Deterministic: members are reduced to one representative per independence group, chosen by
 * lowest item id, before any similarity is computed. Without that, the answer could depend on
 * which article the database happened to return first.
 *
 * `idf` must be built over the same headline token sets passed in `tokens`, so the weighting
 * reflects how rare a word is among headlines.
 */
export function countIndependentSources(
  members: readonly ConfirmationMember[],
  idf: IdfTable,
): ConfirmationVerdict {
  const ignoredGroups = new Set<string>();
  const representatives = new Map<string, ConfirmationMember>();

  for (const member of members) {
    if (!member.allowlisted) {
      ignoredGroups.add(member.independenceGroup);
      continue;
    }
    const existing = representatives.get(member.independenceGroup);
    if (existing === undefined || member.itemId < existing.itemId) {
      representatives.set(member.independenceGroup, member);
    }
  }

  // Sorted so the collapse below is order-independent.
  const groups = [...representatives.keys()].sort();
  const counted: string[] = [];
  const syndicated: string[] = [];

  for (const group of groups) {
    const candidate = representatives.get(group) as ConfirmationMember;

    // Compare against groups already counted, never against ones already discarded — so a
    // chain of three near-identical copies collapses to one, not to two.
    const isCopy = counted.some((countedGroup) => {
      const other = representatives.get(countedGroup) as ConfirmationMember;
      return (
        weightedJaccard(candidate.tokens, other.tokens, idf) >=
        SYNDICATION_TITLE_SIMILARITY
      );
    });

    if (isCopy) syndicated.push(group);
    else counted.push(group);
  }

  return {
    independentSources: counted.length,
    confirmed: counted.length >= REQUIRED_INDEPENDENT_SOURCES,
    countedGroups: counted,
    syndicatedGroups: syndicated,
    ignoredGroups: [...ignoredGroups].sort(),
  };
}
