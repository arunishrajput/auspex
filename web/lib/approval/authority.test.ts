/**
 * Rejection is authenticated by a signature, and these are the ways that must fail.
 *
 * Approval needs no test here: it is proved by the chain, because only the authority's key can
 * produce a transaction `MARKET_CREATOR_ROLE` accepts. Rejection has no such backstop — it is
 * an off-chain record — so the signature check is the only thing standing between the review
 * queue and anyone who can reach the server action.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import { isAuthority, rejectionMessage, verifyRejection } from "./authority";

// Deterministic throwaway keys. These sign nothing but test fixtures and hold no funds on any
// network; the address they produce is the point, not the key.
const AUTHORITY = new Wallet(`0x${"11".repeat(32)}`);
const IMPOSTOR = new Wallet(`0x${"22".repeat(32)}`);

const ORIGINAL = process.env.HUMAN_AUTHORITY_ADDRESS;
const NOW = 1_790_000_000_000;

const INPUT = {
  proposalId: "3f1b2a44-0000-4000-8000-000000000001",
  specHash: `0x${"ab".repeat(32)}`,
  reason: "The close time lands mid-meeting, so the outcome would be undecidable.",
  issuedAt: NOW,
};

beforeEach(() => {
  process.env.HUMAN_AUTHORITY_ADDRESS = AUTHORITY.address;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.HUMAN_AUTHORITY_ADDRESS;
  else process.env.HUMAN_AUTHORITY_ADDRESS = ORIGINAL;
});

describe("isAuthority", () => {
  it("matches regardless of checksum casing", () => {
    expect(isAuthority(AUTHORITY.address)).toBe(true);
    expect(isAuthority(AUTHORITY.address.toLowerCase())).toBe(true);
    expect(isAuthority(AUTHORITY.address.toUpperCase().replace("0X", "0x"))).toBe(true);
  });

  it("rejects anyone else, and anything that is not an address", () => {
    expect(isAuthority(IMPOSTOR.address)).toBe(false);
    expect(isAuthority(null)).toBe(false);
    expect(isAuthority("")).toBe(false);
  });

  it("is false when no authority is configured, rather than defaulting to open", () => {
    delete process.env.HUMAN_AUTHORITY_ADDRESS;
    expect(isAuthority(AUTHORITY.address)).toBe(false);
  });
});

describe("verifyRejection", () => {
  it("accepts a signature from the authority over the exact message", async () => {
    const signature = await AUTHORITY.signMessage(rejectionMessage(INPUT));
    expect(verifyRejection(INPUT, signature, NOW + 1000)).toEqual({ ok: true });
  });

  it("rejects a signature from any other wallet", async () => {
    const signature = await IMPOSTOR.signMessage(rejectionMessage(INPUT));
    const result = verifyRejection(INPUT, signature, NOW + 1000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("does not hold MARKET_CREATOR_ROLE");
  });

  it("rejects a signature replayed against a different proposal", async () => {
    const signature = await AUTHORITY.signMessage(rejectionMessage(INPUT));
    const elsewhere = { ...INPUT, proposalId: "3f1b2a44-0000-4000-8000-000000000002" };
    expect(verifyRejection(elsewhere, signature, NOW + 1000).ok).toBe(false);
  });

  it("rejects a signature reused after the reason was edited", async () => {
    const signature = await AUTHORITY.signMessage(rejectionMessage(INPUT));
    const edited = { ...INPUT, reason: "Looks fine actually." };
    expect(verifyRejection(edited, signature, NOW + 1000).ok).toBe(false);
  });

  it("expires a signature that is more than ten minutes old", async () => {
    const signature = await AUTHORITY.signMessage(rejectionMessage(INPUT));
    const result = verifyRejection(INPUT, signature, NOW + 11 * 60_000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("expired");
  });

  it("refuses a timestamp from the future, so the window cannot be widened by the client", async () => {
    const future = { ...INPUT, issuedAt: NOW + 10 * 60_000 };
    const signature = await AUTHORITY.signMessage(rejectionMessage(future));
    expect(verifyRejection(future, signature, NOW).ok).toBe(false);
  });

  it("returns a plain error for a malformed signature rather than throwing", () => {
    const result = verifyRejection(INPUT, "not-a-signature", NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("could not be read");
  });

  it("fails closed when no authority is configured", async () => {
    const signature = await AUTHORITY.signMessage(rejectionMessage(INPUT));
    delete process.env.HUMAN_AUTHORITY_ADDRESS;
    expect(verifyRejection(INPUT, signature, NOW).ok).toBe(false);
  });
});

describe("rejectionMessage", () => {
  it("names the proposal and its spec hash, so a signature binds to one decision", () => {
    const message = rejectionMessage(INPUT);
    expect(message).toContain(INPUT.proposalId);
    expect(message).toContain(INPUT.specHash);
    expect(message).toContain(INPUT.reason);
  });

  it("tells the signer plainly that nothing is spent", () => {
    // What a wallet shows is what a person reads before approving. It should say what it does.
    expect(rejectionMessage(INPUT)).toContain("does not move funds");
  });

  it("handles a draft that never produced a spec", () => {
    expect(rejectionMessage({ ...INPUT, specHash: null })).toContain("never produced a spec");
  });
});
