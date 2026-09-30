/**
 * The human resolver gate. The only path from a drafted outcome to a resolution on chain.
 *
 * ## Why this is a human gate at all
 *
 * Hard rule #3 lets a decision pass through deterministic code *or* a human *or* the contract.
 * A resolution technically satisfies that with deterministic validation plus the challenge
 * window — and it is still not good enough here, because the challenge window is 120 seconds and
 * immutable. Nobody vetoes anything in 120 seconds. If the only thing between a model saying
 * "YES" and a payout were a two-minute window, then a model would be deciding who gets paid, and
 * the project's whole claim would be decoration.
 *
 * So the resolver is a person, and their signature comes from a browser wallet:
 *
 *   prepare  → the server re-reads the chain, freezes the calldata, and simulates the call
 *   sign     → the resolver's own wallet signs `proposeResolution`. No server is involved.
 *   confirm  → the server verifies the resulting hash against the node and records it
 *
 * The middle step is the property worth having: **no key AuspeX runs in production can resolve a
 * market.** `RESOLVER_ROLE` is held by the human's wallet and by the deployer, whose key is
 * deliberately absent from Vercel.
 *
 * ## What `prepare` refuses to hand to the wallet
 *
 * The draft is re-validated against the **chain**, not against the projection: the market's state
 * and its `challengeCount` are read with `getMarket()` at the current block, because a draft
 * queued on an earlier tick — hours ago, at the cadence the cron actually delivers — may since
 * have been challenged into a new round or finalised by someone else. Then the call is simulated as the resolver. A revert that is *evidence* is
 * welcome in this project; a revert in front of an audience that means "we forgot to check" is
 * not.
 *
 * ## The challenge path
 *
 * `challengeResolution` is the same three-step shape with one difference worth stating: it takes
 * a free-text reason which is emitted **on chain**, so the dispute is part of the public record
 * rather than a support ticket. It is bounded to 200 characters here because it is calldata and
 * there is no reason to let a browser write a kilobyte into a block.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { auditLog, markets, onchainIntents, resolutionDrafts } from "../db/schema";
import { readMarket } from "../chain/auspex";
import { getProvider } from "../chain/provider";
import { describeRevert } from "../chain/revert";
import { attachExternalBroadcast, createIntent } from "../intents/engine";
import { humanResolverAddress, isResolver, verifySignedStatement } from "../approval/authority";
import { ONCHAIN_OUTCOME_VALUE } from "./schema";
import { isProposable, roundFor } from "./validate";

/** Characters of challenge reason we will put in a transaction. */
const MAX_CHALLENGE_REASON = 200;

export type PrepareResolutionResult =
  | {
      ok: true;
      intentId: string;
      /** Exactly what the wallet is asked to send. Encoded here, never in the browser. */
      to: string;
      data: string;
      onchainId: number;
      outcome: "YES" | "NO" | "INVALID";
      evidenceUrl: string;
    }
  | { ok: false; error: string };

/**
 * Validates a drafted resolution and returns the transaction the resolver's wallet should send.
 *
 * Writes an `OnChainIntent` before returning, so the transaction the human is about to sign is
 * already recorded as authorised. If the browser dies between the wallet prompt and the
 * confirmation call, the row is still there and the hash can be attached later — the same
 * "record the intention first" discipline the server-signed path uses, for the same reason.
 */
