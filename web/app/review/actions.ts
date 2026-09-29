"use server";

/**
 * The server half of the human gate.
 *
 * Every function here re-checks the caller's authority on the server. A server action is a
 * public HTTP endpoint — the page telling us which wallet is connected is a claim, not a fact —
 * so `isAuthority` is asserted here and the signature or the transaction is what actually
 * proves it. See `lib/approval/authority.ts` for why approval and rejection are held to two
 * different standards of proof.
 *
 * None of these functions signs anything. Approval returns *calldata* for a wallet to sign, and
 * that asymmetry is the entire point of Phase 4: there is no key on this server that can create
 * a market.
 */

import { revalidatePath } from "next/cache";
import { confirmApproval, prepareApproval, rejectProposal } from "@/lib/approval/approve";
import { rejectionMessage } from "@/lib/approval/authority";
import { runIntentWorker } from "@/lib/intents/engine";
import { runChainSync } from "@/lib/pipeline/sync";

export type ApprovalPlan =
  | { ok: true; intentId: string; to: string; data: string; specHash: string; question: string }
  | { ok: false; error: string };

/**
 * Step 1 of 3: validate, freeze the calldata, simulate, and hand the wallet a transaction.
 *
 * Returns the exact `to` and `data` the wallet should send. The browser never builds calldata —
 * it relays bytes the server encoded from the stored spec, so a compromised page can change
 * *whether* a transaction is sent but not *what* it says.
 */
export async function planApproval(proposalId: string, reviewer: string): Promise<ApprovalPlan> {
  return prepareApproval(proposalId, reviewer);
}

export type RecordResult =
  | {
      ok: true;
      txHash: string;
      settled: string;
      /**
       * The block `createMarket` was mined in, for the follow-up sync to wait on.
       *
       * `null` when the receipt was not polled in time — the safety net then covers it.
       */
      block: number | null;
    }
  | { ok: false; error: string };

/**
 * Step 3 of 3: record the hash the wallet returned, then drive it to a receipt.
 *
 * The hash is verified against the node before anything is recorded — see
 * `attachExternalBroadcast`. Then the intent worker polls for the receipt and returns the block
 * the market was mined in.
 *
 * **Indexing and notifying do not happen here**, and that is a correction rather than an
 * omission. They used to, and they could not work: the intent worker returns after *one*
 * confirmation, while the indexer reads only to `head - 3`, so an indexer run at this instant
 * is guaranteed to sit three blocks below the log it came for. Every approval reported
 * "no notification yet — the market is not indexed" and then waited for a cron tick that, in
 * practice, arrived up to fifty minutes later.
 *
 * The block number goes back to the browser instead, which calls `syncAfterApproval` without
 * awaiting it. That call waits out the confirmation depth before indexing, which takes about
 * ten seconds — time the reviewer should not spend watching a spinner, and time this action
 * cannot spend without risking the function's limit.
 */
export async function recordApproval(
  proposalId: string,
  intentId: string,
  txHash: string,
  reviewer: string,
): Promise<RecordResult> {
  const confirmed = await confirmApproval(proposalId, intentId, txHash, reviewer);
  if (!confirmed.ok) return { ok: false, error: confirmed.error };

  const notes: string[] = [];
  let block: number | null = null;

  try {
    const results = await runIntentWorker({ limit: 2 });
    const mine = results.find((result) => result.intentId === intentId);
    if (mine === undefined) {
      notes.push("receipt not polled yet");
    } else {
      block = mine.blockNumber;
      notes.push(`${mine.status} — ${mine.note}`);
    }
  } catch (error) {
    notes.push(`receipt polling failed: ${message(error)}`);
  }

  revalidatePath("/review");
  revalidatePath("/markets");
  revalidatePath("/");

  // `ok` reflects that the transaction was recorded, not that every follow-up pass succeeded.
  // The market exists on chain either way; the notes say what happened afterwards.
  return { ok: true, txHash: confirmed.txHash, settled: notes.join(" · "), block };
}

