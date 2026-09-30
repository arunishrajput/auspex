/**
 * The one navigation bar, on every page.
 *
 * Before this, only the home page listed the routes and every other page had a bare `← AuspeX`
 * link, so reaching `/agents` from `/markets` meant two clicks through the landing page. A visitor
 * clicking around for four minutes should never have to go back to the top to get somewhere.
 *
 * A server component with no hooks: `current` is passed in rather than read from
 * `usePathname()`, which would make every page that renders a nav a client component and ship
 * React to `/` and `/markets` for the sake of one highlighted link. Known gap #14 in
 * `PROGRESS.md` is about keeping wallet code off the pages a visitor lands on first; this is the
 * same instinct applied to the nav.
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

export type SiteNavProps = {
  /** The route this page is. Highlighted, and rendered as text rather than a link. */
  current: RouteHref;
  /**
   * Short counts beside a route — "3" awaiting review, "2 refused".
   *
   * Optional and sparse on purpose: a nav that always shows seven numbers is a nav nobody reads.
   * Only the home page passes them, because that is the page whose job is to say what needs
   * attention.
   */
  alerts?: Partial<Record<RouteHref, string>>;
};

export function SiteNav({ current, alerts }: SiteNavProps) {
  return (
    <nav
      aria-label="Sections"
      className="-mx-4 mb-8 overflow-x-auto px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <ul className="flex min-w-max items-center gap-1.5">
        {ROUTES.map((route) => {
          const isCurrent = route.href === current;
          const alert = alerts?.[route.href];
          return (
            <li key={route.href}>
              {isCurrent ? (
                <span
                  aria-current="page"
                  className="inline-flex items-center gap-1.5 rounded border border-signal-500/50 bg-signal-500/10 px-2.5 py-1.5 font-mono text-xs text-signal-400"
                >
                  {route.label}
                  {alert !== undefined && <span className="text-warn-500">{alert}</span>}
                </span>
              ) : (
                <Link
                  href={route.href}
                  className="inline-flex items-center gap-1.5 rounded border border-ink-700 bg-ink-850 px-2.5 py-1.5 font-mono text-xs text-ink-200 transition-colors hover:border-signal-500/50 hover:text-signal-400"
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
  );
}
