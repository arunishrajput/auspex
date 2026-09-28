import type { DecodedLog } from "./decode";
import { sortLogs } from "./decode";
import { OUTCOME } from "../chain/auspex";

/**
 * Projecting a log stream into market state. **Pure: no network, no database, no clock.**
 *
 * This is a fold. Feed it every `AuspexMarket` log ever emitted, in chain order, and it
 * returns the current state of every market. Two consequences fall straight out of that:
 *
 * - **Replay is free.** Re-running from block 0 recomputes the same answer from the same
 *   inputs, so the indexer's idempotency does not depend on remembering what it has already
 *   seen. The unique constraint on `chain_events` stops duplicate *rows*; this function is
 *   why duplicate *processing* is harmless.
 * - **It is testable without infrastructure.** The exit criterion "the indexer reconstructs
 *   correct market state from the Phase 1 smoke-test events" is a unit test over fixtures
 *   captured from the real chain, not an integration test that needs a live database.
 *
 * The rules below mirror `AuspexMarket.sol` exactly. Where the contract and this file
 * disagree, the contract is right and this is a bug.
 */

export type ProjectedMarket = {
  onchainId: number;
  specHash: string;
  question: string;
  resolutionSourceUrl: string;
  /** Unix seconds, as the contract stores them. */
  closeTime: number;
  resolveDeadline: number;
  state: "OPEN" | "CLOSED" | "RESOLUTION_PROPOSED" | "FINALIZED" | "INVALIDATED";
  outcome: "UNRESOLVED" | "YES" | "NO" | "INVALID";
  poolYesWei: bigint;
  poolNoWei: bigint;
  evidenceUrl: string | null;
  proposedBy: string | null;
  challengeEndsAt: number | null;
  challengeCount: number;
  creator: string;
  createdTxHash: string;
  createdBlock: number;
  /** Every bet seen, in order. Phase 5 and 6 read these; `/markets` shows the count. */
  bets: ProjectedBet[];
  invalidationReason: string | null;
};

export type ProjectedBet = {
  bettor: string;
  backsYes: boolean;
  amountWei: bigint;
  isAgent: boolean;
  txHash: string;
  blockNumber: number;
  logIndex: number;
};

export type ProjectionResult = {
  markets: Map<number, ProjectedMarket>;
  /** Logs whose event name we know but which the projection ignores, with why. */
  unprojected: number;
  /** Logs we could not decode at all. Non-zero means the ABI and the chain disagree. */
  undecodable: number;
  /** Inputs discarded as repeats of a `(txHash, logIndex)` already seen. */
  duplicates: number;
};

function num(value: string | boolean | undefined): number {
  return Number(value ?? 0);
}

function big(value: string | boolean | undefined): bigint {
  return BigInt(String(value ?? "0"));
}

function str(value: string | boolean | undefined): string {
  return String(value ?? "");
}

/**
 * Folds a log stream into market state.
 *
 * Events that do not change a market — `Claimed`, `AgentRegistered`, `RoleGranted`,
 * `Paused` — are counted, not applied. They are still stored verbatim in `chain_events`;
 * Phases 5 and 6 read them from there. Counting them here means a log can never be silently
 * dropped: every input ends up in exactly one of the three tallies.
 */
