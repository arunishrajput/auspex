/**
 * The deadline ladder, which is the thing that decides whether a stage runs at all.
 *
 * These tests exist because of a defect that no test could have caught in the shape the code was
 * in. On both production ticks that had a genuinely resolvable market, the resolution stage logged
 *
 *     resolution halted: out of time for this tick after examining 0 market(s)
 *
 * and never called `readMarket` — so the chain was never consulted about a market that was holding
 * a stake against a resolve deadline. The cause was two numbers in a file agreeing with each other
 * and with nothing else: clustering had no deadline at all, only a call budget, and resolution's
 * deadline was 40% of the tick measured from the tick's start. Clustering spent the 40%.
 *
 * The ladder is now a pure function of three numbers, so the properties below are checkable rather
 * than argued. They are the two that a future edit could quietly break: the *order* stages get
 * their turn in, and the arithmetic that stops a call starting too late to finish.
 */

import { describe, expect, it } from "vitest";
import { stageDeadlines, type LlmStageName } from "./tick";

/** The production numbers: `maxDuration` on the route, and `GEMINI_TIMEOUT_MS`. */
const BUDGET = 60_000;
const TIMEOUT = 22_000;
/** What `scripts/tick.ts` passes, because a CLI run has no serverless limit. */
const CLI_BUDGET = 300_000;

const LLM_STAGES: LlmStageName[] = ["resolution", "cluster", "propose", "agents"];
const START = 1_000_000;

describe("the ladder cannot let a model call over-run the tick", () => {
  it("leaves room for one full-timeout call plus the tail, at the production budget", () => {
    const ladder = stageDeadlines(START, BUDGET, TIMEOUT);
    for (const stage of LLM_STAGES) {
      // A deadline is checked BEFORE a call starts, so the worst case is a call that begins one
      // millisecond inside the deadline and runs for the whole timeout.
      const worstCaseEnd = ladder[stage] + TIMEOUT;
      expect(worstCaseEnd).toBeLessThanOrEqual(START + BUDGET);
      // And it must not merely fit — it must leave the tail (intents, indexer, settle, notify and
      // the audit row) its room, because a tick killed before the audit insert leaves no trace.
      expect(START + BUDGET - worstCaseEnd).toBeGreaterThanOrEqual(8_000);
    }
  });

  it("is the property the old ladder did not have", () => {
    // Regression guard, stated as arithmetic rather than as a comment. The old fractions were
    // resolution 0.40 and agents 0.63; the agents figure put a call's worst-case end at exactly
    // the function's limit, leaving nothing for the audit row.
    const oldAgentsDeadline = START + Math.floor(BUDGET * 0.63);
    expect(oldAgentsDeadline + TIMEOUT).toBeGreaterThan(START + BUDGET - 8_000);

    const ladder = stageDeadlines(START, BUDGET, TIMEOUT);
    expect(ladder.agents).toBeLessThan(oldAgentsDeadline);
  });

  it("scales the same way for a CLI tick, where the clamp does not bind", () => {
    const ladder = stageDeadlines(START, CLI_BUDGET, TIMEOUT);
    // At 300s every fraction is far below the cutoff, so the ladder is its fractions — which is
    // what stops a local tick from silently doing less work than production (the Phase 8 defect).
    expect(ladder.resolution).toBe(START + 90_000);
    expect(ladder.agents).toBe(START + 150_000);
    for (const stage of LLM_STAGES) {
      expect(ladder[stage] + TIMEOUT).toBeLessThanOrEqual(START + CLI_BUDGET);
    }
  });

  it("declines every model stage when the budget cannot hold one call and the tail", () => {
    // 25s cannot contain a 22s call plus an 8s tail. The right answer is that no stage starts a
    // call and each says so — not a negative deadline, and not a crash.
    const ladder = stageDeadlines(START, 25_000, TIMEOUT);
    for (const stage of LLM_STAGES) {
      expect(ladder[stage]).toBe(START);
    }
    // The settle stage makes no model call, so it is bounded by its fraction and still runs.
    expect(ladder.settle).toBe(START + Math.floor(25_000 * 0.85));
  });
});

describe("the ladder's order is the fix, so the order is asserted", () => {
  it("gives resolution its turn before clustering and the proposer", () => {
    const ladder = stageDeadlines(START, BUDGET, TIMEOUT);
    // Resolution used to run fourth. A market that has closed is holding a stake against a resolve
    // deadline; a story that has not been clustered is holding nothing. ADR-075.
    expect(ladder.resolution).toBeLessThanOrEqual(ladder.cluster);
    expect(ladder.cluster).toBeLessThanOrEqual(ladder.propose);
    expect(ladder.propose).toBeLessThanOrEqual(ladder.agents);
    expect(ladder.agents).toBeLessThanOrEqual(ladder.settle);
  });

  it("gives resolution a deadline strictly earlier than the stages that used to starve it", () => {
    const ladder = stageDeadlines(START, CLI_BUDGET, TIMEOUT);
    // Checked at the CLI budget, where no clamp can collapse two stages onto the same value and
    // make a strict comparison accidentally true.
    expect(ladder.resolution).toBeLessThan(ladder.cluster);
    expect(ladder.cluster).toBeLessThan(ladder.propose);
    expect(ladder.propose).toBeLessThan(ladder.agents);
  });

  it("keeps every deadline inside the tick's own budget", () => {
    for (const budget of [30_000, BUDGET, 120_000, CLI_BUDGET]) {
      const ladder = stageDeadlines(START, budget, TIMEOUT);
      for (const value of Object.values(ladder)) {
        expect(value).toBeGreaterThanOrEqual(START);
        expect(value).toBeLessThanOrEqual(START + budget);
      }
    }
  });
});
