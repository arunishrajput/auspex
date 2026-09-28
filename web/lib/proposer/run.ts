/**
 * The proposer pass: confirmed events in, review-queue rows out.
 *
 * Bounded twice over. At most `MAX_EVENTS_PER_PASS` events are considered per tick, and the
 * LLM budget passed in is the real ceiling — a pass that runs out of budget stops and the next
 * tick picks up where it left off. Nothing here loops until the work is done, for the same
 * reason nothing else in the pipeline does: a tick has to finish inside a 60-second function.
 *
 * **Idempotency is `UNIQUE(proposals.event_id)`.** Two ticks racing on the same confirmed event
 * produce one row; the loser's insert conflicts and is discarded. That is also why a transient
 * model failure must not write a row — see the header of `draft.ts`.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { auditLog, eventItems, events, proposals, rawItems, sources } from "../db/schema";
import { publisherDomain, resolvePublisher } from "../news/sources";
import type { LlmBudget } from "../llm/client";
import { draftProposal, type DraftOptions, type ProposalInput } from "./draft";

/** Confirmed events *drafted* per tick. One is usually enough; the queue is for humans. */
const MAX_EVENTS_PER_PASS = 2;

/**
 * Confirmed events examined to find that many draftable ones.
 *
 * Bigger than `MAX_EVENTS_PER_PASS` because an event can be confirmed and still have no usable
 * resolution source (see `eligibleSources`). Without the headroom, two such events at the head
 * of the queue would block every tick from ever reaching a draftable one behind them.
 */
const MAX_EVENTS_SCANNED = 10;

export type ProposeReport = {
  /** Confirmed events with no proposal row at the start of the pass. */
  pending: number;
  attempted: number;
  proposed: number;
  schemaRejected: number;
  /** Events left alone because no model answered. They are retried next tick. */
  unavailable: number;
  /**
   * Events passed over because not one of their articles came from an allowlisted publisher, so
   * there was no resolution source we could vouch for. No row is written: a later tick may
   * attach a known publisher to the same story, and then it becomes draftable.
   */
  skippedNoSource: number;
  /** Why the pass stopped early, when it did. */
  haltedBecause: string | null;
};

/**
 * Confirmed events that have never been proposed on, newest confirmation first.
 *
 * `LEFT JOIN … WHERE proposals.id IS NULL` rather than a `NOT IN` subquery: it is the same
 * plan and it makes the invariant visible — an event leaves this queue the moment *any*
 * proposal row exists for it, including a `SCHEMA_REJECTED` one.
 */
export async function pendingProposalEvents(limit: number) {
  return db
    .select({ id: events.id, title: events.title, confirmedAt: events.confirmedAt })
    .from(events)
    .leftJoin(proposals, eq(proposals.eventId, events.id))
    .where(and(eq(events.status, "CONFIRMED"), isNull(proposals.id)))
    .orderBy(desc(events.confirmedAt))
    .limit(limit);
}

/**
 * The URL that goes on chain as a market's resolution source. **Pure.**
 *
 * ## The problem this solves, found by reading real output
 *
 * The first live proposer run put
 * `https://news.google.com/rss/articles/CBMiqAFBVV95cUxQUkp6…` on a spec. Phase 3 gets the
 * *publisher* right — it reads Google News's `<source url>` element rather than trusting the
 * link — but `raw_items.url` is still the aggregator's redirect, and a value that is fine for
 * "click through to read" is not fine for "this is where the outcome is settled". It is opaque
 * to anyone reading MSTScan, aggregator redirects expire, and it does not demonstrably belong
 * to the publisher we credited the story to.
 *
 * ## Why the obvious fix was wrong
 *
 * The first attempt simply excluded redirect links. Measured against the live database, that
 * starved the pipeline completely: **every** confirmed event's articles were Google News
 * redirects. That is structural, not bad luck — confirmation requires two independent
 * publishers, and only the aggregator carries one story from several of them. The four direct
 * publisher feeds each cover different stories, so their items form single-publisher events
 * that stay `OBSERVED` by design.
 *
 * ## What it does instead
 *
 * Returns a URL that is real, owned by the credited publisher, and stable — three properties
 * the redirect lacks:
 *
 *  - a **direct** article link on the publisher's own domain is used as-is
 *  - anything else falls back to `https://<publisher-domain>/`
 *
 * The fallback is weaker and it is labelled as such: `direct: false` becomes a warning the
 * reviewer sees before approving. It is still a coherent spec, because "where to look" and
 * "what to look for" are separate fields — `resolutionCriteria` carries the exact fact. And it
 * is never fabricated: the domain comes from our own publisher allowlist, not from the model.
 */
export function resolutionUrlFor(
  url: string,
  domain: string,
  allowlisted: boolean,
): { url: string; direct: boolean } | null {
  // An unknown publisher is good enough to read and not good enough to be the place a market's
  // outcome is settled — the line Phase 3 draws for confirmation, drawn again where it matters
  // more. There is also nothing to fall back to: we cannot vouch for the domain either.
  if (!allowlisted) return null;

  const host = publisherDomain(url);
  const sameDomain = host !== null && host === domain;
  // `edition.cnn.com` and `cnn.com` are the same publisher; `news.google.com` is not.
  const samePublisher =
    host !== null &&
    (() => {
      const viaHost = resolvePublisher(host);
      const viaDomain = resolvePublisher(domain);
      return viaHost !== null && viaDomain !== null && viaHost.domain === viaDomain.domain;
    })();

  if (sameDomain || samePublisher) return { url, direct: true };
  return { url: `https://${domain}/`, direct: false };
}

