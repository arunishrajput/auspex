import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/mst-testnet-logs.json";
import { projectMarkets } from "./project";
import type { DecodedLog } from "./decode";

/**
 * The indexer's projection, tested against logs captured from MST Testnet.
 *
 * `__fixtures__/mst-testnet-logs.json` is not hand-written. It is the real output of
 * `eth_getLogs` against `0xc4743d…104C` on chain 91562037, decoded through the committed ABI
 * (`pnpm --filter web fixtures:capture` regenerates it). Testing against invented logs would
 * only prove the projection agrees with my beliefs about the contract — which is precisely
 * the belief a bug would share.
 *
 * Phase 2's exit criterion "the indexer ingests the Phase 1 smoke-test events and
 * reconstructs correct market state" is the first two tests below.
 */

const REAL_LOGS = fixtures as unknown as DecodedLog[];

/** Builds a synthetic log for a lifecycle stage the chain has not reached yet. */
function log(
  eventName: string,
  args: Record<string, string | boolean>,
  blockNumber: number,
  logIndex = 0,
): DecodedLog {
  return {
    txHash: `0x${blockNumber.toString(16).padStart(64, "0")}`,
    logIndex,
    blockNumber,
    blockHash: `0x${"b".repeat(64)}`,
    address: "0xc4743d6295311afead12161881bfcf601b70104c",
    topic0: `0x${"t".repeat(64)}`,
    rawTopics: [],
    rawData: "0x",
    eventName,
    args,
  };
}

const CREATED = log(
  "MarketCreated",
  {
    marketId: "42",
    specHash: `0x${"1".repeat(64)}`,
    creator: "0xC71Dc478040f7a6BCC5cb1F316a4A446f7d4Ad24",
    question: "Will the projection hold?",
    resolutionSourceUrl: "https://example.org/source",
    closeTime: "1800000000",
    resolveDeadline: "1800003600",
  },
  100,
);

describe("projectMarkets — against real MST Testnet logs", () => {
  it("reconstructs every market that exists on chain", () => {
    const { markets, undecodable } = projectMarkets(REAL_LOGS);

    // If this ever fails, the committed ABI and the deployed contract have diverged.
    expect(undecodable).toBe(0);

    const created = REAL_LOGS.filter((l) => l.eventName === "MarketCreated").length;
    expect(markets.size).toBe(created);
    expect(markets.size).toBeGreaterThanOrEqual(3);

    // Ids are assigned by the contract from 1 upward, with no gaps.
    expect([...markets.keys()].sort((a, b) => a - b)).toEqual(
      Array.from({ length: markets.size }, (_, i) => i + 1),
    );
  });

  it("sums the smoke-test bets into the right pool", () => {
    const { markets } = projectMarkets(REAL_LOGS);

    // Recompute the expected pools straight from the BetPlaced logs, so this asserts the
    // fold rather than a number I copied out of one run.
    for (const [id, market] of markets) {
      let yes = 0n;
      let no = 0n;
      for (const l of REAL_LOGS) {
        if (l.eventName !== "BetPlaced" || l.args === null) continue;
        if (Number(l.args.marketId) !== id) continue;
        if (l.args.backsYes === true) yes += BigInt(String(l.args.amount));
        else no += BigInt(String(l.args.amount));
      }
      expect(market.poolYesWei).toBe(yes);
      expect(market.poolNoWei).toBe(no);
      expect(market.bets.length).toBe(
        REAL_LOGS.filter(
          (l) => l.eventName === "BetPlaced" && Number(l.args?.marketId) === id,
        ).length,
      );
    }
  });

  it("counts role grants as real events that simply are not market state", () => {
    const { unprojected } = projectMarkets(REAL_LOGS);
    const nonMarket = REAL_LOGS.filter(
      (l) =>
        l.eventName !== null &&
        ![
          "MarketCreated",
          "BetPlaced",
          "MarketClosed",
          "ResolutionProposed",
          "ResolutionChallenged",
          "MarketFinalized",
          "MarketInvalidated",
        ].includes(l.eventName),
    ).length;

    // Every input lands in exactly one tally — nothing is silently dropped.
    expect(unprojected).toBe(nonMarket);
    expect(nonMarket).toBeGreaterThan(0);
  });

  it("is idempotent: feeding it the same logs twice gives the same state", () => {
    const once = projectMarkets(REAL_LOGS);
    const twice = projectMarkets([...REAL_LOGS, ...REAL_LOGS]);

    expect(twice.markets.size).toBe(once.markets.size);
    expect(twice.duplicates).toBe(REAL_LOGS.length);

    for (const [id, market] of once.markets) {
      const replayed = twice.markets.get(id);
      expect(replayed).toBeDefined();
      // The one that matters. `BetPlaced` ADDS to a pool, so a duplicated log is the case
      // where a replay silently doubles someone's money. The fold discards a repeated
      // (txHash, logIndex) rather than relying on its caller to have deduplicated.
      expect(replayed?.poolYesWei).toBe(market.poolYesWei);
      expect(replayed?.poolNoWei).toBe(market.poolNoWei);
      expect(replayed?.state).toBe(market.state);
    }
  });

  it("does not depend on the order logs arrive in", () => {
    const inOrder = projectMarkets(REAL_LOGS);
    const shuffled = projectMarkets([...REAL_LOGS].reverse());

    for (const [id, market] of inOrder.markets) {
      expect(shuffled.markets.get(id)?.poolYesWei).toBe(market.poolYesWei);
      expect(shuffled.markets.get(id)?.state).toBe(market.state);
    }
  });
});

