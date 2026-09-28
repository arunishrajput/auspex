import { keccak256, toUtf8Bytes } from "ethers";

/**
 * The canonical market specification and its hash.
 *
 * `specHash` is the link between "what a human approved" and "what the contract created". The
 * contract stores it and refuses a hash it has already seen, which is the on-chain half of
 * the idempotency argument. For that link to mean anything, the hash has to be reproducible
 * from the spec by anyone — a judge included — so the encoding is fixed here and nowhere else.
 *
 * **Canonical form: keys sorted, JSON, UTF-8, keccak256.** Sorting matters: two objects with
 * the same content in a different key order are the same specification, and must not produce
 * two hashes and therefore two markets.
 */

export type MarketSpec = {
  question: string;
  resolutionSourceUrl: string;
  /** Unix seconds. Betting closes here. */
  closeTime: number;
  /** Unix seconds. A resolver must have proposed an outcome by here. */
  resolveDeadline: number;
  /** The exact fact to check at the source, in a form a human can verify in one read. */
  resolutionCriteria: string;
  category: string;
};

/** Recursively sorts object keys so encoding depends on content, not construction order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, canonicalize(v)]));
  }
  return value;
}

export function canonicalSpecJson(spec: MarketSpec): string {
  return JSON.stringify(canonicalize(spec));
}

/**
 * The value passed to `createMarket(bytes32 specHash, …)`.
 *
 * Deterministic: the same spec always hashes the same, which is exactly why re-submitting an
 * approved spec is rejected by the contract rather than quietly creating a duplicate market.
 */
export function computeSpecHash(spec: MarketSpec): string {
  return keccak256(toUtf8Bytes(canonicalSpecJson(spec)));
}
