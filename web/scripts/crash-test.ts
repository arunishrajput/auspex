/**
 * THE CRASH TEST.  `pnpm --filter web crash-test`
 *
 * Phase 2's exit criteria include: *kill the worker mid-send, re-run — exactly one transaction
 * on chain, no duplicate rows.* This script does exactly that, against the real MST Testnet
 * and the real database, and prints evidence a judge can check on MSTScan.
 *
 * ── What it does ────────────────────────────────────────────────────────────────────────
 *   1. Creates ONE intent to call `createMarket` with a fresh spec hash.
 *   2. Runs a worker in a CHILD PROCESS armed with `AUSPEX_CRASH_AT=after_sign`.
 *      The child signs the transaction, persists the signed bytes, and is then killed with
 *      `process.exit(1)` — no unwinding, nothing flushed, exactly like a lambda being killed.
 *   3. Runs a second child armed with `AUSPEX_CRASH_AT=after_broadcast`. It rebroadcasts the
 *      stored bytes and dies again, this time with the transaction genuinely in the mempool.
 *   4. Runs a third worker to completion.
 *   5. Asserts: one intent row, one transaction hash unchanged across both crashes, one
 *      `MarketCreated` log on chain, and `marketCount()` increased by exactly one.
 *
 * ── Why a child process ─────────────────────────────────────────────────────────────────
 * `process.exit(1)` in-process would end the test. The crash has to be real — a thrown error
 * would unwind through the engine's own error handling, which is the code path the design is
 * trying to survive *around*, not through.
 *
 * ── Why this is safe to run repeatedly ──────────────────────────────────────────────────
 * Each run's spec hash contains the run's timestamp, so it creates its own market rather than
 * colliding with a previous run's. The markets it creates are real, and their question text
 * says plainly that they are idempotency-test markets. Nothing pretends otherwise.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { and, eq } from "drizzle-orm";
import { db, getPool } from "../lib/db/client";
import { chainEvents, onchainIntents } from "../lib/db/schema";
import { createIntent } from "../lib/intents/engine";
import { computeSpecHash } from "../lib/chain/spec";
import { readMarketCount } from "../lib/chain/auspex";
import { runIndexer } from "../lib/indexer/run";
import { MST_TESTNET } from "../lib/chain";

const WORKER = join(dirname(fileURLToPath(import.meta.url)), "run-one-intent.ts");

function heading(text: string): void {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

/**
 * Runs the single-intent worker in a child process, optionally armed to crash.
 *
 * `tsx` rather than Node's own type stripping: stripping requires every relative import to
 * carry a `.ts` extension, which the rest of this app does not use.
 */
