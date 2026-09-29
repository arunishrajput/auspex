/**
 * The keeper: the three transactions after a human has signed, none of which needs permission.
 *
 *   closeMarket        OPEN and past closeTime            → CLOSED
 *   finalizeResolution RESOLUTION_PROPOSED, window over   → FINALIZED
 *   claim              FINALIZED or INVALIDATED, owed     → paid to the agent's OWNER
 *
 * ## The point of this file is which key signs it
 *
 * All three are **permissionless** in the contract. `closeMarket` and `finalizeResolution` are
 * callable by anyone; `claim` is callable by whoever holds the stake, and pays the registered
 * owner. So the keeper here signs with an **agent wallet** — a key that holds no role at all,
 * capped by the contract, and the only kind of key the deployed application has.
 *
 * That is not a workaround. It is the claim, executed: *nothing privileged is needed to finish a
 * market.* A judge can call `finalizeResolution` themselves from any address and it will work.
 * The counterpart is `invalidateStale`, which is equally permissionless and equally not ours —
 * see why it is deliberately **not** run automatically, below.
 *
 * ## Why claiming reads `previewPayout` and not our own records
 *
 * `previewPayout(marketId, account)` is the contract's own answer to "what would you pay this
 * address right now", and it returns 0 for an unsettled market and for an account that has
 * already claimed. Keying the worker on that instead of on `agent_decisions` means:
 *
 *   - a bet placed outside the normal path is still claimed, because the chain knows about it
 *     even though no decision row does;
 *   - a double claim is impossible for two independent reasons — the contract's `claimed` mapping
 *     reverts with `AlreadyClaimed`, and `previewPayout` returns 0 so we never try;
 *   - there is no number in Postgres that can disagree with the payout.
 *
 * `docs/DECISIONS.md` ADR-050 records this as a deliberate departure from the plan, which said
 * to key the worker on decisions.
 *
 * ## `invalidateStale`, and the grace period that replaced "never" (ADR-066)
 *
 * ADR-057 kept this call out of the keeper entirely, on the grounds that invalidation refunds
 * everyone and destroys the market, so a resolver who is ten minutes late should not cost every
 * bettor their position. That reasoning is right about *ten minutes* and wrong about *forever*:
 * with nothing automated, a market nobody resolves stays `CLOSED` with the stakes locked in the
 * contract permanently, which is a worse outcome for the same bettor it was meant to protect.
 * Market #2 sat in exactly that state until a human noticed.
 *
 * So the call is automated, behind `STALE_GRACE_SECONDS` — a deliberate wait *after* the
 * contract's own `resolveDeadline` before the keeper acts. The late resolver ADR-057 worried
 * about still wins the race; the absent one no longer strands the funds. The decision is still
 * permissionless, so a judge can always make the call themselves, sooner, from their own wallet.
 *
 * Eligibility is read from `getMarket`, never from the projection, and the contract re-checks it:
 * `invalidateStale` reverts with `MarketNotClosed` on anything that is not `OPEN` or `CLOSED`
 * (which is how "has no pending proposal" is enforced — `RESOLUTION_PROPOSED` is neither) and with
 * `ResolveDeadlineNotPassed` inside the window. Two independent gates, as everywhere else here.
 */

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  agentDecisions,
  auditLog,
  chainEvents,
  markets,
  onchainIntents,
  resolutionDrafts,
} from "../db/schema";
import { readMarket, readPreviewPayout, type OnChainMarket } from "../chain/auspex";
import { getProvider } from "../chain/provider";
import { createIntent } from "../intents/engine";
import { listBettingMembers, type MemberRow } from "../agents/members";

/** Markets touched per pass, per stage. Bounded like everything else in a tick. */
const MAX_PER_PASS = 4;

/**
 * Balance an agent wallet must hold to be used as the keeper.
 *
 * 0.0005 tMSTC, against a measured cost of roughly 0.0001 per call at this chain's 1 gwei
 * priority fee and zero base fee. A keeper that cannot pay for its own transaction produces a
 * signed intent that never mines, which is worse than doing nothing — so a pass with no funded
 * candidate reports that rather than trying.
 */
