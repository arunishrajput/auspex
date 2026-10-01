/**
 * The tone registry, tested where the rule lives.
 *
 * Same convention as `Provenance.test.ts`: no DOM, because this package has no React testing
 * library and the things worth asserting here are properties of a plain object. What a tone
 * *looks* like is checked by `scripts/check-contrast.mjs` against the built palette, which is
 * the only place that can measure a colour. What is checked here is that the registry cannot be
 * left in a state where a page renders a claim with no way to read it.
 */

import { describe, expect, it } from "vitest";
import { MARKET_STATE_TONE, TONE, TONES, toneOf, type Tone } from "./tone";

const CLAIMS: Tone[] = ["ok", "warn", "bad", "signal", "human"];

describe("TONE", () => {
  it("defines every slot for every tone, so no call site can render undefined into a class", () => {
    for (const tone of TONES) {
      for (const slot of ["text", "border", "surface", "badge"] as const) {
        expect(TONE[tone][slot], `${tone}.${slot}`).toMatch(/\S/);
      }
      expect(TONE[tone].meaning.length).toBeGreaterThan(10);
    }
  });

  it("gives every claim a non-colour glyph", () => {
    // The guarantee behind the greyscale and colour-blindness criteria. Colour alone is not
    // allowed to carry a claim, whichever ground the palette is tuned against: on white the five
    // could not be pushed past 1.13 in luminance and on near-black they reach 1.20, and neither
    // number is a margin worth betting legibility on. The glyph carries the rest. A tone without
    // one is a claim that a reader with deuteranopia cannot distinguish from its opposite.
    for (const tone of CLAIMS) {
      expect(TONE[tone].glyph, `${tone} must carry a mark`).toMatch(/\S/);
    }
  });

  it("gives the claims distinct glyphs, or the mark carries no information", () => {
    const glyphs = CLAIMS.map((tone) => TONE[tone].glyph);
    expect(new Set(glyphs).size).toBe(CLAIMS.length);
  });

  it("leaves `quiet` unmarked, because the absence of a claim has nothing to mark", () => {
    expect(TONE.quiet.glyph).toBe("");
  });

  it("uses each tone's own colour family in its slots", () => {
    // Catches the copy-paste that gives `bad` the `warn` border — which is exactly how six
    // hand-written copies of this map drifted apart before it existed.
    for (const tone of CLAIMS) {
      for (const slot of ["text", "border", "surface", "badge"] as const) {
        expect(TONE[tone][slot], `${tone}.${slot}`).toContain(`${tone}-500`);
        for (const other of CLAIMS.filter((t) => t !== tone)) {
          expect(TONE[tone][slot], `${tone}.${slot} mentions ${other}`).not.toContain(`${other}-500`);
        }
      }
    }
  });
});

describe("toneOf", () => {
  it("passes through a known tone", () => {
    for (const tone of TONES) expect(toneOf(tone)).toBe(tone);
  });

  it("falls back rather than producing a class name that does not exist", () => {
    // A tone arriving from a database column or a URL is untrusted. `TONE[unknown]` would be
    // undefined and the template literal would render the string "undefined" into a className,
    // which produces no CSS and no warning — the ADR-064 failure mode in a new disguise.
    expect(toneOf("catastrophe")).toBe("quiet");
    expect(toneOf(null)).toBe("quiet");
    expect(toneOf(undefined)).toBe("quiet");
    expect(toneOf("", "bad")).toBe("bad");
  });
});

describe("MARKET_STATE_TONE", () => {
  it("covers every state the contract can report", () => {
    // Mirrors the MarketState enum in AuspexMarket.sol. A state with no entry falls back to
    // `quiet`, which is safe, but a missing entry is more likely to mean the contract gained a
    // state nobody told the UI about.
    for (const state of ["OPEN", "CLOSED", "RESOLUTION_PROPOSED", "FINALIZED", "INVALIDATED"]) {
      expect(MARKET_STATE_TONE[state], state).toBeDefined();
      expect(TONES).toContain(MARKET_STATE_TONE[state]);
    }
  });

  it("does not call a finalized market good news", () => {
    // A settled market is over, not correct. Tinting it `ok` would read as an endorsement of
    // whichever way it settled, on a page whose job is to make no claim it cannot support.
    expect(MARKET_STATE_TONE.FINALIZED).toBe("quiet");
  });
});
