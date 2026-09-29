/**
 * The pure parts of the member model: the tMSTC parser and the on-chain cap derivation.
 *
 * `onChainCapsFor` is small and load-bearing. It is the only place the relationship between the
 * two limit layers is expressed, the contract rejects `perMarketCap < perTxCap` outright, and
 * `compareRegistry` uses it to decide whether the chain and the policy have drifted. A wrong
 * number here is a failed registration or a silently wrong drift warning.
 */

import { describe, expect, it } from "vitest";
import { MEMBER_SEEDS, onChainCapsFor, parseMstc } from "./members";

describe("parseMstc", () => {
  it("parses whole and fractional amounts exactly, without a float in the path", () => {
    expect(parseMstc("1")).toBe(10n ** 18n);
    expect(parseMstc("0.01")).toBe(10n ** 16n);
    expect(parseMstc("0.005")).toBe(5n * 10n ** 15n);
    expect(parseMstc("0.016")).toBe(16n * 10n ** 15n);
    expect(parseMstc("0")).toBe(0n);
  });

  it("handles an amount with full 18-decimal precision", () => {
    expect(parseMstc("1.000000000000000001")).toBe(10n ** 18n + 1n);
  });

  it("does not lose precision on a value a float would round", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; this path never converts to a Number.
    expect(parseMstc("0.3")).toBe(3n * 10n ** 17n);
  });
});

describe("onChainCapsFor", () => {
  it("sets the contract's per-tx cap at twice the off-chain one", () => {
    expect(onChainCapsFor({ perTxCapWei: 10n ** 16n }).perTxCapWei).toBe(2n * 10n ** 16n);
  });

  it("sets the per-market cap at twice the on-chain per-tx cap", () => {
    const caps = onChainCapsFor({ perTxCapWei: 10n ** 16n });
    expect(caps.perMarketCapWei).toBe(caps.perTxCapWei * 2n);
  });

  it("always satisfies the contract's perMarketCap >= perTxCap requirement", () => {
    // `registerAgent` reverts InvalidAgentConfig otherwise, so every seed must pass this.
    for (const seed of MEMBER_SEEDS) {
      const caps = onChainCapsFor({ perTxCapWei: parseMstc(seed.perTxCap) });
      expect(caps.perMarketCapWei).toBeGreaterThanOrEqual(caps.perTxCapWei);
      expect(caps.perTxCapWei).toBeGreaterThan(0n);
    }
  });

  it("leaves the off-chain cap the tighter of the two, so the gate binds before the chain does", () => {
    // The ordering the design depends on: an ordinary bet is stopped by policy, and the contract
    // is the outer bound a compromised server would hit instead.
    for (const seed of MEMBER_SEEDS) {
      const perTxCapWei = parseMstc(seed.perTxCap);
      expect(onChainCapsFor({ perTxCapWei }).perTxCapWei).toBeGreaterThan(perTxCapWei);
    }
  });

  it("is deterministic", () => {
    expect(onChainCapsFor({ perTxCapWei: 7n })).toEqual(onChainCapsFor({ perTxCapWei: 7n }));
  });
});

describe("MEMBER_SEEDS", () => {
  it("has unique handles, since seeding is idempotent on the handle", () => {
    const handles = MEMBER_SEEDS.map((seed) => seed.handle);
    expect(new Set(handles).size).toBe(handles.length);
  });

  it("gives every member a daily budget of at least one full-size bet", () => {
    for (const seed of MEMBER_SEEDS) {
      expect(parseMstc(seed.dailyBudget)).toBeGreaterThanOrEqual(parseMstc(seed.perTxCap));
    }
  });

  it("keeps every confidence threshold inside 0..1", () => {
    for (const seed of MEMBER_SEEDS) {
      expect(seed.minConfidence).toBeGreaterThan(0);
      expect(seed.minConfidence).toBeLessThanOrEqual(1);
    }
  });

  it("ships one member with its kill switch on, so the switch is exercised every tick", () => {
    expect(MEMBER_SEEDS.filter((seed) => seed.killSwitch)).toHaveLength(1);
  });

  it("gives every member at least one allowed category, since an empty list permits nothing", () => {
    for (const seed of MEMBER_SEEDS) {
      expect(seed.allowedCategories.length).toBeGreaterThan(0);
    }
  });
});
