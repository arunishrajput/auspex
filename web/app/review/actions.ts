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
import { runIndexer } from "@/lib/indexer/run";
import { runNotificationPass } from "@/lib/notify/discord";

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

export type RecordResult = { ok: true; txHash: string; settled: string } | { ok: false; error: string };

/**
 * Step 3 of 3: record the hash the wallet returned, then drive it to a receipt.
 *
 * The hash is verified against the node before anything is recorded — see
 * `attachExternalBroadcast`. After that, the intent worker, the indexer and the notifier run
 * in that order, so by the time the page re-renders the market is indexed and the notification
 * has fired. Doing it here rather than waiting for the next cron tick is purely about the demo
 * reading as one continuous action; every one of these passes is idempotent and safe to run at
 * any moment, which is why it is safe to run them at this one.
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

  try {
    const results = await runIntentWorker({ limit: 2 });
    const mine = results.find((result) => result.intentId === intentId);
    notes.push(mine === undefined ? "receipt not polled yet" : `${mine.status} — ${mine.note}`);
  } catch (error) {
    notes.push(`receipt polling failed: ${message(error)}`);
  }

  try {
    const report = await runIndexer();
    notes.push(`indexed ${report.logsInserted} new log(s)`);
  } catch (error) {
    notes.push(`indexing failed: ${message(error)}`);
  }

  try {
    const report = await runNotificationPass();
    notes.push(
      report.created === 0
        ? "no notification yet — the market is not indexed"
        : `notified: ${report.sent} sent, ${report.failed} failed, ${report.skipped} skipped`,
    );
  } catch (error) {
    notes.push(`notification failed: ${message(error)}`);
  }

  revalidatePath("/review");
  revalidatePath("/markets");
  revalidatePath("/");

  // `ok` reflects that the transaction was recorded, not that every follow-up pass succeeded.
  // The market exists on chain either way; the notes say what happened afterwards.
  return { ok: true, txHash: confirmed.txHash, settled: notes.join(" · ") };
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
