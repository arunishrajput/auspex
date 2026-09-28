/**
 * Captures every AuspexMarket log currently on MST Testnet into a test fixture.
 *
 *   pnpm --filter web fixtures:capture
 *
 * The indexer's unit tests run against these captured logs rather than against invented ones.
 * That matters: a hand-written fixture tests the projection against my *belief* about what the
 * contract emits, which is exactly the belief a bug would share. These bytes came off chain
 * 91562037 and decoded through the committed ABI.
 *
 * Re-run it after any phase that adds new event types on chain, and commit the result.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchLogs } from "../lib/indexer/run";
import { DEPLOY_BLOCK } from "../lib/chain/deployment";
import { getProvider } from "../lib/chain/provider";

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "lib",
  "indexer",
  "__fixtures__",
  "mst-testnet-logs.json",
);

async function main(): Promise<void> {
  const head = await getProvider().getBlockNumber();
  const logs = await fetchLogs(DEPLOY_BLOCK, head);

  writeFileSync(OUT, `${JSON.stringify(logs, null, 2)}\n`);

  console.log(
    `Captured ${logs.length} logs from blocks ${DEPLOY_BLOCK.toLocaleString("en-US")}–${head.toLocaleString("en-US")}:`,
  );
  for (const log of logs) {
    console.log(`  block ${log.blockNumber} #${log.logIndex}  ${log.eventName ?? "(unknown)"}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