const KEEPER_MIN_BALANCE_WEI = 5n * 10n ** 14n;

/**
 * How long after the contract's `resolveDeadline` the keeper waits before invalidating.
 *
 * This number is the whole of ADR-066's compromise with ADR-057. `invalidateStale` refunds every
 * bettor and ends the market, so acting the instant the deadline passes would let a resolver who
 * is a few minutes late destroy a market nobody wanted destroyed. Waiting forever — which is what
 * not automating it amounted to — strands the stakes instead.
 *
 * One hour, against a `resolveDeadline` that is already 24 hours after close on a real market. A
 * resolver with a day to act and an hour of slack after it is not late, they are absent.
 *
 * Overridable at runtime via `KEEPER_STALE_GRACE_SECONDS` so demo day does not need a deploy.
 */
export const STALE_GRACE_SECONDS = 60 * 60;

function staleGraceSeconds(): number {
  const raw = process.env.KEEPER_STALE_GRACE_SECONDS;
  if (raw === undefined) return STALE_GRACE_SECONDS;
  const parsed = Number(raw);
  // A missing or malformed override must not silently become 0 — that would turn a typo into
  // "refund everyone immediately", which is the one outcome this constant exists to prevent.
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : STALE_GRACE_SECONDS;
}

/**
 * Whether the chain's own view of a market makes it eligible for `invalidateStale`. **Pure.**
 *
 * Mirrors `AuspexMarket.invalidateStale` exactly — `state ∈ {OPEN, CLOSED}` and
 * `block.timestamp > resolveDeadline` — plus our own grace period on top. `RESOLUTION_PROPOSED`
 * failing the state test is what "has no pending proposal" means here: a proposed resolution
 * moves the market out of `CLOSED`, so a pending proposal cannot be invalidated even by a caller
 * who wanted to.
 */
export function staleEligibility(
  market: Pick<OnChainMarket, "state" | "resolveDeadline">,
  nowSeconds: number,
  graceSeconds: number = STALE_GRACE_SECONDS,
): { ok: true } | { ok: false; reason: string } {
  if (market.state === "RESOLUTION_PROPOSED") {
    return {
      ok: false,
      reason:
        "a resolution is proposed and inside its challenge window — the contract reverts with " +
        "MarketNotClosed, and finalizeResolution is the call that finishes it",
    };
  }
  if (market.state !== "OPEN" && market.state !== "CLOSED") {
    return { ok: false, reason: `the market is already ${market.state}` };
  }
  if (nowSeconds <= market.resolveDeadline) {
    return {
      ok: false,
      reason:
        `the resolver still has until ${new Date(market.resolveDeadline * 1000).toISOString()} — ` +
        "the contract reverts with ResolveDeadlineNotPassed",
    };
  }
  if (nowSeconds <= market.resolveDeadline + graceSeconds) {
    return {
      ok: false,
      reason:
        `the resolve-by time has passed but the keeper waits ${graceSeconds}s beyond it before ` +
        `refunding, so a late resolver is not overruled by a cron job (ADR-066). Anyone may call ` +
        `invalidateStale now if they would rather have the refund.`,
    };
  }
  return { ok: true };
}

export type SettleReport = {
  /** Markets whose `closeMarket` transition was queued. */
  closed: number;
  /** Markets whose challenge window has elapsed and whose finalisation was queued. */
  finalized: number;
  /** Markets past `resolveDeadline` (plus grace) with no proposal, whose refund was queued. */
  invalidated: number;
  /** (market, agent) pairs owed something, whose claim was queued. */
  claimed: number;
  /**
   * Total wei the contract says it will pay across those claims, as a decimal string.
   *
   * A string and not a `bigint`, because this report is returned as JSON by `POST /api/tick` and
   * `JSON.stringify` throws on a `bigint` — a 500 on the endpoint the cron calls, from a field
   * added for a log line. Same convention as every wei column in `schema.ts`, for the same reason.
   */
  claimableWei: string;
  /** Draft rows brought up to date from a settled intent. */
  reconciled: number;
  /** Why the pass did less than it could have. */
  notes: string[];
};

