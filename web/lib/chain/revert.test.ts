import { describe, expect, it } from "vitest";
import { Interface } from "ethers";
import { AUSPEX_MARKET_ABI } from "./deployment";
import { decodeRevertData, describeRevert, extractRevertData } from "./revert";

/**
 * The revert decoder (ADR-023).
 *
 * MST Testnet's RPC hides custom-error data in the error *message* rather than the standard
 * `error.data` field, so ethers leaves `error.revert` null and an over-cap bet surfaces as an
 * anonymous "execution reverted". The whole point of a refused transaction is someone reading
 * `AgentPerTxCapExceeded(attempted, cap)` with real numbers in it, so this decoder is load
 * bearing rather than cosmetic.
 *
 * The encoded payloads below are produced by ethers from the committed ABI, so they are the
 * bytes the deployed contract actually emits.
 */

const iface = new Interface(AUSPEX_MARKET_ABI);

const CAP_EXCEEDED = iface.encodeErrorResult("AgentPerTxCapExceeded", [
  200_000_000_000_000_000n,
  100_000_000_000_000_000n,
]);

describe("extractRevertData", () => {
  it("prefers the standard error.data field", () => {
    expect(extractRevertData({ data: CAP_EXCEEDED })).toBe(CAP_EXCEEDED);
  });

  it("reads ethers' nested info.error.data", () => {
    expect(extractRevertData({ info: { error: { data: CAP_EXCEEDED } } })).toBe(CAP_EXCEEDED);
  });

  it("scrapes the message, which is where MST actually puts it", () => {
    // The exact shape observed from https://testnetrpc.mstblockchain.com on 2026-09-28.
    const mstStyle = { message: `execution reverted: ${CAP_EXCEEDED}` };
    expect(extractRevertData(mstStyle)).toBe(CAP_EXCEEDED);
  });

  it("returns undefined when there is no payload to find", () => {
    expect(extractRevertData({ message: "connection refused" })).toBeUndefined();
    expect(extractRevertData(new Error("timeout"))).toBeUndefined();
  });
});

describe("decodeRevertData", () => {
  it("decodes a custom error with its arguments intact", () => {
    const decoded = decodeRevertData(CAP_EXCEEDED);
    expect(decoded?.name).toBe("AgentPerTxCapExceeded");
    // Decimal strings, not numbers: 0.2 tMSTC in wei is past Number.MAX_SAFE_INTEGER.
    expect(decoded?.args).toEqual(["200000000000000000", "100000000000000000"]);
    expect(decoded?.formatted).toBe(
      "AgentPerTxCapExceeded(200000000000000000, 100000000000000000)",
    );
  });

  it("decodes every custom error the contract declares", () => {
    // Enumerated from the interface itself, so a future ABI change that adds an error cannot
    // quietly leave it undecodable — and Phase 5's demo depends on the cap errors decoding.
    let count = 0;
    iface.forEachError((fragment) => {
      count += 1;
      const args = fragment.inputs.map((input) => {
        if (input.type.startsWith("uint")) return 1n;
        if (input.type === "address") return "0x0000000000000000000000000000000000000001";
        if (input.type === "bytes32") return `0x${"1".repeat(64)}`;
        return "x";
      });
      const encoded = iface.encodeErrorResult(fragment, args);
      expect(decodeRevertData(encoded)?.name, `failed to decode ${fragment.name}`).toBe(
        fragment.name,
      );
    });

    expect(count).toBeGreaterThan(20);
  });

  it("decodes a plain require(...) string revert", () => {
    const encoded = new Interface(["function Error(string)"]).encodeFunctionData("Error", [
      "not authorised",
    ]);
    expect(decodeRevertData(encoded)?.formatted).toBe("not authorised");
  });

  it("names a Panic code rather than printing the raw number", () => {
    const encoded = new Interface(["function Panic(uint256)"]).encodeFunctionData("Panic", [
      0x11,
    ]);
    expect(decodeRevertData(encoded)?.formatted).toBe(
      "Panic: arithmetic overflow or underflow",
    );
  });

  it("returns null rather than guessing at an unknown selector", () => {
    // An undecodable revert is a real outcome. Inventing a name for it would be presenting a
    // guess as a fact — the one thing this project cannot afford to do with chain data.
    expect(decodeRevertData("0xdeadbeef00000000")).toBeNull();
    expect(decodeRevertData("0x")).toBeNull();
    expect(decodeRevertData(undefined)).toBeNull();
  });
});

describe("describeRevert", () => {
  it("turns an MST-shaped RPC error into a readable custom error", () => {
    const message = describeRevert({ message: `execution reverted: ${CAP_EXCEEDED}` });
    expect(message).toBe("AgentPerTxCapExceeded(200000000000000000, 100000000000000000)");
  });

  it("always returns something recordable, even for a network failure", () => {
    // Every caller writes this into onchain_intents.revert_reason or the audit log, and both
    // refuse null. Returning "" would record a failure as though nothing happened.
    expect(describeRevert(new Error("fetch failed"))).toBe("fetch failed");
    expect(describeRevert("weird").length).toBeGreaterThan(0);
  });

  it("says plainly when it could not decode the payload it found", () => {
    const message = describeRevert({ message: "execution reverted: 0xdeadbeef11223344" });
    expect(message).toContain("undecodable revert");
    expect(message).toContain("0xdeadbeef");
  });
});
