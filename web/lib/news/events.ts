/**
 * Turning a planned clustering into `events` and `event_items` rows, then applying the
 * two-source rule.
 *
 * ## Cluster identity survives a re-run because the database owns it, not the content
 *
 * `planClusters` proposes a key derived from the cluster's seed article. That key is only ever
 * used to create an event that does not exist yet. Once any member of a cluster already
 * belongs to an event, **that event wins** and new members are attached to it. Without this,
 * an article published earlier than the current seed would arrive, become the new seed, change
 * the derived key, and orphan the event — taking its Phase 4 proposal with it.
 *
 * ## Existing events are never merged
 *
 * A new article can bridge two clusters that are already separate events. We do not merge
 * them: unassigned members attach to the earliest of the two, the split is left alone, and the
 * deferred merge is recorded in `audit_log`.
 *
 * Merging would mean moving `event_items` between events and deleting the emptied one, and
 * `proposals.event_id` cascades on delete — so a routine clustering improvement could silently
 * delete a market proposal a human had already reviewed. The cost of not merging is an event
 * that under-counts its sources and therefore stays `OBSERVED`, which is the same fail-safe
 * direction as ADR-030: the pipeline stalls rather than confirming something it should not.
 */

import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { auditLog, eventItems, events, rawItems, sources } from "../db/schema";
import { comparableTokens } from "./normalize";
import { buildIdf, type IdfTable } from "./similarity";
import {
  MAX_ITEMS_PER_CLUSTER_PASS,
  planClusters,
  type ClusterItem,
  type PairKey,
} from "./cluster";
import { countIndependentSources, type ConfirmationMember } from "./confirm";
import { adjudicateBorderlinePairs, type ItemText } from "./adjudicate";
import type { LlmBudget } from "../llm/client";

/** How far back a clustering pass looks. Older stories are settled; re-reading them is cost. */
const LOOKBACK_HOURS = 48;

export type CandidateItem = {
  id: string;
  title: string;
  summary: string | null;
  contentHash: string;
  publishedAt: Date | null;
  independenceGroup: string;
  allowlisted: boolean;
  /** Headline tokens. Drives both clustering and syndication detection. */
  tokens: Set<string>;
};

/**
 * Loads the items a clustering pass considers: recent, bounded, newest first.
 *
 * `now` is injected rather than read here so the pass is reproducible in a test.
 */
export async function loadCandidates(now: Date): Promise<CandidateItem[]> {
  const since = new Date(now.getTime() - LOOKBACK_HOURS * 3_600_000);

  const rows = await db
    .select({
      id: rawItems.id,
      title: rawItems.title,
      summary: rawItems.summary,
      contentHash: rawItems.contentHash,
      publishedAt: rawItems.publishedAt,
      independenceGroup: sources.independenceGroup,
      allowlisted: sources.allowlisted,
    })
    .from(rawItems)
    .innerJoin(sources, eq(rawItems.sourceId, sources.id))
    .where(gte(rawItems.ingestedAt, since))
    .orderBy(desc(rawItems.ingestedAt))
    .limit(MAX_ITEMS_PER_CLUSTER_PASS);

  return rows.map((row) => ({
    ...row,
    tokens: comparableTokens(row.title),
  }));
}

export type ClusterReport = {
  candidates: number;
  comparisons: number;
  borderlinePairs: number;
  adjudicated: number;
  adjudicationHalted: string | null;
  eventsCreated: number;
  membersAttached: number;
  eventsConfirmed: number;
  deferredMerges: number;
};

/**
 * Runs one clustering + confirmation pass.
 *
 * Two planning passes over the same pure function: the first reports which borderline pairs
 * exist, the second applies whatever verdicts came back. With no LLM configured the second
 * pass receives an empty verdict map and produces exactly the deterministic clustering — so
 * the code path a visitor sees when the model is down is the same one, not a fallback.
 */
