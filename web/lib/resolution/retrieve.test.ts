import { describe, expect, it } from "vitest";
import { buildIdf } from "../news/similarity";
import { comparableTokens } from "../news/normalize";
import { MIN_QUESTION_COVERAGE, questionCoverage, rankByCoverage } from "./retrieve";

/**
 * The retrieval measure, pinned.
 *
 * The first test is the one that matters: it reproduces the defect that made this file necessary.
 * Phase 3's Jaccard scored a *correct* article near zero against a market question, because Jaccard
 * divides by the union and a question is long by construction. These tests fail if anyone
 * "simplifies" coverage back into a symmetric measure.
 */

const QUESTION =
  "Will the Federal Reserve announce a further increase in the federal funds rate at their next scheduled meeting?";

/** Builds the IDF table the way `rankByCoverage` does, so scores here match scores there. */
function scoreAgainst(question: string, headlines: readonly string[]): number[] {
  const ranked = rankByCoverage(question, headlines, (headline) => headline);
  // `rankByCoverage` sorts; re-align to the input order so a test can name its expectations.
  return headlines.map(
    (headline) => ranked.find((entry) => entry.document === headline)?.score ?? Number.NaN,
  );
}

describe("questionCoverage — asymmetry is the point", () => {
  it("is 1 when the document contains every one of the question's content words", () => {
    const question = comparableTokens("Will the Federal Reserve raise rates?");
    const document = comparableTokens(
      "Federal Reserve raise rates decision expected Thursday in Washington",
    );
    const idf = buildIdf([question, document]);
    expect(questionCoverage(question, document, idf)).toBeCloseTo(1, 5);
  });

  it("is 0 when they share nothing", () => {
    const question = comparableTokens("Will the Federal Reserve raise rates?");
    const document = comparableTokens("Panda arrives safely in Chengdu");
    const idf = buildIdf([question, document]);
    expect(questionCoverage(question, document, idf)).toBe(0);
  });

  it("does NOT penalise a document for being long — the failure that Jaccard had", () => {
    const question = comparableTokens("Will the Federal Reserve raise rates?");
    const short = comparableTokens("Federal Reserve raise rates");
    const long = comparableTokens(
      "Federal Reserve raise rates after a long meeting in Washington attended by " +
        "governors economists journalists and assorted commentators discussing inflation",
    );
    const idf = buildIdf([question, short, long]);

    // Both cover the whole question, so both score the same. A symmetric measure would rank the
    // long one far lower — which is exactly how the first implementation lost every true match.
    expect(questionCoverage(question, long, idf)).toBeCloseTo(
      questionCoverage(question, short, idf),
      5,
    );
  });

  it("returns 0 rather than NaN for an empty question or document", () => {
    const idf = buildIdf([new Set(["a"])]);
    expect(questionCoverage(new Set(), new Set(["a"]), idf)).toBe(0);
    expect(questionCoverage(new Set(["a"]), new Set(), idf)).toBe(0);
  });

  it("weights rare terms above common ones", () => {
    const question = comparableTokens("Will the Federal Reserve raise interest rates?");
    // "rates" appears in every document below, so it is nearly worthless; "federal reserve" is rare.
    const rare = comparableTokens("Federal Reserve holds rates");
    const common = comparableTokens("Bank of England rates announcement");
    const filler = [
      comparableTokens("Norway rates decision"),
      comparableTokens("Turkey rates decision"),
      comparableTokens("Brazil rates decision"),
    ];
    const idf = buildIdf([question, rare, common, ...filler]);

    expect(questionCoverage(question, rare, idf)).toBeGreaterThan(
      questionCoverage(question, common, idf),
    );
  });
});

describe("rankByCoverage", () => {
  it("puts the article about the question's subject first", () => {
    const headlines = [
      "Panda arrives safely in Chengdu",
      "Fed raises federal funds rate by a quarter point at scheduled meeting",
      "Stand-up comic released after conviction",
    ];
    const ranked = rankByCoverage(QUESTION, headlines, (headline) => headline);
    expect(ranked[0].document).toBe(headlines[1]);
  });

  it("separates the relevant article from the noise by more than the floor", () => {
    const relevant = "Fed raises federal funds rate at its scheduled meeting";
    const noise = ["Fiery end for SpaceX Starship mission", "Panda arrives safely in Chengdu"];
    const [relevantScore, ...noiseScores] = scoreAgainst(QUESTION, [relevant, ...noise]);

    expect(relevantScore).toBeGreaterThanOrEqual(MIN_QUESTION_COVERAGE);
    for (const score of noiseScores) expect(score).toBeLessThan(MIN_QUESTION_COVERAGE);
  });

  it("is a total ordering over the input — nothing is dropped", () => {
    const headlines = ["one thing entirely", "another thing", "a third"];
    expect(rankByCoverage(QUESTION, headlines, (h) => h)).toHaveLength(headlines.length);
  });

  it("returns an empty list for no documents rather than throwing", () => {
    expect(rankByCoverage(QUESTION, [], (h: string) => h)).toEqual([]);
  });

  it("is pure: the same inputs give the same scores", () => {
    const headlines = ["Fed raises rates", "Panda arrives in Chengdu"];
    expect(rankByCoverage(QUESTION, headlines, (h) => h)).toEqual(
      rankByCoverage(QUESTION, headlines, (h) => h),
    );
  });
});

describe("MIN_QUESTION_COVERAGE", () => {
  it("sits inside the gap measured on the live corpus: above 0.087, below 0.165", () => {
    // The table in `retrieve.ts` is the measurement. This test is what stops the constant drifting
    // out of the gap it was read from without someone re-measuring and updating both.
    expect(MIN_QUESTION_COVERAGE).toBeGreaterThan(0.087);
    expect(MIN_QUESTION_COVERAGE).toBeLessThan(0.165);
  });
});
