/**
 * The two parsers behind the `/trust` histograms.
 *
 * Neither touches a database, which is the point of extracting them: the only way a counter on
 * that page can be wrong without the query being wrong is if free text is bucketed badly, and that
 * is testable without Postgres.
 *
 * The cases below are real strings taken from `policyGate.ts`, `over-cap-bet.ts` and
 * `describeRevert`'s output, not invented shapes — a parser tested against a made-up format is a
 * parser tested against itself.
 */

import { describe, expect, it } from "vitest";
import { reasonCode, revertErrorName } from "./counters";

describe("reasonCode", () => {
  it("reads the machine-readable prefix the gate writes", () => {
    expect(reasonCode("CATEGORY_NOT_ALLOWED: WORLD is not on vega's allowlist.")).toBe(
      "CATEGORY_NOT_ALLOWED",
    );
    expect(
      reasonCode("CONFIDENCE_BELOW_THRESHOLD: 0.72 is under the member's floor of 0.90."),
    ).toBe("CONFIDENCE_BELOW_THRESHOLD");
    expect(reasonCode("GATE_BYPASSED: scripts/over-cap-bet.ts created this bet.")).toBe(
      "GATE_BYPASSED",
    );
  });

  it("tolerates leading whitespace and a space before the colon", () => {
    expect(reasonCode("  KILL_SWITCH_ON : the member is halted.")).toBe("KILL_SWITCH_ON");
  });

  it("buckets an unprefixed reason rather than dropping it", () => {
    // A gate reason nobody can group is a defect worth seeing on the page, not one worth hiding.
    expect(reasonCode("the agent abstained")).toBe("UNLABELLED");
    expect(reasonCode("")).toBe("UNLABELLED");
    // Too short to be a code, and lowercase text is not one either.
    expect(reasonCode("NO: it declined")).toBe("UNLABELLED");
  });
});

describe("revertErrorName", () => {
  it("keeps the contract's error name and drops its arguments", () => {
    expect(revertErrorName("AgentPerTxCapExceeded(20000000000000001, 20000000000000000)")).toBe(
      "AgentPerTxCapExceeded",
    );
    expect(revertErrorName("MarketNotOpen()")).toBe("MarketNotOpen");
    expect(revertErrorName("ChallengeWindowOpen(1759185120)")).toBe("ChallengeWindowOpen");
  });

  it("keeps a bare name that has no arguments at all", () => {
    expect(revertErrorName("AlreadyClaimed")).toBe("AlreadyClaimed");
  });

  it("labels an undecoded revert honestly instead of inventing a name", () => {
    expect(revertErrorName(null)).toBe("not decoded");
    expect(revertErrorName("")).toBe("not decoded");
    expect(revertErrorName("   ")).toBe("not decoded");
    expect(revertErrorName("(0x1234)")).toBe("not decoded");
  });
});