export async function prepareResolution(
  draftId: string,
  resolver: string,
): Promise<PrepareResolutionResult> {
  const expected = humanResolverAddress();
  if (expected === null) {
    return {
      ok: false,
      error: "No resolver address is configured on this deployment, so nothing can be resolved.",
    };
  }
  if (!isResolver(resolver)) {
    return {
      ok: false,
      error: `Connected as ${resolver}, which is not the resolver wallet. Switch to ${expected}.`,
    };
  }

  const [row] = await db
    .select({
      draft: resolutionDrafts,
      onchainId: markets.onchainId,
      question: markets.question,
    })
    .from(resolutionDrafts)
    .innerJoin(markets, eq(resolutionDrafts.marketId, markets.id))
    .where(eq(resolutionDrafts.id, draftId))
    .limit(1);

  if (row === undefined) return { ok: false, error: "No such resolution draft." };

  const { draft } = row;
  if (draft.status !== "PENDING_REVIEW") {
    return { ok: false, error: `This draft is already ${draft.status}.` };
  }
  if (row.onchainId === null) {
    return { ok: false, error: "That market is not on chain yet." };
  }
  if (draft.outcome !== "YES" && draft.outcome !== "NO" && draft.outcome !== "INVALID") {
    return {
      ok: false,
      error: `This draft's outcome is ${draft.outcome}, which proposeResolution does not accept.`,
    };
  }
  if (draft.evidenceUrl === null || draft.evidenceUrl === "") {
    return { ok: false, error: "This draft has no evidence URL, so there is nothing to record." };
  }

  // The chain, not the projection. A draft can be minutes old and the market can have moved.
  const onChain = await readMarket(row.onchainId);
  const nowSeconds = Math.floor(Date.now() / 1000);

  const proposable = isProposable(onChain, nowSeconds);
  if (!proposable.ok) return { ok: false, error: proposable.reason };

  const currentRound = roundFor(onChain);
  if (draft.round !== currentRound) {
    return {
      ok: false,
      error:
        `This draft was written for round ${draft.round} and the market is now at round ` +
        `${currentRound} — it has been challenged since. Reject this draft and let the agent ` +
        `draft a fresh outcome against the challenge.`,
    };
  }

  const intent = await createIntent({
    // Derived from the draft, so two clicks produce one intent and therefore one resolution.
    idempotencyKey: `draft:${draft.id}:propose-resolution`,
    kind: "PROPOSE_RESOLUTION",
    signer: "EXTERNAL",
    from: expected,
    functionName: "proposeResolution",
    args: [row.onchainId, ONCHAIN_OUTCOME_VALUE[draft.outcome], draft.evidenceUrl],
  });

  // Simulate as the resolver, against the real contract, at the current block. Catches a revoked
  // role, a market someone else already resolved, and a wrong encoding — without signing.
  try {
    await getProvider().call({ to: intent.toAddress, data: intent.data, from: expected });
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
    onchainId: row.onchainId,
    outcome: draft.outcome,
    evidenceUrl: draft.evidenceUrl,
  };
}

export type ConfirmResolutionResult =
  | { ok: true; txHash: string }
  | { ok: false; error: string };

/**
 * Records the transaction the wallet produced, after verifying it against the node.
 *
 * The draft becomes `APPROVED` only once the chain has confirmed that a transaction with this
 * hash exists, was sent by the resolver, and carries exactly the calldata the server authorised.
 * `attachExternalBroadcast` does that checking — including the `data` comparison, which is what
 * makes "the outcome that was signed is the outcome that was drafted" a fact rather than a claim.
 */
export async function confirmResolution(
  draftId: string,
  intentId: string,
  txHash: string,
  resolver: string,
): Promise<ConfirmResolutionResult> {
  if (!isResolver(resolver)) {
    return { ok: false, error: "Only the resolver wallet can propose a resolution." };
  }

  const attached = await attachExternalBroadcast(intentId, txHash);
  if (!attached.ok) return { ok: false, error: attached.error };

  const hash = attached.intent.txHash ?? txHash.toLowerCase();

  // Only a draft still in review is transitioned, so a replayed confirmation cannot rewrite
  // `reviewedAt` or overwrite a rejection that happened in between.
  await db
    .update(resolutionDrafts)
    .set({
      status: "APPROVED",
      reviewedBy: resolver.toLowerCase(),
      reviewedAt: new Date(),
      intentId,
      updatedAt: new Date(),
    })
    .where(and(eq(resolutionDrafts.id, draftId), eq(resolutionDrafts.status, "PENDING_REVIEW")));

  await db.insert(auditLog).values({
    actor: `human:${resolver.toLowerCase()}`,
    action: "resolution.proposed",
    subjectType: "resolution_draft",
    subjectId: draftId,
    reason:
      "A human resolver read the drafted outcome and its evidence and signed proposeResolution " +
      "with their own wallet. The calldata was encoded by the server from the stored draft and " +
      "verified against the node before this was recorded. The challenge window now runs.",
    txHash: hash,
    metadata: { intentId },
  });

  return { ok: true, txHash: hash };
}

// ---------------------------------------------------------------------------
// Rejecting a draft — no transaction, so it needs a signature
// ---------------------------------------------------------------------------

