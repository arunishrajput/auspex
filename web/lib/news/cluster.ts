/**
 * Grouping articles into stories. **Pure** — no I/O, no clock, no randomness.
 *
 * This module *proposes* a grouping. It never writes one. Persistence lives in
 * `lib/news/events.ts`, and the split matters: cluster identity has to survive a re-run, and
 * the only stable source of that identity is the database row that already exists. A pure
 * planner that re-derived identity from content would rename a cluster every time an earlier
 * article arrived.
 *
 * ## The decision rule, and which way it fails
 *
 * Three bands, from `similarity.ts`:
 *
 * | Similarity       | Decision                          | Model consulted? |
 * |------------------|-----------------------------------|------------------|
 * | ≥ 0.50           | same story — merge                | no               |
 * | 0.25 – 0.50      | ask, and default to *not* merging | yes, advisory    |
 * | < 0.25           | different stories                 | no               |
 *
 * Those boundaries were measured, not chosen — `similarity.ts` carries the evidence table and
 * `pnpm --filter web calibrate` reproduces it.
 *
 * **An unavailable model means "do not merge".** That direction is chosen, not incidental.
 * Failing to merge two reports of one story leaves two events each holding one source, and
 * `CONFIRMED` requires two independent sources — so the pipeline stalls and nothing happens.
 * Wrongly merging two *different* stories produces one event carrying two independent
 * publishers, which confirms, which proposes a market about a story that does not exist. One
 * failure is a quiet no-op; the other puts a fabricated question in front of a human and
 * eventually on-chain. When the model is down, rate-limited, or returns garbage, we take the
 * no-op. This is ADR-030.
 */

import { classifyPair, weightedJaccard, type IdfTable } from "./similarity";

/**
 * Hard bound on one clustering pass.
 *
 * All-pairs comparison is O(n²); at 200 items that is 19,900 comparisons of small string sets,
 * which measures under 20ms. The bound exists so a backlog cannot turn one tick into a
 * multi-minute job on a serverless function with a 60-second ceiling.
 */
export const MAX_ITEMS_PER_CLUSTER_PASS = 200;

export type ClusterItem = {
  id: string;
  /** SHA-256 of the normalised content. Used for deterministic seed tie-breaking. */
  contentHash: string;
  /** Epoch milliseconds, or null when the feed omitted a date. Injected — never `Date.now()`. */
  publishedAt: number | null;
  tokens: ReadonlySet<string>;
};

/** Canonical key for an unordered pair, so an adjudication is recorded once, not twice. */
export type PairKey = string;

