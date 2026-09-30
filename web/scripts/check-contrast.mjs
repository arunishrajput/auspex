#!/usr/bin/env node
/**
 * The colour guard: contrast, and whether the semantic tones are still telling a reader apart.
 *
 * Phase 10 replaced a dark theme with a light one. Every one of the ~1,350 colour-token
 * references in `app/` keeps its name and gets a new value, which is what made the redesign
 * affordable — and also what makes it dangerous, because a single number in `@theme` now decides
 * whether 209 pieces of label text are legible. Eyeballing a palette on one monitor is not a
 * check. This is.
 *
 * Four things are asserted, and each maps to a Phase 10 exit criterion:
 *
 *   1. **WCAG AA on real pairs.** Not "the palette looks fine", but every text token against
 *      every surface it is actually rendered on, at the size it is actually rendered at. The
 *      pairs are written down below with the reason each one occurs, taken from a census of the
 *      utilities the pages use (`text-ink-400` on `bg-ink-900`, and so on).
 *
 *   2. **The semantic five survive greyscale.** `ok` / `warn` / `bad` / `signal` / `human` encode
 *      trust claims. If two of them have the same relative luminance they are the same colour in
 *      a screenshot printed in black and white, and a reader cannot tell a refusal from a
 *      confirmation.
 *
 *   3. **The semantic five survive colour-vision deficiency.** Each pair is simulated under
 *      protanopia, deuteranopia and tritanopia (Viénot/Brettel LMS reduction) and compared in
 *      CIE Lab. Red/green pairs are the ones that collapse, and `ok` against `bad` is precisely
 *      a red/green pair, so this is not a theoretical check.
 *
 *   4. **Colour is never the only signal.** Every tone in `components/ui/tone.ts` must carry a
 *      non-colour glyph, so checks 2 and 3 have a backstop that does not depend on a number
 *      clearing a threshold. `quiet` is exempt: "no claim" has nothing to mark.
 *
 * Thresholds are the WCAG ones — 4.5:1 for text under 24px, 3:1 for large text and for the
 * borders and dots that carry meaning (WCAG 1.4.11 non-text contrast). Where a pair only clears
 * 3:1 it must be declared `large` here with the reason, so "this is a heading" is a claim
 * someone wrote down rather than a threshold quietly relaxed to make a colour pass.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const notes = [];

// --- the palette, read from the one place it is defined -----------------------------------------

const css = readFileSync(join(WEB_ROOT, "app/globals.css"), "utf8");
const theme = css.slice(css.indexOf("@theme"), css.indexOf("\n}", css.indexOf("@theme")));
const COLOR = {};
for (const [, name, hex] of theme.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
  COLOR[name] = hex;
}
if (Object.keys(COLOR).length === 0) {
  console.error("check-contrast: found no --color-* tokens in app/globals.css @theme.");
  process.exit(1);
}

// --- colour maths -------------------------------------------------------------------------------

function rgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
}
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function luminance(hex) {
  const [r, g, b] = rgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Composite a token used at partial opacity over its ground — `bg-warn-500/12` on a white card. */
function over(fgHex, alpha, bgHex) {
  const f = rgb(fgHex);
  const b = rgb(bgHex);
  const out = f.map((c, i) => c * alpha + b[i] * (1 - alpha));
  return (
    "#" +
    out.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0")).join("")
  );
}