/**
 * The exact text a resolver signs to reject a drafted outcome.
 *
 * Built by the same function on both sides, so the string the wallet displays is the string the
 * server verifies. It names the draft, the market, the outcome and the round, so a signature
 * captured for one rejection cannot be replayed against another draft — and the round matters
 * because the same market legitimately gets a second draft after a challenge.
 */
export function draftRejectionMessage(input: {
  draftId: string;
  onchainId: number;
  outcome: string;
  round: number;
  reason: string;
  issuedAt: number;
}): string {
  return [
    "AuspeX — reject a drafted resolution",
    `draft: ${input.draftId}`,
    `market: #${input.onchainId}`,
    `outcome proposed: ${input.outcome}`,
    `round: ${input.round}`,
    `reason: ${input.reason.trim()}`,
    `issuedAt: ${input.issuedAt}`,
    "",
    "Signing this records a rejection. It does not move funds and sends no transaction.",
  ].join("\n");
}

export type RejectDraftResult = { ok: true } | { ok: false; error: string };

/**
 * Records the rejection of a drafted outcome, authenticated by a signature.
 *
 * Nothing on chain records a rejection, so without a signature "I am the resolver" would be an
 * unverified claim from a browser and anyone who could reach the server action could clear the
 * queue. Hard rule #7: the reason is required and kept — a resolution queue that only ever
 * records approvals cannot demonstrate that anything was ever refused.
 */
