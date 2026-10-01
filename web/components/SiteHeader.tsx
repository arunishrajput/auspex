/**
 * The one site header, on every page, stuck to the top of the viewport.
 *
 * It replaces `SiteNav`, which was a row of pills rendered *inside* each page's content column.
 * Two things were wrong with that. It scrolled away, so a visitor four screens into `/trust` had
 * to go back to the top to get anywhere; and it was laid out by seven call sites, which is why
 * `/markets/[id]` had no nav at all — nobody remembered to add it. The header is now rendered by
 * `PageShell`, so a page gets it by existing rather than by remembering.
 *
 * Still a server component with no hooks. `current` is passed in rather than read from
 * `usePathname()`, which would make every page that renders a header a client component and ship
 * React to `/` and `/markets` for the sake of one highlighted link. Known gap #14 in
 * `PROGRESS.md` is about keeping wallet code off the pages a visitor lands on first; this is the
 * same instinct applied to the chrome.
 *
 * The mobile layout has no menu button for the same reason: a disclosure needs state, state needs
 * a client component, and seven short labels fit in a scroller. Two rows under `sm`, one above.
 *
 * The current route is marked in the accent rather than in `signal`. `signal` means "read from
 * or linked to the chain" everywhere else on the site, and spending it on "you are here" would
 * make the one loud colour in the chrome look like a claim about data. The accent exists to carry
 * furniture and is checked to stay ΔE-distant from all five semantic tones.
 */

import Link from "next/link";

export const ROUTES = [
  { href: "/", label: "Overview" },
  { href: "/markets", label: "Markets" },
  { href: "/review", label: "Review" },
  { href: "/agents", label: "Agents" },
  { href: "/resolve", label: "Resolve" },
  { href: "/trust", label: "Trust" },
  { href: "/audit", label: "Audit" },
] as const;

export type RouteHref = (typeof ROUTES)[number]["href"];

export type SiteHeaderProps = {
  /** The route this page is. Highlighted, and rendered as text rather than a link. */
  current: RouteHref;
  /**
   * Short counts beside a route — "3" awaiting review, "2 refused".
   *
   * Optional and sparse on purpose: a header that always shows seven numbers is a header nobody
   * reads. Only the home page passes them, because that is the page whose job is to say what
   * needs attention.
   */
  alerts?: Partial<Record<RouteHref, string>>;
};

/**
 * The wordmark: the same mark the browser tab shows, drawn with tokens instead of literals.
 *
 * Three proposals in, one decision out, through a gate — the geometry is `app/icon.svg` and the
 * meaning is the product. The colours are the semantic tones on purpose, and this is the one
 * place that is allowed: a logo is not a reading of the data, and a mark assembled out of the
 * page's own vocabulary says what the page is about before anyone scrolls.
 */
function Wordmark() {
  return (
    <Link
      href="/"
      className="group flex shrink-0 items-center gap-2.5"
      aria-label="AuspeX — overview"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-ink-800 bg-ink-900 transition-colors group-hover:border-ink-600">
        <svg viewBox="0 0 32 32" className="size-5" aria-hidden="true">
          <path
            d="M7 9h8M7 16h12M7 23h8"
            stroke="var(--color-signal-500)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <path
            d="M23 6v20"
            stroke="var(--color-human-500)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle cx="23" cy="16" r="3.5" fill="var(--color-ok-500)" />
        </svg>
      </span>
      <span className="font-display text-lg leading-none font-extrabold tracking-tight text-ink-100">
        AuspeX
      </span>
    </Link>
  );
}

/**
 * The header's one call to action points at `/trust`, which is where a sceptical visitor should
 * go first. On `/trust` itself that would be a button that does nothing, so there it points at
 * the log instead — still the same offer, one step further along.
 */
function ctaFor(current: RouteHref) {
  return current === "/trust"
    ? { href: "/audit", label: "Read the log" }
    : { href: "/trust", label: "Check the claims" };
}

export function SiteHeader({ current, alerts }: SiteHeaderProps) {
  const cta = ctaFor(current);
  return (
    <header className="sticky top-0 z-50 border-b border-ink-800 bg-ink-950/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-6 sm:px-6">
        <div className="flex items-center justify-between gap-3 sm:contents">
          <Wordmark />
          {/* The call to action sits on the first row at every width: on a phone it is the only
              thing beside the wordmark, and on a wide screen it moves to the far right. */}
          <Link
            href={cta.href}
            className="rounded-full bg-accent-500 px-3.5 py-1.5 font-mono text-[11px] font-semibold tracking-[0.1em] text-ink-950 uppercase transition-colors hover:bg-accent-600 sm:order-last"
          >
            {cta.label}
          </Link>
        </div>

        <nav
          aria-label="Sections"
          className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:flex-1 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <ul className="flex min-w-max items-center gap-0.5">
            {ROUTES.map((route) => {
              const isCurrent = route.href === current;
              const alert = alerts?.[route.href];
              return (
                <li key={route.href}>
                  {isCurrent ? (
                    <span
                      aria-current="page"
                      className="inline-flex items-center gap-1.5 rounded-full bg-accent-500/12 px-3 py-1.5 font-mono text-[11px] font-medium tracking-[0.06em] text-accent-600 uppercase"
                    >
                      {route.label}
                      {alert !== undefined && <span className="text-warn-500">{alert}</span>}
                    </span>
                  ) : (
                    <Link
                      href={route.href}
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[11px] tracking-[0.06em] text-ink-400 uppercase transition-colors hover:bg-ink-900 hover:text-ink-100"
                    >
                      {route.label}
                      {alert !== undefined && <span className="text-warn-500">{alert}</span>}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
