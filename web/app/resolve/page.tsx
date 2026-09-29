import Link from "next/link";
import { explorerUrl, shortHash } from "@/lib/chain";
import { hasDatabase } from "@/lib/db/client";
import { humanAuthorityAddress, humanResolverAddress } from "@/lib/approval/authority";
import {
  challengeableMarkets,
  decidedResolutions,
  pendingResolutions,
  resolutionCounters,
  type DraftRow,
} from "@/lib/resolution/dashboard";
import { RESOLUTION_RULES } from "@/lib/resolution/validate";
import { readChallengeWindow } from "@/lib/chain/auspex";
import { ChallengeControls, ResolutionControls } from "./ResolutionControls";
import { ResolveProviders, ResolverGate } from "./ResolverGate";
import { SettleButton } from "./SettleButton";

/**
 * `/resolve` — the second human gate, and the one that decides who gets paid.
 *
 * `/review` decides whether a market exists. This decides what its answer is, which is the moment
 * money actually moves. So the page is built around the same principle and applies it harder:
 *
 * 1. **The outcome is a checklist with a quote in it.** The resolver is not asked to agree with a
 *    summary. They are given the exact sentence the model says settles it, and the link to the
 *    article it came from, and the validator has already confirmed that sentence is really in that
 *    article. The remaining job is one Ctrl-F — which is a job a human can actually do well.
 *
 * 2. **Refusals sit beside resolutions.** A resolution log that showed only what got signed would
 *    be evidence of nothing. Hard rule #7.
 *
 * 3. **The challenge window is shown as a live countdown read from the chain.** Not from our
 *    projection: "is the window still open?" changes every three seconds and is the one question
 *    where a stale answer produces a reverted transaction in front of an audience.
 *
 * Read live on every request. A draft that was signed thirty seconds ago must not still offer a
 * sign button.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Resolve — AuspeX",
  description:
    "AI drafts an outcome with evidence. A human reads the quote, checks the source, and signs.",
};

export default async function ResolvePage() {
  const resolver = humanResolverAddress();
  const authority = humanAuthorityAddress();
  const sharedWithCreator =
    resolver !== null && authority !== null && resolver === authority;

  if (!hasDatabase()) {
    return (
      <Shell resolver={resolver} sharedWithCreator={sharedWithCreator} challengeWindow={null}>
        <Panel tone="warn" title="DATABASE_URL is not configured on this deployment.">
          The resolution queue lives in Postgres. This page shows the real reason it cannot be read
          rather than an empty queue, because an empty queue and an unreachable one look identical
          and mean opposite things.
        </Panel>
      </Shell>
    );
  }

  let pending: DraftRow[] = [];
  let decided: DraftRow[] = [];
  let challengeable: Awaited<ReturnType<typeof challengeableMarkets>> = [];
  let counters = {
    pendingReview: 0,
    approved: 0,
    rejected: 0,
    schemaRejected: 0,
    stale: 0,
    awaitingDraft: 0,
  };
  let error: string | null = null;

  try {
    [pending, decided, challengeable, counters] = await Promise.all([
      pendingResolutions(8),
      decidedResolutions(10),
      challengeableMarkets(),
      resolutionCounters(),
    ]);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const challengeWindow = await readChallengeWindow().catch(() => null);

  return (
    <Shell
      resolver={resolver}
      sharedWithCreator={sharedWithCreator}
      challengeWindow={challengeWindow}
    >
      {error !== null && (
        <Panel tone="warn" title="resolution queue unavailable">
          <span className="font-mono text-xs break-words">{error}</span>
          <br />
          The Neon free tier scales to zero, so the first request after a quiet period can take
          10–25 seconds. Slow is not broken.
        </Panel>
      )}

      {/* Counters. Real queries, never constants. */}
      <section className="mb-8 overflow-hidden rounded-lg border border-ink-700 bg-ink-900">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-800 px-4 py-2.5">
          <span className="live-dot size-2 rounded-full bg-ok-500" />
          <span className="font-mono text-xs text-ink-300">
            closed market → AI drafts an outcome → human signs → challenge window → payout
          </span>
          <div className="ml-auto">
            <SettleButton />
          </div>
        </div>
        <dl className="grid grid-cols-2 divide-ink-800 sm:grid-cols-4 sm:divide-x">
          <Stat label="Awaiting a draft" value={counters.awaitingDraft}>
            closed, no outcome drafted yet
          </Stat>
          <Stat label="Waiting for a human" value={counters.pendingReview} tone="warn">
            drafted, unsigned
          </Stat>
          <Stat label="Signed on chain" value={counters.approved} tone="ok">
            proposeResolution sent
          </Stat>
          <Stat
            label="Refused"
            value={counters.rejected + counters.schemaRejected}
            tone="bad"
          >
            {counters.schemaRejected} by the validator, {counters.rejected} by a human
          </Stat>
        </dl>
      </section>

      {/* A resolution inside its challenge window: the one place a human can veto on chain. */}
      {challengeable.length > 0 && (
        <section className="mb-8">
          <SectionLabel>Inside the challenge window</SectionLabel>
          <ul className="mt-3 space-y-4">
            {challengeable.map((item) => (
              <li
                key={item.marketRowId}
                className="overflow-hidden rounded-lg border border-signal-500/40 bg-signal-500/5"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-signal-500/20 px-4 py-2.5">
                  <span className="font-mono text-xs text-ink-400">#{item.chain.onchainId}</span>
                  <span className="rounded border border-signal-500/40 bg-signal-500/10 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-signal-500 uppercase">
                    resolution proposed · {item.chain.outcome}
                  </span>
                  <span className="font-mono text-[11px] text-ink-400">
                    by {shortHash(item.chain.proposedBy, 8, 6)}
                  </span>
                </div>
                <div className="px-4 py-3">
                  <p className="text-sm text-ink-100">{item.question}</p>
                  {item.chain.evidenceUrl !== "" && (
                    <p className="mt-2 font-mono text-[11px]">
                      <span className="text-ink-400">evidence on chain </span>
                      <a
                        href={item.chain.evidenceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-signal-500 underline-offset-2 hover:underline"
                      >
                        {item.chain.evidenceUrl}
                      </a>
                    </p>
                  )}
                </div>
                <ChallengeControls
                  marketRowId={item.marketRowId}
                  onchainId={item.chain.onchainId}
                  challengeEndsAt={item.chain.challengeEndsAt}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The queue. */}
      <section className="mb-10">
        <SectionLabel>Drafted outcomes waiting for a human</SectionLabel>

        {pending.length === 0 ? (
          <div className="mt-3 rounded-lg border border-ink-700 bg-ink-900 px-4 py-8 text-center">
            <p className="text-ink-300">Nothing is waiting to be resolved.</p>
            <p className="mt-2 text-xs leading-relaxed text-ink-400">
              {counters.awaitingDraft > 0
                ? `${counters.awaitingDraft} closed market(s) have no drafted outcome yet — the ` +
                  `resolution agent runs once per tick and reports "not settled yet" until an ` +
                  `article actually reports the answer.`
                : "No market has closed without being resolved. A market appears here once betting " +
                  "ends and the resolution agent finds an article that settles its question."}
            </p>
          </div>
        ) : (
          <ul className="mt-3 space-y-5">
            {pending.map((draft) => (
              <DraftCard key={draft.id} draft={draft} signable />
            ))}
          </ul>
        )}
      </section>

      {/* What the validator checks, stated so the queue above is legible. */}
      <section className="mb-10">
        <SectionLabel>What every draft had to pass before it reached this page</SectionLabel>
        <ol className="mt-3 space-y-1.5 rounded-lg border border-ink-700 bg-ink-900 px-4 py-3">
          {RESOLUTION_RULES.map((rule, index) => (
            <li key={rule} className="flex gap-2 text-xs leading-relaxed text-ink-300">
              <span className="font-mono text-ink-500">{index + 1}.</span>
              {rule}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
          These run in <span className="font-mono">lib/resolution/validate.ts</span>, which is pure —
          no network, no database, no clock — so every branch is pinned by a unit test. The model is
          never asked for a confidence score: a human reads every draft, so there is no threshold for
          a self-assessment to inform, and a number on this page would invite being read as a gate.
        </p>
      </section>

      {/* Decided, including the validator's own refusals. */}
      <section>
        <SectionLabel>Already decided — including what was refused</SectionLabel>
        {decided.length === 0 ? (
          <p className="mt-3 rounded-lg border border-ink-700 bg-ink-900 px-4 py-6 text-center text-xs text-ink-400">
            No resolution has been decided yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-5">
            {decided.map((draft) => (
              <DraftCard key={draft.id} draft={draft} signable={false} />
            ))}
          </ul>
        )}
      </section>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const STATUS_STYLE: Record<string, string> = {
  PENDING_REVIEW: "border-warn-500/40 bg-warn-500/10 text-warn-500",
  APPROVED: "border-ok-500/40 bg-ok-500/10 text-ok-500",
  REJECTED: "border-bad-500/40 bg-bad-500/10 text-bad-500",
  SCHEMA_REJECTED: "border-bad-500/40 bg-bad-500/10 text-bad-500",
  STALE: "border-ink-600 bg-ink-800 text-ink-400",
  UNSETTLED: "border-ink-600 bg-ink-800 text-ink-400",
};

const OUTCOME_STYLE: Record<string, string> = {
  YES: "text-ok-500",
  NO: "text-bad-500",
  INVALID: "text-warn-500",
  UNRESOLVED: "text-ink-400",
};

function DraftCard({ draft, signable }: { draft: DraftRow; signable: boolean }) {
  return (
    <li className="overflow-hidden rounded-lg border border-ink-700 bg-ink-900">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-800 px-4 py-2.5">
        <span className="font-mono text-xs text-ink-400">
          {draft.onchainId === null ? "off chain" : `#${draft.onchainId}`}
        </span>
        <span
          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wide uppercase ${
            STATUS_STYLE[draft.status] ?? "border-ink-600 bg-ink-800 text-ink-300"
          }`}
        >
          {draft.status.replace(/_/g, " ")}
        </span>
        {draft.status !== "SCHEMA_REJECTED" && (
          <span className="font-mono text-[11px]">
            <span className="text-ink-400">proposes </span>
            <span className={OUTCOME_STYLE[draft.outcome] ?? "text-ink-200"}>{draft.outcome}</span>
          </span>
        )}
        <span className="font-mono text-[11px] text-ink-500">round {draft.round}</span>
        {draft.chain !== null && (
          <span className="font-mono text-[11px] text-ink-500">
            chain says {draft.chain.state.replace(/_/g, " ").toLowerCase()}
          </span>
        )}
        {draft.onchainId !== null && (
          <Link
            href={`/markets/${draft.onchainId}`}
            className="ml-auto font-mono text-[11px] text-signal-500 underline-offset-2 hover:underline"
          >
            market detail →
          </Link>
        )}
      </div>

      <div className="px-4 py-4">
        <p className="text-ink-100">{draft.question}</p>

        {draft.resolutionCriteria !== null && (
          <Field label="resolves on">
            <span className="text-ink-200">{draft.resolutionCriteria}</span>
          </Field>
        )}

        {draft.settledByQuote !== null && (
          <div className="mt-4">
            <p className="font-mono text-[10px] tracking-wide text-ink-400 uppercase">
              the sentence the outcome rests on — verified to be in the article below
            </p>
            <blockquote className="mt-1.5 border-l-2 border-signal-500/50 pl-3 text-sm leading-relaxed text-ink-100 italic">
              “{draft.settledByQuote}”
            </blockquote>
          </div>
        )}

        {draft.evidenceUrl !== null && (
          <Field label="evidence">
            <a
              href={draft.evidenceUrl}
              target="_blank"
              rel="noreferrer"
              className="break-all text-signal-500 underline-offset-2 hover:underline"
            >
              {draft.evidenceUrl}
            </a>
            <span className="ml-1 text-ink-500">— open it and search for the quote</span>
          </Field>
        )}

        {draft.rationale !== null && (
          <Field label="the agent's reasoning">
            <span className="text-ink-300">{draft.rationale}</span>
          </Field>
        )}

        {draft.warnings.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {draft.warnings.map((warning) => (
              <li
                key={warning}
                className="rounded border border-warn-500/40 bg-warn-500/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-warn-500"
              >
                ⚠ {warning}
              </li>
            ))}
          </ul>
        )}

        {draft.rejectionReason !== null && (
          <div className="mt-4 rounded border border-bad-500/40 bg-bad-500/5 px-2.5 py-2">
            <p className="font-mono text-[10px] tracking-wide text-bad-500 uppercase">
              {draft.status === "SCHEMA_REJECTED" ? "refused by the validator" : "refused, because"}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed break-words text-ink-300">
              {draft.rejectionReason}
            </p>
          </div>
        )}

        {draft.rawModelOutput !== null && draft.status === "SCHEMA_REJECTED" && (
          <details className="mt-3">
            <summary className="cursor-pointer font-mono text-[11px] text-ink-400 hover:text-ink-200">
              what the model actually returned
            </summary>
            <pre className="mt-2 overflow-x-auto rounded border border-ink-800 bg-ink-950 px-3 py-2 font-mono text-[10px] leading-relaxed break-all whitespace-pre-wrap text-ink-400">
              {draft.rawModelOutput}
            </pre>
          </details>
        )}

        <dl className="mt-4 space-y-1.5 border-t border-ink-800 pt-3 font-mono text-[11px]">
          <Row label="drafted">{draft.createdAt.toISOString()}</Row>
          {draft.model !== null && <Row label="model">{draft.model}</Row>}
          {draft.reviewedBy !== null && (
            <Row label="decided by">
              <a
                href={explorerUrl("address", draft.reviewedBy)}
                target="_blank"
                rel="noreferrer"
                className="text-signal-500 underline-offset-2 hover:underline"
              >
                {draft.reviewedBy}
              </a>
              {draft.reviewedAt !== null && (
                <span className="ml-2 text-ink-500">{draft.reviewedAt.toISOString()}</span>
              )}
            </Row>
          )}
          {draft.chainError !== null && (
            <Row label="chain">
              <span className="text-warn-500">unreadable — {draft.chainError}</span>
            </Row>
          )}
        </dl>
      </div>

      {signable && draft.onchainId !== null && draft.status === "PENDING_REVIEW" && (
        <ResolutionControls
          draftId={draft.id}
          onchainId={draft.onchainId}
          outcome={draft.outcome}
          round={draft.round}
          blocked={draft.blockedBecause}
        />
      )}
    </li>
  );
}

function Shell({
  resolver,
  sharedWithCreator,
  challengeWindow,
  children,
}: {
  resolver: string | null;
  sharedWithCreator: boolean;
  challengeWindow: number | null;
  children: React.ReactNode;
}) {
  return (
    <main className="grid-backdrop min-h-dvh">
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        <header className="mb-8">
          <Link
            href="/"
            className="font-mono text-xs text-ink-400 underline-offset-2 hover:text-ink-200 hover:underline"
          >
            ← AuspeX
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink-100 sm:text-4xl">
            Resolve
          </h1>
          <p className="mt-3 max-w-2xl text-ink-300">
            An AI agent reads news published since a market closed and proposes an outcome, quoting
            the sentence it relies on. It cannot send that outcome anywhere. A human opens the
            article, checks the quote, and signs{" "}
            <span className="font-mono text-ink-200">proposeResolution</span> from their own wallet —
            and even then the contract holds the result for a public challenge window
            {challengeWindow !== null ? ` of ${challengeWindow} seconds` : ""} before a single wei
            can be claimed.
          </p>
        </header>

        <ResolveProviders>
          <ResolverGate resolverAddress={resolver} sharedWithCreator={sharedWithCreator}>
            {children}
          </ResolverGate>
        </ResolveProviders>

        <footer className="mt-10 border-t border-ink-800 pt-6">
          <p className="text-xs leading-relaxed text-ink-400">
            <span className="text-ink-300">Resolution is trusted, and this is the honest version
            of what that means.</span>{" "}
            A small set of authorised resolvers submits outcomes with an evidence URL stored on
            chain. What bounds them is not our good intentions: a challenge window must elapse
            before finality, <span className="font-mono">finalizeResolution</span> is
            permissionless so nobody can block a payout by going silent, and{" "}
            <span className="font-mono">invalidateStale</span> is permissionless so a resolver who
            never appears cannot lock funds up either. It is not a decentralised oracle, and the
            README says so in the same words.
          </p>
        </footer>
      </div>
    </main>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[11px] tracking-widest text-ink-400 uppercase">{children}</h2>
  );
}

function Panel({
  tone,
  title,
  children,
}: {
  tone: "warn" | "bad";
  title: string;
  children: React.ReactNode;
}) {
  const border = tone === "warn" ? "border-warn-500/40 bg-warn-500/5" : "border-bad-500/40 bg-bad-500/5";
  const text = tone === "warn" ? "text-warn-500" : "text-bad-500";
  return (
    <div className={`mb-8 rounded-lg border px-4 py-3 ${border}`}>
      <p className={`font-mono text-sm ${text}`}>{title}</p>
      <p className="mt-2 text-xs leading-relaxed text-ink-400">{children}</p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  children,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn" | "bad";
  children?: React.ReactNode;
}) {
  const colour =
    tone === "ok"
      ? "text-ok-500"
      : tone === "warn"
        ? "text-warn-500"
        : tone === "bad"
          ? "text-bad-500"
          : "text-ink-100";
  return (
    <div className="px-4 py-3">
      <dt className="font-mono text-[10px] tracking-wide text-ink-400 uppercase">{label}</dt>
      <dd className={`mt-0.5 font-mono text-xl tabular-nums ${colour}`}>{value}</dd>
      {children !== undefined && (
        <p className="mt-0.5 text-[11px] leading-snug text-ink-500">{children}</p>
      )}
    </div>
  );
}

/** A labelled block. Plain elements, not `dt`/`dd`: these are not inside a `dl`. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <p className="font-mono text-[10px] tracking-wide text-ink-400 uppercase">{label}</p>
      <div className="mt-0.5 text-sm leading-relaxed break-words">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="w-24 shrink-0 text-ink-400">{label}</dt>
      <dd className="min-w-0 break-words text-ink-200">{children}</dd>
    </div>
  );
}
