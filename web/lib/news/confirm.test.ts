import { describe, expect, it } from "vitest";
import { comparableTokens } from "./normalize";
import { buildIdf } from "./similarity";
import { countIndependentSources, type ConfirmationMember } from "./confirm";

/**
 * The two-source rule — the claim the whole phase rests on.
 *
 * Each test here corresponds to a way "two independent publishers reported it" can be false
 * while still looking true: one newsroom under two domains, one wire story under two
 * mastheads, and a publisher nobody vetted.
 */

type Spec = { id: string; group: string; title: string; allowlisted?: boolean };

function members(specs: Spec[]): { members: ConfirmationMember[]; idf: ReturnType<typeof buildIdf> } {
  const withTokens = specs.map((spec) => ({
    itemId: spec.id,
    independenceGroup: spec.group,
    allowlisted: spec.allowlisted ?? true,
    tokens: comparableTokens(spec.title),
  }));
  return { members: withTokens, idf: buildIdf(withTokens.map((m) => m.tokens)) };
}

function verdictFor(specs: Spec[]) {
  const { members: m, idf } = members(specs);
  return countIndependentSources(m, idf);
}

/** Two newsrooms writing their own headline about one ECB decision. Observed at 0.438. */
const ECB_AP = "European Central Bank raises interest rates a quarter point to quell energy-fueled inflation";
const ECB_NYT = "European Central Bank Raises Rates in Bid to Quell Inflation";
/** The same copy, run by two outlets. Observed at 1.00. */
const HYNIX = "SK Hynix Shares Fall as Solidigm's Potential US IPO Sours Mood";

describe("countIndependentSources", () => {
  it("confirms on two independently-written reports from different publishers", () => {
    const verdict = verdictFor([
      { id: "1", group: "ap", title: ECB_AP },
      { id: "2", group: "nyt", title: ECB_NYT },
    ]);

    expect(verdict.independentSources).toBe(2);
    expect(verdict.confirmed).toBe(true);
    expect(verdict.countedGroups).toEqual(["ap", "nyt"]);
  });

  it("does NOT confirm an event with a single publisher", () => {
    // The exit criterion: one publisher stays OBSERVED, however many articles it filed.
    const verdict = verdictFor([
      { id: "1", group: "bbc", title: ECB_AP },
      { id: "2", group: "bbc", title: ECB_NYT },
      { id: "3", group: "bbc", title: "ECB decision: what it means for mortgages" },
    ]);

    expect(verdict.independentSources).toBe(1);
    expect(verdict.confirmed).toBe(false);
  });

  it("counts one newsroom under two domains once", () => {
    // bbc.com and bbc.co.uk share an independence group in `sources.ts`.
    const verdict = verdictFor([
      { id: "1", group: "bbc", title: ECB_AP },
      { id: "2", group: "bbc", title: ECB_NYT },
    ]);
    expect(verdict.confirmed).toBe(false);
  });

  it("does NOT let a syndicated copy manufacture a second source", () => {
    // Yahoo Finance and Bloomberg ran character-identical headlines. Two domains, two
    // independence groups, one story — and it must not confirm.
    const verdict = verdictFor([
      { id: "1", group: "bloomberg", title: HYNIX },
      { id: "2", group: "yahoo", title: HYNIX },
    ]);

    expect(verdict.independentSources).toBe(1);
    expect(verdict.confirmed).toBe(false);
    expect(verdict.syndicatedGroups).toEqual(["yahoo"]);
  });

  it("collapses a chain of three copies to one source, not two", () => {
    // Each candidate is compared against what has already been *counted*, never against what
    // was discarded — otherwise copy 3 would be compared only to discarded copy 2 and survive.
    const verdict = verdictFor([
      { id: "1", group: "bloomberg", title: HYNIX },
      { id: "2", group: "yahoo", title: HYNIX },
      { id: "3", group: "msn", title: HYNIX },
    ]);

    expect(verdict.independentSources).toBe(1);
    expect(verdict.syndicatedGroups).toEqual(["msn", "yahoo"]);
  });

  it("confirms when a syndicated pair is joined by a genuinely independent report", () => {
    const verdict = verdictFor([
      { id: "1", group: "bloomberg", title: HYNIX },
      { id: "2", group: "yahoo", title: HYNIX },
      { id: "3", group: "reuters", title: "Solidigm weighs New York listing, sources say" },
    ]);

    expect(verdict.independentSources).toBe(2);
    expect(verdict.confirmed).toBe(true);
    expect(verdict.countedGroups).toEqual(["bloomberg", "reuters"]);
    expect(verdict.syndicatedGroups).toEqual(["yahoo"]);
  });

  it("ignores publishers that are not on the allowlist", () => {
    // Anyone can get a headline into Google News. An unvetted publisher is shown but never
    // counted, so "two sources agreed" cannot be manufactured by the market's beneficiary.
    const verdict = verdictFor([
      { id: "1", group: "ap", title: ECB_AP },
      { id: "2", group: "rumourblog.example", title: ECB_NYT, allowlisted: false },
    ]);

    expect(verdict.independentSources).toBe(1);
    expect(verdict.confirmed).toBe(false);
    expect(verdict.ignoredGroups).toEqual(["rumourblog.example"]);
  });

  it("reports an empty event as zero sources rather than throwing", () => {
    expect(verdictFor([])).toMatchObject({ independentSources: 0, confirmed: false });
  });

  it("is order-independent", () => {
    const specs: Spec[] = [
      { id: "1", group: "bloomberg", title: HYNIX },
      { id: "2", group: "yahoo", title: HYNIX },
      { id: "3", group: "reuters", title: "Solidigm weighs New York listing, sources say" },
    ];
    const forward = verdictFor(specs);
    const reversed = verdictFor([...specs].reverse());
    expect(reversed).toEqual(forward);
  });

  it("confirms on exactly two and does not require more", () => {
    const verdict = verdictFor([
      { id: "1", group: "ap", title: ECB_AP },
      { id: "2", group: "nyt", title: ECB_NYT },
    ]);
    expect(verdict.independentSources).toBe(2);
    expect(verdict.confirmed).toBe(true);
  });
});
