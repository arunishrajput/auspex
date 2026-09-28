import { describe, expect, it } from "vitest";
import { canonicalSpecJson, computeSpecHash, type MarketSpec } from "./spec";

/**
 * The spec hash is the link between "what a human approved" and "what the contract created".
 * The contract refuses a hash it has seen before, so anything that makes the same
 * specification hash differently would let the same market be created twice.
 */

const SPEC: MarketSpec = {
  question: "Will X happen by Friday?",
  resolutionSourceUrl: "https://example.org/source",
  closeTime: 1_800_000_000,
  resolveDeadline: 1_800_003_600,
  resolutionCriteria: "The headline figure published at the source URL.",
  category: "markets",
};

describe("computeSpecHash", () => {
  it("is deterministic", () => {
    expect(computeSpecHash(SPEC)).toBe(computeSpecHash({ ...SPEC }));
  });

  it("does not depend on key order", () => {
    // The one that matters. Two objects with the same content built in a different order are
    // the same specification; if they hashed differently, the contract's replay guard would
    // not fire and the same market could be created twice.
    const reordered: MarketSpec = {
      category: SPEC.category,
      resolveDeadline: SPEC.resolveDeadline,
      question: SPEC.question,
      resolutionCriteria: SPEC.resolutionCriteria,
      closeTime: SPEC.closeTime,
      resolutionSourceUrl: SPEC.resolutionSourceUrl,
    };
    expect(computeSpecHash(reordered)).toBe(computeSpecHash(SPEC));
    expect(canonicalSpecJson(reordered)).toBe(canonicalSpecJson(SPEC));
  });

  it("changes when any field changes", () => {
    const fields: MarketSpec[] = [
      { ...SPEC, question: "Will X happen by Saturday?" },
      { ...SPEC, resolutionSourceUrl: "https://example.org/other" },
      { ...SPEC, closeTime: SPEC.closeTime + 1 },
      { ...SPEC, resolveDeadline: SPEC.resolveDeadline + 1 },
      { ...SPEC, resolutionCriteria: "Something else entirely." },
      { ...SPEC, category: "sport" },
    ];
    for (const variant of fields) {
      expect(computeSpecHash(variant)).not.toBe(computeSpecHash(SPEC));
    }
  });

  it("produces a bytes32 the contract will accept", () => {
    expect(computeSpecHash(SPEC)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("sorts keys in the canonical JSON", () => {
    expect(canonicalSpecJson(SPEC).startsWith('{"category":')).toBe(true);
  });
});
