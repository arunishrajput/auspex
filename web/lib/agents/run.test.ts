/**
 * The agent pass's deadline behaviour, tested without a database.
 *
 * `runAgentPass` itself needs Postgres and a chain, so it is exercised live rather than here (see
 * `scripts/verify-agents.ts` and the tick reports in PROGRESS.md). What *is* worth pinning in a
 * unit test is the deadline arithmetic, because its failure mode is silent: a tick that overruns
 * `maxDuration` is killed before it returns a report or writes its audit row, so the evidence that
 * anything went wrong is exactly what gets lost.
 *
 * These assert the contract the constants have to satisfy, not the plumbing that uses them.
 */

import { describe, expect, it } from "vitest";
import { GAS_RESERVE_WEI, MAX_DECISIONS_PER_PASS } from "./run";
import { MIN_STAKE_WEI } from "../policy/policyGate";

describe("the agents stage's bounds", () => {
  it("reserves more gas than the minimum stake, so a funded wallet can always bet once", () => {
    // If the reserve were below the minimum stake, a wallet holding exactly the reserve plus a
    // little would pass the balance screen and then be clamped to something unsendable.
    expect(GAS_RESERVE_WEI).toBeGreaterThan(MIN_STAKE_WEI);
  });

  it("takes a bounded number of decisions per pass", () => {
    // Unbounded work in a serverless function is one slow RPC away from being killed halfway.
    expect(MAX_DECISIONS_PER_PASS).toBeGreaterThan(0);
    expect(MAX_DECISIONS_PER_PASS).toBeLessThanOrEqual(8);
  });

  it("keeps the gas reserve small enough to be affordable at this chain's fees", () => {
    // baseFeePerGas is 0 and priority is 1 gwei, so a placeBet costs ~1e14 wei. A reserve of more
    // than a few times that would idle funds an agent could have staked.
    expect(GAS_RESERVE_WEI).toBeLessThanOrEqual(MIN_STAKE_WEI * 100n);
  });
});