function toLab(hex) {
  const [r, g, b] = rgb(hex).map(toLinear);
  // sRGB -> XYZ (D65), then XYZ -> Lab with the D65 white point.
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const deltaE = (a, b) => {
  const [la, aa, ba] = toLab(a);
  const [lb, ab, bb] = toLab(b);
  return Math.hypot(la - lb, aa - ab, ba - bb);
};

/**
 * Dichromacy simulation. Converts to LMS, collapses the missing cone's response onto the plane
 * spanned by the two that remain, and converts back — the Viénot–Brettel–Mollon construction.
 */
const LMS_FROM_LINEAR = [
  [0.31399022, 0.63951294, 0.04649755],
  [0.15537241, 0.75789446, 0.08670142],
  [0.01775239, 0.10944209, 0.87256922],
];
const LINEAR_FROM_LMS = [
  [5.47221206, -4.6419601, 0.16963708],
  [-1.1252419, 2.29317094, -0.1678952],
  [0.02980165, -0.19318073, 1.16364789],
];
const COLLAPSE = {
  protanopia: [
    [0, 1.05118294, -0.05116099],
    [0, 1, 0],
    [0, 0, 1],
  ],
  deuteranopia: [
    [1, 0, 0],
    [0.9513092, 0, 0.04866992],
    [0, 0, 1],
  ],
  tritanopia: [
    [1, 0, 0],
    [0, 1, 0],
    [-0.86744736, 1.86727089, 0],
  ],
};
const apply = (m, v) => m.map((row) => row.reduce((sum, k, i) => sum + k * v[i], 0));

function simulate(hex, kind) {
  const lin = rgb(hex).map(toLinear);
  const out = apply(LINEAR_FROM_LMS, apply(COLLAPSE[kind], apply(LMS_FROM_LINEAR, lin)));
  return (
    "#" +
    out
      .map((c) => Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, c))))) * 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

// --- 1. WCAG AA on the pairs that actually occur -------------------------------------------------
//
// `why` is the utility combination in the pages that puts these two tokens together. A pair with
// no `why` should not be in this list.

const SURFACES = {
  page: "ink-950",
  card: "ink-900",
  head: "ink-880",
  sunk: "ink-850",
};

const TEXT_ON_ALL_SURFACES = [
  ["ink-100", "headings and primary values — 49 uses"],
  ["ink-200", "strong body text and `dd` values — 70 uses"],
  ["ink-300", "body prose and the page lede — 119 uses"],
  ["ink-400", "labels, captions and muted prose — 209 uses, the most used token in the app"],
  ["ink-500", "the faintest text, at 11px — 53 uses"],
];

const TONES = ["ok", "warn", "bad", "signal", "human"];

{
  for (const [token, why] of TEXT_ON_ALL_SURFACES) {
    for (const [name, surface] of Object.entries(SURFACES)) {
      const ratio = contrast(COLOR[token], COLOR[surface]);
      if (ratio < 4.5) {
        failures.push(
          `text-${token} on bg-${surface} (${name}) is ${ratio.toFixed(2)}:1 — AA needs 4.5:1. ${why}.`,
        );
      }
    }
  }

  // The semantic tones are rendered as text directly: `text-warn-500` 74 times, `text-bad-500`
  // 56, `text-signal-500` 62, `text-ok-500` 40. On a card, on the page, and on a 12% tint of
  // themselves inside a badge.
  for (const tone of TONES) {
    const token = `${tone}-500`;
    for (const [name, surface] of Object.entries(SURFACES)) {
      const ratio = contrast(COLOR[token], COLOR[surface]);
      if (ratio < 4.5) {
        failures.push(
          `text-${token} on bg-${surface} (${name}) is ${ratio.toFixed(2)}:1 — AA needs 4.5:1. ` +
            `This tone is rendered as small text on that surface.`,
        );
      }
    }
    const badgeGround = over(COLOR[token], 0.12, COLOR[SURFACES.card]);
    const onBadge = contrast(COLOR[token], badgeGround);
    if (onBadge < 4.5) {
      failures.push(
        `text-${token} on its own 12% tint (${badgeGround}) is ${onBadge.toFixed(2)}:1 — ` +
          `AA needs 4.5:1. That is the Badge and Callout combination in components/ui.`,
      );
    }
  }

  // Non-text contrast, WCAG 1.4.11: a border or a status dot that carries meaning needs 3:1
  // against what it sits on. The 8px `bg-{tone}-500` dots are the whole signal on `/` and
  // `/trust`, and `border-ink-700` is what makes a card a card.
  for (const tone of TONES) {
    const ratio = contrast(COLOR[`${tone}-500`], COLOR[SURFACES.card]);
    if (ratio < 3) {
      failures.push(
        `the bg-${tone}-500 status dot is ${ratio.toFixed(2)}:1 against the card — ` +
          `WCAG 1.4.11 needs 3:1 for a mark that carries meaning.`,
      );
    }
  }
  for (const border of ["ink-700", "ink-800"]) {
    const ratio = contrast(COLOR[border], COLOR[SURFACES.card]);
    if (ratio < 1.25) {
      failures.push(
        `border-${border} is ${ratio.toFixed(2)}:1 against the card and will be invisible.`,
      );
    }
  }
  // The accent is chrome only and never labels data, but it is text.
  for (const [name, surface] of Object.entries(SURFACES)) {
    const ratio = contrast(COLOR["accent-600"], COLOR[surface]);
    if (ratio < 4.5) {
      failures.push(
        `text-accent-600 on bg-${surface} (${name}) is ${ratio.toFixed(2)}:1 — AA needs 4.5:1.`,
      );
    }
  }
  // Focus rings have to be visible on every ground, or keyboard navigation is guesswork.
  for (const [name, surface] of Object.entries(SURFACES)) {
    const ratio = contrast(COLOR["focus-500"], COLOR[surface]);
    if (ratio < 3) {
      failures.push(
        `the focus ring (focus-500) is ${ratio.toFixed(2)}:1 on bg-${surface} (${name}) — ` +
          `needs 3:1 to be seen.`,
      );
    }
  }
}

