import Link from "next/link";
import { Provenance } from "@/components/Provenance";
import {
  Badge,
  Callout,
  EmptyState,
  Mono,
  PageHeader,
  PageShell,
  SectionLabel,
  Stat,
  StatGrid,
  TONE,
  TxLink,
  type Tone,
} from "@/components/ui";
import { hasDatabase } from "@/lib/db/client";
import {
  AUDIT_GROUPS,
  auditActionCounts,
  auditPage,
  cadenceReport,
  isAuditGroup,
  lastTickSummary,
  reasonlessEntries,
  type AuditGroup,
  type CadenceReport,
} from "@/lib/audit";

/**
 * `/audit` — every decision the pipeline made, with the reason it recorded at the time.
 *
 * This page exists because of hard rule #7, and its whole value is in the half of the log that is
 * *refusals*. A system that logged only its successes would be indistinguishable from a system with
 * no gates at all. So the default view is unfiltered — a log whose default hid the boring rows
 * could hide anything — and "refusals" is the one filter singled out in the header.
 *
 * `audit_log` is append-only. Nothing in this codebase updates or deletes a row in it, and the
 * counter at the top reports how many rows carry an empty reason, because "every decision has a
 * reason" is a claim this page is meant to substantiate rather than repeat.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Audit — AuspeX",
  description:
    "Every decision the pipeline made, approved and refused alike, with the reason recorded at the time.",
};

/**
 * What a row *means*, as one of the six semantic tones rather than a class string.
 *
 * This used to return `"text-bad-500"` directly, which made it the seventh place in the app that
 * decided what a refusal looks like. It now returns a claim and `TONE` decides how the claim is
 * drawn — so a refusal on this page and a refusal on `/trust` cannot drift apart, and each one
 * picks up the glyph that keeps it legible in greyscale.
 */
function tone(action: string): Tone {
  if (
    action.endsWith("rejected") ||
    action.endsWith("refused") ||
    action === "intent.reverted" ||
    action === "intent.abandoned" ||
    action === "resolution.challenged" ||
    action === "resolution.propose_failed"
  ) {
    return "bad";
  }
  if (
    action.endsWith("deferred") ||
    action.endsWith("halted") ||
    action === "resolution.unsettled" ||
    action === "intent.retry"
  ) {
    return "warn";
  }
  if (
    action.endsWith("approved") ||
    action.endsWith("confirmed") ||
    action === "resolution.proposed"
  ) {
    return "ok";
  }
  return "quiet";
}

/**
 * Who acted. `human:` is the only one that gets a tone, because a person signing is the one fact
 * on this page that a reader should be able to find by scanning. The rest are neutral: an agent,
 * a keeper and deterministic code are all "the system did this", and tinting them three shades
 * would imply a hierarchy of trust between them that does not exist.
 */
