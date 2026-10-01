/**
 * The page scaffold every route shared by copy-paste until now.
 *
 * `main.grid-backdrop` wrapping a centred column appeared verbatim in all eight routes, and
 * three of them wrapped it in a local `Shell` of their own. The column width was the only real
 * difference — dense table pages used `max-w-4xl` and card pages `max-w-5xl` — so that is the
 * one prop.
 *
 * `PageShell` also renders the site header now. It used to be the page's job, which is exactly
 * why `/markets/[id]` never had one: seven call sites remembered and one did not. A route gets
 * the header by existing.
 */

import type { ReactNode } from "react";
import { SiteHeader, type RouteHref } from "@/components/SiteHeader";

const WIDTH = {
  /**
   * Reading column. Long prose, single-column tables, forms.
   *
   * Narrower than `wide` but no longer narrow enough to look misaligned against the header's
   * column, which is what `max-w-4xl` did: the wordmark sat 128px to the left of the page's own
   * `h1`, and that reads as a mistake rather than as a measure. The prose that actually needs a
   * short line — the lede — caps itself at `max-w-2xl` inside `PageHeader`.
   */
  text: "max-w-5xl",
  /** Card grids and anything with four columns of numbers. Matches the header's own column. */
  wide: "max-w-6xl",
} as const;

export type PageShellProps = {
  width?: keyof typeof WIDTH;
  /** Which route this is, for the header. Omitted only by a page that renders its own chrome. */
  current?: RouteHref;
  /** Counts beside a route in the header. Only `/` passes these. */
  alerts?: Partial<Record<RouteHref, string>>;
  children: ReactNode;
};

export function PageShell({ width = "wide", current, alerts, children }: PageShellProps) {
  return (
    <>
      {current !== undefined && <SiteHeader current={current} alerts={alerts} />}
      <main className="grid-backdrop min-h-dvh">
        <div className={`mx-auto ${WIDTH[width]} px-4 py-12 sm:px-6 sm:py-16`}>{children}</div>
      </main>
    </>
  );
}

/**
 * The small accent mark that opens an eyebrow. A filled square rather than a bullet, because at
 * 11px a bullet is a smudge and a square still reads as a deliberate mark.
 */
function Tick() {
  return <span aria-hidden="true" className="inline-block size-1.5 shrink-0 bg-accent-500" />;
}

export type PageHeaderProps = {
  /** The `h1`. One per page. */
  title: ReactNode;
  /**
   * An overline above the title — where this page sits, what it is for. Set in the accent,
   * which is the one place a loud colour is unambiguously safe: it carries no data.
   */
  eyebrow?: ReactNode;
  /** The standfirst. Prose, not a caption; keep it to two or three sentences. */
  lede?: ReactNode;
  /** Provenance badges, status lines — anything that belongs under the lede. */
  children?: ReactNode;
};

export function PageHeader({ title, eyebrow, lede, children }: PageHeaderProps) {
  return (
    <header className="mb-12 border-b border-ink-800 pb-10">
      {eyebrow !== undefined && (
        <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.22em] text-accent-600 uppercase">
          <Tick />
          {eyebrow}
        </p>
      )}
      <h1 className="mt-4 font-display text-[2.6rem] leading-[0.95] font-extrabold tracking-[-0.03em] text-ink-100 sm:text-6xl">
        {title}
      </h1>
      {lede !== undefined && (
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-300 sm:text-[17px]">
          {lede}
        </p>
      )}
      {children !== undefined && <div className="mt-5">{children}</div>}
    </header>
  );
}

export type SectionLabelProps = {
  children: ReactNode;
  className?: string;
};

/**
 * The small-caps heading above a block. Six local copies existed, in four slightly different
 * shapes; the flex wrapper is the superset — it lets a label carry a `<Provenance>` badge
 * beside it, and renders identically when it does not.
 *
 * Margin is deliberately *not* baked in. Two of the six copies had `mb-3` and four did not, and
 * guessing would have moved things on four pages; spacing stays the caller's decision.
 */
export function SectionLabel({ children, className }: SectionLabelProps) {
  return (
    <h2
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] tracking-[0.2em] text-ink-400 uppercase ${className ?? ""}`}
    >
      <Tick />
      {children}
    </h2>
  );
}

/** A titled region with a rule under the label. Pairs with `SectionLabel` for plain blocks. */
export function Section({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-12 ${className ?? ""}`}>
      <SectionLabel className="mb-3">{label}</SectionLabel>
      {children}
    </section>
  );
}

/**
 * The large section opener used where a page is read top to bottom rather than scanned — the
 * numbered chapters on `/`. The number is decorative and marked `aria-hidden`: it tells a reader
 * where they are in a sequence, and a screen reader already has the heading.
 */
export function SectionHead({
  index,
  title,
  note,
  children,
}: {
  /** "01", "02" — the chapter number, rendered large and faint. */
  index: string;
  title: ReactNode;
  /** One line to the right of the title: a provenance badge, a timestamp. */
  note?: ReactNode;
  /** A sentence under the title. */
  children?: ReactNode;
}) {
  return (
    <div className="mb-5 border-t border-ink-800 pt-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <span
          aria-hidden="true"
          className="font-mono text-[11px] font-semibold tracking-[0.2em] text-accent-600 tabular-nums"
        >
          {index}
        </span>
        <h2 className="font-display text-2xl leading-tight font-bold tracking-[-0.02em] text-ink-100 sm:text-[28px]">
          {title}
        </h2>
        {note !== undefined && <div className="ml-auto flex items-center gap-2">{note}</div>}
      </div>
      {children !== undefined && (
        <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-ink-400">{children}</p>
      )}
    </div>
  );
}
