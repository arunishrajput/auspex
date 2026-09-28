/**
 * Runs the event indexer from the command line.
 *
 *   pnpm --filter web index            # incremental, from the stored cursor
 *   pnpm --filter web index:replay     # ignore the cursor, re-read from the deploy block
 *
 * The replay mode exists to be *run*, not merely claimed: Phase 2's exit criteria include
 * "re-running the indexer from block 0 is idempotent", and the honest way to show that is to
 * do it twice and print `logsInserted: 0` the second time.
 */
import { runIndexer, resetCursor } from "../lib/indexer/run";
import { getPool } from "../lib/db/client";
import { AUSPEX_MARKET_ADDRESS, DEPLOY_BLOCK } from "../lib/chain/deployment";

async function main(): Promise<void> {
  const replay = process.argv.includes("--replay");

  if (process.argv.includes("--reset-cursor")) {
    await resetCursor();
    console.log(`Cursor reset to ${DEPLOY_BLOCK - 1}.`);
  }

  console.log(`Indexing ${AUSPEX_MARKET_ADDRESS}${replay ? " (full replay)" : ""} …`);
  const report = await runIndexer({ fullReplay: replay });

  console.log(
    [
      `  blocks     ${report.fromBlock.toLocaleString("en-US")} → ${report.toBlock.toLocaleString("en-US")} (head ${report.headBlock.toLocaleString("en-US")})`,
      `  logs       ${report.logsFetched} fetched, ${report.logsInserted} newly stored`,
      `  markets    ${report.marketsUpserted} upserted`,
      `  ignored    ${report.unprojected} non-market events, ${report.undecodable} undecodable`,
      `  took       ${report.durationMs}ms`,
    ].join("\n"),
  );

  if (report.undecodable > 0) {
    console.warn(
      "\nSome logs could not be decoded against the committed ABI. That means the ABI and the " +
        "deployed contract disagree — investigate before trusting any market state.",
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
