/**
 * The provenance guard, tested where the rule actually lives.
 *
 * `provenanceRefusal` is pure and takes `nodeEnv` as an argument rather than reading
 * `process.env` — which is the only reason this can be tested at all without mutating the
 * environment of a shared worker. Same injection convention as `validateDraft(now)`.
 *
 * There is no DOM test here on purpose: this package has no React testing library, adding one to
 * assert a `<span>` renders would be a dependency bought for nothing, and the branch that matters
 * is a pure predicate. The rendered output is covered by `scripts/check-provenance.mjs`, which
 * reads the prerendered HTML of a real build.
 */

import { describe, expect, it } from "vitest";
import {
  DOCUMENTED_ORIGINS,
  ORIGIN_META,
  provenanceRefusal,
  type DataOrigin,
} from "./Provenance";

const ALL_ORIGINS: DataOrigin[] = [
  "CHAIN",
  "INDEXED",
  "DB",
  "COMPUTED",
  "CONSTRUCTED",
  "MOCK",
];

describe("provenanceRefusal", () => {
  it("refuses invented data in a production build", () => {
    const refusal = provenanceRefusal("MOCK", "production");
    expect(refusal).not.toBeNull();
    expect(refusal).toContain("hard rule #2");
  });

  it("permits invented data in development, so it can be used while building", () => {
    expect(provenanceRefusal("MOCK", "development")).toBeNull();
    expect(provenanceRefusal("MOCK", "test")).toBeNull();
    // An unset NODE_ENV is not production. Guessing the other way would make a plain `tsx`
    // script that renders a component fail for a reason nobody could find.
    expect(provenanceRefusal("MOCK", undefined)).toBeNull();
  });

  it("permits every real origin in production, including the labelled synthetic one", () => {
    for (const origin of DOCUMENTED_ORIGINS) {
      expect(provenanceRefusal(origin, "production")).toBeNull();
    }
  });
});

describe("ORIGIN_META", () => {
  it("describes every origin, so a badge can never render without an explanation", () => {
    for (const origin of ALL_ORIGINS) {
      expect(ORIGIN_META[origin].blurb.length).toBeGreaterThan(20);
      expect(ORIGIN_META[origin].className).toContain("text-");
    }
  });

  it("documents every origin except the forbidden one", () => {
    expect([...DOCUMENTED_ORIGINS].sort()).toEqual(
      ALL_ORIGINS.filter((origin) => origin !== "MOCK").sort(),
    );
  });
});
