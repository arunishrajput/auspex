/**
 * Every branch of the policy gate.
 *
 * The gate is pure, so this file needs no chain, no database, no model and no clock — which is
 * the entire argument for it being pure. If any test here ever needs `vi.mock`, something has
 * leaked into `policyGate.ts` that does not belong there.
 *
 * Three things are asserted beyond "the right branch fires":
 *
 *  1. **Exactly at a cap is allowed, one wei over is clamped.** The contract draws the same line
 *     (`placeBet` accepts `msg.value == perTxCap` and reverts on `perTxCap + 1`), and a gate
 *     that drew it one wei differently would either reject legitimate bets or hand the chain a
 *     transaction it is going to refuse.
 *  2. **REJECT versus DEFER.** A `REJECT` writes a row that is terminal for that
 *     (market, member, round); a `DEFER` writes nothing. Getting these the wrong way round
 *     either bars an agent from a market forever because a wallet was briefly unfunded, or
 *     silently re-asks a model the same question every tick. The verdict is load-bearing.
 *  3. **Approvals carry reasons too.** A gate that only explains itself when it says no cannot
 *     show that a clamp happened, and the clamp is the interesting half.
 */

import { describe, expect, it } from "vitest";
import {
  MIN_SECONDS_BEFORE_CLOSE,
  MIN_STAKE_WEI,
  policyGate,
  remainingDailyBudget,
  requestedStake,
  screenAgent,
  spendableBalance,
  type GateInput,
  type ScreenInput,
} from "./policyGate";

/** 2026-09-29T12:00:00Z in unix seconds. Injected everywhere; nothing reads a clock. */
const NOW = 1_790_683_200;

const TMSTC = 10n ** 18n;
/** 0.01 tMSTC — the off-chain per-tx cap used throughout. */
const PER_TX = TMSTC / 100n;
const OWNER = "0xa9f68fdf84388fa548a685085e2bee0e5b311ff1";

function screenInput(overrides: Partial<ScreenInput> = {}): ScreenInput {
  return {
    globalKillSwitch: false,
    policy: {
      perTxCapWei: PER_TX,
      dailyBudgetWei: PER_TX * 3n,
      minConfidence: 0.6,
      allowedCategories: ["POLITICS", "ECONOMY", "WORLD"],
      killSwitch: false,
    },
    market: { onchainId: 4, category: "ECONOMY", closeTime: NOW + 86_400, state: "OPEN" },
    onChain: {
      registered: true,
      active: true,
      perTxCapWei: PER_TX * 2n,
      perMarketCapWei: PER_TX * 4n,
      remainingOnMarketWei: PER_TX * 4n,
      owner: OWNER,
    },
    spentTodayWei: 0n,
    agentBalanceWei: TMSTC / 10n,
    gasReserveWei: TMSTC / 1000n,
    memberOwnerAddress: OWNER,
    now: NOW,
    ...overrides,
  };
}

function gateInput(overrides: Partial<GateInput> = {}): GateInput {
  return {
    ...screenInput(),
    proposal: {
      side: "YES",
      confidence: 0.8,
      stakeFraction: 0.5,
      sourceLabels: ["SOURCE_1", "SOURCE_2"],
    },
    issuedLabels: ["SOURCE_1", "SOURCE_2", "SOURCE_3"],
    ...overrides,
  };
}

/** The reason code of every reason, so assertions do not depend on prose. */
function codes(reasons: readonly string[]): string[] {
  return reasons.map((reason) => reason.split(":")[0]);
}

// ---------------------------------------------------------------------------
// The arithmetic helpers
// ---------------------------------------------------------------------------