describe("projectMarkets — lifecycle stages the chain has not reached yet", () => {
  it("MarketClosed moves OPEN to CLOSED", () => {
    const { markets } = projectMarkets([CREATED, log("MarketClosed", { marketId: "42" }, 101)]);
    expect(markets.get(42)?.state).toBe("CLOSED");
  });

  it("ResolutionProposed records the outcome, evidence and challenge deadline", () => {
    const { markets } = projectMarkets([
      CREATED,
      log("MarketClosed", { marketId: "42" }, 101),
      log(
        "ResolutionProposed",
        {
          marketId: "42",
          resolver: "0xAbC0000000000000000000000000000000000001",
          outcome: "1",
          evidenceUrl: "https://example.org/evidence",
          challengeEndsAt: "1800004000",
        },
        102,
      ),
    ]);

    const market = markets.get(42);
    expect(market?.state).toBe("RESOLUTION_PROPOSED");
    expect(market?.outcome).toBe("YES");
    expect(market?.evidenceUrl).toBe("https://example.org/evidence");
    expect(market?.challengeEndsAt).toBe(1800004000);
    // Lowercased on the way in, so address comparisons downstream never depend on checksum.
    expect(market?.proposedBy).toBe("0xabc0000000000000000000000000000000000001");
  });

  it("a challenge discards the proposed outcome but keeps the count", () => {
    const { markets } = projectMarkets([
      CREATED,
      log("MarketClosed", { marketId: "42" }, 101),
      log(
        "ResolutionProposed",
        {
          marketId: "42",
          resolver: "0xAbC0000000000000000000000000000000000001",
          outcome: "1",
          evidenceUrl: "https://example.org/evidence",
          challengeEndsAt: "1800004000",
        },
        102,
      ),
      log(
        "ResolutionChallenged",
        { marketId: "42", challenger: "0xAbC0000000000000000000000000000000000002", reason: "wrong" },
        103,
      ),
    ]);

    const market = markets.get(42);
    // Matches AuspexMarket.challengeResolution exactly: back to CLOSED, outcome discarded.
    expect(market?.state).toBe("CLOSED");
    expect(market?.outcome).toBe("UNRESOLVED");
    expect(market?.proposedBy).toBeNull();
    // The count survives — forceInvalidate needs three of them (ADR-022).
    expect(market?.challengeCount).toBe(1);
  });

  it("finalisation and invalidation are terminal", () => {
    const finalized = projectMarkets([
      CREATED,
      log("MarketFinalized", { marketId: "42", outcome: "2" }, 110),
    ]);
    expect(finalized.markets.get(42)?.state).toBe("FINALIZED");
    expect(finalized.markets.get(42)?.outcome).toBe("NO");

    const invalidated = projectMarkets([
      CREATED,
      log("MarketInvalidated", { marketId: "42", reason: "resolver never appeared" }, 110),
    ]);
    expect(invalidated.markets.get(42)?.state).toBe("INVALIDATED");
    expect(invalidated.markets.get(42)?.outcome).toBe("INVALID");
    expect(invalidated.markets.get(42)?.invalidationReason).toBe("resolver never appeared");
  });

  it("refuses to invent a market from an orphaned bet", () => {
    const { markets, unprojected } = projectMarkets([
      log(
        "BetPlaced",
        { marketId: "99", bettor: "0xabc", backsYes: true, amount: "1000", isAgent: false },
        100,
      ),
    ]);
    // A bet for a market we never saw created means the log stream is incomplete. Creating a
    // question-less market here would put fabricated data on the page.
    expect(markets.size).toBe(0);
    expect(unprojected).toBe(1);
  });

  it("keeps a uint256 pool exact past Number.MAX_SAFE_INTEGER", () => {
    const huge = 10_000_000_000_000_000_001n; // > 2^53, and not representable as a double
    const { markets } = projectMarkets([
      CREATED,
      log(
        "BetPlaced",
        {
          marketId: "42",
          bettor: "0xabc",
          backsYes: true,
          amount: huge.toString(),
          isAgent: true,
        },
        101,
      ),
    ]);
    expect(markets.get(42)?.poolYesWei).toBe(huge);
  });
});
