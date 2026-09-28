/**
 * The human gate. The only path from a proposal to a market.
 *
 * ## Why approval is three steps and not one
 *
 *   prepare  → the server re-checks the proposal, freezes the calldata, and simulates the call
 *   sign     → the human's wallet signs and broadcasts. Nothing server-side is involved.
 *   confirm  → the server verifies the resulting hash against the node and records it
 *
 * The middle step is the point of the whole project: the key that creates a market is not on
 * any server we run. That has a consequence the intent engine had to be taught — an
 * `EXTERNAL` intent is never signed by the worker, only settled by it (see `plannedSteps`).
 *
 * ## What `prepare` refuses to hand to the wallet
 *
 * A simulation runs first, as the authority address, against the deployed contract. If the
 * call would revert — the role was revoked, the contract is paused, the spec hash is already
 * used, the close time has passed — the human is told **before** a wallet prompt appears. A
 * reverted transaction is a fine outcome when the revert is the evidence (Phase 5 wants one);
 * it is a terrible outcome when someone is watching a demo and the revert means "we forgot".
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { auditLog, markets, onchainIntents, proposals } from "../db/schema";
import { getProvider } from "../chain/provider";
import { describeRevert } from "../chain/revert";
import { computeSpecHash, type MarketSpec } from "../chain/spec";
import { attachExternalBroadcast, createIntent } from "../intents/engine";
import { humanAuthorityAddress, isAuthority, verifyRejection } from "./authority";

/**
 * How close to `closeTime` a proposal may still be approved.
 *
 * The contract requires `closeTime > block.timestamp`, so a proposal that has sat in the queue
 * until its own close time cannot be created at all. Refusing a little early turns a confusing
 * on-chain revert into a plain sentence in the review queue.
 */
const MIN_REMAINING_SECONDS = 300;

/** `proposals.spec` is `jsonb`, so it is re-parsed rather than trusted on read. */
function readSpec(raw: Record<string, unknown> | null): MarketSpec | null {
  if (raw === null) return null;
  const { question, resolutionSourceUrl, closeTime, resolveDeadline, resolutionCriteria, category } =
    raw as Partial<MarketSpec>;

  if (
    typeof question !== "string" ||
    typeof resolutionSourceUrl !== "string" ||
    typeof closeTime !== "number" ||
    typeof resolveDeadline !== "number" ||
    typeof resolutionCriteria !== "string" ||
    typeof category !== "string"
  ) {
    return null;
  }
  return { question, resolutionSourceUrl, closeTime, resolveDeadline, resolutionCriteria, category };
}

export type PrepareResult =
  | {
      ok: true;
      intentId: string;
      /** Exactly what the wallet is asked to send. Encoded here, never in the browser. */
      to: string;
      data: string;
      specHash: string;
      question: string;
    }
  | { ok: false; error: string };

/**
 * Validates an approval and returns the transaction the wallet should send.
 *
 * Writes an `OnChainIntent` before returning, so the transaction the human is about to sign is
 * already recorded as authorised. If the browser dies between the wallet prompt and the
 * confirmation call, the row is still there and the hash can be attached later — the same
 * "record the intention first" discipline the server-signed path uses, for the same reason.
 */