export function projectMarkets(logs: DecodedLog[]): ProjectionResult {
  const markets = new Map<number, ProjectedMarket>();
  const seen = new Set<string>();
  let unprojected = 0;
  let undecodable = 0;
  let duplicates = 0;

  for (const log of sortLogs(logs)) {
    // `BetPlaced` ADDS to a pool, so it is the one event where seeing the same log twice
    // silently doubles someone's money. `chain_events` already refuses duplicates with
    // UNIQUE(tx_hash, log_index), but the fold must not depend on its caller having done
    // that: it is called with whatever list it is given, and getting this wrong would
    // overstate a pool on a page that claims to be reading the chain.
    const identity = `${log.txHash}:${log.logIndex}`;
    if (seen.has(identity)) {
      duplicates += 1;
      continue;
    }
    seen.add(identity);

    if (log.eventName === null || log.args === null) {
      undecodable += 1;
      continue;
    }

    const args = log.args;
    const id = num(args.marketId);

    switch (log.eventName) {
      case "MarketCreated": {
        // Idempotent by construction: a replay overwrites the row with identical values
        // rather than appending. `bets` is reset because the fold is total, not incremental.
        markets.set(id, {
          onchainId: id,
          specHash: str(args.specHash),
          question: str(args.question),
          resolutionSourceUrl: str(args.resolutionSourceUrl),
          closeTime: num(args.closeTime),
          resolveDeadline: num(args.resolveDeadline),
          state: "OPEN",
          outcome: "UNRESOLVED",
          poolYesWei: 0n,
          poolNoWei: 0n,
          evidenceUrl: null,
          proposedBy: null,
          challengeEndsAt: null,
          challengeCount: 0,
          creator: str(args.creator).toLowerCase(),
          createdTxHash: log.txHash,
          createdBlock: log.blockNumber,
          bets: [],
          invalidationReason: null,
        });
        break;
      }

      case "BetPlaced": {
        const market = markets.get(id);
        // A bet for a market we never saw created means the log stream is incomplete —
        // skip it rather than fabricate a market with no question text.
        if (market === undefined) {
          unprojected += 1;
          break;
        }
        const amount = big(args.amount);
        const backsYes = args.backsYes === true;
        if (backsYes) market.poolYesWei += amount;
        else market.poolNoWei += amount;
        market.bets.push({
          bettor: str(args.bettor).toLowerCase(),
          backsYes,
          amountWei: amount,
          isAgent: args.isAgent === true,
          txHash: log.txHash,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
        });
        break;
      }

      case "MarketClosed": {
        const market = markets.get(id);
        if (market === undefined) {
          unprojected += 1;
          break;
        }
        market.state = "CLOSED";
        break;
      }

      case "ResolutionProposed": {
        const market = markets.get(id);
        if (market === undefined) {
          unprojected += 1;
          break;
        }
        market.state = "RESOLUTION_PROPOSED";
        market.outcome = OUTCOME[num(args.outcome)] ?? "UNRESOLVED";
        market.evidenceUrl = str(args.evidenceUrl);
        market.proposedBy = str(args.resolver).toLowerCase();
        market.challengeEndsAt = num(args.challengeEndsAt);
        break;
      }

      case "ResolutionChallenged": {
        const market = markets.get(id);
        if (market === undefined) {
          unprojected += 1;
          break;
        }
        // Matches AuspexMarket.challengeResolution: the market drops back to CLOSED and the
        // proposed outcome is discarded, so a challenged resolution leaves no trace of the
        // outcome it proposed. The challenge COUNT survives — `forceInvalidate` needs 3.
        market.state = "CLOSED";
        market.outcome = "UNRESOLVED";
        market.challengeEndsAt = null;
        market.proposedBy = null;
        market.challengeCount += 1;
        break;
      }

      case "MarketFinalized": {
        const market = markets.get(id);
        if (market === undefined) {
          unprojected += 1;
          break;
        }
        market.state = "FINALIZED";
        market.outcome = OUTCOME[num(args.outcome)] ?? "UNRESOLVED";
        break;
      }

      case "MarketInvalidated": {
        const market = markets.get(id);
        if (market === undefined) {
          unprojected += 1;
          break;
        }
        market.state = "INVALIDATED";
        market.outcome = "INVALID";
        market.invalidationReason = str(args.reason);
        break;
      }

      default:
        // Claimed, AgentRegistered, AgentDeactivated, Paused, Unpaused, Role*.
        // Real events, stored verbatim, simply not part of market state.
        unprojected += 1;
    }
  }

  return { markets, unprojected, undecodable, duplicates };
}
