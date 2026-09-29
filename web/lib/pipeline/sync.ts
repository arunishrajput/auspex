/**
 * Index the chain, then announce what it found. Nothing else.
 *
 * ## Why this exists beside `runTick`
 *
 * A full tick fetches eight RSS feeds, clusters two hundred articles and spends an LLM budget.
 * Measured in production it takes ~19s. The path from "a human approved a market" to "members
 * were told" needs none of that — it is `eth_getLogs` plus one query plus one webhook, and the
 * indexer half of a real tick took **98ms**. Separating them means the notification path can be
 * run often and cheaply, by a caller that must not be made to pay for news ingestion.
 *
 * ## The ordering is the trust boundary
 *
 * Indexer first, notifier second, always. The notifier selects on `onchain_id` and
 * `created_tx_hash`, which only the indexer writes and only from a confirmed log. So this
 * function cannot announce a market that is not on chain even if it is called at the wrong
 * moment, twice at once, or by someone who should not have called it — the guarantee is in the
 * selector, not in the caller's good behaviour.
 *
 * Both halves are idempotent (`ON CONFLICT DO NOTHING` on the logs, `UNIQUE(dedupe_key)` on the
 * notifications), so an extra call costs two queries and sends nothing twice.
 */

import { runIndexer, type IndexReport } from "../indexer/run";
import { runNotificationPass, type NotifyReport } from "../notify/discord";

export type SyncReport = {
  startedAt: string;
  durationMs: number;
  index: IndexReport;
  notify: NotifyReport;
};

export type SyncOptions = {
  /**
   * Wait for this block to clear the confirmation depth before indexing.
   *
   * The approval path passes the block its `createMarket` was mined in. Without it, a pass run
   * the instant a receipt arrives reads only up to `head - confirmations` and misses the log it
   * came for — see `awaitConfirmationDepth` in the indexer.
   */
  confirmBlock?: number;
};

export async function runChainSync(options: SyncOptions = {}): Promise<SyncReport> {
  const startedAt = new Date();

  const index = await runIndexer({ confirmBlock: options.confirmBlock });
  const notify = await runNotificationPass();

  // Hard rule #7 in its cheapest form. The durable record is the `notifications` row and its
  // audit entry; this line is what makes a late or failed delivery findable in the platform log
  // without opening the database.
  console.log(
    `[sync] blocks ${index.fromBlock}→${index.toBlock} (head ${index.headBlock}, ` +
      `waited ${index.waitedMs}ms) · ${index.logsInserted} new log(s) · ` +
      `notify: ${notify.created} created, ${notify.sent} sent, ` +
      `${notify.failed} failed, ${notify.skipped} skipped`,
  );

  return {
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    index,
    notify,
  };
}