/**
 * The articles behind one event, best-matching first, each with the URL it would resolve at.
 *
 * The order is the labelling order: `SOURCE_1` is the article closest to the cluster seed. The
 * same rule reproduces the labels on `/review` (see `queue.ts`), so the label shown beside an
 * article is the label the model was actually given.
 */
async function eligibleSources(eventId: string): Promise<ProposalInput["articles"]> {
  const rows = await db
    .select({
      title: rawItems.title,
      summary: rawItems.summary,
      url: rawItems.url,
      domain: sources.domain,
      allowlisted: sources.allowlisted,
      injectionFlags: rawItems.injectionFlags,
    })
    .from(eventItems)
    .innerJoin(rawItems, eq(eventItems.rawItemId, rawItems.id))
    .innerJoin(sources, eq(rawItems.sourceId, sources.id))
    .where(eq(eventItems.eventId, eventId))
    .orderBy(desc(eventItems.similarity));

  return rows.flatMap((row) => {
    const resolution = resolutionUrlFor(row.url, row.domain, row.allowlisted);
    if (resolution === null) return [];
    return [
      {
        title: row.title,
        summary: row.summary,
        articleUrl: row.url,
        resolutionUrl: resolution.url,
        directLink: resolution.direct,
        domain: row.domain,
        injectionFlags: row.injectionFlags,
      },
    ];
  });
}

/**
 * Runs one proposer pass.
 *
 * Never throws: it is a tick stage, and `tick.ts` already treats a thrown stage as a recorded
 * failure. Returning a report instead means a pass that proposed one market and then hit a
 * rate limit still reports the market it proposed.
 */
export async function runProposerPass(
  budget: LlmBudget,
  options: DraftOptions & { limit?: number } = {},
): Promise<ProposeReport> {
  const limit = options.limit ?? MAX_EVENTS_PER_PASS;
  const candidates = await pendingProposalEvents(MAX_EVENTS_SCANNED);

  const report: ProposeReport = {
    pending: candidates.length,
    attempted: 0,
    proposed: 0,
    schemaRejected: 0,
    unavailable: 0,
    skippedNoSource: 0,
    haltedBecause: null,
  };

  for (const event of candidates) {
    if (report.attempted >= limit) break;
    if (budget.remaining === 0) {
      report.haltedBecause = `LLM budget spent after ${report.attempted} of ${candidates.length} events`;
      break;
    }

    const articles = await eligibleSources(event.id);
    if (articles.length === 0) {
      // Not a rejection: nothing about the draft was wrong, because no draft was attempted. A
      // row here would be terminal against UNIQUE(event_id) and would permanently bar a story
      // that might gain a known publisher on the very next tick.
      report.skippedNoSource += 1;
      continue;
    }

    report.attempted += 1;

    const outcome = await draftProposal(
      { eventId: event.id, eventTitle: event.title, articles },
      budget,
      options,
    );

    if (outcome.kind === "UNAVAILABLE") {
      report.unavailable += 1;
      report.haltedBecause = outcome.reason;
      // No row, so the event stays in the queue. Log it anyway — "nothing happened" and
      // "nothing ran" are indistinguishable from the outside otherwise (hard rule #7).
      await db.insert(auditLog).values({
        actor: "system:proposer",
        action: "proposal.deferred",
        subjectType: "event",
        subjectId: event.id,
        reason: `No model answered, so no proposal was written: ${outcome.reason}`,
      });
      // A model that is unavailable for one event is unavailable for the next one too.
      break;
    }

    if (outcome.kind === "REJECTED") {
      const [inserted] = await db
        .insert(proposals)
        .values({
          eventId: event.id,
          status: "SCHEMA_REJECTED",
          rejectionReason: outcome.reason,
          rawModelOutput: outcome.rawModelOutput,
          model: outcome.model,
        })
        .onConflictDoNothing({ target: proposals.eventId })
        .returning({ id: proposals.id });

      if (inserted !== undefined) {
        report.schemaRejected += 1;
        await db.insert(auditLog).values({
          actor: "system:proposer",
          action: "proposal.schema_rejected",
          subjectType: "proposal",
          subjectId: inserted.id,
          reason: outcome.reason,
          metadata: { eventId: event.id, model: outcome.model },
        });
      }
      continue;
    }

    const [inserted] = await db
      .insert(proposals)
      .values({
        eventId: event.id,
        // Straight to PENDING_REVIEW: DRAFTED and VALIDATED are states of one synchronous
        // function, and persisting them would invent work for a later tick to redo.
        status: "PENDING_REVIEW",
        // `spec` holds the MarketSpec and NOTHING else. `specHash` is keccak256 of its
        // canonical JSON, and approval re-derives that hash from this column to check the row
        // has not been edited underneath the human. One extra key here would change the hash
        // and break that check — which is why warnings live in their own column.
        spec: outcome.spec,
        specHash: outcome.specHash,
        warnings: outcome.warnings,
        rawModelOutput: outcome.rawModelOutput,
        model: outcome.model,
      })
      .onConflictDoNothing({ target: proposals.eventId })
      .returning({ id: proposals.id });

    if (inserted !== undefined) {
      report.proposed += 1;
      await db.insert(auditLog).values({
        actor: "system:proposer",
        action: "proposal.queued",
        subjectType: "proposal",
        subjectId: inserted.id,
        reason:
          `Drafted "${outcome.spec.question}" resolving at ${outcome.resolutionSource.domain}. ` +
          `Awaiting human approval — nothing is on chain and no one has been notified.`,
        metadata: {
          eventId: event.id,
          specHash: outcome.specHash,
          model: outcome.model,
          warnings: outcome.warnings,
        },
      });
    }
  }

  return report;
}
