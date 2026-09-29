"use server";

/**
 * The server half of the human resolver gate.
 *
 * Every function here re-checks the caller's authority on the server. A server action is a public
 * HTTP endpoint — the page telling us which wallet is connected is a claim, not a fact — so
 * `isResolver` is asserted inside `lib/resolution/propose.ts` and the signature or the transaction
 * is what actually proves it.
 *
 * None of these functions signs anything. Proposing returns *calldata* for a wallet to sign, and
 * that asymmetry is the point: there is no key on this server that can resolve a market.
 */

import { revalidatePath } from "next/cache";
import {
  confirmChallenge,
  confirmResolution,
  draftRejectionMessage,
  prepareChallenge,
  prepareResolution,
  rejectDraft,
} from "@/lib/resolution/propose";
import { runSettlePass } from "@/lib/resolution/settle";
import { runIntentWorker } from "@/lib/intents/engine";
import { runIndexer } from "@/lib/indexer/run";

export type ResolutionPlan =
  | {
      ok: true;
      intentId: string;
      to: string;
      data: string;
      onchainId: number;
      outcome: string;
      evidenceUrl: string;
    }
  | { ok: false; error: string };

/**
 * Step 1 of 3: re-read the chain, freeze the calldata, simulate, hand the wallet a transaction.
 *
 * The browser never builds calldata — it relays bytes the server encoded from the stored draft, so
 * a tampered page can change *whether* a transaction is sent but not *what outcome* it records.
 */
export async function planResolution(
  draftId: string,
  resolver: string,
): Promise<ResolutionPlan> {
  return prepareResolution(draftId, resolver);
}

export type RecordResult =
  | { ok: true; txHash: string; settled: string }
  | { ok: false; error: string };

/**
 * Step 3 of 3: record the hash the wallet returned, then drive the chain state forward.
 *
 * After the hash is verified against the node, the intent worker and the indexer run so that by
 * the time the page re-renders the challenge window is visibly ticking. Every pass here is
 * idempotent and safe to run at any moment, which is why it is safe to run at this one.
 *
 * `ok` reflects that the transaction was recorded, not that every follow-up succeeded. The
 * resolution exists on chain either way; the notes say what happened afterwards.
 */
export async function recordResolution(
  draftId: string,
  intentId: string,
  txHash: string,
  resolver: string,
): Promise<RecordResult> {
  const confirmed = await confirmResolution(draftId, intentId, txHash, resolver);
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

  revalidate();
  return { ok: true, txHash: confirmed.txHash, settled: notes.join(" · ") };
}

// ---------------------------------------------------------------------------
// Rejecting a draft
// ---------------------------------------------------------------------------

export type RejectionRequest = {
  draftId: string;
  onchainId: number;
  outcome: string;
  round: number;
  reason: string;
  issuedAt: number;
};

/**
 * The text the wallet will display for a rejection.
 *
 * Built on the server and sent to the browser to be signed, so what the wallet shows is what the
 * server verifies. Building it in the browser would let the two drift, and a signature over text
 * nobody checked is not authentication.
 */
export async function rejectionPreamble(request: RejectionRequest): Promise<string> {
  return draftRejectionMessage(request);
}

export type RejectResult = { ok: true } | { ok: false; error: string };

export async function submitDraftRejection(
  request: RejectionRequest,
  resolver: string,
  signature: string,
): Promise<RejectResult> {
  const result = await rejectDraft({
    draftId: request.draftId,
    resolver,
    reason: request.reason,
    signature,
    issuedAt: request.issuedAt,
  });
  if (result.ok) revalidate();
  return result;
}

// ---------------------------------------------------------------------------
// Challenging a proposed resolution
// ---------------------------------------------------------------------------

export type ChallengePlan =
  | { ok: true; intentId: string; to: string; data: string; onchainId: number }
  | { ok: false; error: string };

export async function planChallenge(
  marketRowId: string,
  challenger: string,
  reason: string,
): Promise<ChallengePlan> {
  return prepareChallenge(marketRowId, challenger, reason);
}

export async function recordChallenge(
  marketRowId: string,
  intentId: string,
  txHash: string,
  challenger: string,
  reason: string,
): Promise<RecordResult> {
  const confirmed = await confirmChallenge(marketRowId, intentId, txHash, challenger, reason);
  if (!confirmed.ok) return { ok: false, error: confirmed.error };

  const notes: string[] = [];
  try {
    await runIntentWorker({ limit: 2 });
    const report = await runIndexer();
    notes.push(`indexed ${report.logsInserted} new log(s) — the market is back to CLOSED`);
  } catch (error) {
    notes.push(`follow-up failed: ${message(error)}`);
  }

  revalidate();
  return { ok: true, txHash: confirmed.txHash, settled: notes.join(" · ") };
}

// ---------------------------------------------------------------------------
// Finishing a market — the permissionless half, run on demand
// ---------------------------------------------------------------------------

export type SettleResult = { ok: true; summary: string } | { ok: false; error: string };

/**
 * Runs the keeper's pass now instead of waiting for the next cron tick.
 *
 * **Deliberately not gated on the resolver wallet.** Every transaction it queues —
 * `closeMarket`, `finalizeResolution`, `claim` — is permissionless in the contract, so requiring
 * authority here would be theatre: anyone can make these calls from their own wallet, and a judge
 * doing exactly that is the point. The button is on the page so a demo does not have to wait
 * three minutes for a challenge window that closed thirty seconds ago.
 */
export async function settleNow(): Promise<SettleResult> {
  try {
    const report = await runSettlePass();
    const results = await runIntentWorker({ limit: 5 });
    await runIndexer().catch(() => undefined);
    revalidate();

    const parts = [
      `${report.closed} close(s)`,
      `${report.finalized} finalisation(s)`,
      `${report.claimed} claim(s) worth ${report.claimableWei} wei`,
      ...report.notes,
      ...results.map((result) => `${result.status} (${result.note})`),
    ];
    return { ok: true, summary: parts.join(" · ") };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

function revalidate(): void {
  revalidatePath("/resolve");
  revalidatePath("/markets");
  revalidatePath("/audit");
  revalidatePath("/");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
