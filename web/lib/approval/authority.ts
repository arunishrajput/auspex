/**
 * Who the human authority is, and how a claim to be them is checked.
 *
 * ## Two different standards of proof, on purpose
 *
 * **Approval proves itself.** The market is created by a transaction signed with the authority
 * wallet's key. No server check is load-bearing there: the contract's `MARKET_CREATOR_ROLE`
 * refuses anyone else, and that holds even if this file were deleted.
 *
 * **Rejection does not.** Nothing on chain records a rejection, so "I am the authority" would
 * otherwise be an unverified claim from a browser — and anyone who could reach the server
 * action could clear the review queue. So a rejection carries an EIP-191 signature over a
 * message naming the exact proposal, and it is verified here.
 *
 * The result is that both halves of the human gate are backed by the same private key, and
 * neither depends on a session, a cookie, or trusting what the page said about itself.
 */

import { verifyMessage } from "ethers";
import { optionalEnv } from "../env";

/** The address that holds `MARKET_CREATOR_ROLE`. A public address — never a key. */
export function humanAuthorityAddress(): string | null {
  const raw = optionalEnv("HUMAN_AUTHORITY_ADDRESS");
  if (raw === undefined) return null;
  return /^0x[0-9a-fA-F]{40}$/.test(raw) ? raw.toLowerCase() : null;
}

export function isAuthority(address: string | null | undefined): boolean {
  const authority = humanAuthorityAddress();
  if (authority === null || typeof address !== "string") return false;
  return address.toLowerCase() === authority;
}

/** How long a signed rejection stays valid. Long enough to type a reason, short enough to replay. */
const REJECTION_MAX_AGE_MS = 10 * 60_000;

/**
 * The exact text a reviewer signs to reject a proposal.
 *
 * Built by the same function on both sides, so the string the wallet displays is the string
 * the server verifies. It names the proposal and its spec hash, so a signature captured for
 * one rejection cannot be replayed against another proposal, and `issuedAt` bounds how long it
 * is worth capturing at all.
 */
export function rejectionMessage(input: {
  proposalId: string;
  specHash: string | null;
  reason: string;
  issuedAt: number;
}): string {
  return [
    "AuspeX — reject market proposal",
    `proposal: ${input.proposalId}`,
    `specHash: ${input.specHash ?? "(none — this draft never produced a spec)"}`,
    `reason: ${input.reason.trim()}`,
    `issuedAt: ${input.issuedAt}`,
    "",
    "Signing this records a rejection. It does not move funds and sends no transaction.",
  ].join("\n");
}

export type SignatureCheck = { ok: true } | { ok: false; error: string };

/** Recovers the signer and checks it is the authority, within the freshness window. */
export function verifyRejection(
  input: { proposalId: string; specHash: string | null; reason: string; issuedAt: number },
  signature: string,
  now = Date.now(),
): SignatureCheck {
  const authority = humanAuthorityAddress();
  if (authority === null) {
    return { ok: false, error: "HUMAN_AUTHORITY_ADDRESS is not configured on this deployment." };
  }

  const age = now - input.issuedAt;
  if (!Number.isFinite(input.issuedAt) || age < -60_000 || age > REJECTION_MAX_AGE_MS) {
    return { ok: false, error: "That signature has expired. Sign the rejection again." };
  }

  let recovered: string;
  try {
    recovered = verifyMessage(rejectionMessage(input), signature);
  } catch {
    return { ok: false, error: "That signature could not be read." };
  }

  if (recovered.toLowerCase() !== authority) {
    return {
      ok: false,
      error: `Signed by ${recovered}, which does not hold MARKET_CREATOR_ROLE.`,
    };
  }
  return { ok: true };
}