describe("requestedStake", () => {
  it("turns a fraction of the cap into wei", () => {
    expect(requestedStake(PER_TX, 0.5)).toBe(PER_TX / 2n);
    expect(requestedStake(PER_TX, 1)).toBe(PER_TX);
    expect(requestedStake(PER_TX, 0.25)).toBe(PER_TX / 4n);
  });

  it("can never exceed the cap, whatever the model emits", () => {
    // Zod bounds this to [0, 1] already; the gate does not rely on that having happened.
    expect(requestedStake(PER_TX, 5)).toBe(PER_TX);
    expect(requestedStake(PER_TX, 1e30)).toBe(PER_TX);
  });

  it("treats zero, negative and non-finite fractions as zero", () => {
    expect(requestedStake(PER_TX, 0)).toBe(0n);
    expect(requestedStake(PER_TX, -0.5)).toBe(0n);
    expect(requestedStake(PER_TX, Number.NaN)).toBe(0n);
    // Infinity stakes NOTHING rather than the cap. A nonsense fraction is a broken proposal, and
    // the fail-safe reading of a broken proposal is no bet — it then fails STAKE_TOO_SMALL and is
    // recorded. Clamping it to the cap would turn garbage into the largest bet allowed.
    expect(requestedStake(PER_TX, Number.POSITIVE_INFINITY)).toBe(0n);
  });

  it("rounds to basis points, so the same fraction always gives the same wei", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in binary floating point. Both must land on 3000 bp.
    expect(requestedStake(PER_TX, 0.1 + 0.2)).toBe(requestedStake(PER_TX, 0.3));
    // Below half a basis point rounds to nothing rather than to a dust stake.
    expect(requestedStake(PER_TX, 0.00004)).toBe(0n);
  });
});

describe("remainingDailyBudget and spendableBalance", () => {
  it("never go negative, however far past the limit the inputs are", () => {
    expect(remainingDailyBudget({ dailyBudgetWei: 100n, spentTodayWei: 250n })).toBe(0n);
    expect(spendableBalance({ agentBalanceWei: 10n, gasReserveWei: 99n })).toBe(0n);
  });

  it("subtract exactly", () => {
    expect(remainingDailyBudget({ dailyBudgetWei: 100n, spentTodayWei: 30n })).toBe(70n);
    expect(spendableBalance({ agentBalanceWei: 100n, gasReserveWei: 30n })).toBe(70n);
  });
});

// ---------------------------------------------------------------------------
// screenAgent — the checks that happen before a model is asked anything
// ---------------------------------------------------------------------------

describe("screenAgent — the clear path", () => {
  it("proceeds with no reasons when nothing is wrong", () => {
    expect(screenAgent(screenInput())).toEqual({ verdict: "PROCEED", reasons: [] });
  });
});

describe("screenAgent — DEFER: true now, not forever, so no row is written", () => {
  it("defers on the global kill switch", () => {
    const result = screenAgent(screenInput({ globalKillSwitch: true }));
    expect(result.verdict).toBe("DEFER");
    expect(codes(result.reasons)).toEqual(["GLOBAL_KILL_SWITCH"]);
  });

  it("defers on the member's own kill switch", () => {
    const result = screenAgent(
      screenInput({ policy: { ...screenInput().policy, killSwitch: true } }),
    );
    expect(result.verdict).toBe("DEFER");
    expect(codes(result.reasons)).toEqual(["MEMBER_KILL_SWITCH"]);
    // The claim the exit criterion rests on: the contract was not involved.
    expect(result.reasons[0]).toContain("off-chain flag");
  });

  it("defers when the contract has never heard of the agent", () => {
    const result = screenAgent(
      screenInput({ onChain: { ...screenInput().onChain, registered: false } }),
    );
    expect(result.verdict).toBe("DEFER");
    expect(codes(result.reasons)).toEqual(["AGENT_NOT_REGISTERED"]);
  });

  it("defers when the contract has deactivated the agent", () => {
    const result = screenAgent(
      screenInput({ onChain: { ...screenInput().onChain, active: false } }),
    );
    expect(result.verdict).toBe("DEFER");
    expect(codes(result.reasons)).toEqual(["AGENT_INACTIVE"]);
  });

  it("defers when the chain would pay winnings to an address we do not expect", () => {
    const result = screenAgent(
      screenInput({
        onChain: { ...screenInput().onChain, owner: "0xdead00000000000000000000000000000000beef" },
      }),
    );
    expect(result.verdict).toBe("DEFER");
    expect(codes(result.reasons)).toEqual(["OWNER_MISMATCH"]);
  });

  it("compares owner addresses case-insensitively", () => {
    const result = screenAgent(screenInput({ memberOwnerAddress: OWNER.toUpperCase() }));
    expect(result.verdict).toBe("PROCEED");
  });

  it("defers when the daily budget is spent, because it resets at midnight", () => {
    const result = screenAgent(screenInput({ spentTodayWei: PER_TX * 3n }));
    expect(result.verdict).toBe("DEFER");
    expect(codes(result.reasons)).toEqual(["DAILY_BUDGET_SPENT"]);
  });

  it("defers when the wallet cannot cover the minimum stake on top of its gas reserve", () => {
    const result = screenAgent(
      screenInput({ agentBalanceWei: MIN_STAKE_WEI, gasReserveWei: MIN_STAKE_WEI }),
    );
    expect(result.verdict).toBe("DEFER");
    expect(codes(result.reasons)).toEqual(["INSUFFICIENT_BALANCE"]);
  });
});