function emptyReport(): SettleReport {
  return {
    closed: 0,
    finalized: 0,
    invalidated: 0,
    claimed: 0,
    claimableWei: "0",
    reconciled: 0,
    notes: [],
  };
}

/**
 * An agent wallet with enough balance to pay for a permissionless call.
 *
 * Deliberately **not** the deployer: production has no deployer key, and a keeper that only works
 * locally is a keeper that does not work. Picking the richest funded agent rather than a fixed one
 * means a single drained wallet does not stop the pipeline finishing markets.
 */
export async function pickKeeper(
  members: readonly MemberRow[],
): Promise<{ ok: true; member: MemberRow; balanceWei: bigint } | { ok: false; reason: string }> {
  if (members.length === 0) {
    return { ok: false, reason: "no member has an agent wallet, so there is no keeper to sign with" };
  }

  const provider = getProvider();
  let best: { member: MemberRow; balanceWei: bigint } | null = null;

  for (const member of members) {
    const balanceWei = await provider.getBalance(member.agentAddress);
    if (balanceWei < KEEPER_MIN_BALANCE_WEI) continue;
    if (best === null || balanceWei > best.balanceWei) best = { member, balanceWei };
  }

  if (best === null) {
    return {
      ok: false,
      reason:
        `no agent wallet holds the ${KEEPER_MIN_BALANCE_WEI} wei needed to pay for a ` +
        `permissionless call, so nothing was queued rather than queueing a transaction that ` +
        `could not mine`,
    };
  }
  return { ok: true, ...best };
}

/**
 * Markets the indexer believes are live, with their ids. The chain is then asked about each.
 *
 * `scanLimit` bounds the `eth_call`s one stage can make. The claim stage passes a larger one
 * because it filters on `previewPayout` rather than on the projection, so it has to look at every
 * market that *could* be settled, not just the handful the projection already labels that way.
 */
async function indexedMarkets(states: readonly string[], scanLimit = MAX_PER_PASS * 3) {
  return db
    .select({
      rowId: markets.id,
      onchainId: markets.onchainId,
      question: markets.question,
      proposalId: markets.proposalId,
    })
    .from(markets)
    .where(and(isNotNull(markets.onchainId), inArray(markets.state, states as never)))
    .orderBy(markets.onchainId)
    .limit(scanLimit);
}

/** Markets the claim stage scans per pass. Reads are free on this chain; writes stay at `limit`. */
const MAX_CLAIM_SCAN = 50;

/**
 * Runs one settlement pass: close, finalize, claim, reconcile.
 *
 * Never throws — it is a tick stage. Every stage inside is independently bounded and each one
 * reads the **chain** before acting, because all three of these transactions revert if the state
 * has moved, and the projection is by construction a little behind.
 */
