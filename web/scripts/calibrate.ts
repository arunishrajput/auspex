/**
 * Threshold calibration against live feeds.
 *
 *   pnpm --filter web calibrate
 *
 * `docs/BUILD_PLAN.md` specified a 0.6 / 0.4 band for "MinHash/Jaccard". Those numbers were
 * written before the measure existed, and they do not fit the measure we ended up with —
 * IDF-weighted Jaccard over title+summary. A threshold is a property *of a measure*, so it has
 * to be read off the data rather than inherited from the plan. This script is how it was read
 * off, and re-running it is how anyone can check the numbers in `similarity.ts`.
 *
 * It touches no database and writes nothing. Network only.
 */

import { fetchAllFeeds, FEEDS } from "../lib/news/feeds";
import { comparableTokens } from "../lib/news/normalize";
import {
  BORDERLINE_THRESHOLD,
  SAME_STORY_THRESHOLD,
  buildIdf,
  weightedJaccard,
} from "../lib/news/similarity";
import { resolveDomain } from "../lib/news/ingest";

type Item = {
  key: string;
  title: string;
  domain: string;
  tokens: Set<string>;
};

async function main(): Promise<void> {
  console.log("Fetching live feeds…\n");
  const results = await fetchAllFeeds(FEEDS);

  for (const result of results) {
    const detail = result.error === null ? "" : `  (${result.error})`;
    console.log(
      `  ${result.ok ? "ok " : "FAIL"}  ${result.feedId.padEnd(24)} ` +
        `${String(result.items.length).padStart(3)} items  ${result.durationMs}ms${detail}`,
    );
  }

  const items: Item[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    for (const item of result.items) {
      const domain = resolveDomain(item, result.fixedDomain) ?? "unknown";
      const key = `${domain}|${item.guid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        key,
        title: item.title,
        domain,
        tokens: comparableTokens(item.title),
      });
    }
  }

  console.log(`\n${items.length} distinct items, ${new Set(items.map((i) => i.domain)).size} publishers\n`);
  if (items.length < 2) {
    console.log("Not enough items to calibrate. Are the feeds reachable?");
    return;
  }

  const idf = buildIdf(items.map((item) => item.tokens));

  const scored: { a: Item; b: Item; score: number }[] = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      scored.push({
        a: items[i],
        b: items[j],
        score: weightedJaccard(items[i].tokens, items[j].tokens, idf),
      });
    }
  }
  scored.sort((x, y) => y.score - x.score);

  // Distribution. The shape that matters is a long, dense floor of unrelated pairs and a
  // sparse tail of real matches; the threshold belongs in the gap between them.
  console.log("Score distribution over " + scored.length.toLocaleString("en-US") + " pairs:");
  const buckets = new Map<string, number>();
  for (const pair of scored) {
    const bucket = (Math.floor(pair.score * 20) / 20).toFixed(2);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  for (const [bucket, count] of [...buckets.entries()].sort((a, b) => Number(b[0]) - Number(a[0]))) {
    const bar = "█".repeat(Math.max(1, Math.round((count / scored.length) * 200)));
    console.log(`  ${bucket}  ${String(count).padStart(6)}  ${bar}`);
  }

  console.log("\nTop 30 pairs — eyeball which of these are genuinely the same story.");
  console.log("Pairs landing between the thresholds are the ones a model is asked about.\n");
  for (const pair of scored.slice(0, 30)) {
    const crossPublisher = pair.a.domain === pair.b.domain ? " [same publisher]" : "";
    const band =
      pair.score >= SAME_STORY_THRESHOLD
        ? "same      "
        : pair.score >= BORDERLINE_THRESHOLD
          ? "borderline"
          : "different ";
    console.log(`  ${pair.score.toFixed(3)}  ${band}${crossPublisher}`);
    console.log(`     A (${pair.a.domain}) ${pair.a.title.slice(0, 110)}`);
    console.log(`     B (${pair.b.domain}) ${pair.b.title.slice(0, 110)}`);
  }

  const percentile = (p: number): number => scored[Math.floor(scored.length * p)]?.score ?? 0;
  console.log("\nPercentiles (from the top):");
  for (const p of [0.0001, 0.001, 0.005, 0.01, 0.05, 0.5]) {
    console.log(`  top ${(p * 100).toFixed(2).padStart(5)}%  ${percentile(p).toFixed(4)}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