describe("screenAgent — REJECT: terminal, so the row is written and kept", () => {
  it("rejects a market the chain no longer reports as OPEN", () => {
    const result = screenAgent(
      screenInput({ market: { ...screenInput().market, state: "CLOSED" } }),
    );
    expect(result.verdict).toBe("REJECT");
    expect(codes(result.reasons)).toEqual(["MARKET_NOT_OPEN"]);
  });

  it("rejects a market whose betting has already closed", () => {
    const result = screenAgent(
      screenInput({ market: { ...screenInput().market, closeTime: NOW - 30 } }),
    );
    expect(result.verdict).toBe("REJECT");
    expect(codes(result.reasons)).toEqual(["MARKET_CLOSED"]);
    expect(result.reasons[0]).toContain("BettingClosed()");
  });

  it("rejects a market closing inside the safety margin rather than racing the chain", () => {
    const result = screenAgent(
      screenInput({
        market: { ...screenInput().market, closeTime: NOW + MIN_SECONDS_BEFORE_CLOSE - 1 },
      }),
    );
    expect(result.verdict).toBe("REJECT");
    expect(codes(result.reasons)).toEqual(["MARKET_CLOSING"]);
  });

  it("allows a market exactly at the safety margin", () => {
    const result = screenAgent(
      screenInput({
        market: { ...screenInput().market, closeTime: NOW + MIN_SECONDS_BEFORE_CLOSE },
      }),
    );
    expect(result.verdict).toBe("PROCEED");
  });

  it("rejects a category that is not on the member's allowlist", () => {
    const result = screenAgent(
      screenInput({ market: { ...screenInput().market, category: "SPORT" } }),
    );
    expect(result.verdict).toBe("REJECT");
    expect(codes(result.reasons)).toEqual(["CATEGORY_NOT_ALLOWED"]);
  });

  it("rejects when the contract reports no headroom left on this market", () => {
    const result = screenAgent(
      screenInput({
        onChain: { ...screenInput().onChain, remainingOnMarketWei: MIN_STAKE_WEI - 1n },
      }),
    );
    expect(result.verdict).toBe("REJECT");
    expect(codes(result.reasons)).toEqual(["PER_MARKET_CAP_SPENT"]);
  });

  it("does NOT read an unregistered agent's zero headroom as a spent cap", () => {
    // `agentRemainingOnMarket` returns 0 for an unknown agent. Treating that as terminal would
    // bar an agent from a market for ever because a setup transaction had not run yet.
    const result = screenAgent(
      screenInput({
        onChain: { ...screenInput().onChain, registered: false, remainingOnMarketWei: 0n },
      }),
    );
    expect(result.verdict).toBe("DEFER");
    expect(codes(result.reasons)).toEqual(["AGENT_NOT_REGISTERED"]);
  });

  it("does NOT read a deactivated agent's zero headroom as a spent cap either", () => {
    const result = screenAgent(
      screenInput({
        onChain: { ...screenInput().onChain, active: false, remainingOnMarketWei: 0n },
      }),
    );
    expect(result.verdict).toBe("DEFER");
    expect(codes(result.reasons)).toEqual(["AGENT_INACTIVE"]);
  });
});

describe("screenAgent — collecting reasons", () => {
  it("reports every failing rule, not the first", () => {
    const result = screenAgent(
      screenInput({
        globalKillSwitch: true,
        market: { ...screenInput().market, category: "SPORT", state: "FINALIZED" },
      }),
    );
    expect(codes(result.reasons)).toEqual([
      "MARKET_NOT_OPEN",
      "CATEGORY_NOT_ALLOWED",
      "GLOBAL_KILL_SWITCH",
    ]);
  });

  it("lets a terminal reason win over a transient one", () => {
    // A closed market plus an unfunded wallet is terminal: funding the wallet changes nothing.
    const result = screenAgent(
      screenInput({
        market: { ...screenInput().market, state: "CLOSED" },
        agentBalanceWei: 0n,
      }),
    );
    expect(result.verdict).toBe("REJECT");
    expect(codes(result.reasons)).toContain("MARKET_NOT_OPEN");
    expect(codes(result.reasons)).toContain("INSUFFICIENT_BALANCE");
  });
});

