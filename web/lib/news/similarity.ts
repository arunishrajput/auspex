/**
 * How similar two stories are. **Pure** — see the note at the top of `normalize.ts`.
 *
 * ## Why IDF-weighted Jaccard and not plain Jaccard
 *
 * Plain Jaccard over headline words does not work, and it is worth being concrete about why
 * rather than discovering it during a demo. Take two real reports of one event:
 *
 *   "Fed holds interest rates steady at September meeting"
 *   "Federal Reserve keeps rates unchanged in September"
 *
 * Their content-word sets intersect in {rate, september} and union to eleven tokens, so plain
 * Jaccard is 0.18 — below even the borderline band. The words they *do* share are the rare,
 * load-bearing ones; the words they differ on are interchangeable verbs. Plain Jaccard counts
 * both equally, which is precisely backwards.
 *
 * Weighting each token by its inverse document frequency across the batch being clustered
 * fixes that: "september" and "rate" are rare and dominate the score, while a word appearing
 * in most of the batch contributes almost nothing. The measure stays a true Jaccard — weight
 * of the intersection over weight of the union — so it is still 0 for disjoint sets, 1 for
 * identical ones, and monotonic in between.
 *
 * ## Why there is no MinHash here
 *
 * `docs/BUILD_PLAN.md` called for MinHash. It is not implemented, on purpose — see ADR-029.
 * MinHash is a technique for avoiding all-pairs comparison when you have millions of
 * documents. A tick clusters at most `MAX_ITEMS_PER_CLUSTER_PASS` items (200), so all-pairs
 * is 19,900 set intersections over sets of ~30 short strings: under 20ms, measured. Against
 * that, MinHash would buy nothing and cost something real — it is an *approximation*, so it
 * introduces false negatives, and a false negative here means two reports of one story fail
 * to merge and the event never reaches its second source. Exact comparison at this scale is
 * both faster to defend and strictly more correct.
 */

/** Token → inverse document frequency. Higher means rarer, therefore more discriminating. */
export type IdfTable = ReadonlyMap<string, number>;

/**
 * Builds the IDF table for one clustering pass.
 *
 * Smoothed as `ln(1 + N / df)`, which is always positive — an unsmoothed `ln(N / df)` is
 * exactly 0 for a token appearing in every document, and a token with zero weight silently
 * disappears from both numerator and denominator. Positive-but-tiny is the honest encoding of
 * "this word barely matters", and it keeps the metric well defined when every document in a
 * small batch happens to share a word.
 *
 * The table is a function of the batch, so clustering the same batch twice gives identical
 * scores. It is *not* stable across batches with different membership, which is why a
 * cluster's identity comes from its seed item's content hash rather than from its score —
 * see `cluster.ts`.
 */
export function buildIdf(documents: ReadonlySet<string>[]): IdfTable {
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    for (const token of document) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const total = documents.length;
  const idf = new Map<string, number>();
  for (const [token, frequency] of documentFrequency) {
    idf.set(token, Math.log(1 + total / frequency));
  }
  return idf;
}

/** Weight of a token, defaulting to the weight of a token seen exactly once in a batch of one. */
function weightOf(token: string, idf: IdfTable): number {
  return idf.get(token) ?? Math.log(2);
}

/**
 * IDF-weighted Jaccard similarity in [0, 1].
 *
 * Returns 0 rather than NaN for two empty documents: an item with no content words is not
 * "perfectly similar" to another such item, it is unclusterable, and 0 keeps it out of every
 * cluster instead of merging all of them together.
 */
export function weightedJaccard(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
  idf: IdfTable,
): number {
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  let union = 0;

  for (const token of a) {
    const weight = weightOf(token, idf);
    union += weight;
    if (b.has(token)) intersection += weight;
  }
  for (const token of b) {
    if (!a.has(token)) union += weightOf(token, idf);
  }

  return union === 0 ? 0 : intersection / union;
}

/**
 * The band boundaries. **Measured, not inherited.**
 *
 * `docs/BUILD_PLAN.md` specified 0.6 / 0.4, written before this measure existed. A threshold
 * is a property *of a measure*, so these were read off the live distribution instead —
 * `pnpm --filter web calibrate` reproduces it. On a run of 228 articles from 70 publishers
 * (25,878 pairs), 96% of pairs scored exactly 0. The top of the distribution:
 *
 * | Title score | Pair                                              | Ground truth    |
 * |-------------|---------------------------------------------------|-----------------|
 * | 1.000       | SK Hynix / Solidigm IPO — Yahoo vs Bloomberg       | syndicated copy |
 * | 1.000       | Anthropic ETFs — Yahoo vs Motley Fool              | syndicated copy |
 * | 0.765       | Fed raises rates — NPR vs NPR                      | same (one desk) |
 * | 0.444       | EU sanctions over deportations — EU vs Reuters     | same            |
 * | 0.438       | ECB raises rates — AP vs New York Times            | same            |
 * | 0.424       | Fed raises rates — ABC News vs ABC13 Houston       | same            |
 * | 0.380       | Trump / Iran sanctions — Jerusalem Post vs Anadolu | same            |
 * | **0.370**   | **Taiwan CB holds vs ECB hikes — WSJ vs Morningstar** | **different** |
 * | 0.360       | Trump / Iran sanctions — Axios vs Anadolu          | same            |
 * | **0.354**   | **Norges Bank hikes vs Fed hikes — Morningstar vs Politico** | **different** |
 * | 0.349       | ECB raises rates — Guardian vs New York Times      | same            |
 *
 * The two bold rows are the whole argument. They sit *interleaved* with true pairs — 0.370
 * between 0.373 and 0.360 — so **no threshold on this measure separates them**. Two stories
 * can share "central bank", "hikes", "rates", "inflation" and "forecasts" and be about
 * different continents. Picking 0.372 would be fitting a constant to two observations.
 *
 * The band is therefore drawn wide enough to *contain* the ambiguity rather than to resolve
 * it. Everything from 0.25 to 0.50 goes to adjudication, where a model can read "Taiwan" and
 * "ECB" and answer what lexical overlap cannot. Above 0.50 the sample holds no cross-publisher
 * false positive; below 0.25 is the floor, comfortably under the lowest observed true pair
 * (0.349).
 *
 * Re-run the calibration if the feed list changes. These are empirical constants and they are
 * only as good as the distribution they were read from.
 */
export const SAME_STORY_THRESHOLD = 0.5;
export const BORDERLINE_THRESHOLD = 0.25;

export type PairVerdict = "same" | "borderline" | "different";

export function classifyPair(similarity: number): PairVerdict {
  if (similarity >= SAME_STORY_THRESHOLD) return "same";
  if (similarity >= BORDERLINE_THRESHOLD) return "borderline";
  return "different";
}