export async function runSettlePass(
  options: { now?: Date; limit?: number } = {},
): Promise<SettleReport> {
  const report = emptyReport();
  const now = options.now ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const limit = options.limit ?? MAX_PER_PASS;
  const provider = getProvider();

  // Always first, and unconditionally: a pass that queues nothing should still learn that the
  // resolution a human signed last tick has confirmed.
  report.reconciled = await reconcileDrafts();

  const members = await listBettingMembers();
  const keeper = await pickKeeper(members);
  if (!keeper.ok) {
    report.notes.push(keeper.reason);
  }

  // --- 1. closeMarket ------------------------------------------------------------------------
  //
  // Purely cosmetic for safety — betting is gated on `closeTime` in the contract, so a market
  // nobody closes cannot take a late bet. It exists to make the transition an indexable event
  // instead of an implicit one, which is what lets `/markets` show CLOSED rather than "OPEN, but
  // actually not".
  if (keeper.ok) {
    let queued = 0;
    for (const market of await indexedMarkets(["OPEN"])) {
      if (queued >= limit) break;
      if (market.onchainId === null) continue;
      const onChain = await readMarket(market.onchainId, provider);
      if (onChain.state !== "OPEN" || nowSeconds < onChain.closeTime) continue;

      await createIntent({
        // One close per market, ever. The contract reverts a second attempt with MarketNotOpen.
        idempotencyKey: `market:${market.onchainId}:close`,
        kind: "CLOSE_MARKET",
        from: keeper.member.agentAddress,
        functionName: "closeMarket",
        args: [market.onchainId],
      });
      await db.insert(auditLog).values({
        actor: `keeper:${keeper.member.agentAddress}`,
        action: "market.close_queued",
        subjectType: "market",
        subjectId: market.rowId,
        reason:
          `Market #${market.onchainId} is past its close time, so closeMarket was queued. The ` +
          `call is permissionless and is signed by an agent wallet holding no role — betting was ` +
          `already impossible because the contract gates it on closeTime directly.`,
        metadata: { onchainId: market.onchainId },
      });
      report.closed += 1;
      queued += 1;
    }
  }

  // --- 2. finalizeResolution -----------------------------------------------------------------
  //
  // The one transaction in the whole system that no privileged party can block. Queued as soon
  // as the window has elapsed, from a wallet with no role, which is the whole demonstration.
  if (keeper.ok) {
    let queued = 0;
    for (const market of await indexedMarkets(["RESOLUTION_PROPOSED"])) {
      if (queued >= limit) break;
      if (market.onchainId === null) continue;
      const onChain = await readMarket(market.onchainId, provider);
      if (onChain.state !== "RESOLUTION_PROPOSED") continue;
      if (nowSeconds < onChain.challengeEndsAt) continue;

      await createIntent({
        // Keyed on the challenge count as well as the market: a market challenged and
        // re-proposed legitimately needs a second finalisation, and it is a different one.
        idempotencyKey: `market:${market.onchainId}:finalize:${onChain.challengeCount}`,
        kind: "FINALIZE_RESOLUTION",
        from: keeper.member.agentAddress,
        functionName: "finalizeResolution",
        args: [market.onchainId],
      });
      await db.insert(auditLog).values({
        actor: `keeper:${keeper.member.agentAddress}`,
        action: "resolution.finalize_queued",
        subjectType: "market",
        subjectId: market.rowId,
        reason:
          `The challenge window on market #${market.onchainId} closed at ` +
          `${new Date(onChain.challengeEndsAt * 1000).toISOString()} with ` +
          `${onChain.challengeCount} challenge(s) recorded, so finalizeResolution was queued. ` +
          `This call is permissionless: no privileged party — including us — can block the ` +
          `payout by going silent.`,
        metadata: {
          onchainId: onChain.onchainId,
          outcome: onChain.outcome,
          challengeCount: onChain.challengeCount,
        },
      });
      report.finalized += 1;
      queued += 1;
    }
  }

  // --- 3. invalidateStale --------------------------------------------------------------------
  //
  // The refund path for a market no resolver ever came back to. Permissionless, like the two
  // above, and gated on the chain's own `resolveDeadline` plus a grace period so a late resolver
  // is not overruled by a cron job (ADR-066). `RESOLUTION_PROPOSED` is excluded by the state test
  // inside `staleEligibility`, and the contract re-checks both conditions itself.
  if (keeper.ok) {
    let queued = 0;
    const grace = staleGraceSeconds();
    for (const market of await indexedMarkets(["OPEN", "CLOSED"])) {
      if (queued >= limit) break;
      if (market.onchainId === null) continue;

      // The chain, not the projection: the projection can say CLOSED about a market somebody
      // resolved thirty seconds ago, and invalidating that one would be the worst bug in here.
      const onChain = await readMarket(market.onchainId, provider);
      const eligible = staleEligibility(onChain, nowSeconds, grace);
      if (!eligible.ok) continue;

      await createIntent({
        // One invalidation per market, ever. The contract reverts a second attempt with
        // MarketNotClosed, because the first one moved it to INVALIDATED.
        idempotencyKey: `market:${market.onchainId}:invalidate-stale`,
        kind: "INVALIDATE_STALE",
        from: keeper.member.agentAddress,
        functionName: "invalidateStale",
        args: [market.onchainId],
      });
      await db.insert(auditLog).values({
        actor: `keeper:${keeper.member.agentAddress}`,
        action: "market.invalidate_queued",
        subjectType: "market",
        subjectId: market.rowId,
        reason:
          `Market #${market.onchainId} passed its resolve-by time of ` +
          `${new Date(onChain.resolveDeadline * 1000).toISOString()} with no resolution proposed, ` +
          `and the ${grace}s grace period after it has elapsed too, so invalidateStale was queued. ` +
          `Every bettor is refunded their exact stake; nobody wins. The call is permissionless and ` +
          `is signed by an agent wallet holding no role — a judge could have made it themselves.`,
        metadata: {
          onchainId: market.onchainId,
          resolveDeadline: onChain.resolveDeadline,
          graceSeconds: grace,
          poolYesWei: onChain.poolYesWei.toString(),
          poolNoWei: onChain.poolNoWei.toString(),
        },
      });
      report.invalidated += 1;
      queued += 1;
    }
  }

  // --- 4. claim ------------------------------------------------------------------------------
  //
  // One claim per (settled market, agent) pair the contract says it owes. Signed by the agent
  // itself and paid to the registered owner — a stolen agent key cannot redirect a payout.
  //
  // ## Why the candidate list is not filtered on the projection's state
  //
  // It used to be `indexedMarkets(["FINALIZED", "INVALIDATED"])`, which means a market this very
  // pass invalidated is invisible to this stage until the indexer catches up — the refund waits
  // a whole tick behind the transaction that made it claimable. The candidates now come from
  // every settle-able projection state and **the chain decides**, which is the rule the rest of
  // this file already follows.
  //
  // ## Why this claims only for agent wallets, and cannot do more
  //
  // `claim(marketId)` pays `msg.sender`'s position and nobody else's — there is no
  // `claimFor(address)`, deliberately, because a pull-based payout is what stops one reverting
  // receiver breaking the loop for everyone. So the only positions a keeper can ever settle are
  // the ones whose key it holds: the registered agent wallets. A bettor who staked from their own
  // wallet claims from their own wallet, and no amount of code here changes that. `/markets/[id]`
  // shows what the contract owes every address, claimed or not, so nobody has to be told.
  {
    let queued = 0;
    const settled = await indexedMarkets(
      ["OPEN", "CLOSED", "RESOLUTION_PROPOSED", "FINALIZED", "INVALIDATED"],
      MAX_CLAIM_SCAN,
    );
    for (const market of settled) {
      if (queued >= limit) break;
      if (market.onchainId === null) continue;
      const onChain = await readMarket(market.onchainId, provider);
      if (onChain.state !== "FINALIZED" && onChain.state !== "INVALIDATED") continue;

      for (const member of members) {
        if (queued >= limit) break;
        // The contract's own number. Zero means unsettled, nothing staked, a losing side, or
        // already claimed — every one of which is a reason not to send a transaction.
        const owedWei = await readPreviewPayout(market.onchainId, member.agentAddress, provider);
        if (owedWei === 0n) continue;

        await createIntent({
          // One claim per market per agent, ever. The contract's `claimed` mapping is the
          // independent guarantee behind this one.
          idempotencyKey: `market:${market.onchainId}:claim:${member.agentAddress}`,
          kind: "CLAIM",
          from: member.agentAddress,
          functionName: "claim",
          args: [market.onchainId],
        });
        await db.insert(auditLog).values({
          actor: `agent:${member.agentAddress}`,
          action: "payout.claim_queued",
          subjectType: "market",
          subjectId: market.rowId,
          reason:
            `previewPayout says the contract owes ${owedWei} wei on market ` +
            `#${market.onchainId} to ${member.handle}'s agent, so claim was queued. The funds ` +
            `are paid to the registered owner ${member.ownerAddress}, not to the agent wallet ` +
            `that signs the transaction — the contract enforces that, not our code.`,
          metadata: {
            onchainId: market.onchainId,
            handle: member.handle,
            agentAddress: member.agentAddress,
            ownerAddress: member.ownerAddress,
            owedWei: owedWei.toString(),
            outcome: onChain.outcome,
          },
        });
        report.claimed += 1;
        report.claimableWei = (BigInt(report.claimableWei) + owedWei).toString();
        queued += 1;
      }
    }
  }

  return report;
}