// ---------------------------------------------------------------------------
// policyGate — the proposal-dependent rules
// ---------------------------------------------------------------------------

describe("policyGate — approving", () => {
  it("allows a clean proposal and stakes the requested amount", () => {
    const result = policyGate(gateInput());
    expect(result.allow).toBe(true);
    expect(result.verdict).toBe("PROCEED");
    expect(result.requestedStakeWei).toBe(PER_TX / 2n);
    expect(result.finalStakeWei).toBe(PER_TX / 2n);
    expect(result.boundBy).toBeNull();
  });

  it("explains itself when it approves, not only when it refuses", () => {
    const result = policyGate(gateInput());
    expect(codes(result.reasons)).toContain("APPROVED");
    expect(result.reasons[0]).toContain("YES");
    expect(result.reasons[0]).toContain("market #4");
  });

  it("re-runs the screen itself, so a caller that skipped it still gets the full check", () => {
    const result = policyGate(gateInput({ globalKillSwitch: true }));
    expect(result.allow).toBe(false);
    expect(result.verdict).toBe("DEFER");
    expect(codes(result.reasons)).toEqual(["GLOBAL_KILL_SWITCH"]);
    expect(result.finalStakeWei).toBe(0n);
    // The requested amount is still reported, so the UI can show what was asked for.
    expect(result.requestedStakeWei).toBe(PER_TX / 2n);
  });
});