export async function rejectDraft(input: {
  draftId: string;
  resolver: string;
  reason: string;
  signature: string;
  issuedAt: number;
}): Promise<RejectDraftResult> {
  const reason = input.reason.trim();
  if (reason.length < 3) return { ok: false, error: "A rejection needs a reason." };
  if (reason.length > 500) return { ok: false, error: "Keep the reason under 500 characters." };

  const [row] = await db
    .select({ draft: resolutionDrafts, onchainId: markets.onchainId })
    .from(resolutionDrafts)
    .innerJoin(markets, eq(resolutionDrafts.marketId, markets.id))
    .where(eq(resolutionDrafts.id, input.draftId))
    .limit(1);

  if (row === undefined) return { ok: false, error: "No such resolution draft." };
  if (row.draft.status !== "PENDING_REVIEW") {
    return { ok: false, error: `This draft is already ${row.draft.status}.` };
  }

  const check = verifySignedStatement({
    message: draftRejectionMessage({
      draftId: row.draft.id,
      onchainId: row.onchainId ?? 0,
      outcome: row.draft.outcome,
      round: row.draft.round,
      reason,
      issuedAt: input.issuedAt,
    }),
    signature: input.signature,
    expected: humanResolverAddress(),
    expectedDescription: "the resolver wallet",
    issuedAt: input.issuedAt,
  });
  if (!check.ok) return { ok: false, error: check.error };

  await db
    .update(resolutionDrafts)
    .set({
      status: "REJECTED",
      rejectionReason: reason,
      reviewedBy: input.resolver.toLowerCase(),
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(resolutionDrafts.id, row.draft.id), eq(resolutionDrafts.status, "PENDING_REVIEW")),
    );

  await db.insert(auditLog).values({
    actor: `human:${input.resolver.toLowerCase()}`,
    action: "resolution.rejected",
    subjectType: "resolution_draft",
    subjectId: row.draft.id,
    reason,
    metadata: {
      onchainId: row.onchainId,
      outcome: row.draft.outcome,
      round: row.draft.round,
      authenticatedBy: "eip-191 signature",
    },
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Challenging a proposed resolution — on chain, from the human's wallet
// ---------------------------------------------------------------------------

export type PrepareChallengeResult =
  | { ok: true; intentId: string; to: string; data: string; onchainId: number }
  | { ok: false; error: string };

/**
 * Validates a challenge and returns the transaction the wallet should send.
 *
 * The reason is calldata, so it is bounded and it is frozen here rather than in the browser —
 * the same discipline as every other intent. The market state and the window are read from the
 * chain, because "is the window still open?" is a question only the chain can answer and the
 * answer changes every three seconds.
 */
export async function prepareChallenge(
  marketRowId: string,
  challenger: string,
  reason: string,
): Promise<PrepareChallengeResult> {
  const expected = humanResolverAddress();
  if (expected === null) {
    return { ok: false, error: "No challenger address is configured on this deployment." };
  }
  if (!isResolver(challenger)) {
    return {
      ok: false,
      error: `Connected as ${challenger}, which is not the challenger wallet. Switch to ${expected}.`,
    };
  }

  const trimmed = reason.trim();
  if (trimmed.length < 3) return { ok: false, error: "A challenge needs a reason." };
  if (trimmed.length > MAX_CHALLENGE_REASON) {
    return {
      ok: false,
      error: `Keep the reason under ${MAX_CHALLENGE_REASON} characters — it goes on chain.`,
    };
  }

  const [market] = await db
    .select({ onchainId: markets.onchainId })
    .from(markets)
    .where(eq(markets.id, marketRowId))
    .limit(1);

  if (market === undefined || market.onchainId === null) {
    return { ok: false, error: "That market is not on chain." };
  }

  const onChain = await readMarket(market.onchainId);
  if (onChain.state !== "RESOLUTION_PROPOSED") {
    return {
      ok: false,
      error: `The market is ${onChain.state}; there is no proposed resolution to challenge.`,
    };
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds >= onChain.challengeEndsAt) {
    return {
      ok: false,
      error:
        `The challenge window closed at ` +
        `${new Date(onChain.challengeEndsAt * 1000).toISOString()}. The contract reverts with ` +
        `ChallengeWindowClosed — anyone can finalise this resolution now.`,
    };
  }

  const intent = await createIntent({
    // The round is in the key, so challenging the *same market's* second proposal is a genuinely
    // new intent rather than a duplicate of the first challenge.
    idempotencyKey: `market:${market.onchainId}:challenge:${onChain.challengeCount}`,
    kind: "CHALLENGE_RESOLUTION",
    signer: "EXTERNAL",
    from: expected,
    functionName: "challengeResolution",
    args: [market.onchainId, trimmed],
  });

  try {
    await getProvider().call({ to: intent.toAddress, data: intent.data, from: expected });
  } catch (error) {
    return {
      ok: false,
      error: `The contract would refuse this challenge: ${describeRevert(error)}`,
    };
  }

  return {
    ok: true,
    intentId: intent.id,
    to: intent.toAddress,
    data: intent.data,
    onchainId: market.onchainId,
  };
}

/**
 * Records a challenge transaction after verifying it against the node.
 *
 * There is no draft row to transition: a challenge's whole record is the on-chain event and the
 * audit entry here. The market's `challengeCount` and its return to `CLOSED` come from the
 * indexer reading `ResolutionChallenged`, never from us asserting it.
 */
export async function confirmChallenge(
  marketRowId: string,
  intentId: string,
  txHash: string,
  challenger: string,
  reason: string,
): Promise<ConfirmResolutionResult> {
  if (!isResolver(challenger)) {
    return { ok: false, error: "Only the challenger wallet can challenge a resolution." };
  }

  const attached = await attachExternalBroadcast(intentId, txHash);
  if (!attached.ok) return { ok: false, error: attached.error };

  const hash = attached.intent.txHash ?? txHash.toLowerCase();

  await db.insert(auditLog).values({
    actor: `human:${challenger.toLowerCase()}`,
    action: "resolution.challenged",
    subjectType: "market",
    subjectId: marketRowId,
    reason:
      `A human challenged the proposed resolution on chain: ${reason.trim()}. The market returns ` +
      `to CLOSED and the outcome is discarded, so it must be re-proposed with fresh evidence.`,
    txHash: hash,
    metadata: { intentId },
  });

  return { ok: true, txHash: hash };
}

/** The `PROPOSE_RESOLUTION` intent for a draft, if one was ever prepared. Used by `/resolve`. */
export async function resolutionIntentFor(draftId: string) {
  const [intent] = await db
    .select({
      id: onchainIntents.id,
      status: onchainIntents.status,
      txHash: onchainIntents.txHash,
      blockNumber: onchainIntents.blockNumber,
      revertReason: onchainIntents.revertReason,
    })
    .from(onchainIntents)
    .where(eq(onchainIntents.idempotencyKey, `draft:${draftId}:propose-resolution`))
    .limit(1);

  return intent ?? null;
}

export { MAX_CHALLENGE_REASON };
