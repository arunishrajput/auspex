/**
 * The four shapes a labelled value takes on these pages. They were nine local components.
 *
 *   `Field`      a label above a number, in a grid of them. Pool sizes, caps, counts.
 *   `Row`        a narrow label beside a value, in a stack. Timestamps, hashes, URLs.
 *   `SpecRow`    the same, with a wide label and its own padding — a market spec being read as
 *                a checklist on `/review`, where the label is a full phrase.
 *   `FieldBlock` a label above a paragraph. Model output, a refusal reason, quoted evidence.
 *
 * `Field` and `Row` are `dt`/`dd` and must sit inside a `dl`. `FieldBlock` deliberately is not:
 * the three call sites that use it are not in a definition list, and a bare `dt` outside a `dl`
 * is invalid HTML that no test would have caught.
 */

import type { ReactNode } from "react";

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-[10px] tracking-[0.12em] text-ink-400 uppercase">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm tabular-nums">{children}</dd>
    </div>
  );
}

export function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="w-24 shrink-0 text-ink-400">{label}</dt>
      <dd className="min-w-0 break-words text-ink-200">{children}</dd>
    </div>
  );
}

export function SpecRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 font-mono text-[10px] tracking-[0.12em] text-ink-500 uppercase sm:pt-0.5">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-xs leading-relaxed text-ink-200">{children}</dd>
    </div>
  );
}

export function FieldBlock({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className ?? "mt-4"}>
      <p className="font-mono text-[10px] tracking-[0.12em] text-ink-400 uppercase">{label}</p>
      <div className="mt-1 text-sm leading-relaxed break-words text-ink-200">{children}</div>
    </div>
  );
}
