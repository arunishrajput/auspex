/**
 * The small uppercase pill — a market state, a signer kind, an off-chain warning.
 *
 * The glyph comes from the tone registry rather than the call site, so the claim is carried by
 * a mark as well as a colour without every caller having to remember to do it. `quiet` has no
 * glyph and renders as a plain pill.
 */

import type { ReactNode } from "react";
import { TONE, type Tone } from "./tone";

export type BadgeProps = {
  tone?: Tone;
  children: ReactNode;
  /** Hidden when the pill sits in a row of pills whose meaning is already obvious. */
  glyph?: boolean;
  /** Overrides the tone's own `meaning` on hover. */
  title?: string;
  className?: string;
};

export function Badge({ tone = "quiet", children, glyph = true, title, className }: BadgeProps) {
  const meta = TONE[tone];
  return (
    <span
      title={title ?? (tone === "quiet" ? undefined : meta.meaning)}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.1em] uppercase ${meta.badge} ${className ?? ""}`}
    >
      {glyph && meta.glyph !== "" && (
        <span aria-hidden="true" className="text-[9px] leading-none">
          {meta.glyph}
        </span>
      )}
      {children}
    </span>
  );
}
