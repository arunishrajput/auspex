/**
 * A tinted block with a title and an explanation: an error this page is showing rather than
 * hiding, a gate that refused, a caveat about what the numbers below do and do not claim.
 *
 * `/resolve` and `/review` each had a local `Panel` for this, with overlapping but different
 * tone unions (`warn | bad` and `warn | quiet`), and roughly fifteen more call sites wrote the
 * class string inline. One component, the full tone union.
 */

import type { ReactNode } from "react";
import { TONE, type Tone } from "./tone";

export type CalloutProps = {
  tone?: Tone;
  /** The headline. Mono, because these are usually system statements rather than prose. */
  title: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function Callout({ tone = "quiet", title, children, className }: CalloutProps) {
  const meta = TONE[tone];
  return (
    <div className={`lit-edge rounded-2xl border px-4 py-3.5 ${meta.surface} ${className ?? ""}`}>
      <p className={`flex items-baseline gap-2 font-mono text-sm font-medium ${meta.text}`}>
        {meta.glyph !== "" && (
          <span aria-hidden="true" className="text-[11px]">
            {meta.glyph}
          </span>
        )}
        <span>{title}</span>
      </p>
      {children !== undefined && (
        <div className="mt-2 text-xs leading-relaxed text-ink-400">{children}</div>
      )}
    </div>
  );
}
