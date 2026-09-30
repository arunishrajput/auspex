/**
 * One number with a label. Three local copies of this existed, plus two of `Counter`, and the
 * five disagreed on type size, label size and where the divider lived.
 *
 * The divider now belongs to `StatGrid`, which is what five call sites were already doing by
 * hand with `divide-ink-800 sm:divide-x`. That is why `Stat` itself has no border: a stat
 * inside a grid should not know how many neighbours it has.
 */

import type { ReactNode } from "react";
import { TONE, type Tone } from "./tone";

export type StatProps = {
  label: ReactNode;
  /** A string or a number — `tabular-nums` keeps a column of them aligned either way. */
  value: ReactNode;
  /** A trust claim about the value, not emphasis. Leave unset for a plain count. */
  tone?: Tone;
  /** One short line under the number. */
  children?: ReactNode;
};

export function Stat({ label, value, tone = "quiet", children }: StatProps) {
  const colour = tone === "quiet" ? "text-ink-100" : TONE[tone].text;
  return (
    <div className="px-4 py-3">
      <dt className="font-mono text-[10px] tracking-[0.12em] text-ink-400 uppercase">{label}</dt>
      <dd className={`mt-1 font-mono text-xl tabular-nums ${colour}`}>{value}</dd>
      {children !== undefined && (
        <div className="mt-1 text-[11px] leading-snug text-ink-400">{children}</div>
      )}
    </div>
  );
}

const COLS = {
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
} as const;

/**
 * A row of stats inside a `Card`. Owns the dividers, and the `sm:` breakpoint is where they
 * become vertical — at 390 px these stack two-up, which is the only arrangement that does not
 * push the fourth number off the screen.
 */
export function StatGrid({
  cols = 4,
  children,
  className,
}: {
  cols?: keyof typeof COLS;
  children: ReactNode;
  className?: string;
}) {
  return (
    <dl
      className={`grid ${COLS[cols]} divide-y divide-ink-800 sm:divide-x sm:divide-y-0 ${className ?? ""}`}
    >
      {children}
    </dl>
  );
}

/**
 * A stat that stands alone rather than in a divided row — its own bordered tile, tinted by
 * tone. This is `/trust`'s refusal counters and `/agents`'s per-agent numbers.
 */
export function Counter({
  label,
  value,
  note,
  tone = "quiet",
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  tone?: Tone;
}) {
  const meta = TONE[tone];
  const skin = tone === "quiet" ? "border-ink-700 bg-ink-900" : meta.surface;
  const colour = tone === "quiet" ? "text-ink-100" : meta.text;
  return (
    <div className={`rounded-xl border px-3.5 py-3 ${skin}`}>
      <p className="font-mono text-[10px] tracking-[0.12em] text-ink-400 uppercase">{label}</p>
      <p className={`mt-1 font-mono text-2xl tabular-nums ${colour}`}>{value}</p>
      {note !== undefined && (
        <p className="mt-0.5 font-mono text-[10px] leading-snug text-ink-400">{note}</p>
      )}
    </div>
  );
}
