import { describe, expect, it } from "vitest";
import { comparableTokens } from "./normalize";
import { buildIdf, classifyPair, weightedJaccard } from "./similarity";
import { pairKey, planClusters, type ClusterItem } from "./cluster";

/**
 * Clustering, against copy taken from real feeds.
 *
 * Every fixture below is a real headline and standfirst observed during
 * `pnpm --filter web calibrate`, including the two pairs that make the problem hard: a pair of
 * genuinely independent reports of one event, and a pair of *different* events that share
 * almost the same vocabulary. The suite asserts which band each lands in, because the band is
 * the actual contract — "same" and "different" are decided without a model, and only the
 * middle is ever asked about.
 */

type Fixture = { id: string; title: string; summary: string | null; published: number | null };

/** Bloomberg's story. */
const HYNIX_BLOOMBERG: Fixture = {
  id: "item-hynix-bloomberg",
  title: "SK Hynix Shares Fall as Solidigm's Potential US IPO Sours Mood - Bloomberg.com",
  summary:
    "SK Hynix shares dropped after a report that its Solidigm unit is weighing a US listing, " +
    "raising questions about the memory maker's capital plans.",
  published: 1_700_000_000_000,
};

/** The same story, republished. Observed at 0.709 on full text and 1.00 on titles. */
const HYNIX_YAHOO: Fixture = {
  id: "item-hynix-yahoo",
  title: "SK Hynix Shares Fall as Solidigm's Potential US IPO Sours Mood - Yahoo Finance",
  summary:
    "SK Hynix shares dropped after a report that its Solidigm unit is weighing a US listing, " +
    "raising questions about the memory maker's capital plans.",
  published: 1_700_000_030_000,
};

/** AP's own copy. */
const ECB_AP: Fixture = {
  id: "item-ecb-ap",
  title:
    "European Central Bank raises interest rates a quarter point to quell energy-fueled inflation - AP News",
  summary:
    "The European Central Bank raised its key interest rate by a quarter of a percentage point " +
    "on Thursday, continuing its campaign to bring down inflation driven by energy costs.",
  published: 1_700_000_060_000,
};

/** The New York Times on the same event, written independently. Observed at 0.420. */
const ECB_NYT: Fixture = {
  id: "item-ecb-nyt",
  title: "European Central Bank Raises Rates in Bid to Quell Inflation - The New York Times",
  summary:
    "Policymakers in Frankfurt lifted the benchmark rate by a quarter point, pressing on with " +
    "efforts to cool prices even as the euro zone economy slows.",
  published: 1_700_000_090_000,
};

/**
 * A *different* central bank, a different continent, the opposite decision — and nearly the
 * same words. Observed at 0.411 against `ECB_NYT`, nine thousandths below a true pair.
 */
const TAIWAN_CB: Fixture = {
  id: "item-taiwan",
  title: "Taiwan Central Bank Holds Rates, Raises Growth and Inflation Forecasts - WSJ",
  summary:
    "Taiwan's central bank left its policy rate unchanged and raised its growth and inflation " +
    "forecasts for the year, citing resilient exports.",
  published: 1_700_000_120_000,
};

const FOOTBALL: Fixture = {
  id: "item-football",
  title: "Late goal sends City through to the semi-final",
  summary:
    "A stoppage-time header settled a tense quarter-final at the Etihad and sent the home side " +
    "into the last four for the third season running.",
  published: 1_700_000_180_000,
};

const CORPUS = [HYNIX_BLOOMBERG, HYNIX_YAHOO, ECB_AP, ECB_NYT, TAIWAN_CB, FOOTBALL];

function toItem(fixture: Fixture): ClusterItem {
  return {
    id: fixture.id,
    contentHash: `0x${fixture.id}`,
    publishedAt: fixture.published,
    tokens: comparableTokens(fixture.title),
  };
}

const IDF = buildIdf(CORPUS.map((f) => comparableTokens(f.title)));
const ITEMS = CORPUS.map(toItem);
const byId = new Map(ITEMS.map((item) => [item.id, item]));

