/**
 * The bordered panel, which appeared verbatim twelve times and with a tinted tone five more.
 *
 * `CardHead` is the strip of metadata across the top — id, state badge, a link to the
 * transaction — and it was its own ten-times-repeated class string. `CardFoot` is the
 * explanatory sentence under a table, which is where most of this app's prose lives.
 *
 * On a near-black page a bordered rectangle on a barely-different ground tends to dissolve, so
 * every card carries `lit-edge`: a one-pixel brightened line along its top, as if catching the
 * glow the backdrop puts above it. It is in the component rather than at the call site because
 * seventeen call sites will not all remember.
 */

import type { ReactNode } from "react";
import { TONE, type Tone } from "./tone";

export type CardProps = {
  /**
   * Tints the border and ground. `quiet` is the default and is the plain panel; a tone here
   * means the card's *whole contents* carry that claim — the off-chain pending list on
   * `/markets` is `warn` because none of it is on the contract yet.
   */
  tone?: Tone;
  children: ReactNode;
  className?: string;
};

const QUIET = "border-ink-700 bg-ink-900";

export function Card({ tone = "quiet", children, className }: CardProps) {
  const skin = tone === "quiet" ? QUIET : TONE[tone].surface;
  return (
    <div className={`lit-edge overflow-hidden rounded-2xl border ${skin} ${className ?? ""}`}>
      {children}
    </div>
  );
}

/** The same panel as an `li`, for the card lists on `/markets` and `/agents`. */
export function CardItem({ tone = "quiet", children, className }: CardProps) {
  const skin = tone === "quiet" ? QUIET : TONE[tone].surface;
  return (
    <li
      className={`lit-edge overflow-hidden rounded-2xl border transition-colors hover:border-ink-600 ${skin} ${className ?? ""}`}
    >
      {children}
    </li>
  );
}

export function CardHead({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-800 bg-ink-880 px-4 py-3 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`px-4 py-4 ${className ?? ""}`}>{children}</div>;
}

/**
 * The sentence under the data. Muted and small, but `leading-relaxed` because these are real
 * paragraphs explaining what the reader is looking at, not captions.
 */
export function CardFoot({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`border-t border-ink-800 bg-ink-950/40 px-4 py-3.5 text-xs leading-relaxed text-ink-400 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
