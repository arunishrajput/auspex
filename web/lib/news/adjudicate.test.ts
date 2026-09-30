/**
 * The clock bound on adjudication — the stage that had none, and starved the one after it.
 *
 * Clustering was bounded by a call budget and nothing else. A budget of four calls at the 22s
 * per-call timeout is 88 seconds of wall clock against a function killed at 60, so on a busy tick
 * this stage could consume the whole budget and every stage after it yielded having done nothing.
 * That is what happened to the resolution stage on both production ticks that had a market to
 * resolve: `examining 0 market(s)`, the chain never read. ADR-075.
 *
 * The property these tests hold down is the one that makes the bound safe to add: **yielding on
 * the clock costs nothing and writes nothing.** This loop touches no database and holds no lock,
 * so a pass that stops early produces fewer merges — which is the direction ADR-030 already chose
 * for an unavailable model — and never a half-applied one.
 *
 * No model transport is needed to prove any of this: the deadline is checked before the call, so
 * a deadline in the past means `callJson` is never reached. An unspent budget is the evidence.
 */

import { describe, expect, it } from "vitest";
import { adjudicateBorderlinePairs } from "./adjudicate";
import type { BorderlinePair } from "./cluster";
import type { ItemText } from "./adjudicate";
import { LlmBudget } from "../llm/client";

function pairs(count: number): BorderlinePair[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `a${i}|b${i}` as BorderlinePair["key"],
    aId: `a${i}`,
    bId: `b${i}`,
    similarity: 0.42,
  }));
}

function texts(count: number): Map<string, ItemText> {
  const map = new Map<string, ItemText>();
  for (let i = 0; i < count; i += 1) {
    map.set(`a${i}`, { title: `Story ${i}, as one publisher told it`, summary: null, independenceGroup: "reuters.com" });
    map.set(`b${i}`, { title: `Story ${i}, as another told it`, summary: null, independenceGroup: "apnews.com" });
  }
  return map;
}

describe("adjudication yields on the clock without spending the budget", () => {
  it("asks nothing at all when the deadline has already passed", async () => {
    const budget = new LlmBudget(4);
    const outcome = await adjudicateBorderlinePairs(pairs(20), texts(20), budget, {
      deadlineMs: Date.now() - 1,
    });

    // The load-bearing assertion: no call was made. If the deadline were checked after the call
    // rather than before it, the budget would be down one and the tick would be 22s poorer.
    expect(budget.spent).toBe(0);
    expect(outcome.verdicts.size).toBe(0);
    expect(outcome.notes).toEqual([]);
    expect(outcome.haltedBecause).toMatch(/out of time/);
  });

  it("says how much it left undone, so the report is not silent about it", async () => {
    const outcome = await adjudicateBorderlinePairs(pairs(20), texts(20), new LlmBudget(4), {
      deadlineMs: Date.now() - 1,
    });
    // Hard rule #7: a stage that declined work records why. "Nothing happened" and "nothing ran"
    // are indistinguishable from the outside otherwise.
    expect(outcome.haltedBecause).toContain("0 of 20 pairs");
    expect(outcome.haltedBecause).toMatch(/next tick/);
  });

  it("reports the budget, not the clock, when the budget is what ran out", async () => {
    // The two bounds must stay distinguishable in the report: one means "this tick was busy",
    // the other means "this tick was slow", and they call for different responses.
    const spent = new LlmBudget(0);
    const outcome = await adjudicateBorderlinePairs(pairs(20), texts(20), spent, {
      deadlineMs: Date.now() + 60_000,
    });
    expect(outcome.haltedBecause).toMatch(/budget spent/);
    expect(outcome.haltedBecause).not.toMatch(/out of time/);
  });

  it("is unbounded by default, which is what the tests and the calibration script rely on", async () => {
    // No deadline given => infinite. Proved by the halt reason naming the budget rather than the
    // clock, with a budget of zero so no network call is attempted.
    const outcome = await adjudicateBorderlinePairs(pairs(4), texts(4), new LlmBudget(0));
    expect(outcome.haltedBecause).toMatch(/budget spent/);
  });

  it("does nothing, and says nothing, when there were no borderline pairs", async () => {
    const budget = new LlmBudget(4);
    const outcome = await adjudicateBorderlinePairs([], texts(0), budget, { deadlineMs: 0 });
    expect(outcome.haltedBecause).toBeNull();
    expect(budget.spent).toBe(0);
  });
});