function score(a: Fixture, b: Fixture): number {
  return weightedJaccard(
    (byId.get(a.id) as ClusterItem).tokens,
    (byId.get(b.id) as ClusterItem).tokens,
    IDF,
  );
}

describe("similarity bands on real feed copy", () => {
  it("puts a republished wire copy above the deterministic threshold", () => {
    expect(classifyPair(score(HYNIX_BLOOMBERG, HYNIX_YAHOO))).toBe("same");
  });

  it("puts two independently-written reports of one event in the borderline band", () => {
    // This is the honest result, and the reason the band exists. AP and the NYT describing the
    // same ECB decision do not share enough vocabulary to merge without being asked about.
    expect(classifyPair(score(ECB_AP, ECB_NYT))).toBe("borderline");
  });

  it("also puts a genuinely different story in the borderline band", () => {
    // Taiwan holding rates and the ECB raising them are different events that read alike.
    // No threshold separates this from the pair above — that is precisely why a model is
    // consulted here and nowhere else. See the table in `similarity.ts`.
    expect(classifyPair(score(ECB_NYT, TAIWAN_CB))).toBe("borderline");
  });

  it("scores unrelated stories as different", () => {
    expect(classifyPair(score(ECB_AP, FOOTBALL))).toBe("different");
    expect(score(ECB_AP, FOOTBALL)).toBeLessThan(0.1);
  });

  it("is symmetric", () => {
    expect(score(ECB_AP, ECB_NYT)).toBeCloseTo(score(ECB_NYT, ECB_AP), 12);
  });

  it("treats an empty document as similar to nothing, including another empty one", () => {
    const empty = new Set<string>();
    expect(weightedJaccard(empty, empty, IDF)).toBe(0);
    expect(weightedJaccard(empty, (byId.get(ECB_AP.id) as ClusterItem).tokens, IDF)).toBe(0);
  });
});

describe("planClusters — deterministic pass, no model", () => {
  const plan = planClusters(ITEMS, IDF);

  it("merges only the pair that cleared the deterministic threshold", () => {
    const merged = plan.clusters.filter((cluster) => cluster.members.length > 1);
    expect(merged).toHaveLength(1);
    expect(merged[0].members.map((m) => m.itemId).sort()).toEqual([
      "item-hynix-bloomberg",
      "item-hynix-yahoo",
    ]);
  });

  it("leaves every borderline pair unmerged — ADR-030", () => {
    // Five clusters: the merged Hynix pair, plus four singletons.
    expect(plan.clusters).toHaveLength(5);
  });

  it("reports the borderline pairs it declined to decide", () => {
    const keys = plan.undecided.map((pair) => pair.key);
    expect(keys).toContain(pairKey(ECB_AP.id, ECB_NYT.id));
    expect(keys).toContain(pairKey(ECB_NYT.id, TAIWAN_CB.id));
  });

  it("seeds a cluster with its earliest-published member", () => {
    const merged = plan.clusters.find((cluster) => cluster.members.length > 1);
    expect(merged?.seedId).toBe("item-hynix-bloomberg");
    expect(merged?.proposedKey).toBe("0xitem-hynix-bloomberg");
  });

  it("records the seed's own similarity as exactly 1", () => {
    const merged = plan.clusters.find((cluster) => cluster.members.length > 1);
    const seed = merged?.members.find((m) => m.itemId === merged.seedId);
    expect(seed?.similarity).toBe(1);
  });

  it("is deterministic in content and in order regardless of input order", () => {
    const reversed = planClusters([...ITEMS].reverse(), IDF);
    expect(JSON.stringify(reversed.clusters)).toBe(JSON.stringify(plan.clusters));
    expect(JSON.stringify(reversed.undecided)).toBe(JSON.stringify(plan.undecided));
  });

  it("reports the number of comparisons it made", () => {
    expect(plan.comparisons).toBe((ITEMS.length * (ITEMS.length - 1)) / 2);
  });
});