function actorTone(actor: string): string {
  if (actor.startsWith("human:")) return "text-human-500";
  if (actor.startsWith("agent:")) return "text-ink-200";
  if (actor.startsWith("keeper:")) return "text-ink-300";
  return "text-ink-400";
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const group: AuditGroup = isAuditGroup(view) ? view : "all";

  if (!hasDatabase()) {
    return (
      <Shell group={group} total={0} matching={0} reasonless={0} tick={null} cadence={null}>
        <div className="rounded-2xl border border-warn-500/40 bg-warn-500/10 px-4 py-3">
          <p className="font-mono text-sm text-warn-500">
            DATABASE_URL is not configured on this deployment.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-400">
            The audit log lives in Postgres. This page shows the real reason it cannot be read
            rather than an empty log, because an empty log and an unreachable one look identical and
            mean opposite things.
          </p>
        </div>
      </Shell>
    );
  }

  const page = await auditPage(group, 80);
  const [counts, tick, reasonless, cadence] = await Promise.all([
    auditActionCounts().catch(() => []),
    lastTickSummary().catch(() => null),
    reasonlessEntries().catch(() => 0),
    cadenceReport(50),
  ]);

  return (
    <Shell
      group={group}
      total={page.total}
      matching={page.matching}
      reasonless={reasonless}
      tick={tick}
      cadence={cadence}
    >
      {page.error !== null ? (
        <Callout tone="warn" title="audit log unavailable">
          <p className="font-mono break-words">{page.error}</p>
          <p className="mt-2">
            The Neon free tier scales to zero, so the first request after a quiet period can take
            10–25 seconds. Slow is not broken.
          </p>
        </Callout>
      ) : (
        <>
          {counts.length > 0 && (
            <section className="mb-8">
              <SectionLabel>Every action ever recorded, and how often</SectionLabel>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {counts.map((row) => (
                  <Badge key={row.action} tone={tone(row.action)} className="py-1 text-[10px]">
                    <span className="normal-case">{row.action}</span>
                    <span className="ml-1 tabular-nums opacity-70">{row.count}</span>
                  </Badge>
                ))}
              </div>
              {/* The one action id that does not match the name of the feature that writes it.
                  Explained here rather than mapped at display time: a log page that renders
                  something other than what is stored can hide anything. ADR-069. */}
              {counts.some((row) => row.action === "judge.cap_probe") && (
                <p className="mt-3 text-xs leading-relaxed text-ink-500">
                  <Mono>judge.cap_probe</Mono> is the cap probe on <Mono>/trust</Mono>, which was
                  built under an earlier name.
                  This table is append-only and is never migrated, so the label changed and the
                  stored identifier did not — one event keeps one name in a log that cannot be
                  rewritten.
                </p>
              )}
            </section>
          )}

          <section>
            <SectionLabel>{AUDIT_GROUPS[group].label} — newest first</SectionLabel>

            {page.entries.length === 0 ? (
              <div className="mt-3">
                <EmptyState title="No entries match this view yet.">
                  The log is append-only, so this view being empty means nothing of this kind has
                  happened — not that anything was removed.
                </EmptyState>
              </div>
            ) : (
              <ol className="mt-3 space-y-2">
                {page.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="rounded-2xl border border-ink-800 bg-ink-900 px-4 py-2.5"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-mono text-[10px] text-ink-500 tabular-nums">
                        {entry.createdAt.toISOString().replace("T", " ").slice(0, 19)}
                      </span>
                      <span
                        className={`font-mono text-[11px] font-medium ${TONE[tone(entry.action)].text}`}
                      >
                        <span aria-hidden="true">{TONE[tone(entry.action)].glyph} </span>
                        {entry.action}
                      </span>
                      <span className={`font-mono text-[10px] ${actorTone(entry.actor)}`}>
                        {entry.actor}
                      </span>
                      {entry.txHash !== null && (
                        <TxLink hash={entry.txHash} className="ml-auto text-[10px]" />
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed break-words text-ink-300">
                      {entry.reason}
                    </p>
                    {entry.metadata !== null && Object.keys(entry.metadata).length > 0 && (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer font-mono text-[10px] text-ink-500 hover:text-ink-300">
                          metadata
                        </summary>
                        <pre className="mt-1 overflow-x-auto rounded-lg border border-ink-800 bg-ink-850 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed break-all whitespace-pre-wrap text-ink-400">
                          {JSON.stringify(entry.metadata, null, 2)}
                        </pre>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
            )}

            {page.matching > page.entries.length && (
              <p className="mt-3 text-center font-mono text-[11px] text-ink-500">
                showing the most recent {page.entries.length} of {page.matching} matching row(s)
              </p>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}

/** A gap or a duration as something a person reads at a glance. */
function humanMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 90_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * What the pipeline's cadence actually is, read off the log rather than off the cron expression.
 *
 * **This panel is here instead of a sentence.** `heartbeat.yml` asks GitHub for a run twice an
 * hour; GitHub delivered the previous expression 1.6% of the time. Scheduled workflows on a public
 * repository are best-effort — delayed under load, free runners dropped first — so the expression
 * is a request and this is the delivery. Writing a cadence into prose beside that is how a
 * repository ends up making a claim its own logs contradict, which is what Phase 11 was for.
 *
 * **Two numbers, because one of them lies.** The first version of this averaged every tick row and
 * reported 84 minutes — mixing the cron with button presses and local CLI runs, which made the
 * system look four times more live than it is when nobody is watching. That is exactly the
 * impression this panel exists to remove. So "unattended" counts only the ticks the cron delivered,
 * and it appears only once enough rows carry a source to support it.
 */
function Cadence({ cadence }: { cadence: CadenceReport }) {
  if (cadence.error !== null || cadence.all.ticks < 2) return null;

  const unattended = cadence.unattended;
  const haveUnattended = unattended.ticks >= 2 && unattended.meanGapMs !== null;

  return (
    <div className="mt-2 lit-edge rounded-2xl border border-ink-700 bg-ink-900">
      <div className="border-b border-ink-800 px-4 pt-3 pb-2">
        <SectionLabel>Measured cadence — counted from this log, not from the cron expression</SectionLabel>
      </div>
      <StatGrid cols={4}>
        <Stat
          label="Unattended"
          value={haveUnattended ? humanMs(unattended.meanGapMs ?? 0) : "—"}
          tone={
            !haveUnattended
              ? "quiet"
              : (unattended.meanGapMs ?? 0) > 3_600_000
                ? "warn"
                : "ok"
          }
        >
          {haveUnattended ? (
            <>
              mean gap over {unattended.ticks} cron tick(s), {humanMs(unattended.minGapMs ?? 0)}–
              {humanMs(unattended.maxGapMs ?? 0)}
            </>
          ) : (
            <>
              {unattended.ticks === 0 ? "no" : unattended.ticks} cron tick(s) recorded so far, of{" "}
              {cadence.tagged} with a known trigger — needs two to measure a gap
            </>
          )}
        </Stat>
        <Stat label="Any trigger" value={humanMs(cadence.all.meanGapMs ?? 0)}>
          mean gap over {cadence.all.ticks} tick(s), cron and prompted alike
        </Stat>
        <Stat label="Window" value={`${(cadence.all.spanHours ?? 0).toFixed(1)}h`}>
          oldest to newest tick in view
        </Stat>
        {cadence.medianDurationMs === null ? (
          <Stat label="Tick duration" value="—">
            recorded from Phase 11 onward
          </Stat>
        ) : (
          <Stat
            label="Tick duration"
            value={humanMs(cadence.medianDurationMs)}
            tone={
              cadence.budgetMs !== null &&
              cadence.maxDurationMs !== null &&
              cadence.maxDurationMs > cadence.budgetMs * 0.8
                ? "warn"
                : "ok"
            }
          >
            median of {cadence.measuredDurations}
            {cadence.maxDurationMs !== null && <>, worst {humanMs(cadence.maxDurationMs)}</>}
            {cadence.budgetMs !== null && <> against {humanMs(cadence.budgetMs)}</>}
          </Stat>
        )}
      </StatGrid>
      <p className="border-t border-ink-800 px-4 py-2.5 text-[11px] leading-relaxed text-ink-400">
        The schedule in <Mono>heartbeat.yml</Mono> is a <em>request</em>. GitHub delays scheduled
        workflows under load and drops free runners first, so the figures above are what was
        delivered, counted from this log on every request. <strong>Unattended</strong> is the one
        that describes the system with nobody watching; <strong>any trigger</strong> includes the
        Run tick button and local runs. Nothing in this repository states a cadence in prose — if it
        did, it would be wrong by now.
      </p>
    </div>
  );
}

function Shell({
  group,
  total,
  matching,
  reasonless,
  tick,
  cadence,
  children,
}: {
  group: AuditGroup;
  total: number;
  matching: number;
  reasonless: number;
  tick: { reason: string; createdAt: Date } | null;
  cadence: CadenceReport | null;
  children: React.ReactNode;
}) {
  return (
    <PageShell width="text" current="/audit">

      <PageHeader
        eyebrow="Append-only"
        title="Audit"
        lede={
          <>
            Every decision this pipeline made, approved and refused alike, with the reason it
            recorded at the time. The table is append-only — nothing in the codebase updates or
            deletes a row.{" "}
            <Link
              href="/audit?view=refusals"
              className="text-signal-500 underline-offset-2 hover:underline"
            >
              The refusals
            </Link>{" "}
            are the half worth reading: a log of successes alone would be indistinguishable from a
            system with no gates at all.
          </>
        }
      >
        <Provenance origin="DB" detail="audit_log, append-only, ordered by created_at" />
      </PageHeader>

      <div className="mb-10">
        <nav className="flex flex-wrap gap-2">
          {(Object.keys(AUDIT_GROUPS) as AuditGroup[]).map((key) => (
            <Link
              key={key}
              href={key === "all" ? "/audit" : `/audit?view=${key}`}
              className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                key === group
                  ? "border-accent-500/40 bg-accent-500/10 text-accent-600"
                  : "border-ink-700 bg-ink-900 text-ink-400 hover:border-ink-600 hover:text-ink-100"
              }`}
            >
              {AUDIT_GROUPS[key].label}
            </Link>
          ))}
        </nav>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 lit-edge rounded-2xl border border-ink-700 bg-ink-900 px-4 py-2.5 font-mono text-[11px]">
          <span className="text-ink-400">
            <span className="text-ink-100 tabular-nums">{total.toLocaleString("en-US")}</span>{" "}
            entries total
          </span>
          <span className="text-ink-400">
            <span className="text-ink-100 tabular-nums">{matching.toLocaleString("en-US")}</span>{" "}
            in this view
          </span>
          <span className={reasonless === 0 ? "text-ok-500" : "text-bad-500"}>
            {reasonless === 0
              ? "every entry carries a reason"
              : `${reasonless} entr(ies) with a blank reason`}
          </span>
        </div>

        {tick !== null && (
          <div className="mt-2 rounded-2xl border border-ink-800 bg-ink-850 px-4 py-2.5">
            <p className="font-mono text-[10px] tracking-wide text-ink-500 uppercase">
              last pipeline tick — {tick.createdAt.toISOString()}
            </p>
            <p className="mt-1 text-xs leading-relaxed break-words text-ink-400">{tick.reason}</p>
          </div>
        )}

        {cadence !== null && <Cadence cadence={cadence} />}
      </div>

      {children}

      <footer className="mt-12 border-t border-ink-800 pt-6">
        <p className="text-xs leading-relaxed text-ink-400">
          Rows written by <span className="font-mono text-human-500">human:0x…</span> are decisions
          a person signed for with a key no server holds. <Mono>agent:0x…</Mono> rows are proposals
          from a capped AI wallet — most of them refused, by design. <Mono>keeper:0x…</Mono> rows
          are the permissionless calls that finish a market, signed by a wallet holding no role at
          all. The <Mono>system:*</Mono> rows are deterministic code with no discretion.
        </p>
      </footer>
    </PageShell>
  );
}
