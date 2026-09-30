/**
 * The semantic tones, in one place, because they are trust claims and not decoration.
 *
 * `ok` / `warn` / `bad` / `signal` / `human` each mean something specific on these pages:
 * `human` marks an action a person signed, `warn` marks an operator-key row or a deadline
 * running out, `bad` marks a refusal, `ok` marks a state the chain confirms, `signal` marks
 * something read from or linked to the chain. `quiet` is the absence of a claim.
 *
 * ## Why this file exists
 *
 * Before it, the same five tones were re-derived as Tailwind class strings in six different
 * places — `TONE_CLASS` on `/trust`, a four-branch ternary in `/agents`, two more in `/resolve`
 * and `/review`, `STATE_STYLE` on `/markets`, and two `tone()` functions on `/audit`. They had
 * already drifted: `/trust` tinted borders and `/agents` did not, `/resolve`'s neutral was
 * `text-ink-100` and `/agents`'s was `text-ink-200`. Six copies of a trust claim is six chances
 * for one page to say something a different page contradicts.
 *
 * ## `glyph` is load-bearing, not ornament
 *
 * Colour is never allowed to be the only carrier of a claim: a reader with deuteranopia, or
 * anyone looking at a greyscale screenshot, has to be able to tell a refusal from a
 * confirmation. Keeping the mark *in the registry* rather than at the call site is what makes
 * that mechanical — a tone cannot be used without one being available, and
 * `scripts/check-contrast.mjs` asserts every tone has one.
 */

export const TONES = ["ok", "warn", "bad", "signal", "human", "quiet"] as const;

export type Tone = (typeof TONES)[number];

export type ToneSlots = {
  /** Foreground for a value or a heading carrying this claim. */
  text: string;
  /** Border alone — a card or column whose whole contents carry the claim. */
  border: string;
  /** Tinted ground plus border, for a callout. */
  surface: string;
  /** Border, ground and foreground together, for a badge or pill. */
  badge: string;
  /**
   * The non-colour mark. Never the only thing rendered, always available beside the colour, so
   * the claim survives greyscale and colour-vision deficiency. `quiet` has none by design:
   * "no claim" needs no mark.
   */
  glyph: string;
  /** What the tone asserts, for a title attribute or a legend. */
  meaning: string;
};

export const TONE: Record<Tone, ToneSlots> = {
  ok: {
    text: "text-ok-500",
    border: "border-ok-500/45",
    surface: "border-ok-500/45 bg-ok-500/8",
    badge: "border-ok-500/45 bg-ok-500/12 text-ok-500",
    glyph: "✓",
    meaning: "confirmed — the chain or a check says so",
  },
  warn: {
    text: "text-warn-500",
    border: "border-warn-500/50",
    surface: "border-warn-500/50 bg-warn-500/10",
    badge: "border-warn-500/50 bg-warn-500/14 text-warn-500",
    glyph: "▲",
    meaning: "needs attention — not wrong, not settled",
  },
  bad: {
    text: "text-bad-500",
    border: "border-bad-500/45",
    surface: "border-bad-500/45 bg-bad-500/8",
    badge: "border-bad-500/50 bg-bad-500/12 text-bad-500",
    glyph: "✕",
    meaning: "refused, reverted or invalid",
  },
  signal: {
    text: "text-signal-500",
    border: "border-signal-500/45",
    surface: "border-signal-500/45 bg-signal-500/8",
    badge: "border-signal-500/45 bg-signal-500/12 text-signal-500",
    glyph: "◆",
    meaning: "read from or linked to the chain",
  },
  human: {
    text: "text-human-500",
    border: "border-human-500/45",
    surface: "border-human-500/45 bg-human-500/8",
    badge: "border-human-500/45 bg-human-500/12 text-human-500",
    glyph: "✍",
    meaning: "a person signed this",
  },
  quiet: {
    text: "text-ink-200",
    border: "border-ink-700",
    surface: "border-ink-700 bg-ink-850",
    badge: "border-ink-700 bg-ink-850 text-ink-300",
    glyph: "",
    meaning: "no claim either way",
  },
};

/** `TONE[tone]`, but tolerant of a string that came from a database column or a URL. */
export function toneOf(value: string | null | undefined, fallback: Tone = "quiet"): Tone {
  return (TONES as readonly string[]).includes(value ?? "") ? (value as Tone) : fallback;
}

/**
 * A market's state, as a claim rather than a colour. Defined here because `/markets` and
 * `/markets/[id]` each had their own copy and a third would have been inevitable.
 *
 * `FINALIZED` is deliberately `quiet`. A settled market is not good news — it is simply over —
 * and tinting it `ok` would read as an endorsement of whichever way it settled.
 */
export const MARKET_STATE_TONE: Record<string, Tone> = {
  OPEN: "ok",
  CLOSED: "warn",
  RESOLUTION_PROPOSED: "signal",
  FINALIZED: "quiet",
  INVALIDATED: "bad",
};