/**
 * Brings `resolution_drafts` up to date with the intents they produced.
 *
 * An `APPROVED` draft whose intent **reverted** is the interesting case: a human signed it and
 * the chain refused it, usually because someone else resolved the market in the meantime. The
 * draft goes back to `PENDING_REVIEW` so the resolver can act on the market's real state, with
 * the revert reason recorded — and *not* to `REJECTED`, because the human did not reject it.
 *
 * Idempotent: every UPDATE is guarded on the status it expects to find.
 */
export async function reconcileDrafts(): Promise<number> {
  const settled = await db
    .select({
      draftId: resolutionDrafts.id,
      intentStatus: onchainIntents.status,
      txHash: onchainIntents.txHash,
      blockNumber: onchainIntents.blockNumber,
      revertReason: onchainIntents.revertReason,
    })
    .from(resolutionDrafts)
    .innerJoin(onchainIntents, eq(resolutionDrafts.intentId, onchainIntents.id))
    .where(
      and(
        eq(resolutionDrafts.status, "APPROVED"),
        inArray(onchainIntents.status, ["REVERTED", "ABANDONED"]),
      ),
    );

  let updated = 0;

  for (const row of settled) {
    const detail =
      row.intentStatus === "REVERTED"
        ? `the contract refused it: ${row.revertReason ?? "reason not decoded"}`
        : "the transaction was never broadcast successfully";

    await db
      .update(resolutionDrafts)
      .set({
        status: "PENDING_REVIEW",
        rejectionReason:
          `A resolver signed this outcome and ${detail}. Nothing was resolved. The draft is back ` +
          `in the queue so it can be signed against the market's current state.`,
        intentId: null,
        reviewedAt: null,
        reviewedBy: null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(resolutionDrafts.id, row.draftId), eq(resolutionDrafts.status, "APPROVED")),
      );

    await db.insert(auditLog).values({
      actor: "system:resolver",
      action: "resolution.propose_failed",
      subjectType: "resolution_draft",
      subjectId: row.draftId,
      reason: `A signed proposeResolution did not take effect — ${detail}.`,
      txHash: row.txHash,
    });

    updated += 1;
  }

  return updated;
}

