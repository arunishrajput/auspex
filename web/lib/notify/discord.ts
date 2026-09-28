/**
 * Notifications, and the one rule that makes them trustworthy.
 *
 * **A notification fires only after the market exists on chain.** Not after approval, not after
 * the transaction is broadcast — after the indexer has read `MarketCreated` out of a confirmed
 * log and written `created_tx_hash`. That is why the selector below joins on the indexed
 * columns rather than on the intent's status: an intent can say `BROADCAST` about a
 * transaction that is still in a mempool and may yet revert, and "members were told about a
 * market that does not exist" is the exact failure the build plan's exit criterion forbids.
 *
 * Every message carries the transaction hash, so anyone who receives one can check the claim
 * on MSTScan rather than taking our word for it.
 *
 * Delivery is at-most-once per fact: `UNIQUE(notifications.dedupe_key)` means however many
 * ticks observe the same market, exactly one row exists and exactly one webhook call is made.
 * A failed send is recorded as `FAILED` and not retried — a notification is worth sending once
 * and is not worth a retry queue.
 */

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import { auditLog, markets, notifications, proposals } from "../db/schema";
import { MST_TESTNET, explorerUrl } from "../chain";
import { optionalEnv } from "../env";

const WEBHOOK_TIMEOUT_MS = 8_000;

export type NotifyReport = {
  /** Markets confirmed on chain that had never been announced. */
  eligible: number;
  created: number;
  sent: number;
  failed: number;
  /** Rows deliberately not delivered because no webhook is configured. */
  skipped: number;
};

/**
 * Markets that are on chain, came through the human gate, and have not been announced.
 *
 * `onchainId IS NOT NULL` and `createdTxHash IS NOT NULL` are both written by the indexer from
 * a real log — they are the "this actually happened" condition. `proposalId IS NOT NULL`
 * restricts announcements to markets a human approved, so the Phase 1 smoke-test markets and
 * the Phase 2 crash-test market are never announced as products.
 */
async function announceable() {
  return db
    .select({
      marketId: markets.id,
      onchainId: markets.onchainId,
      question: markets.question,
      specHash: markets.specHash,
      createdTxHash: markets.createdTxHash,
      closeTime: markets.closeTime,
      resolutionSourceUrl: markets.resolutionSourceUrl,
      reviewedBy: proposals.reviewedBy,
    })
    .from(markets)
    .innerJoin(proposals, eq(markets.proposalId, proposals.id))
    .leftJoin(notifications, eq(notifications.marketId, markets.id))
    .where(
      and(
        isNotNull(markets.onchainId),
        isNotNull(markets.createdTxHash),
        isNull(notifications.id),
      ),
    )
    .limit(5);
}

function body(market: Awaited<ReturnType<typeof announceable>>[number]): string {
  const closes = market.closeTime.toISOString().replace("T", " ").slice(0, 16);
  return [
    `**Market #${market.onchainId} is open.**`,
    market.question,
    "",
    `Betting closes ${closes} UTC · resolves against <${market.resolutionSourceUrl}>`,
    `Approved by \`${market.reviewedBy ?? "unknown"}\` — this market exists because a human signed for it.`,
    `Transaction: <${explorerUrl("tx", market.createdTxHash ?? "")}>`,
  ].join("\n");
}

/**
 * Runs one notification pass.
 *
 * The row is written **before** the webhook call, so a crash mid-send leaves a row marked
 * `PENDING` rather than a silently un-notified market — and the unique key means the next pass
 * cannot turn that into a second message.
 */
export async function runNotificationPass(): Promise<NotifyReport> {
  const pending = await announceable();
  const report: NotifyReport = {
    eligible: pending.length,
    created: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };
  if (pending.length === 0) return report;

  const webhook = optionalEnv("DISCORD_WEBHOOK_URL");

  for (const market of pending) {
    const dedupeKey = `market-created:${market.specHash}`;
    const text = body(market);

    const [row] = await db
      .insert(notifications)
      .values({
        kind: "MARKET_CREATED",
        marketId: market.marketId,
        title: `Market #${market.onchainId} is open`,
        body: text,
        txHash: market.createdTxHash,
        dedupeKey,
        discordStatus: webhook === undefined ? "SKIPPED" : "PENDING",
      })
      .onConflictDoNothing({ target: notifications.dedupeKey })
      .returning({ id: notifications.id });

    // Another pass (or another instance) got there first. Nothing to send.
    if (row === undefined) continue;
    report.created += 1;

    await db.insert(auditLog).values({
      actor: "system:notifier",
      action: "notification.created",
      subjectType: "market",
      subjectId: market.marketId,
      reason:
        `Market #${market.onchainId} was confirmed on chain, so members are being told. ` +
        `Nothing was sent before this transaction was indexed.`,
      txHash: market.createdTxHash,
    });

    if (webhook === undefined) {
      report.skipped += 1;
      continue;
    }

    try {
      const response = await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "AuspeX",
          content: text,
          // The link previews would be four embeds of news-site chrome. The hash is the point.
          allowed_mentions: { parse: [] },
        }),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      await db
        .update(notifications)
        .set({ discordStatus: "SENT", discordSentAt: new Date() })
        .where(eq(notifications.id, row.id));
      report.sent += 1;
    } catch (error) {
      // Hard rule #6: a dead webhook is not a failed tick. The row records what happened.
      const message = error instanceof Error ? error.message : String(error);
      await db
        .update(notifications)
        .set({ discordStatus: "FAILED" })
        .where(eq(notifications.id, row.id));
      await db.insert(auditLog).values({
        actor: "system:notifier",
        action: "notification.failed",
        subjectType: "market",
        subjectId: market.marketId,
        reason: `Discord webhook failed: ${message}. The market is on chain regardless.`,
      });
      report.failed += 1;
    }
  }

  return report;
}

/** The in-app feed on `/review` and `/`. Same rows, no webhook required. */
export async function recentNotifications(limit = 6) {
  return db
    .select({
      id: notifications.id,
      title: notifications.title,
      body: notifications.body,
      txHash: notifications.txHash,
      discordStatus: notifications.discordStatus,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .orderBy(sql`${notifications.createdAt} desc`)
    .limit(limit);
}

/** Exposed so the review page can name the network in the same words everywhere. */
export const NOTIFY_NETWORK = MST_TESTNET.name;