// --- 2 & 3. the semantic five, in greyscale and under dichromacy ---------------------------------
//
// The thresholds: 8 ΔE is roughly "clearly a different colour" for two large flat areas, and a
// luminance ratio of 1.2 between two tones is enough to separate them in a greyscale print.

const GREYSCALE_MIN = 1.18;
const CVD_MIN = 9;

/*
 * Where those two numbers come from, because they look arbitrary and are not.
 *
 * Requiring five colours to clear AA on a white ground confines them to a narrow band of
 * lightness, and lightness is the *only* thing greyscale preserves. A search over hue and
 * lightness for the five (250k samples, `ok`/`warn`/`bad`/`signal`/`human` all between 4.6:1
 * and 9.4:1) could not push the worst pair past about 1.13 in luminance ratio. So 1.18 is close
 * to the ceiling rather than a comfortable bar, and it is met by spreading the tones up a
 * deliberate ladder instead of clustering them at the lightest value that passes.
 *
 * The ordering of that ladder is not free either. The pairs that collapse under colour blindness
 * — `ok`/`bad` and `warn`/`bad` (red against green), `ok`/`signal` (green against blue under
 * tritanopia), `signal`/`human` and `warn`/`human` (violet against both) — form a five-cycle:
 * bad–ok–signal–human–warn–bad. Every one of those pairs needs a lightness gap, because hue is
 * what dichromacy takes away. A cycle cannot be laid on a line with all its edges long, so the
 * tones are assigned alternately around it (bad, signal, warn, ok, human, lightest to darkest),
 * which is what puts every colliding pair at least two rungs apart. Assigning them in their
 * intuitive order instead — refusal lightest through to confirmation darkest — leaves
 * `signal`/`human` adjacent and they measured ΔE 3.1 under deuteranopia: one colour.
 *
 * This is why `glyph` is not decoration. Colour alone cannot carry five distinct claims at AA on
 * a light ground; the measured separation makes the palette as honest as it can be, and the mark
 * beside it is what actually guarantees a reader can tell a refusal from a confirmation.
 */

{
  for (let i = 0; i < TONES.length; i += 1) {
    for (let j = i + 1; j < TONES.length; j += 1) {
      const [a, b] = [`${TONES[i]}-500`, `${TONES[j]}-500`];
      const [ha, hb] = [COLOR[a], COLOR[b]];

      const grey = contrast(ha, hb);
      if (grey < GREYSCALE_MIN) {
        failures.push(
          `${TONES[i]} and ${TONES[j]} are ${grey.toFixed(3)}:1 apart in luminance — the same ` +
            `shade in a greyscale screenshot. Needs ${GREYSCALE_MIN}. Their glyphs still ` +
            `differ, but two trust claims should not need the glyph to be told apart.`,
        );
      }

      for (const kind of Object.keys(COLLAPSE)) {
        const d = deltaE(simulate(ha, kind), simulate(hb, kind));
        if (d < CVD_MIN) {
          failures.push(
            `${TONES[i]} and ${TONES[j]} are ΔE ${d.toFixed(1)} apart under ${kind} — under ` +
              `${CVD_MIN} they read as one colour. Glyphs ${JSON.stringify(glyphFor(TONES[i]))} ` +
              `and ${JSON.stringify(glyphFor(TONES[j]))} are what a reader would be left with.`,
          );
        }
      }
    }
  }

  // The accent is not a trust claim, but it sits in the chrome directly above data, so it must
  // not be mistakable for one.
  for (const tone of TONES) {
    const d = deltaE(COLOR["accent-500"], COLOR[`${tone}-500`]);
    if (d < 18) {
      failures.push(
        `the accent is only ΔE ${d.toFixed(1)} from ${tone} — a reader could read the chrome as ` +
          `a trust claim. The accent must stay clearly outside the semantic five.`,
      );
    }
  }
}