export async function runClusteringPass(
  now: Date,
  budget: LlmBudget,
): Promise<ClusterReport> {
  const candidates = await loadCandidates(now);

  const empty: ClusterReport = {
    candidates: candidates.length,
    comparisons: 0,
    borderlinePairs: 0,
    adjudicated: 0,
    adjudicationHalted: null,
    eventsCreated: 0,
    membersAttached: 0,
    eventsConfirmed: 0,
    deferredMerges: 0,
  };
  if (candidates.length === 0) return empty;

  const byId = new Map(candidates.map((item) => [item.id, item]));
  const idf = buildIdf(candidates.map((item) => item.tokens));

  const clusterItems: ClusterItem[] = candidates.map((item) => ({
    id: item.id,
    contentHash: item.contentHash,
    publishedAt: item.publishedAt?.getTime() ?? null,
    tokens: item.tokens,
  }));

  const firstPass = planClusters(clusterItems, idf);

  const texts = new Map<string, ItemText>(
    candidates.map((item) => [
      item.id,
      { title: item.title, summary: item.summary, independenceGroup: item.independenceGroup },
    ]),
  );
  const adjudication = await adjudicateBorderlinePairs(firstPass.undecided, texts, budget);

  const finalPass =
    adjudication.verdicts.size === 0
      ? firstPass
      : planClusters(clusterItems, idf, {
          adjudications: adjudication.verdicts as ReadonlyMap<PairKey, boolean>,
        });

  // Which event, if any, each candidate already belongs to.
  const existing = await db
    .select({ eventId: eventItems.eventId, rawItemId: eventItems.rawItemId })
    .from(eventItems)
    .where(inArray(eventItems.rawItemId, candidates.map((item) => item.id)));

  const eventByItem = new Map(existing.map((row) => [row.rawItemId, row.eventId]));

  // ---------------------------------------------------------------------------------------
  // Persistence. Everything below is written in **batches**, and that is not a micro-
  // optimisation: the first version of this function issued one INSERT per cluster and one
  // confirmation query per event, which against Neon in aws-us-east-1 (~0.5s per round trip
  // from here) made a 200-item tick take **420 seconds**. A Vercel function has 60. The work
  // was never the problem; the number of round trips was.
  // ---------------------------------------------------------------------------------------

  /** Which clusters need a new event, and which already have one. */
  const plans: { cluster: (typeof finalPass.clusters)[number]; priorEventIds: string[] }[] =
    finalPass.clusters.map((cluster) => ({
      cluster,
      // Sorted so the survivor of a would-be merge is the same on every tick.
      priorEventIds: [
        ...new Set(
          cluster.members
            .map((member) => eventByItem.get(member.itemId))
            .filter((id): id is string => id !== undefined),
        ),
      ].sort(),
    }));

  // --- 1. Create every genuinely new event in one statement. --------------------------------

  const newClusters = plans.filter((plan) => plan.priorEventIds.length === 0);
  const eventIdByClusterKey = new Map<string, string>();

  if (newClusters.length > 0) {
    const seenKeys = new Set<string>();
    const rows: (typeof events.$inferInsert)[] = [];

    for (const { cluster } of newClusters) {
      const seed = byId.get(cluster.seedId);
      if (seed === undefined) continue;
      const clusterKey = cluster.proposedKey.slice(0, 128);
      // Two clusters cannot share a seed, but a defensive de-dupe costs nothing and a single
      // INSERT cannot resolve a conflict against a row in its own VALUES list.
      if (seenKeys.has(clusterKey)) continue;
      seenKeys.add(clusterKey);
      rows.push({ clusterKey, title: seed.title, status: "OBSERVED", distinctSourceCount: 0 });
    }

    if (rows.length > 0) {
      // ON CONFLICT on the cluster key: two ticks racing to create the same cluster produce one
      // event, and the loser reads the winner's id back rather than failing. `DO UPDATE` rather
      // than `DO NOTHING` because only the former returns a row for a conflicting insert.
      const created = await db
        .insert(events)
        .values(rows)
        .onConflictDoUpdate({ target: events.clusterKey, set: { updatedAt: new Date() } })
        .returning({ id: events.id, clusterKey: events.clusterKey });

      for (const row of created) eventIdByClusterKey.set(row.clusterKey, row.id);
    }
  }

  // --- 2. Resolve every cluster to its event id. --------------------------------------------

  let eventsCreated = 0;
  let deferredMerges = 0;
  const touchedEventIds = new Set<string>();
  const resolved: { eventId: string; members: typeof finalPass.clusters[number]["members"] }[] = [];

  for (const { cluster, priorEventIds } of plans) {
    let eventId: string | undefined;

    if (priorEventIds.length === 0) {
      eventId = eventIdByClusterKey.get(cluster.proposedKey.slice(0, 128));
      if (eventId !== undefined) eventsCreated += 1;
    } else {
      eventId = priorEventIds[0];
      if (priorEventIds.length > 1) deferredMerges += 1;
    }

    if (eventId === undefined) continue;
    touchedEventIds.add(eventId);
    resolved.push({ eventId, members: cluster.members });
  }

  // --- 3. Attach every member in one statement. ---------------------------------------------

  let membersAttached = 0;
  const memberRows: (typeof eventItems.$inferInsert)[] = [];

  for (const { eventId, members } of resolved) {
    for (const member of members) {
      // Never move an item that already belongs to a different event — see the header note.
      const current = eventByItem.get(member.itemId);
      if (current !== undefined && current !== eventId) continue;
      memberRows.push({
        eventId,
        rawItemId: member.itemId,
        similarity: member.similarity,
        adjudicatedByLlm: member.adjudicatedByLlm,
      });
    }
  }

  if (memberRows.length > 0) {
    const attached = await db
      .insert(eventItems)
      .values(memberRows)
      .onConflictDoNothing({ target: [eventItems.eventId, eventItems.rawItemId] })
      .returning({ rawItemId: eventItems.rawItemId });
    membersAttached = attached.length;
  }

  // --- 4. Record deferred merges, in one statement. -----------------------------------------

  const deferredRows = plans
    .filter((plan) => plan.priorEventIds.length > 1)
    .map((plan) => ({
      actor: "system",
      action: "cluster.merge_deferred",
      subjectType: "event",
      subjectId: plan.priorEventIds[0],
      reason:
        `Clustering would join ${plan.priorEventIds.length} existing events. Not merged: ` +
        `proposals cascade on event delete, so merging could destroy a reviewed proposal. ` +
        `Under-counting sources keeps the event OBSERVED, which is the safe direction.`,
      metadata: { eventIds: plan.priorEventIds },
    }));

  if (deferredRows.length > 0) await db.insert(auditLog).values(deferredRows);

  // --- 5. Confirmation, for every touched event, in two queries. ----------------------------

  const eventsConfirmed = await recomputeConfirmations([...touchedEventIds], idf);

  return {
    candidates: candidates.length,
    comparisons: finalPass.comparisons,
    borderlinePairs: firstPass.undecided.length,
    adjudicated: adjudication.verdicts.size,
    adjudicationHalted: adjudication.haltedBecause,
    eventsCreated,
    membersAttached,
    eventsConfirmed,
    deferredMerges,
  };
}