/**
 * What the contract would pay each agent wallet on one market, right now.
 *
 * Used by the market detail page. Reads `previewPayout` per agent, so the number shown is the
 * number the contract will transfer — never a parimutuel figure this codebase computed and hoped
 * matched.
 */
export async function payoutsFor(
  onchainId: number,
): Promise<{ handle: string; agentAddress: string; ownerAddress: string; owedWei: bigint }[]> {
  const members = await listBettingMembers();
  const provider = getProvider();

  const rows = await Promise.all(
    members.map(async (member) => ({
      handle: member.handle,
      agentAddress: member.agentAddress,
      ownerAddress: member.ownerAddress,
      owedWei: await readPreviewPayout(onchainId, member.agentAddress, provider),
    })),
  );

  return rows.filter((row) => row.owedWei > 0n);
}

/**
 * Every intent in one market's lifecycle, oldest first. Rendered on the market detail page.
 *
 * ## Three ways an intent belongs to a market, because the keys were chosen at three different times
 *
 * An idempotency key is derived from the business fact that authorised the write, and those facts are
 * not all "a market id":
 *
 *   `market:<id>:…`             the calls that happen once a market exists — bets, close, propose,
 *                               challenge, finalize, claim, invalidate
 *   `proposal:<id>:create-market`  `createMarket` itself, which cannot be keyed on a market id
 *                               because the id does not exist until the transaction confirms
 *   `agent_decisions.intent_id` a Phase 5 bet, keyed on the **decision** that authorised it, which is
 *                               the right key for that fact and the wrong one for this query
 *
 * All three are matched. The alternative — showing only what one prefix finds — made market #4 render
 * a lifecycle table containing `createMarket` and nothing else, underneath a caption claiming the
 * market had been "bet on by a capped agent". True in the world, absent from the table: exactly the
 * kind of quiet mismatch hard rule #2 exists to prevent.
 */