describe("planClusters — applying model verdicts", () => {
  const ecbPair = pairKey(ECB_AP.id, ECB_NYT.id);
  const falsePair = pairKey(ECB_NYT.id, TAIWAN_CB.id);

  it("merges two independent reports when the model confirms they are one event", () => {
    // The exit criterion: two genuinely different reports of one story become one Event.
    const plan = planClusters(ITEMS, IDF, { adjudications: new Map([[ecbPair, true]]) });
    const ecbCluster = plan.clusters.find((cluster) =>
      cluster.members.some((m) => m.itemId === ECB_AP.id),
    );
    expect(ecbCluster?.members.map((m) => m.itemId).sort()).toEqual([
      "item-ecb-ap",
      "item-ecb-nyt",
    ]);
  });

  it("keeps the look-alike pair apart when the model says they are different events", () => {
    const plan = planClusters(ITEMS, IDF, {
      adjudications: new Map([
        [ecbPair, true],
        [falsePair, false],
      ]),
    });
    const withTaiwan = plan.clusters.find((cluster) =>
      cluster.members.some((m) => m.itemId === TAIWAN_CB.id),
    );
    expect(withTaiwan?.members).toHaveLength(1);
  });

  it("marks a model-merged member so the UI can show which links are judgements", () => {
    const plan = planClusters(ITEMS, IDF, { adjudications: new Map([[ecbPair, true]]) });
    const cluster = plan.clusters.find((c) => c.members.some((m) => m.itemId === ECB_AP.id));
    const nonSeed = cluster?.members.find((m) => m.itemId !== cluster.seedId);
    expect(nonSeed?.adjudicatedByLlm).toBe(true);
  });

  it("does not mark a deterministically-merged member as adjudicated", () => {
    const plan = planClusters(ITEMS, IDF);
    const cluster = plan.clusters.find((c) => c.members.length > 1);
    expect(cluster?.members.every((m) => !m.adjudicatedByLlm)).toBe(true);
  });

  it("a model cannot split a pair that cleared the deterministic threshold", () => {
    // Verdicts are only ever consulted inside the band. This one is ignored.
    const plan = planClusters(ITEMS, IDF, {
      adjudications: new Map([[pairKey(HYNIX_BLOOMBERG.id, HYNIX_YAHOO.id), false]]),
    });
    const merged = plan.clusters.filter((cluster) => cluster.members.length > 1);
    expect(merged).toHaveLength(1);
  });

  /**
   * Transitivity is a property of the union-find, not of the similarity measure, so it is
   * tested on hand-built token sets. Deriving it from prose would make a test of `planClusters`
   * depend on whether a particular headline happened to land in a particular band.
   */
  it("clusters transitively: a deterministic merge and an accepted verdict join up", () => {
    const item = (id: string, tokens: string[]): ClusterItem => ({
      id,
      contentHash: `0x${id}`,
      publishedAt: 1,
      tokens: new Set(tokens),
    });

    // a~b are identical (score 1, "same"); b~c overlap in three of five weighted tokens,
    // which lands in the borderline band.
    const a = item("a", ["alpha", "bravo", "charlie", "delta"]);
    const b = item("b", ["alpha", "bravo", "charlie", "delta"]);
    const c = item("c", ["bravo", "charlie", "delta", "echo"]);
    const items = [a, b, c];
    const idf = buildIdf(items.map((i) => i.tokens));

    // Without a verdict: {a,b} and {c}.
    const deterministic = planClusters(items, idf);
    expect(deterministic.clusters).toHaveLength(2);
    expect(deterministic.undecided.map((p) => p.key)).toContain(pairKey("b", "c"));

    // With the b~c verdict accepted, a is pulled in through b even though a~c was never merged.
    const merged = planClusters(items, idf, {
      adjudications: new Map([[pairKey("b", "c"), true]]),
    });
    expect(merged.clusters).toHaveLength(1);
    expect(merged.clusters[0].members.map((m) => m.itemId)).toEqual(["a", "b", "c"]);
  });
});

describe("pairKey", () => {
  it("is order-independent, so one pair is recorded once", () => {
    expect(pairKey("b", "a")).toBe(pairKey("a", "b"));
  });
});
