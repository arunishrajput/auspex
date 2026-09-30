/**
 * The page scaffold every route shared by copy-paste until now.
 *
 * `main.grid-backdrop` wrapping a centred column appeared verbatim in all eight routes, and
 * three of them wrapped it in a local `Shell` of their own. The column width was the only real
 * difference — dense table pages used `max-w-4xl` and card pages `max-w-5xl` — so that is the
 * one prop.
 */

import type { ReactNode } from "react";

const WIDTH = {
  /** Reading column. Long prose, single-column tables, forms. */
  text: "max-w-4xl",
  /** Card grids and anything with four columns of numbers. */
  wide: "max-w-5xl",
} as const;

export type PageShellProps = {
  width?: keyof typeof WIDTH;
  children: ReactNode;
};

export function PageShell({ width = "wide", children }: PageShellProps) {
  return (
    <main className="grid-backdrop min-h-dvh">
      <div className={`mx-auto ${WIDTH[width]} px-4 py-12 sm:px-6 sm:py-16`}>{children}</div>
    </main>
  );
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
    <header className="mb-10">
      {eyebrow !== undefined && (
        <p className="font-mono text-[11px] tracking-[0.18em] text-accent-600 uppercase">
          {eyebrow}
        </p>
      )}
      <h1 className="mt-2 font-display text-4xl leading-[1.05] font-semibold tracking-tight text-ink-100 sm:text-5xl">
        {title}
      </h1>
      {lede !== undefined && (
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-300">{lede}</p>
      )}
      {children !== undefined && <div className="mt-4">{children}</div>}
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
      className={`flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-[11px] tracking-[0.16em] text-ink-400 uppercase ${className ?? ""}`}
    >
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
    <section className={`mb-10 ${className ?? ""}`}>
      <SectionLabel className="mb-3">{label}</SectionLabel>
      {children}
    </section>
  );
}
