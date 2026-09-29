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

/**
 * The address that holds `RESOLVER_ROLE` and `CHALLENGER_ROLE`.
 *
 * Defaults to the market-creating authority, because on this deployment they are the same person
 * and the same BridgeKey account. It is a **separate function with its own variable** so that
 * splitting them is a configuration change rather than a code change: set
 * `HUMAN_RESOLVER_ADDRESS` to a different wallet, grant it the two roles, and the creator can no
 * longer resolve. That separation of duties is the right end state and `docs/TRUST_MODEL.md` says
 * plainly that this deployment has not made it, rather than implying it has.
 */
export function humanResolverAddress(): string | null {
  const raw = optionalEnv("HUMAN_RESOLVER_ADDRESS");
  if (raw !== undefined) {
    return /^0x[0-9a-fA-F]{40}$/.test(raw) ? raw.toLowerCase() : null;
  }
  return humanAuthorityAddress();
}

export function isResolver(address: string | null | undefined): boolean {
  const resolver = humanResolverAddress();
  if (resolver === null || typeof address !== "string") return false;
  return address.toLowerCase() === resolver;
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

/**
 * Recovers the signer of an exact message and checks it is `expected`, within the freshness window.
 *
 * Shared by the two places a decision leaves no on-chain trace and therefore needs a signature to
 * mean anything: rejecting a market proposal, and rejecting a drafted resolution. The freshness
 * rules are the interesting part and they must not be written twice — a future timestamp is
 * refused as well as an old one, because otherwise a client could widen its own replay window by
 * claiming to be signing tomorrow.
 */
export function verifySignedStatement(input: {
  message: string;
  signature: string;
  expected: string | null;
  expectedDescription: string;
  issuedAt: number;
  now?: number;
}): SignatureCheck {
  if (input.expected === null) {
    return { ok: false, error: `${input.expectedDescription} is not configured on this deployment.` };
  }

  const age = (input.now ?? Date.now()) - input.issuedAt;
  if (!Number.isFinite(input.issuedAt) || age < -60_000 || age > REJECTION_MAX_AGE_MS) {
    return { ok: false, error: "That signature has expired. Sign it again." };
  }

  let recovered: string;
  try {
    recovered = verifyMessage(input.message, input.signature);
  } catch {
    return { ok: false, error: "That signature could not be read." };
  }

  if (recovered.toLowerCase() !== input.expected.toLowerCase()) {
    return {
      ok: false,
      error: `Signed by ${recovered}, which is not ${input.expectedDescription}.`,
    };
  }
  return { ok: true };
}

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
