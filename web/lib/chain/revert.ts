import { Interface } from "ethers";
import { AUSPEX_MARKET_ABI } from "./deployment";

/**
 * Decoding a revert on MST Testnet.
 *
 * **The problem (ADR-023).** This RPC does not return custom-error data in the standard
 * JSON-RPC `error.data` field. It embeds the ABI-encoded bytes in the error *message*:
 *
 *     execution reverted: 0x594f797d0000…0000016345785d8a0000…
 *
 * ethers looks in `error.data`, finds nothing, and leaves `error.revert` null. So a bet that
 * exceeded an on-chain cap surfaces as an anonymous "execution reverted" — which is precisely
 * the moment the project most needs to be legible. Phase 5's headline demo is a judge seeing
 * `AgentPerTxCapExceeded(attempted, cap)` with real numbers in it.
 *
 * This module is lifted from `contracts/scripts/smoke.ts`, where the behaviour was first
 * found, and generalised so both the intent engine and the UI use one decoder.
 */

const iface = new Interface(AUSPEX_MARKET_ABI);

/** Selector + encoded args for `Error(string)`, the classic `require("...")` revert. */
const STRING_ERROR_SELECTOR = "0x08c379a0";
/** `Panic(uint256)` — assertion failures, division by zero, arithmetic overflow. */
const PANIC_SELECTOR = "0x4e487b71";

const PANIC_REASONS: Record<string, string> = {
  "0x01": "assertion failed",
  "0x11": "arithmetic overflow or underflow",
  "0x12": "division or modulo by zero",
  "0x21": "invalid enum value",
  "0x31": "pop on empty array",
  "0x32": "array index out of bounds",
  "0x41": "out of memory",
  "0x51": "call to an uninitialised function pointer",
};

export type DecodedRevert = {
  /** The custom error's name, e.g. `AgentPerTxCapExceeded`. */
  name: string;
  /** Arguments as decimal/hex strings, in declaration order. */
  args: string[];
  /** Ready to render: `AgentPerTxCapExceeded(200000000000000000, 100000000000000000)`. */
  formatted: string;
  /** The raw bytes we decoded, so the UI can show its work. */
  data: string;
};

/**
 * Pulls ABI-encoded revert data out of an RPC error.
 *
 * Checks the two standard locations first — a correctly-behaved node, or a future fix to
 * MST's — and only then falls back to scraping the message. The fallback is last so that a
 * node which starts behaving correctly silently gets the better path.
 */
export function extractRevertData(error: unknown): string | undefined {
  const e = error as {
    data?: unknown;
    info?: { error?: { data?: unknown } };
    error?: { data?: unknown };
    message?: string;
    shortMessage?: string;
  };

  for (const candidate of [e.data, e.info?.error?.data, e.error?.data]) {
    if (typeof candidate === "string" && candidate.startsWith("0x") && candidate.length > 2) {
      return candidate;
    }
  }

  // The MST fallback. A selector is 4 bytes, so any real revert payload is ≥ 10 characters.
  const text = `${e.message ?? ""} ${e.shortMessage ?? ""}`;
  return /0x[0-9a-fA-F]{8,}/.exec(text)?.[0];
}

/**
 * Decodes revert bytes against the AuspexMarket ABI.
 *
 * Returns `null` rather than throwing or inventing a name: an undecodable revert is a real
 * outcome (a different contract, a plain out-of-gas), and claiming to have decoded it would
 * be presenting a guess as a fact.
 */
export function decodeRevertData(data: string | undefined): DecodedRevert | null {
  if (data === undefined || !data.startsWith("0x") || data.length < 10) return null;

  const selector = data.slice(0, 10).toLowerCase();

  if (selector === STRING_ERROR_SELECTOR) {
    try {
      const [reason] = new Interface(["function Error(string)"]).decodeFunctionData(
        "Error",
        data,
      );
      return { name: "Error", args: [String(reason)], formatted: String(reason), data };
    } catch {
      return null;
    }
  }

  if (selector === PANIC_SELECTOR) {
    try {
      const [code] = new Interface(["function Panic(uint256)"]).decodeFunctionData(
        "Panic",
        data,
      );
      const hex = `0x${(code as bigint).toString(16).padStart(2, "0")}`;
      const reason = PANIC_REASONS[hex] ?? `unknown panic ${hex}`;
      return { name: "Panic", args: [hex], formatted: `Panic: ${reason}`, data };
    } catch {
      return null;
    }
  }

  const fragment = iface.getError(selector);
  if (fragment === null) return null;

  try {
    const decoded = iface.decodeErrorResult(fragment, data);
    const args = decoded.map((value) =>
      typeof value === "bigint" ? value.toString() : String(value),
    );
    return {
      name: fragment.name,
      args,
      formatted: `${fragment.name}(${args.join(", ")})`,
      data,
    };
  } catch {
    return null;
  }
}

/**
 * The whole path in one call: take a thrown RPC error, give back something printable.
 *
 * Always returns a string, because every caller is on a path where *something* must be
 * recorded — `onchain_intents.revert_reason` and the audit log both refuse null. When
 * decoding fails it says so plainly instead of dressing up a guess.
 */
export function describeRevert(error: unknown): string {
  const data = extractRevertData(error);
  const decoded = decodeRevertData(data);
  if (decoded !== null) return decoded.formatted;

  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  return data !== undefined
    ? `undecodable revert ${data.slice(0, 18)}… (${message.slice(0, 160)})`
    : message.slice(0, 200);
}
