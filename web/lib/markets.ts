import { desc, eq, inArray, isNull } from "drizzle-orm";
import { db, hasDatabase } from "./db/client";
import { chainEvents, markets as marketsTable } from "./db/schema";
import { readAllMarkets, type OnChainMarket } from "./chain/auspex";

/**
 * What `/markets` renders.
 *
 * **The chain is the source of truth and it is read directly.** `getMarketsForDisplay` calls
 * `getMarket()` on the contract for every market and renders those numbers. The indexed rows
 * in Postgres are used only to add things a `view` call cannot give you — the transaction
 * that created each market, and how many bets have been placed — and the page labels them as
 * indexed rather than read.
 *
 * That ordering is deliberate. If the indexer is broken, behind, or the database is asleep,
 * the page still shows correct, live market state instead of stale projections presented as
 * current. The failure mode of a mirror is silently showing yesterday's numbers; this page
 * cannot do that, because it never reads its primary numbers from the mirror.
 */

export type MarketView = OnChainMarket & {
  /** From the indexer. Null when the log has not been indexed (or the DB is unreachable). */
  createdTxHash: string | null;
  createdBlock: number | null;
  /**
   * The address that signed `createMarket`, from the indexed log's own topic — **not**
   * `proposedBy`, which the contract sets at resolution time and is the zero address until then.
   * It is what `marketOrigins` uses to say which markets a human signed for.
   */
  creator: string | null;
  betCount: number | null;
  /** Non-null when the projection in Postgres disagrees with what the chain just said. */
  projectionDrift: string | null;
};

/**
 * A market a human approved whose transaction has not been indexed yet.
 *
 * Deliberately a separate type from `MarketView`: there is no on-chain id, no pool and no
 * state to read, because the contract has never heard of it. Rendering it as a market with
 * empty fields would be claiming something the chain has not said.
 */
export type PendingMarket = {
  specHash: string;
  question: string;
};

export type MarketsPayload = {
  markets: MarketView[];
  /** Approved and signed, not yet confirmed on chain. Shown apart, labelled off-chain. */
  pending: PendingMarket[];
  /** Real error text when the chain could not be read. The page shows it rather than nothing. */
  chainError: string | null;
  /** Real error text when the database could not be read. Markets still render without it. */
  indexError: string | null;
};

type IndexedExtra = {
  createdTxHash: string | null;
  createdBlock: number | null;
  creator: string | null;
  betCount: number;
  state: string;
  poolYesWei: string;
  poolNoWei: string;
};

async function readIndexedExtras(ids: number[]): Promise<Map<number, IndexedExtra>> {
  const out = new Map<number, IndexedExtra>();
  if (ids.length === 0) return out;

  const rows = await db
    .select()
    .from(marketsTable)
    .where(inArray(marketsTable.onchainId, ids));

  const betLogs = await db
    .select({ args: chainEvents.args })
    .from(chainEvents)
    .where(eq(chainEvents.eventName, "BetPlaced"));

  const betsByMarket = new Map<number, number>();
  for (const log of betLogs) {
    const id = Number((log.args as Record<string, string> | null)?.marketId ?? NaN);
    if (Number.isNaN(id)) continue;
    betsByMarket.set(id, (betsByMarket.get(id) ?? 0) + 1);
  }

  for (const row of rows) {
    if (row.onchainId === null) continue;
    out.set(row.onchainId, {
      createdTxHash: row.createdTxHash,
      createdBlock: row.createdBlock,
      creator: row.creator,
      betCount: betsByMarket.get(row.onchainId) ?? 0,
      state: row.state,
      poolYesWei: row.poolYesWei,
      poolNoWei: row.poolNoWei,
    });
  }

  return out;
}

/**
 * Markets approved off-chain whose `MarketCreated` log has not been indexed.
 *
 * `onchain_id IS NULL` is the whole condition: the indexer sets it when it adopts the row by
 * spec hash, so a null id means "the chain has not confirmed this yet" and nothing else.
 */
async function readPendingMarkets(): Promise<PendingMarket[]> {
  const rows = await db
    .select({ specHash: marketsTable.specHash, question: marketsTable.question })
    .from(marketsTable)
    .where(isNull(marketsTable.onchainId))
    .orderBy(desc(marketsTable.createdAt))
    .limit(10);
  return rows;
}

/**
 * Reads every market from the chain, then annotates with indexed detail.
 *
 * Never throws: a chain failure and a database failure are both reported as text the page
 * displays, because a blank page is indistinguishable from "there are no markets" and that
 * distinction is the whole point of the status surface.
 */
export async function getMarketsForDisplay(): Promise<MarketsPayload> {
  let onChain: OnChainMarket[];
  try {
    onChain = await readAllMarkets();
  } catch (error) {
    return {
      markets: [],
      pending: [],
      chainError: error instanceof Error ? error.message : String(error),
      indexError: null,
    };
  }

  if (!hasDatabase()) {
    return {
      markets: onChain.map((m) => ({
        ...m,
        createdTxHash: null,
        createdBlock: null,
        creator: null,
        betCount: null,
        projectionDrift: null,
      })),
      pending: [],
      chainError: null,
      indexError: "DATABASE_URL is not configured for this deployment.",
    };
  }

  let extras = new Map<number, IndexedExtra>();
  let pending: PendingMarket[] = [];
  let indexError: string | null = null;
  try {
    [extras, pending] = await Promise.all([
      readIndexedExtras(onChain.map((m) => m.onchainId)),
      readPendingMarkets(),
    ]);
  } catch (error) {
    indexError = error instanceof Error ? error.message : String(error);
  }

  return {
    chainError: null,
    indexError,
    pending,
    markets: onChain.map((m) => {
      const extra = extras.get(m.onchainId);
      // A disagreement between chain and projection is shown, not smoothed over. It means the
      // indexer is behind (benign, common) or wrong (a bug worth finding immediately).
      let drift: string | null = null;
      if (extra !== undefined) {
        if (extra.state !== m.state) drift = `indexed as ${extra.state}, chain says ${m.state}`;
        else if (extra.poolYesWei !== m.poolYesWei.toString()) drift = "indexed pool differs";
        else if (extra.poolNoWei !== m.poolNoWei.toString()) drift = "indexed pool differs";
      }

      return {
        ...m,
        createdTxHash: extra?.createdTxHash ?? null,
        createdBlock: extra?.createdBlock ?? null,
        creator: extra?.creator ?? null,
        betCount: extra?.betCount ?? null,
        projectionDrift: drift,
      };
    }),
  };
}

/** Recent audit entries, newest first. Used by the indexer status strip on `/markets`. */
export async function getIndexerStatus(): Promise<{
  lastBlock: number | null;
  chainEventCount: number | null;
  error: string | null;
}> {
  if (!hasDatabase()) {
    return { lastBlock: null, chainEventCount: null, error: "DATABASE_URL is not configured." };
  }
  try {
    const { indexerCursors } = await import("./db/schema");
    const [cursor] = await db.select().from(indexerCursors).limit(1);
    const [latest] = await db
      .select({ blockNumber: chainEvents.blockNumber })
      .from(chainEvents)
      .orderBy(desc(chainEvents.blockNumber))
      .limit(1);

    const all = await db.select({ id: chainEvents.id }).from(chainEvents);

    return {
      lastBlock: cursor?.lastBlock ?? latest?.blockNumber ?? null,
      chainEventCount: all.length,
      error: null,
    };
  } catch (error) {
    return {
      lastBlock: null,
      chainEventCount: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