function runWorkerChild(intentId: string, crashAt?: string): number {
  const result = spawnSync("pnpm", ["exec", "tsx", WORKER, intentId], {
    stdio: "inherit",
    env: { ...process.env, ...(crashAt === undefined ? {} : { AUSPEX_CRASH_AT: crashAt }) },
  });
  return result.status ?? -1;
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const nowSeconds = Math.floor(stamp / 1000);

  const spec = {
    question: `[Phase 2 idempotency test ${stamp}] Did the crash test produce exactly one transaction?`,
    resolutionSourceUrl: "https://github.com/arunishrajput/auspex/blob/main/PROGRESS.md",
    // 20 minutes of betting, then 40 more to resolve. Short because this market exists to
    // prove a property of the writer, not to be traded.
    closeTime: nowSeconds + 20 * 60,
    resolveDeadline: nowSeconds + 60 * 60,
    resolutionCriteria: "One MarketCreated log for this spec hash, and no second one.",
    category: "meta",
  };
  const specHash = computeSpecHash(spec);
  const idempotencyKey = `crash-test:${specHash}`;

  heading("0 · Baseline");
  const countBefore = await readMarketCount();
  console.log(`  marketCount() on chain : ${countBefore}`);
  console.log(`  specHash               : ${specHash}`);

  heading("1 · Create one intent");
  const intent = await createIntent({
    idempotencyKey,
    kind: "CREATE_MARKET",
    functionName: "createMarket",
    args: [
      specHash,
      spec.question,
      spec.resolutionSourceUrl,
      spec.closeTime,
      spec.resolveDeadline,
    ],
  });
  console.log(`  intent ${intent.id} status=${intent.status}`);

  heading("2 · Worker crashes AFTER SIGNING, before broadcast");
  console.log(`  child exited ${runWorkerChild(intent.id, "after_sign")} (1 = the injected crash)`);

  const [afterSign] = await db
    .select()
    .from(onchainIntents)
    .where(eq(onchainIntents.id, intent.id));
  console.log(`  status=${afterSign.status} nonce=${afterSign.nonce} txHash=${afterSign.txHash}`);
  if (afterSign.status !== "SIGNED" || afterSign.txHash === null) {
    throw new Error("Expected the intent to be SIGNED with a fixed hash after the first crash.");
  }
  const hashAfterSign = afterSign.txHash;

  heading("3 · Worker crashes AFTER BROADCAST, before the receipt");
  console.log(
    `  child exited ${runWorkerChild(intent.id, "after_broadcast")} (1 = the injected crash)`,
  );

  const [afterBroadcast] = await db
    .select()
    .from(onchainIntents)
    .where(eq(onchainIntents.id, intent.id));
  console.log(`  status=${afterBroadcast.status} txHash=${afterBroadcast.txHash}`);
  if (afterBroadcast.txHash !== hashAfterSign) {
    throw new Error(
      `Transaction hash changed across a crash: ${hashAfterSign} → ${afterBroadcast.txHash}. ` +
        "This is the exact failure the signed-bytes design exists to prevent.",
    );
  }

  heading("4 · Worker runs to completion");
  console.log(`  child exited ${runWorkerChild(intent.id)} (0 = clean)`);

  const [settled] = await db
    .select()
    .from(onchainIntents)
    .where(eq(onchainIntents.id, intent.id));
  console.log(
    `  status=${settled.status} block=${settled.blockNumber} gasUsed=${settled.gasUsed}`,
  );

  heading("5 · Assertions");
  const failures: string[] = [];

  if (settled.status !== "CONFIRMED") {
    failures.push(
      `intent is ${settled.status}, expected CONFIRMED ` +
        `(${settled.revertReason ?? settled.lastError ?? "no reason recorded"})`,
    );
  }
  if (settled.txHash !== hashAfterSign) {
    failures.push(
      `final hash ${settled.txHash} differs from the hash fixed at signing ${hashAfterSign}`,
    );
  }

  // Exactly one intent row for this spec hash — the off-chain half.
  const rows = await db
    .select()
    .from(onchainIntents)
    .where(eq(onchainIntents.idempotencyKey, idempotencyKey));
  console.log(`  intent rows for this spec hash : ${rows.length}`);
  if (rows.length !== 1) failures.push(`${rows.length} intent rows, expected 1`);

  // Exactly one MarketCreated on chain — the on-chain half. Indexed, not trusted.
  await runIndexer();
  const created = await db
    .select()
    .from(chainEvents)
    .where(
      and(
        eq(chainEvents.eventName, "MarketCreated"),
        eq(chainEvents.txHash, settled.txHash ?? ""),
      ),
    );
  console.log(`  MarketCreated logs in that tx  : ${created.length}`);
  if (created.length !== 1) failures.push(`${created.length} MarketCreated logs, expected 1`);

  const countAfter = await readMarketCount();
  console.log(`  marketCount() ${countBefore} → ${countAfter}`);
  if (countAfter !== countBefore + 1) {
    failures.push(`marketCount moved by ${countAfter - countBefore}, expected exactly 1`);
  }

  heading("Result");
  if (failures.length > 0) {
    for (const failure of failures) console.error(`  ✖ ${failure}`);
    throw new Error(`${failures.length} assertion(s) failed.`);
  }

  console.log("  ✓ Two hard crashes mid-send produced exactly one transaction and one market.");
  console.log(`\n  tx         ${MST_TESTNET.explorerUrl}/tx/${settled.txHash}`);
  console.log(`  spec hash  ${specHash}`);
}

main()
  .catch((error: unknown) => {
    console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
