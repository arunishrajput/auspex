/**
 * Processes exactly one intent, by id, then exits.
 *
 *   pnpm exec tsx scripts/run-one-intent.ts <intentId>
 *
 * This is the *child* half of `crash-test.ts`. It is a separate process on purpose: the crash
 * hook kills with `process.exit(1)`, which has to happen somewhere the test can survive.
 *
 * It takes the row the same way the real worker does — by lease — so the crash test exercises
 * the production code path rather than a simplified stand-in. Unlike `claimIntent` it selects
 * by id and ignores an unexpired lease, because a lease left by a crashed predecessor is
 * exactly the situation being recovered from.
 */
import { eq, sql } from "drizzle-orm";
import { db, getPool } from "../lib/db/client";
import { onchainIntents } from "../lib/db/schema";
import { processIntent } from "../lib/intents/engine";

async function main(): Promise<void> {
  const intentId = process.argv[2];
  if (intentId === undefined) throw new Error("usage: run-one-intent.ts <intentId>");

  // Bumping `attempts` here keeps the engine's backoff and give-up accounting honest across
  // the crashes, rather than letting the crash test look like a first attempt every time.
  const [intent] = await db
    .update(onchainIntents)
    .set({
      claimedAt: new Date(),
      claimedBy: `crash-test-${process.pid}`,
      attempts: sql`${onchainIntents.attempts} + 1`,
      nextAttemptAt: sql`now() + make_interval(secs => 90)`,
      updatedAt: new Date(),
    })
    .where(eq(onchainIntents.id, intentId))
    .returning();

  if (intent === undefined) throw new Error(`No intent ${intentId}`);

  console.log(`  [child ${process.pid}] processing ${intent.id} from status=${intent.status}`);
  const result = await processIntent(intent);
  console.log(
    `  [child ${process.pid}] → ${result.status} ${result.txHash ?? ""} — ${result.note}`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  })
  .finally(() => getPool().end());