// --- 4. every tone carries a non-colour mark -----------------------------------------------------

function glyphFor(tone) {
  const src = readFileSync(join(WEB_ROOT, "components/ui/tone.ts"), "utf8");
  const block = src.slice(src.indexOf(`  ${tone}: {`));
  const match = block.slice(0, block.indexOf("},")).match(/glyph:\s*"([^"]*)"/);
  return match === null ? null : match[1];
}

{
  for (const tone of TONES) {
    const glyph = glyphFor(tone);
    if (glyph === null) {
      failures.push(`components/ui/tone.ts has no glyph field for \`${tone}\`.`);
    } else if (glyph.trim() === "") {
      failures.push(
        `tone \`${tone}\` has an empty glyph. Colour would be its only carrier, which fails for ` +
          `a reader with colour-vision deficiency and in any greyscale copy of the page.`,
      );
    }
  }
  const quiet = glyphFor("quiet");
  if (quiet !== "") {
    notes.push(`\`quiet\` now has the glyph ${JSON.stringify(quiet)}; it is meant to have none.`);
  }
}

// --- the measurements, printed whether or not anything failed ------------------------------------

console.log("Palette, as built:\n");
const pad = (s, n) => String(s).padEnd(n);
console.log(`  ${pad("token", 13)} ${pad("value", 9)} on page   on card`);
for (const [token] of TEXT_ON_ALL_SURFACES) {
  console.log(
    `  ${pad("text-" + token, 13)} ${pad(COLOR[token], 9)} ` +
      `${contrast(COLOR[token], COLOR[SURFACES.page]).toFixed(2).padStart(7)}:1 ` +
      `${contrast(COLOR[token], COLOR[SURFACES.card]).toFixed(2).padStart(7)}:1`,
  );
}
for (const tone of [...TONES, "accent"]) {
  const token = tone === "accent" ? "accent-600" : `${tone}-500`;
  console.log(
    `  ${pad("text-" + token, 13)} ${pad(COLOR[token], 9)} ` +
      `${contrast(COLOR[token], COLOR[SURFACES.page]).toFixed(2).padStart(7)}:1 ` +
      `${contrast(COLOR[token], COLOR[SURFACES.card]).toFixed(2).padStart(7)}:1`,
  );
}

console.log("\nThe semantic five, separated:\n");
console.log(`  ${pad("pair", 17)} greyscale   protan  deuter  tritan   glyphs`);
for (let i = 0; i < TONES.length; i += 1) {
  for (let j = i + 1; j < TONES.length; j += 1) {
    const [ha, hb] = [COLOR[`${TONES[i]}-500`], COLOR[`${TONES[j]}-500`]];
    const cvd = Object.keys(COLLAPSE).map((k) =>
      deltaE(simulate(ha, k), simulate(hb, k)).toFixed(0).padStart(6),
    );
    console.log(
      `  ${pad(`${TONES[i]} / ${TONES[j]}`, 17)} ${contrast(ha, hb).toFixed(2).padStart(7)}:1 ` +
        `${cvd.join("  ")}   ${glyphFor(TONES[i])} ${glyphFor(TONES[j])}`,
    );
  }
}

if (notes.length > 0) {
  console.log("");
  for (const note of notes) console.log(`  note: ${note}`);
}

if (failures.length > 0) {
  console.error(`\nContrast check FAILED — ${failures.length} problem(s):\n`);
  for (const failure of failures) console.error(`  ✖ ${failure}`);
  console.error("");
  process.exit(1);
}

console.log(
  `\nContrast check passed: every text token clears AA on all four surfaces, the semantic five ` +
    `stay apart in greyscale and under three kinds of colour blindness, and each carries a glyph.`,
);