export type SyncResult = { ok: boolean; message: string };

/**
 * Index the approved market and announce it. Called by the browser, not awaited.
 *
 * ## Why a server action and not a `fetch` to `/api/sync`
 *
 * `/api/sync` is authenticated with a secret so it cannot be used to burn our free tiers, and a
 * browser cannot hold a secret — anything the page can send, a visitor can read. Same reasoning
 * as `runTickAction` on the dashboard, and the same bound applies instead: a cooldown, plus the
 * fact that both halves of the work are idempotent and cheap.
 *
 * **The cooldown does not apply to a call carrying a block number**, and that exemption is the
 * point rather than a hole in it. A cooldown that can refuse the one call made straight after an
 * approval would silently reinstate the bug this function exists to fix — the market would fall
 * back to a cron measured in hours — and it would do so exactly when the system is busiest. What
 * the exemption lets an abusive caller have is a bounded confirmation wait and the same
 * read-only indexing pass a tick runs; what the cooldown still stops is a page reloading in a
 * loop and running that pass for nothing.
 *
 * ## What it cannot do
 *
 * It cannot announce anything that is not on chain, and that is not a promise about this
 * function — it is a property of the notifier's selector, which joins on `onchain_id` and
 * `created_tx_hash`. Those columns are written only by the indexer and only from a confirmed
 * log. A caller who invents a block number gets a wait and an ordinary indexing pass.
 *
 * It signs nothing and holds no key.
 */
const SYNC_COOLDOWN_MS = 5_000;
let lastSyncAt = 0;

export async function syncAfterApproval(block: number | null): Promise<SyncResult> {
  const now = Date.now();
  if (block === null && now - lastSyncAt < SYNC_COOLDOWN_MS) {
    return { ok: false, message: "a sync just ran — the next pass will pick this up" };
  }
  lastSyncAt = now;

  try {
    const report = await runChainSync({ confirmBlock: block ?? undefined });

    revalidatePath("/markets");
    revalidatePath("/");

    // `eligible` counts markets that are on chain, human-approved and unannounced — so zero
    // means everything is announced, and non-zero with nothing created means another pass won
    // the race. Neither is a problem; saying which one happened is the difference between a
    // status line a reviewer can act on and one they learn to ignore.
    if (report.notify.created === 0) {
      return {
        ok: true,
        message:
          report.notify.eligible === 0
            ? "nothing to announce — already sent, or not confirmed yet"
            : "announced by another pass",
      };
    }

    return {
      ok: true,
      message:
        `announced: ${report.notify.sent} sent, ${report.notify.failed} failed, ` +
        `${report.notify.skipped} skipped`,
    };
  } catch (error) {
    // Hard rule #6. The market is on chain regardless, and the safety net runs this again.
    console.error("[syncAfterApproval] sync failed:", message(error));
    return { ok: false, message: `sync failed: ${message(error)}` };
  }
}

export type RejectionRequest = {
  proposalId: string;
  specHash: string | null;
  reason: string;
  issuedAt: number;
};

/**
 * The text the wallet will display for a rejection.
 *
 * Built on the server and sent to the browser to be signed, so the string the wallet shows is
 * the string the server will verify. Building it in the browser would let the two drift, and a
 * signature over text nobody checked is not authentication.
 */
export async function rejectionPreamble(request: RejectionRequest): Promise<string> {
  return rejectionMessage(request);
}

export type RejectResult = { ok: true } | { ok: false; error: string };

export async function submitRejection(
  request: RejectionRequest,
  reviewer: string,
  signature: string,
): Promise<RejectResult> {
  const result = await rejectProposal({
    proposalId: request.proposalId,
    reviewer,
    reason: request.reason,
    signature,
    issuedAt: request.issuedAt,
  });

  if (result.ok) revalidatePath("/review");
  return result;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