/**
 * Re-applies the two-source rule to a set of events. Returns how many are newly `CONFIRMED`.
 *
 * Two queries for the whole set, not two per event. Confirmation is recomputed from the
 * database rather than from the plan, so an event that gained a member in an earlier tick is
 * re-evaluated here too.
 *
 * Writes are issued only for events whose state actually changes. On a steady-state tick that
 * is almost none of them: most events are a single article that was already recorded as having
 * one source, and re-writing an unchanged row would turn a read-mostly pass back into 200
 * sequential updates.
 *
 * `confirmedAt` is set once and never moved — it is the moment the claim became true, and
 * rewriting it every tick would destroy the only timestamp that means anything.
 */
export async function recomputeConfirmations(
  eventIds: readonly string[],
  idf: IdfTable,
): Promise<number> {
  if (eventIds.length === 0) return 0;

  const [memberRows, currentRows] = await Promise.all([
    db
      .select({
        eventId: eventItems.eventId,
        itemId: rawItems.id,
        title: rawItems.title,
        independenceGroup: sources.independenceGroup,
        allowlisted: sources.allowlisted,
      })
      .from(eventItems)
      .innerJoin(rawItems, eq(eventItems.rawItemId, rawItems.id))
      .innerJoin(sources, eq(rawItems.sourceId, sources.id))
      .where(inArray(eventItems.eventId, [...eventIds])),
    db
      .select({
        id: events.id,
        status: events.status,
        confirmedAt: events.confirmedAt,
        distinctSourceCount: events.distinctSourceCount,
      })
      .from(events)
      .where(inArray(events.id, [...eventIds])),
  ]);

  const byEvent = new Map<string, ConfirmationMember[]>();
  for (const row of memberRows) {
    const member: ConfirmationMember = {
      itemId: row.itemId,
      independenceGroup: row.independenceGroup,
      allowlisted: row.allowlisted,
      tokens: comparableTokens(row.title),
    };
    const bucket = byEvent.get(row.eventId);
    if (bucket === undefined) byEvent.set(row.eventId, [member]);
    else bucket.push(member);
  }

  const now = new Date();
  const updates: Promise<unknown>[] = [];
  const auditRows: (typeof auditLog.$inferInsert)[] = [];
  let newlyConfirmed = 0;

  for (const current of currentRows) {
    const verdict = countIndependentSources(byEvent.get(current.id) ?? [], idf);
    const alreadyConfirmed = current.status === "CONFIRMED";
    // Only ever OBSERVED → CONFIRMED. Demotion would let a data-loading quirk retract a claim a
    // human may already have acted on; REJECTED is a human decision, made in Phase 4.
    const status = verdict.confirmed || alreadyConfirmed ? "CONFIRMED" : "OBSERVED";

    if (status === current.status && verdict.independentSources === current.distinctSourceCount) {
      continue; // nothing changed — do not spend a round trip saying so.
    }

    updates.push(
      db
        .update(events)
        .set({
          distinctSourceCount: verdict.independentSources,
          status,
          confirmedAt: current.confirmedAt ?? (verdict.confirmed ? now : null),
          updatedAt: now,
        })
        .where(eq(events.id, current.id)),
    );

    if (verdict.confirmed && !alreadyConfirmed) {
      newlyConfirmed += 1;
      auditRows.push({
        actor: "system",
        action: "event.confirmed",
        subjectType: "event",
        subjectId: current.id,
        reason:
          `Reported by ${verdict.independentSources} independent publishers ` +
          `(${verdict.countedGroups.join(", ")}).` +
          (verdict.syndicatedGroups.length > 0
            ? ` Discounted as syndicated copies: ${verdict.syndicatedGroups.join(", ")}.`
            : "") +
          (verdict.ignoredGroups.length > 0
            ? ` Present but not allowlisted, so not counted: ${verdict.ignoredGroups.join(", ")}.`
            : ""),
        metadata: {
          countedGroups: verdict.countedGroups,
          syndicatedGroups: verdict.syndicatedGroups,
          ignoredGroups: verdict.ignoredGroups,
        },
      });
    }
  }

  // Concurrent rather than sequential: these touch distinct rows by primary key, so they
  // cannot deadlock against each other.
  await Promise.all(updates);
  if (auditRows.length > 0) await db.insert(auditLog).values(auditRows);

  return newlyConfirmed;
}