export async function lifecycleIntentsFor(
  onchainId: number,
  proposalId?: string | null,
  marketRowId?: string | null,
) {
  const clauses = [sql`${onchainIntents.idempotencyKey} like ${`market:${onchainId}:%`}`];

  if (proposalId !== undefined && proposalId !== null) {
    clauses.push(
      sql`${onchainIntents.idempotencyKey} = ${`proposal:${proposalId}:create-market`}`,
    );
  }
  if (marketRowId !== undefined && marketRowId !== null) {
    clauses.push(
      sql`${onchainIntents.id} in (
        select ${agentDecisions.intentId} from ${agentDecisions}
         where ${agentDecisions.marketId} = ${marketRowId}
           and ${agentDecisions.intentId} is not null
      )`,
    );
  }

  const filter = sql.join(clauses, sql` or `);

  return db
    .select({
      kind: onchainIntents.kind,
      status: onchainIntents.status,
      signer: onchainIntents.signer,
      fromAddress: onchainIntents.fromAddress,
      txHash: onchainIntents.txHash,
      blockNumber: onchainIntents.blockNumber,
      revertReason: onchainIntents.revertReason,
      valueWei: onchainIntents.valueWei,
      createdAt: onchainIntents.createdAt,
    })
    .from(onchainIntents)
    .where(sql`(${filter})`)
    .orderBy(onchainIntents.createdAt);
}

/**
 * One row of the market detail page's lifecycle table.
 *
 * `origin` is the honest part. `INTENT` means this system decided to send the transaction and has
 * its own record of doing so. `CHAIN` means the log exists and no intent row does — the
 * transaction happened, but not through the intent engine.
 */
export type LifecycleRow = {
  kind: string;
  status: string;
  signer: string;
  fromAddress: string;
  txHash: string | null;
  blockNumber: number | null;
  revertReason: string | null;
  valueWei: string;
  createdAt: Date;
  origin: "INTENT" | "CHAIN";
};

/**
 * Which contract call an event log implies, and which of its arguments names the caller.
 *
 * Only events that carry their actor in an indexed argument are here. `MarketClosed`,
 * `MarketFinalized` and `MarketInvalidated` name no address, and a row whose `signed by` column
 * this file had *guessed* would be worse than a missing row — the signer column is the page's
 * trust claim.
 */
const EVENT_TO_CALL: Record<string, { kind: string; actor: string; amount?: string }> = {
  MarketCreated: { kind: "CREATE_MARKET", actor: "creator" },
  BetPlaced: { kind: "PLACE_BET", actor: "bettor", amount: "amount" },
  ResolutionProposed: { kind: "PROPOSE_RESOLUTION", actor: "resolver" },
  ResolutionChallenged: { kind: "CHALLENGE_RESOLUTION", actor: "challenger" },
  Claimed: { kind: "CLAIM", actor: "claimant" },
};

export type RawChainEvent = {
  eventName: string | null;
  args: Record<string, unknown> | null;
  txHash: string;
  blockNumber: number;
  blockTime: Date | null;
};

