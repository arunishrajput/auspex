/**
 * Where a number on screen came from.
 *
 * Hard rule #2 says mock data must never be presented as real. A rule like that is only worth
 * anything if it is *mechanical*, so this component turns "is this real?" into a value that a
 * page has to supply, a badge a reader can see, a checker CI can run, and a throw that stops a
 * production render.
 *
 * ## The origins are different trust claims, not decoration
 *
 * They are ordered from "the chain said so" to "we made it up", and the distinctions are the ones
 * a sceptical reader would actually press on:
 *
 *   `CHAIN`        an `eth_call` or RPC read made during *this request*. Nothing between the
 *                  contract and the screen. The strongest claim on the site.
 *   `INDEXED`      Postgres, written by the indexer from a confirmed contract log. Real, and
 *                  possibly a few blocks stale — which is a different claim from `CHAIN` and is
 *                  why it is not called the same thing.
 *   `DB`           Postgres, written by our own pipeline: gate decisions, drafts, audit rows.
 *                  Real records of what this system did, not assertions about the chain.
 *   `COMPUTED`     derived at request time by the same pure function the pipeline calls. Real
 *                  behaviour over a real input.
 *   `CONSTRUCTED`  a synthetic input we wrote, labelled as one. The injection worked example on
 *                  the home page is the only use: the *input* is ours, everything computed from
 *                  it is real. Allowed in production precisely because it says so on the page.
 *   `MOCK`         invented and passed off as real. **Never permitted in production.**
 *
 * ## What actually stops `MOCK`
 *
 * Three independent things, because a badge alone is a convention and conventions rot:
 *
 *   1. `scripts/check-provenance.mjs` fails CI if the token `MOCK` appears anywhere in `app/`,
 *      `components/` or `lib/` outside this file. No call site can even name it.
 *   2. `provenanceRefusal()` below returns a message for `MOCK` in production, and the component
 *      throws it. A statically rendered page therefore fails `next build`; a dynamic one fails
 *      the request. Either way nothing invented is ever *shown*.
 *   3. The badge itself is loud, so a `MOCK` that somehow reached a screen is unmissable rather
 *      than blending in.
 *
 * The check is a source scan plus a runtime throw rather than a grep of the bundle, and that is
 * deliberate: this file contains the string `MOCK` by necessity, so the token is in every bundle
 * whether or not any page uses it. A bundle grep would either always fail or need an exception
 * wide enough to be useless. The scan of *prerendered HTML* in the checker is the one build-output
 * test that can tell a call site from this branch, because prerendered HTML contains only what a
 * page actually rendered.
 */

import type { ReactNode } from "react";

export type DataOrigin = "CHAIN" | "INDEXED" | "DB" | "COMPUTED" | "CONSTRUCTED" | "MOCK";

/** Badge styling and the one-line explanation shown on hover. Pure, so it is testable. */
export const ORIGIN_META: Record<DataOrigin, { className: string; blurb: string }> = {
  CHAIN: {
    className: "border-ok-500/40 bg-ok-500/10 text-ok-500",
    blurb: "Read from the MST Testnet RPC during this request. Not cached, not stored.",
  },
  INDEXED: {
    className: "border-signal-500/40 bg-signal-500/10 text-signal-500",
    blurb:
      "Postgres, written by the indexer from a confirmed contract log. Real, and up to a few blocks behind the chain.",
  },
  DB: {
    className: "border-ink-600 bg-ink-800 text-ink-300",
    blurb:
      "Postgres, written by this system's own pipeline — a record of what it did, not a claim about the chain.",
  },
  COMPUTED: {
    className: "border-human-500/40 bg-human-500/10 text-human-500",
    blurb:
      "Derived during this request by the same pure function the pipeline calls. Real behaviour over a real input.",
  },
  CONSTRUCTED: {
    className: "border-warn-500/40 bg-warn-500/10 text-warn-500",
    blurb:
      "A synthetic input written by hand and labelled as one. Everything computed from it is real.",
  },
  MOCK: {
    className: "border-bad-500 bg-bad-500/20 text-bad-500",
    blurb: "INVENTED DATA. Forbidden in production — see CLAUDE.md hard rule #2.",
  },
};

/**
 * The reason a render must be refused, or null when it may proceed. **Pure.**
 *
 * Split out from the component so it can be tested without a DOM, and so the rule is one
 * expression rather than a condition buried in JSX.
 */
export function provenanceRefusal(origin: DataOrigin, nodeEnv: string | undefined): string | null {
  if (origin !== "MOCK") return null;
  if (nodeEnv !== "production") return null;
  return (
    "Refusing to render MOCK provenance in a production build. CLAUDE.md hard rule #2: mock data " +
    "must never be presented as real. This throw is the backstop; scripts/check-provenance.mjs " +
    "is the check that should have caught it first."
  );
}

export type ProvenanceProps = {
  origin: DataOrigin;
  /** What specifically was read — `getMarket(#4)`, `agent_decisions`, `scanForInjection()`. */
  detail?: string;
  /** Rendered after the badge, so a caption can read "CHAIN · getMarket(#4) — pools below". */
  children?: ReactNode;
  className?: string;
};

/**
 * The badge. Inline by default so it can sit in a caption or a table header.
 *
 * `data-provenance` is on the element deliberately: it is what `check-provenance.mjs` looks for in
 * prerendered HTML, and it lets a reader confirm the label in devtools rather than trusting the
 * colour.
 */
export function Provenance({ origin, detail, children, className }: ProvenanceProps) {
  const refusal = provenanceRefusal(origin, process.env.NODE_ENV);
  if (refusal !== null) throw new Error(refusal);

  const meta = ORIGIN_META[origin];

  return (
    <span
      className={`inline-flex flex-wrap items-baseline gap-1.5 align-baseline ${className ?? ""}`}
    >
      <span
        data-provenance={origin}
        title={meta.blurb}
        className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wider uppercase ${meta.className}`}
      >
        {origin}
      </span>
      {detail !== undefined && (
        <span className="font-mono text-[11px] break-all text-ink-400">{detail}</span>
      )}
      {children}
    </span>
  );
}

/** Every origin except the forbidden one, for the legend on `/trust`. */
export const DOCUMENTED_ORIGINS: readonly DataOrigin[] = [
  "CHAIN",
  "INDEXED",
  "DB",
  "COMPUTED",
  "CONSTRUCTED",
];