export async function prepareApproval(
  proposalId: string,
  reviewer: string,
): Promise<PrepareResult> {
  const authority = humanAuthorityAddress();
  if (authority === null) {
    return { ok: false, error: "HUMAN_AUTHORITY_ADDRESS is not configured on this deployment." };
  }
  if (!isAuthority(reviewer)) {
    return {
      ok: false,
      error: `Connected as ${reviewer}, which does not hold MARKET_CREATOR_ROLE. Switch to the authority wallet.`,
    };
  }

  const [proposal] = await db
    .select()
    .from(proposals)
    .where(eq(proposals.id, proposalId))
    .limit(1);

  if (proposal === undefined) return { ok: false, error: "No such proposal." };
  if (proposal.status !== "PENDING_REVIEW") {
    return { ok: false, error: `This proposal is already ${proposal.status}.` };
  }

  const spec = readSpec(proposal.spec);
  if (spec === null || proposal.specHash === null) {
    return { ok: false, error: "This proposal has no usable spec." };
  }

  // The hash is re-derived from the stored spec rather than read from the row. They are
  // written together and should always agree; if they ever do not, the row was edited after
  // the proposer wrote it, and the human would be approving one thing while signing another.
  const derived = computeSpecHash(spec);
  if (derived !== proposal.specHash) {
    return {
      ok: false,
      error: `Stored spec hash ${proposal.specHash} does not match the spec (${derived}). Refusing to sign.`,
    };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (spec.closeTime - nowSeconds < MIN_REMAINING_SECONDS) {
    return {
      ok: false,
      error:
        "This proposal's close time has passed or is about to. The contract would reject it — " +
        "reject this one and let the proposer draft a fresh market.",
    };
  }

  const intent = await createIntent({
    // Derived from the proposal, so two clicks produce one intent and therefore one market.
    idempotencyKey: `proposal:${proposal.id}:create-market`,
    kind: "CREATE_MARKET",
    signer: "EXTERNAL",
    from: authority,
    functionName: "createMarket",
    args: [
      proposal.specHash,
      spec.question,
      spec.resolutionSourceUrl,
      spec.closeTime,
      spec.resolveDeadline,
    ],
  });

  // Simulate as the authority, against the real contract, at the current block.
  try {
    await getProvider().call({ to: intent.toAddress, data: intent.data, from: authority });
  } catch (error) {
    return {
      ok: false,
      error: `The contract would refuse this transaction: ${describeRevert(error)}`,
    };
  }

  return {
    ok: true,
    intentId: intent.id,
    to: intent.toAddress,
    data: intent.data,
    specHash: proposal.specHash,
    question: spec.question,
  };
}

export type ConfirmResult =
  | { ok: true; txHash: string; explorerPath: string }
  | { ok: false; error: string };

/**
 * Records the transaction the wallet produced, after verifying it against the node.
 *
 * The proposal becomes `APPROVED` only once the chain has confirmed that a transaction with
 * this hash exists, was sent by the authority, and carries exactly the calldata the server
 * authorised. `attachExternalBroadcast` does that checking; this function owns the proposal
 * side of the same transition.
 */
export async function confirmApproval(
  proposalId: string,
  intentId: string,
  txHash: string,
  reviewer: string,
): Promise<ConfirmResult> {
  if (!isAuthority(reviewer)) {
    return { ok: false, error: "Only the authority wallet can approve a proposal." };
  }

  const attached = await attachExternalBroadcast(intentId, txHash);
  if (!attached.ok) return { ok: false, error: attached.error };

  const hash = attached.intent.txHash ?? txHash.toLowerCase();

  const [proposal] = await db
    .select()
    .from(proposals)
    .where(eq(proposals.id, proposalId))
    .limit(1);
  if (proposal === undefined) return { ok: false, error: "No such proposal." };

  const spec = readSpec(proposal.spec);

  // `APPROVED` is written only for a proposal still in review, so a replayed confirmation
  // cannot rewrite `reviewedAt` or overwrite a rejection that happened in between.
  await db
    .update(proposals)
    .set({
      status: "APPROVED",
      reviewedBy: reviewer.toLowerCase(),
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(proposals.id, proposalId), eq(proposals.status, "PENDING_REVIEW")));

  // The off-chain half of the market's identity, written here and not at `prepare` time. The
  // distinction matters on `/markets`, where this row renders as "approved by a human,
  // transaction in flight" — a claim that is only true once a signature exists. Writing it when
  // the calldata was merely *offered* to a wallet would say a human approved something they had
  // not. The indexer adopts this row by `spec_hash` when `MarketCreated` is indexed
  // (`indexer/run.ts`), so the market keeps its link back to the proposal.
  if (spec !== null && proposal.specHash !== null) {
    await db
      .insert(markets)
      .values({
        specHash: proposal.specHash,
        proposalId: proposal.id,
        question: spec.question,
        resolutionSourceUrl: spec.resolutionSourceUrl,
        closeTime: new Date(spec.closeTime * 1000),
        resolveDeadline: new Date(spec.resolveDeadline * 1000),
        state: "ONCHAIN_PENDING",
      })
      .onConflictDoNothing({ target: markets.specHash });
  }

  await db.insert(auditLog).values({
    actor: `human:${reviewer.toLowerCase()}`,
    action: "proposal.approved",
    subjectType: "proposal",
    subjectId: proposalId,
    reason:
      "Approved in /review and signed with the authority wallet. The calldata was encoded by " +
      "the server from the stored spec and verified against the node before this was recorded.",
    txHash: hash,
    metadata: { intentId },
  });

  return { ok: true, txHash: hash, explorerPath: `tx/${hash}` };
}

export type RejectResult = { ok: true } | { ok: false; error: string };

/**
 * Records a rejection, authenticated by a signature over the proposal's own identity.
 *
 * Hard rule #7: the reason is required and is kept. Rejections are the half of the log that
 * proves the gate is real — a queue that only ever records approvals cannot demonstrate that
 * anything was ever refused.
 */
export async function rejectProposal(input: {
  proposalId: string;
  reviewer: string;
  reason: string;
  signature: string;
  issuedAt: number;
}): Promise<RejectResult> {
  const reason = input.reason.trim();
  if (reason.length < 3) return { ok: false, error: "A rejection needs a reason." };
  if (reason.length > 500) return { ok: false, error: "Keep the reason under 500 characters." };

  const [proposal] = await db
    .select()
    .from(proposals)
    .where(eq(proposals.id, input.proposalId))
    .limit(1);

  if (proposal === undefined) return { ok: false, error: "No such proposal." };
  if (proposal.status !== "PENDING_REVIEW") {
    return { ok: false, error: `This proposal is already ${proposal.status}.` };
  }

  const check = verifyRejection(
    {
      proposalId: proposal.id,
      specHash: proposal.specHash,
      reason,
      issuedAt: input.issuedAt,
    },
    input.signature,
  );
  if (!check.ok) return { ok: false, error: check.error };

  await db
    .update(proposals)
    .set({
      status: "REJECTED",
      rejectionReason: reason,
      reviewedBy: input.reviewer.toLowerCase(),
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(proposals.id, proposal.id), eq(proposals.status, "PENDING_REVIEW")));

  await db.insert(auditLog).values({
    actor: `human:${input.reviewer.toLowerCase()}`,
    action: "proposal.rejected",
    subjectType: "proposal",
    subjectId: proposal.id,
    reason,
    metadata: { specHash: proposal.specHash, authenticatedBy: "eip-191 signature" },
  });

  return { ok: true };
}

/** The `createMarket` intent for a proposal, if one was ever prepared. Used by `/review`. */
export async function approvalIntentFor(proposalId: string) {
  const [intent] = await db
    .select({
      id: onchainIntents.id,
      status: onchainIntents.status,
      txHash: onchainIntents.txHash,
      blockNumber: onchainIntents.blockNumber,
      revertReason: onchainIntents.revertReason,
    })
    .from(onchainIntents)
    .where(eq(onchainIntents.idempotencyKey, `proposal:${proposalId}:create-market`))
    .limit(1);

  return intent ?? null;
}
