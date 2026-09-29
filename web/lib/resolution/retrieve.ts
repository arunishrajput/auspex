/**
 * Scoring an article against a market question. **Pure.**
 *
 * ## Why Phase 3's similarity measure is the wrong tool here, found by measurement
 *
 * `news/similarity.ts` compares two **headlines** with IDF-weighted Jaccard, and its thresholds were
 * read off the live distribution of headline-versus-headline scores (ADR-029). Reusing that measure
 * to compare a **question** against a headline looked obvious and returned *zero candidates for all
 * four live markets* on the first real run.
 *
 * The reason is structural, not a tuning problem. Jaccard divides by the weight of the **union**, so
 * it punishes a length mismatch — and a market question is long by construction:
 *
 *     "Will the Federal Reserve announce a further increase in the federal funds rate at their next
 *      scheduled meeting?"                                              ~12 content tokens
 *     "Fed holds rates steady"                                           ~4 content tokens
 *
 * Even a headline that reports exactly the thing the question asked about shares only its rare terms
 * and differs on the rest, so the union dominates and the score collapses. No threshold on Jaccard
 * separates "this article answers the question" from "this article is unrelated", because the measure
 * is answering a different question: *are these the same story?*
 *
 * ## What this measures instead
 *
 * **How much of the question's discriminating weight the article covers.**
 *
 *     coverage = Σ idf(t) for t in question ∩ article  /  Σ idf(t) for t in question
 *
 * Asymmetric, and deliberately so: the question is the thing being answered, and the article is
 * either about it or not. A headline three times as long is not penalised for its extra words,
 * because they are not what is being asked about. It is IDF-weighted **recall of the question's
 * terms** — the standard shape for a retrieval score, as opposed to a similarity score.
 *
 * Range 0 to 1. Rare terms dominate, so "Federal Reserve" and "funds rate" carry the score while
 * "announce" and "their" carry almost none, which is the behaviour a reader would expect from
 * "does this article cover the question?".
 *
 * ## What it is not
 *
 * It is not evidence that the article settles the question — only that it is worth reading. The
 * model still has to find a sentence that settles it, and `validate.ts` still has to find that
 * sentence in the text (ADR-054). Being generous here costs a few tokens; being strict means the one
 * article that actually reports the outcome never reaches the model because it was worded
 * differently.
 */

import { buildIdf, type IdfTable } from "../news/similarity";
import { comparableTokens } from "../news/normalize";

/**
 * IDF-weighted share of the question's terms that the document covers.
 *
 * Returns 0 for an empty question or document rather than NaN: a market whose question has no
 * content words is unanswerable, not perfectly matched by everything.
 */
export function questionCoverage(
  question: ReadonlySet<string>,
  document: ReadonlySet<string>,
  idf: IdfTable,
): number {
  if (question.size === 0 || document.size === 0) return 0;

  let covered = 0;
  let total = 0;
  for (const token of question) {
    // Same smoothing as `weightedJaccard`: an unseen token still carries weight, because a term
    // absent from the batch is maximally discriminating rather than irrelevant.
    const weight = idf.get(token) ?? Math.log(2);
    total += weight;
    if (document.has(token)) covered += weight;
  }

  return total === 0 ? 0 : covered / total;
}

/**
 * Minimum coverage for an article to be offered as evidence.
 *
 * **Measured, not chosen.** Read off the live corpus on 2026-09-29 — 29 articles ingested since
 * markets #4–#7 opened, scored against each of those four questions. The whole of the interesting
 * part of the distribution:
 *
 * | Score | Article                                                        | Against | Truth |
 * |-------|----------------------------------------------------------------|---------|-------|
 * | 0.297 | Iran war live: Trump says he did not offer Tehran sanctions relief | #7   | **same story** |
 * | 0.177 | FEMA can't condition security grants on election changes, judge says | #5 | **same story** |
 * | 0.165 | Trump denies willingness to give Iran sanctions relief          | #7      | **same story** |
 * | 0.087 | Fiery end for SpaceX Starship mission                          | #6      | unrelated |
 * | 0.066 | Iran court upholds lashes sentence for singer                   | #7      | unrelated |
 * | 0.064 | Iran court upholds lashes sentence for singer                   | #5      | unrelated |
 * | 0.051 | CNBC's The China Connection newsletter                          | #7      | unrelated |
 * | 0.049 | Election denier Kurt Olsen has resigned from DOJ                | #5      | unrelated |
 * | 0.000 | (everything else — 96% of pairs)                                |         | unrelated |
 *
 * The three true matches sit at 0.165 and above; every unrelated article sits at 0.087 and below,
 * and the identical repeated values are single coincidental token hits. **0.12 is inside that gap**,
 * below every true match and above every false one observed.
 *
 * The first value tried here was 0.18, and it is instructive that it was wrong: it missed the
 * Washington Post article for market #5 by 0.003 — a true match, discarded by a threshold nobody had
 * measured. That is the failure mode this project keeps rediscovering (ADR-029, ADR-049): a number
 * that looks reasonable, applied to a distribution nobody looked at.
 *
 * **What this calibration does not cover.** No article in that corpus reported the *outcome* of any
 * of the four markets, because none of those outcomes has happened. So the sample contains true
 * matches on *subject* and no true matches on *settlement* — the case that matters most is not in it.
 * The floor is set generously for exactly that reason: a missed article costs a resolution, an extra
 * one costs a few tokens and still has to survive the quote check and a human.
 *
 * Re-measure with `pnpm --filter web resolution:dry-run`, which prints every candidate's score
 * whether it passed or not. That is to this constant what `pnpm --filter web calibrate` is to the
 * clustering thresholds.
 */
export const MIN_QUESTION_COVERAGE = 0.12;

export type ScoredDocument<T> = { score: number; document: T };

/**
 * Ranks documents by how much of the question they cover, best first.
 *
 * The IDF table is built from the question plus this batch, exactly as clustering builds it per
 * pass — so the score is comparable to the numbers in the note above and not to some other measure
 * that happens to share a name. Returns **every** document with its score; filtering is the
 * caller's job, so a diagnostic can print the ones that did not make the cut.
 */
export function rankByCoverage<T>(
  question: string,
  documents: readonly T[],
  textOf: (document: T) => string,
): ScoredDocument<T>[] {
  const questionTokens = comparableTokens(question);
  const documentTokens = documents.map((document) => comparableTokens(textOf(document)));
  const idf = buildIdf([questionTokens, ...documentTokens]);

  return documents
    .map((document, index) => ({
      document,
      score: questionCoverage(questionTokens, documentTokens[index], idf),
    }))
    .sort((a, b) => b.score - a.score);
}
