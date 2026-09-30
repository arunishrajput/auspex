/**
 * The two pure decisions inside the keeper, tested from both sides.
 *
 * `staleEligibility` decides whether to refund every bettor on a market and end it. It is the
 * most destructive call this codebase can make without a human, so every branch that says "no"
 * matters more than the one that says "yes" — a false positive here takes a live market away from
 * people who bet on it.
 *
 * `mergeLifecycle` decides what the market detail page shows as "every transaction". It was
 * silently dropping a real, confirmed 0.01 tMSTC bet on market #2, so the regression test is
 * built from that market's actual shape.
 */

import { describe, expect, it } from "vitest";
import { mergeLifecycle, staleEligibility, STALE_GRACE_SECONDS } from "./settle";
import type { OnChainMarket } from "../chain/auspex";

const DEADLINE = 1_790_618_054; // market #2's real resolveDeadline

function market(over: Partial<OnChainMarket> = {}): OnChainMarket {
  return {
    onchainId: 2,
    specHash: "0x" + "11".repeat(32),
    closeTime: DEADLINE - 1800,
    resolveDeadline: DEADLINE,
    challengeEndsAt: 0,
    poolYesWei: 10_000_000_000_000_000n,
    poolNoWei: 0n,
    outcome: "UNRESOLVED",
    state: "CLOSED",
    challengeCount: 0,
    proposedBy: "0x" + "00".repeat(20),
    question: "q",
    resolutionSourceUrl: "https://example.test",
    evidenceUrl: "",
    ...over,
  };
}

describe("staleEligibility", () => {
  it("allows a CLOSED market once the deadline and the grace period have both passed", () => {
    const result = staleEligibility(market(), DEADLINE + STALE_GRACE_SECONDS + 1);
    expect(result.ok).toBe(true);
  });

  it("allows an OPEN market that nobody ever closed — the contract accepts OPEN too", () => {
    // `closeMarket` is cosmetic; a market can reach its resolve deadline still marked OPEN if no
    // keeper pass ever ran. `invalidateStale` accepts OPEN, so refusing it here would strand it.
    const result = staleEligibility(market({ state: "OPEN" }), DEADLINE + STALE_GRACE_SECONDS + 1);
    expect(result.ok).toBe(true);
  });

  it("refuses while the resolver is still inside the contract's window", () => {
    const result = staleEligibility(market(), DEADLINE - 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("ResolveDeadlineNotPassed");
  });

  it("refuses at the deadline itself, because the contract uses a strict >", () => {
    // AuspexMarket: `if (block.timestamp <= m.resolveDeadline) revert`. Off-by-one here would
    // queue a transaction the chain is certain to reject.
    expect(staleEligibility(market(), DEADLINE, 0).ok).toBe(false);
    expect(staleEligibility(market(), DEADLINE + 1, 0).ok).toBe(true);
  });

  it("refuses inside the grace period even though the contract would allow it", () => {
    // This is the half of ADR-057 that survives: a late resolver must not be overruled by a cron
    // job. The chain would accept the call; we decline to make it.
    const result = staleEligibility(market(), DEADLINE + 60);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("ADR-066b");
  });

  it("refuses a market with a proposal pending, whatever the clock says", () => {
    // The load-bearing one. A resolver proposed an outcome and it is inside its challenge window;
    // invalidating it would throw away a real resolution. The contract reverts too.
    const result = staleEligibility(
      market({ state: "RESOLUTION_PROPOSED" }),
      DEADLINE + 10 * STALE_GRACE_SECONDS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("MarketNotClosed");
  });

  it("refuses a market that is already settled, in either direction", () => {
    const late = DEADLINE + 10 * STALE_GRACE_SECONDS;
    expect(staleEligibility(market({ state: "FINALIZED" }), late).ok).toBe(false);
    expect(staleEligibility(market({ state: "INVALIDATED" }), late).ok).toBe(false);
  });

  it("never treats a malformed grace period as zero", () => {
    // Guards the env override: a typo must not become "refund everyone immediately".
    expect(staleEligibility(market(), DEADLINE + 1, STALE_GRACE_SECONDS).ok).toBe(false);
  });
});

describe("mergeLifecycle", () => {
  const intent = {
    kind: "CLOSE_MARKET",
    status: "CONFIRMED",
    signer: "SERVER",
    fromAddress: "0x76bf4262aa13632e91e27e0eba3b42b6b353ce4e",
    txHash: "0x9588280c82402a72204af12f6132871e68fd40c9d0b9541b41f0c42399ed35a7",
    blockNumber: 5_796_567,
    revertReason: null,
    valueWei: "0",
    createdAt: new Date("2026-09-29T01:22:40Z"),
  };

  const betLog = {
    eventName: "BetPlaced",
    args: {
      amount: "10000000000000000",
      bettor: "0xc71dC478040F7A6bcc5Cb1f316A4a446F7D4ad24",
      isAgent: false,
      backsYes: true,
      marketId: "2",
    },
    txHash: "0x558dfdafdcdac157176058076c9dafcd825a525346806d2e45e9340213c8a0bf",
    blockNumber: 5_786_402,
    blockTime: new Date("2026-09-28T17:24:20Z"),
  };

  it("recovers market #2's bet, which has no intent row and never will", () => {
    const rows = mergeLifecycle([intent], [betLog]);
    expect(rows).toHaveLength(2);

    const bet = rows.find((row) => row.kind === "PLACE_BET");
    expect(bet).toBeDefined();
    expect(bet!.origin).toBe("CHAIN");
    // The value has to survive: this row is what makes the 0.01 tMSTC visible on the page.
    expect(bet!.valueWei).toBe("10000000000000000");
    expect(bet!.fromAddress).toBe("0xc71dc478040f7a6bcc5cb1f316a4a446f7d4ad24");
    expect(bet!.txHash).toBe(betLog.txHash);
  });

  it("orders by block, so the table reads in the chain's order", () => {
    const rows = mergeLifecycle([intent], [betLog]);
    expect(rows.map((row) => row.blockNumber)).toEqual([5_786_402, 5_796_567]);
  });

  it("does not duplicate a transaction that has both a log and an intent row", () => {
    const sameTx = { ...betLog, txHash: intent.txHash };
    const rows = mergeLifecycle([intent], [sameTx]);
    expect(rows).toHaveLength(1);
    // The intent row wins: it is the only one that knows about reverts.
    expect(rows[0].origin).toBe("INTENT");
  });

  it("matches transaction hashes case-insensitively", () => {
    const rows = mergeLifecycle([intent], [{ ...betLog, txHash: intent.txHash.toUpperCase() }]);
    expect(rows).toHaveLength(1);
  });

  it("drops a log whose actor the contract did not record, rather than guessing one", () => {
    // MarketClosed names no address. A row here would need an invented `signed by` value, and
    // that column is the page's trust claim.
    const rows = mergeLifecycle(
      [],
      [{ eventName: "MarketClosed", args: { marketId: "2", closedAt: "1" }, txHash: "0xab", blockNumber: 1, blockTime: null }],
    );
    expect(rows).toEqual([]);
  });

  it("ignores an undecoded log", () => {
    const rows = mergeLifecycle(
      [],
      [{ eventName: null, args: null, txHash: "0xcd", blockNumber: 1, blockTime: null }],
    );
    expect(rows).toEqual([]);
  });

  it("sorts an unmined intent last rather than first", () => {
    const pending = { ...intent, txHash: null, blockNumber: null, status: "PENDING" };
    const rows = mergeLifecycle([pending], [betLog]);
    expect(rows[rows.length - 1].status).toBe("PENDING");
  });
});
