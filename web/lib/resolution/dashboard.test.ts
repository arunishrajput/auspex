/**
 * What `/resolve` says about a market nobody has settled.
 *
 * This is the page's answer to "why is that market still sitting there", and it was previously
 * no answer at all: a closed market with no draft row appeared nowhere on `/resolve`, so markets
 * #2 and #3 were invisible on the page whose entire job is unsettled markets, while `/markets`
 * showed them as CLOSED. The cases below are built from those two markets' real shapes.
 */

import { describe, expect, it } from "vitest";
import { describeUnresolved } from "./dashboard";
import { STALE_GRACE_SECONDS } from "./settle";
import type { OnChainMarket } from "../chain/auspex";

const DEADLINE = 1_790_618_054; // market #2's real resolveDeadline

type Chain = Pick<
  OnChainMarket,
  "state" | "closeTime" | "resolveDeadline" | "poolYesWei" | "poolNoWei"
>;

function chain(over: Partial<Chain> = {}): Chain {
  return {
    state: "CLOSED",
    closeTime: DEADLINE - 1800,
    resolveDeadline: DEADLINE,
    poolYesWei: 10_000_000_000_000_000n,
    poolNoWei: 0n,
    ...over,
  };
}

describe("describeUnresolved", () => {
  it("marks a market past its resolve-by time as one that will be invalidated", () => {
    const result = describeUnresolved(chain(), DEADLINE + STALE_GRACE_SECONDS + 1, false);
    expect(result?.stage).toBe("PAST_RESOLVE_BY");
    expect(result?.note).toContain("will be invalidated");
    expect(result?.note).toContain("The keeper calls invalidateStale on its next pass");
  });

  it("names the exact wei a refund returns, so the page cannot round it away", () => {
    // Market #2's 0.01 tMSTC. The number a reader checks against the pool on /markets.
    const result = describeUnresolved(chain(), DEADLINE + STALE_GRACE_SECONDS + 1, false);
    expect(result?.note).toContain("10000000000000000 wei is staked");
  });

  it("says plainly that an empty market owes no refund", () => {
    // Market #3: closed, nothing staked. Promising a refund here would be a lie in the safe
    // direction, which is still a lie.
    const result = describeUnresolved(
      chain({ poolYesWei: 0n, poolNoWei: 0n }),
      DEADLINE + STALE_GRACE_SECONDS + 1,
      false,
    );
    expect(result?.note).toContain("Nothing was staked on it");
  });

  it("says the keeper is still waiting while inside the grace period", () => {
    const result = describeUnresolved(chain(), DEADLINE + 60, false);
    expect(result?.stage).toBe("PAST_RESOLVE_BY");
    expect(result?.note).toContain("The keeper waits until");
  });

  it("explains that a market with no approved spec will never get a draft", () => {
    // The Phase 1/2 test markets. The resolution agent is right to skip them, and the page has to
    // say so rather than leaving a reader waiting for a draft that cannot come.
    const result = describeUnresolved(chain(), DEADLINE - 60, false);
    expect(result?.stage).toBe("AWAITING_DRAFT");
    expect(result?.note).toContain("will never draft");
  });

  it("explains that a real market is waiting for an article, not for us", () => {
    const result = describeUnresolved(chain(), DEADLINE - 60, true);
    expect(result?.stage).toBe("AWAITING_DRAFT");
    expect(result?.note).toContain("article published since close");
  });

  it("drops a market the chain has already moved past", () => {
    // The projection said CLOSED and the chain says otherwise. The chain wins, and the row is not
    // rendered at all — showing "will be invalidated" about a finalised market would be worse
    // than showing nothing.
    for (const state of ["RESOLUTION_PROPOSED", "FINALIZED", "INVALIDATED"] as const) {
      expect(describeUnresolved(chain({ state }), DEADLINE + 10_000, false)).toBeNull();
    }
  });

  it("treats an OPEN market past its deadline as stale, not as still running", () => {
    // `closeMarket` is cosmetic, so a market can sit OPEN past its resolve deadline. The contract
    // will invalidate it, and the page must agree.
    const result = describeUnresolved(
      chain({ state: "OPEN" }),
      DEADLINE + STALE_GRACE_SECONDS + 1,
      true,
    );
    expect(result?.stage).toBe("PAST_RESOLVE_BY");
  });
});