/**
 * Merges our intent rows with the chain's own logs, so the table shows everything that happened.
 *
 * **Pure**, and the reason it exists is a real defect rather than tidiness. `/markets/2` rendered
 * a lifecycle table containing one row — the keeper's `closeMarket` — while the chain held a
 * confirmed 0.01 tMSTC `placeBet` on that market from the Phase 1 smoke script. The bet predates
 * the intent engine (Phase 2 built it), so no `onchain_intents` row will ever exist for it. The
 * table was not wrong about any row it printed; it was silently incomplete, which on a page whose
 * whole purpose is "every transaction, and which key signed it" is the same failure hard rule #2
 * is about.
 *
 * The fix is emphatically **not** to write synthetic intent rows for those transactions. That
 * table records what this system *decided to do*, and it never decided to place that bet;
 * inventing the row would put a fabricated decision into the audit trail to make a UI look tidy.
 * Instead the log is shown as what it is, marked `CHAIN`, with the address the contract itself
 * recorded as the actor.
 *
 * De-duplication is by `txHash`: one transaction emits a log *and* has an intent row in the
 * normal case, and only the intent row — which additionally knows about reverts — is kept.
 */
export function mergeLifecycle(
  intents: readonly Omit<LifecycleRow, "origin">[],
  events: readonly RawChainEvent[],
): LifecycleRow[] {
  const known = new Set(
    intents.map((intent) => intent.txHash?.toLowerCase()).filter((hash): hash is string => !!hash),
  );

  const fromChain: LifecycleRow[] = [];
  for (const event of events) {
    if (event.eventName === null || event.args === null) continue;
    if (known.has(event.txHash.toLowerCase())) continue;

    const mapping = EVENT_TO_CALL[event.eventName];
    if (mapping === undefined) continue;

    const actor = event.args[mapping.actor];
    if (typeof actor !== "string" || actor === "") continue;

    const amount = mapping.amount === undefined ? undefined : event.args[mapping.amount];

    fromChain.push({
      kind: mapping.kind,
      // A log only exists because the transaction succeeded. There is no reverted log.
      status: "CONFIRMED",
      // `SERVER` would claim our code signed it and `EXTERNAL` that a browser did. We do not know
      // which, so the signer classifier is given the value that makes it ask the contract about
      // the address instead of believing an enum — the same reasoning as lib/trust/signers.ts.
      signer: "SERVER",
      fromAddress: actor.toLowerCase(),
      txHash: event.txHash,
      blockNumber: event.blockNumber,
      revertReason: null,
      valueWei: typeof amount === "string" ? amount : "0",
      createdAt: event.blockTime ?? new Date(0),
      origin: "CHAIN",
    });
  }

  const all: LifecycleRow[] = [
    ...intents.map((intent) => ({ ...intent, origin: "INTENT" as const })),
    ...fromChain,
  ];

  // Block order is the chain's order and is what a reader checking against MSTScan expects. An
  // intent with no block yet has not mined, so it sorts last, by when it was queued.
  return all.sort((a, b) => {
    const left = a.blockNumber ?? Number.MAX_SAFE_INTEGER;
    const right = b.blockNumber ?? Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

/**
 * The lifecycle table's rows: our intents, plus any chain log they do not account for.
 *
 * Two reads, merged in memory by `mergeLifecycle`. The event query is keyed on the decoded
 * `marketId` argument, which the indexer stores as a decimal string.
 */
export async function lifecycleRowsFor(
  onchainId: number,
  proposalId?: string | null,
  marketRowId?: string | null,
): Promise<LifecycleRow[]> {
  const [intents, events] = await Promise.all([
    lifecycleIntentsFor(onchainId, proposalId, marketRowId),
    db
      .select({
        eventName: chainEvents.eventName,
        args: chainEvents.args,
        txHash: chainEvents.txHash,
        blockNumber: chainEvents.blockNumber,
        blockTime: chainEvents.blockTime,
      })
      .from(chainEvents)
      .where(sql`${chainEvents.args}->>'marketId' = ${String(onchainId)}`)
      .orderBy(chainEvents.blockNumber, chainEvents.logIndex),
  ]);

  return mergeLifecycle(intents, events);
}

export { KEEPER_MIN_BALANCE_WEI };