/** Narrow re-export so callers do not reach past this module into the schema. */
export async function countEventsByStatus(): Promise<{ observed: number; confirmed: number }> {
  const rows = await db.select({ status: events.status }).from(events);
  return {
    observed: rows.filter((row) => row.status === "OBSERVED").length,
    confirmed: rows.filter((row) => row.status === "CONFIRMED").length,
  };
}

/** Used by the dashboard. Kept here so the join stays in one place. */
export async function recentEvents(limit = 12) {
  return db
    .select({
      id: events.id,
      title: events.title,
      status: events.status,
      distinctSourceCount: events.distinctSourceCount,
      confirmedAt: events.confirmedAt,
      createdAt: events.createdAt,
    })
    .from(events)
    .orderBy(desc(events.createdAt))
    .limit(limit);
}

/** The articles behind one event, for the dashboard's expandable rows. */
export async function eventMembers(eventIds: readonly string[]) {
  if (eventIds.length === 0) return [];
  return db
    .select({
      eventId: eventItems.eventId,
      rawItemId: rawItems.id,
      title: rawItems.title,
      url: rawItems.url,
      publishedAt: rawItems.publishedAt,
      similarity: eventItems.similarity,
      adjudicatedByLlm: eventItems.adjudicatedByLlm,
      injectionFlags: rawItems.injectionFlags,
      domain: sources.domain,
      independenceGroup: sources.independenceGroup,
      allowlisted: sources.allowlisted,
    })
    .from(eventItems)
    .innerJoin(rawItems, eq(eventItems.rawItemId, rawItems.id))
    .innerJoin(sources, eq(rawItems.sourceId, sources.id))
    .where(and(inArray(eventItems.eventId, [...eventIds])))
    .orderBy(desc(eventItems.similarity));
}