export function pairKey(a: string, b: string): PairKey {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export type BorderlinePair = {
  key: PairKey;
  aId: string;
  bId: string;
  similarity: number;
};

export type PlannedMember = {
  itemId: string;
  /** Similarity to the cluster seed, recomputed once membership is settled. */
  similarity: number;
  /** True when this item reached the cluster only because a model broke a tie. */
  adjudicatedByLlm: boolean;
};

export type PlannedCluster = {
  /** Proposed key for a *new* event: the seed's content hash. Ignored if members already map
   *  to an existing event — see `lib/news/events.ts`. */
  proposedKey: string;
  seedId: string;
  members: PlannedMember[];
};

export type ClusterPlan = {
  clusters: PlannedCluster[];
  /** Borderline pairs with no adjudication supplied. The caller bounds how many it resolves. */
  undecided: BorderlinePair[];
  /** Pair comparisons actually performed. Reported in the tick so the cost is visible. */
  comparisons: number;
};

/**
 * Similarity between two items, computed in a canonical argument order.
 *
 * `weightedJaccard` is mathematically symmetric but not *bitwise* symmetric: it accumulates
 * `a`'s tokens before `b`'s, and floating-point addition is not associative, so swapping the
 * arguments can change the last bits of the result. That is invisible in isolation and very
 * visible when it makes the planner's output depend on the order rows came back from the
 * database. Ordering by id first removes the dependency entirely.
 */
function similarityOf(x: ClusterItem, y: ClusterItem, idf: IdfTable): number {
  return x.id <= y.id
    ? weightedJaccard(x.tokens, y.tokens, idf)
    : weightedJaccard(y.tokens, x.tokens, idf);
}

/** Union-find. Single-link clustering: A~B and B~C puts all three in one story. */
class DisjointSet {
  private readonly parent = new Map<string, string>();

  find(x: string): string {
    const seen = this.parent.get(x);
    if (seen === undefined) {
      this.parent.set(x, x);
      return x;
    }
    if (seen === x) return x;
    const root = this.find(seen);
    this.parent.set(x, root); // path compression
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    // Union by lexicographic order rather than by rank: it makes the resulting forest a
    // deterministic function of the input, which is what the tests pin.
    if (rootA < rootB) this.parent.set(rootB, rootA);
    else this.parent.set(rootA, rootB);
  }
}

/**
 * Picks a cluster's seed: earliest published wins, undated items last, content hash breaks ties.
 *
 * Total and deterministic — two items can never both be the seed, and the answer does not
 * depend on the order the items arrived in.
 */
function chooseSeed(members: ClusterItem[]): ClusterItem {
  return members.reduce((best, candidate) => {
    const bestTime = best.publishedAt ?? Number.POSITIVE_INFINITY;
    const candidateTime = candidate.publishedAt ?? Number.POSITIVE_INFINITY;
    if (candidateTime !== bestTime) return candidateTime < bestTime ? candidate : best;
    return candidate.contentHash < best.contentHash ? candidate : best;
  });
}

/**
 * Plans a clustering.
 *
 * `adjudications` maps a `pairKey` to a model's verdict for a borderline pair. A pair absent
 * from the map is reported in `undecided` and **not** merged — so calling this with no
 * adjudications at all is the fully deterministic clustering, and is exactly what runs when
 * no LLM is configured. That is the property ADR-030 rests on.
 *
 * Deterministic in output *order* as well as content: clusters come back sorted by seed id and
 * members by item id, so a test can compare against a literal and a re-run cannot reshuffle.
 */
export function planClusters(
  items: readonly ClusterItem[],
  idf: IdfTable,
  options: { adjudications?: ReadonlyMap<PairKey, boolean> } = {},
): ClusterPlan {
  const adjudications = options.adjudications ?? new Map<PairKey, boolean>();
  const sets = new DisjointSet();
  const undecided: BorderlinePair[] = [];
  /** Pairs merged only because a model said so — becomes `adjudicated_by_llm` on the row. */
  const adjudicatedMerges = new Set<PairKey>();
  let comparisons = 0;

  // Every item starts as its own cluster, so a story nothing matches still becomes an event
  // (with one source, which will not confirm — exactly as intended).
  for (const item of items) sets.find(item.id);

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      comparisons += 1;

      const similarity = similarityOf(a, b, idf);
      const verdict = classifyPair(similarity);

      if (verdict === "different") continue;

      if (verdict === "same") {
        sets.union(a.id, b.id);
        continue;
      }

      // Borderline: the only place a model has any influence at all.
      const key = pairKey(a.id, b.id);
      const adjudicated = adjudications.get(key);

      if (adjudicated === undefined) {
        // `aId`/`bId` are canonicalised, not left as (i, j). A pair is unordered, so reversing
        // the input list must not produce a different-looking record of the same question.
        const [aId, bId] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
        undecided.push({ key, aId, bId, similarity });
        continue; // absent verdict => do not merge. ADR-030.
      }

      if (adjudicated) {
        sets.union(a.id, b.id);
        adjudicatedMerges.add(key);
      }
    }
  }

  // Group by root.
  const byRoot = new Map<string, ClusterItem[]>();
  for (const item of items) {
    const root = sets.find(item.id);
    const bucket = byRoot.get(root);
    if (bucket === undefined) byRoot.set(root, [item]);
    else bucket.push(item);
  }

  const clusters: PlannedCluster[] = [];
  for (const members of byRoot.values()) {
    const seed = chooseSeed(members);
    clusters.push({
      proposedKey: seed.contentHash,
      seedId: seed.id,
      members: members
        .map((member) => ({
          itemId: member.id,
          // Similarity is reported against the seed, which is the number a reader can check.
          // It is 1 for the seed itself by definition rather than by computation.
          similarity: member.id === seed.id ? 1 : similarityOf(member, seed, idf),
          adjudicatedByLlm:
            member.id !== seed.id && adjudicatedMerges.has(pairKey(member.id, seed.id)),
        }))
        .sort((x, y) => (x.itemId < y.itemId ? -1 : x.itemId > y.itemId ? 1 : 0)),
    });
  }

  clusters.sort((x, y) => (x.seedId < y.seedId ? -1 : x.seedId > y.seedId ? 1 : 0));
  undecided.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));

  return { clusters, undecided, comparisons };
}