describe("policyGate — rejecting the model's answer", () => {
  it("rejects an abstention, and says abstaining was the right thing to do", () => {
    const result = policyGate(
      gateInput({ proposal: { ...gateInput().proposal, side: "ABSTAIN" } }),
    );
    expect(result.allow).toBe(false);
    expect(result.verdict).toBe("REJECT");
    expect(codes(result.reasons)).toEqual(["ABSTAINED"]);
  });

  it("rejects confidence below the member's threshold", () => {
    const result = policyGate(
      gateInput({ proposal: { ...gateInput().proposal, confidence: 0.59 } }),
    );
    expect(result.verdict).toBe("REJECT");
    expect(codes(result.reasons)).toEqual(["CONFIDENCE_BELOW_THRESHOLD"]);
    expect(result.reasons[0]).toContain("not the model's");
  });

  it("allows confidence exactly at the threshold", () => {
    const result = policyGate(gateInput({ proposal: { ...gateInput().proposal, confidence: 0.6 } }));
    expect(result.allow).toBe(true);
  });

  it("rejects a source label we never issued", () => {
    const result = policyGate(
      gateInput({
        proposal: { ...gateInput().proposal, sourceLabels: ["SOURCE_1", "SOURCE_9"] },
      }),
    );
    expect(result.verdict).toBe("REJECT");
    expect(codes(result.reasons)).toEqual(["UNISSUED_SOURCE_LABEL"]);
    expect(result.reasons[0]).toContain("SOURCE_9");
  });

  it("accepts a proposal that cites no sources at all — that is a weak bet, not a forged one", () => {
    const result = policyGate(gateInput({ proposal: { ...gateInput().proposal, sourceLabels: [] } }));
    expect(result.allow).toBe(true);
  });

  it("rejects a stake too small to be worth a transaction", () => {
    const result = policyGate(
      gateInput({ proposal: { ...gateInput().proposal, stakeFraction: 0.001 } }),
    );
    expect(result.verdict).toBe("REJECT");
    expect(codes(result.reasons)).toEqual(["STAKE_TOO_SMALL"]);
  });

  it("reports every failing rule about the proposal at once", () => {
    const result = policyGate(
      gateInput({
        proposal: {
          side: "NO",
          confidence: 0.1,
          stakeFraction: 0.0001,
          sourceLabels: ["SOURCE_42"],
        },
      }),
    );
    expect(codes(result.reasons)).toEqual([
      "CONFIDENCE_BELOW_THRESHOLD",
      "UNISSUED_SOURCE_LABEL",
      "STAKE_TOO_SMALL",
    ]);
  });

  it("says only that the agent abstained, whatever else its answer contained", () => {
    // Found on the first live pass: an abstaining model sends confidence and stakeFraction that
    // describe no position, and the row then carried three reasons of which one was about
    // anything. An abstention subsumes every later check.
    const result = policyGate(
      gateInput({
        proposal: { side: "ABSTAIN", confidence: 0, stakeFraction: 0, sourceLabels: ["SOURCE_99"] },
      }),
    );
    expect(codes(result.reasons)).toEqual(["ABSTAINED"]);
  });

  it("still reports the requested stake on an abstention, so the UI can show what was asked", () => {
    const result = policyGate(
      gateInput({
        proposal: { side: "ABSTAIN", confidence: 1, stakeFraction: 0.5, sourceLabels: [] },
      }),
    );
    expect(result.allow).toBe(false);
    expect(result.requestedStakeWei).toBe(PER_TX / 2n);
    expect(result.finalStakeWei).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// The clamp — the part that decides how much money moves
// ---------------------------------------------------------------------------

describe("policyGate — clamping", () => {
  it("allows exactly the off-chain per-tx cap and reports it as at-limit, not clamped", () => {
    const result = policyGate(gateInput({ proposal: { ...gateInput().proposal, stakeFraction: 1 } }));
    expect(result.allow).toBe(true);
    expect(result.finalStakeWei).toBe(PER_TX);
    expect(result.boundBy).toBeNull();
    expect(codes(result.reasons)).toContain("AT_LIMIT_POLICY_PER_TX_CAP");
    expect(result.reasons.some((r) => r.startsWith("CLAMPED_BY"))).toBe(false);
  });

  it("clamps to the remaining daily budget when that is the tightest limit", () => {
    const result = policyGate(
      gateInput({
        // 0.03 budget, 0.028 already spent → 0.002 left, against a 0.01 request.
        spentTodayWei: PER_TX * 3n - PER_TX / 5n,
        proposal: { ...gateInput().proposal, stakeFraction: 1 },
      }),
    );
    expect(result.allow).toBe(true);
    expect(result.finalStakeWei).toBe(PER_TX / 5n);
    expect(result.boundBy).toBe("DAILY_BUDGET");
    expect(codes(result.reasons)).toContain("CLAMPED_BY_DAILY_BUDGET");
  });

  it("clamps to the contract's per-tx cap when the policy is looser than the chain", () => {
    const result = policyGate(
      gateInput({
        onChain: { ...gateInput().onChain, perTxCapWei: PER_TX / 4n },
        proposal: { ...gateInput().proposal, stakeFraction: 1 },
      }),
    );
    expect(result.finalStakeWei).toBe(PER_TX / 4n);
    expect(result.boundBy).toBe("ONCHAIN_PER_TX_CAP");
  });

  it("clamps to the contract's remaining per-market headroom", () => {
    const result = policyGate(
      gateInput({
        onChain: { ...gateInput().onChain, remainingOnMarketWei: PER_TX / 8n },
        proposal: { ...gateInput().proposal, stakeFraction: 1 },
      }),
    );
    expect(result.finalStakeWei).toBe(PER_TX / 8n);
    expect(result.boundBy).toBe("ONCHAIN_PER_MARKET_CAP");
  });

  it("clamps to what the wallet can actually pay after its gas reserve", () => {
    const result = policyGate(
      gateInput({
        agentBalanceWei: PER_TX / 2n + MIN_STAKE_WEI,
        gasReserveWei: MIN_STAKE_WEI,
        proposal: { ...gateInput().proposal, stakeFraction: 1 },
      }),
    );
    expect(result.finalStakeWei).toBe(PER_TX / 2n);
    expect(result.boundBy).toBe("AGENT_BALANCE");
  });

  it("names every limit that binds, not only the one that won", () => {
    // Daily budget and the chain's per-tx cap are both below the request; the chain's is lower.
    const result = policyGate(
      gateInput({
        spentTodayWei: PER_TX * 3n - PER_TX / 2n,
        onChain: { ...gateInput().onChain, perTxCapWei: PER_TX / 4n },
        proposal: { ...gateInput().proposal, stakeFraction: 1 },
      }),
    );
    expect(result.finalStakeWei).toBe(PER_TX / 4n);
    expect(result.boundBy).toBe("ONCHAIN_PER_TX_CAP");
    expect(codes(result.reasons)).toContain("CLAMPED_BY_DAILY_BUDGET");
    expect(codes(result.reasons)).toContain("CLAMPED_BY_ONCHAIN_PER_TX_CAP");
  });

  it("takes the smallest of six limits, whichever one it is", () => {
    const result = policyGate(
      gateInput({
        policy: { ...gateInput().policy, perTxCapWei: PER_TX, dailyBudgetWei: PER_TX * 10n },
        onChain: {
          ...gateInput().onChain,
          perTxCapWei: PER_TX * 9n,
          remainingOnMarketWei: MIN_STAKE_WEI * 3n,
        },
        agentBalanceWei: PER_TX * 5n,
        proposal: { ...gateInput().proposal, stakeFraction: 1 },
      }),
    );
    expect(result.finalStakeWei).toBe(MIN_STAKE_WEI * 3n);
    expect(result.boundBy).toBe("ONCHAIN_PER_MARKET_CAP");
  });
});

describe("policyGate — the boundary the contract also draws", () => {
  /**
   * `AuspexMarket.placeBet` accepts `msg.value == perTxCap` and reverts
   * `AgentPerTxCapExceeded` on `perTxCap + 1`. The gate has to land on the same wei, because a
   * gate one wei looser hands the chain a transaction it will refuse, and one wei tighter
   * rejects a bet the chain would have taken.
   */
  const onChainCap = PER_TX;

  function atOnChainCap(requestedWei: bigint): GateInput {
    return gateInput({
      // The off-chain cap is set to the requested amount so the fraction is exactly 1 and the
      // on-chain cap is the only limit under test.
      policy: { ...gateInput().policy, perTxCapWei: requestedWei, dailyBudgetWei: requestedWei * 10n },
      onChain: {
        ...gateInput().onChain,
        perTxCapWei: onChainCap,
        remainingOnMarketWei: onChainCap * 4n,
      },
      agentBalanceWei: onChainCap * 10n,
      proposal: { ...gateInput().proposal, stakeFraction: 1 },
    });
  }

  it("passes a request of exactly the on-chain cap through unreduced", () => {
    const result = policyGate(atOnChainCap(onChainCap));
    expect(result.allow).toBe(true);
    expect(result.finalStakeWei).toBe(onChainCap);
    expect(result.boundBy).toBeNull();
    expect(codes(result.reasons)).toContain("AT_LIMIT_ONCHAIN_PER_TX_CAP");
  });

  it("clamps a request one wei over the on-chain cap back down to the cap", () => {
    const result = policyGate(atOnChainCap(onChainCap + 1n));
    expect(result.allow).toBe(true);
    // The wei that would have reverted is removed here rather than on chain.
    expect(result.finalStakeWei).toBe(onChainCap);
    expect(result.boundBy).toBe("ONCHAIN_PER_TX_CAP");
    expect(codes(result.reasons)).toContain("CLAMPED_BY_ONCHAIN_PER_TX_CAP");
  });

  it("never emits a stake above the on-chain cap, for any fraction", () => {
    for (const stakeFraction of [0.05, 0.5, 0.9999, 1]) {
      const input = atOnChainCap(onChainCap * 3n);
      const result = policyGate({
        ...input,
        proposal: { ...input.proposal, stakeFraction },
      });
      expect(result.finalStakeWei).toBeLessThanOrEqual(onChainCap);
    }
  });
});

describe("policyGate — purity", () => {
  it("returns the same decision for the same input, twice", () => {
    const input = gateInput();
    expect(policyGate(input)).toEqual(policyGate(input));
  });

  it("does not mutate its input", () => {
    const input = gateInput();
    const snapshot = JSON.stringify(input, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    policyGate(input);
    expect(
      JSON.stringify(input, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ).toBe(snapshot);
  });

  it("depends on the injected time, not on the real one", () => {
    // Same market, two different injected instants: open in one, closed in the other.
    const open = screenAgent(screenInput({ now: NOW }));
    const closed = screenAgent(screenInput({ now: NOW + 86_400 }));
    expect(open.verdict).toBe("PROCEED");
    expect(closed.verdict).toBe("REJECT");
  });
});
