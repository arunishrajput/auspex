import { sql, eq } from "drizzle-orm";
import { db } from "../db/client";
import { chainEvents, indexerCursors, markets } from "../db/schema";
import { AUSPEX_MARKET_ADDRESS, DEPLOY_BLOCK } from "../chain/deployment";
import { getProvider } from "../chain/provider";
import { decodeLog, sortLogs, type DecodedLog } from "./decode";
import { projectMarkets, type ProjectedMarket } from "./project";

/**
 * The event indexer.
 *
 * Reads `AuspexMarket` logs with `eth_getLogs`, stores them verbatim, and folds them into the
 * `markets` projection. Run it as often as you like, from wherever you like — the result is
 * the same. Three mechanisms make that true, and they are independent of each other:
 *
 * 1. **`UNIQUE(tx_hash, log_index)` on `chain_events`.** A log identifies itself, so a replay
 *    collides instead of duplicating. Inserts use `ON CONFLICT DO NOTHING`.
 * 2. **The projection is a pure fold** (`project.ts`). Re-processing a log recomputes the same
 *    state rather than adding to it, so "have I seen this before?" is never asked.
 * 3. **The cursor is an optimisation, not a correctness mechanism.** Losing it costs a rescan
 *    and nothing else.
 *
 * Re-org handling is a confirmation depth and no more, which docs/ARCHITECTURE.md §11 states
 * plainly. On a 3-second-block testnet that is honest; on mainnet it would not be.
 */

export const CURSOR_NAME = "auspex_market";

/**
 * Blocks per `eth_getLogs` request.
 *
 * Measured on 2026-09-28: this RPC served a full 0→head range (5.79M blocks) with an address
 * filter in ~450ms, so chunking is not currently required. We chunk anyway — a node that
 * later imposes a range cap would otherwise turn every tick into a hard failure, and the cost
 * of being wrong in this direction is one extra request.
 */
const CHUNK_BLOCKS = 500_000;

/** Blocks left unread below the head. ~9 seconds of chain at 3s blocks. */
const DEFAULT_CONFIRMATIONS = 3;

export type IndexReport = {
  fromBlock: number;
  toBlock: number;
  headBlock: number;
  /** Logs returned by the RPC in this run. */
  logsFetched: number;
  /** Rows actually written — zero on a replay, which is the point. */
  logsInserted: number;
  marketsUpserted: number;
  undecodable: number;
  unprojected: number;
  durationMs: number;
};

async function readCursor(): Promise<{ lastBlock: number; confirmations: number }> {
  const [row] = await db
    .select()
    .from(indexerCursors)
    .where(eq(indexerCursors.name, CURSOR_NAME))
    .limit(1);

  if (row === undefined) {
    // Start one block BELOW the deployment so the deploy block itself is scanned. There is
    // provably nothing below it — the contract did not exist.
    return { lastBlock: DEPLOY_BLOCK - 1, confirmations: DEFAULT_CONFIRMATIONS };
  }
  return { lastBlock: row.lastBlock, confirmations: row.confirmations };
}

async function writeCursor(lastBlock: number, confirmations: number): Promise<void> {
  await db
    .insert(indexerCursors)
    .values({ name: CURSOR_NAME, lastBlock, confirmations })
    .onConflictDoUpdate({
      target: indexerCursors.name,
      set: { lastBlock, confirmations, updatedAt: new Date() },
    });
}

/** Rewinds the cursor. The next run re-reads everything; the result is unchanged. */
export async function resetCursor(toBlock = DEPLOY_BLOCK - 1): Promise<void> {
  await writeCursor(toBlock, DEFAULT_CONFIRMATIONS);
}

/**
 * Fetches logs for a block range, chunked.
 *
 * `fromBlock` below the deployment block is clamped to it and reported, rather than silently
 * accepted: asking for block 0 is a legitimate "replay everything" request, and the honest
 * answer is that everything starts at block 5,786,343.
 */
export async function fetchLogs(fromBlock: number, toBlock: number): Promise<DecodedLog[]> {
  const provider = getProvider();
  const start = Math.max(fromBlock, DEPLOY_BLOCK);
  const out: DecodedLog[] = [];

  for (let from = start; from <= toBlock; from += CHUNK_BLOCKS) {
    const to = Math.min(from + CHUNK_BLOCKS - 1, toBlock);
    const logs = await provider.getLogs({
      address: AUSPEX_MARKET_ADDRESS,
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) out.push(decodeLog(log));
  }

  return sortLogs(out);
}

/** Stores logs verbatim. Returns how many were genuinely new. */
async function persistLogs(
  logs: DecodedLog[],
  blockTimes: Map<number, Date>,
): Promise<number> {
  if (logs.length === 0) return 0;

  const rows = logs.map((log) => ({
    txHash: log.txHash,
    logIndex: log.logIndex,
    blockNumber: log.blockNumber,
    blockHash: log.blockHash,
    blockTime: blockTimes.get(log.blockNumber) ?? null,
    address: log.address,
    eventName: log.eventName,
    args: log.args ?? undefined,
    topic0: log.topic0,
    rawTopics: log.rawTopics,
    rawData: log.rawData,
  }));

  // ON CONFLICT DO NOTHING against UNIQUE(tx_hash, log_index): this is the whole of the
  // indexer's write-side idempotency. `returning` counts what was actually inserted, so the
  // report can show "0 inserted" on a replay instead of claiming work it did not do.
  const inserted = await db
    .insert(chainEvents)
    .values(rows)
    .onConflictDoNothing({ target: [chainEvents.txHash, chainEvents.logIndex] })
    .returning({ id: chainEvents.id });

  return inserted.length;
}

function toDate(unixSeconds: number): Date {
  return new Date(unixSeconds * 1000);
}

/**
 * Writes the projection into `markets`.
 *
 * Conflict target is `spec_hash`, not `onchain_id`: a market created through Phase 4's human
 * gate already exists here as `ONCHAIN_PENDING` with its spec hash and no on-chain id. Keying
 * on the spec hash lets the indexer *adopt* that row when the transaction confirms, rather
 * than inserting a second copy of the same market beside it.
 */
async function upsertMarkets(projected: ProjectedMarket[]): Promise<number> {
  if (projected.length === 0) return 0;

  const rows = projected.map((m) => ({
    onchainId: m.onchainId,
    specHash: m.specHash,
    question: m.question,
    resolutionSourceUrl: m.resolutionSourceUrl,
    closeTime: toDate(m.closeTime),
    resolveDeadline: toDate(m.resolveDeadline),
    state: m.state,
    outcome: m.outcome,
    poolYesWei: m.poolYesWei.toString(),
    poolNoWei: m.poolNoWei.toString(),
    evidenceUrl: m.evidenceUrl,
    proposedBy: m.proposedBy,
    challengeEndsAt: m.challengeEndsAt === null ? null : toDate(m.challengeEndsAt),
    challengeCount: m.challengeCount,
    creator: m.creator,
    createdTxHash: m.createdTxHash,
    createdBlock: m.createdBlock,
    updatedAt: new Date(),
  }));

  const result = await db
    .insert(markets)
    .values(rows)
    .onConflictDoUpdate({
      target: markets.specHash,
      set: {
        onchainId: sql`excluded.onchain_id`,
        question: sql`excluded.question`,
        resolutionSourceUrl: sql`excluded.resolution_source_url`,
        closeTime: sql`excluded.close_time`,
        resolveDeadline: sql`excluded.resolve_deadline`,
        state: sql`excluded.state`,
        outcome: sql`excluded.outcome`,
        poolYesWei: sql`excluded.pool_yes_wei`,
        poolNoWei: sql`excluded.pool_no_wei`,
        evidenceUrl: sql`excluded.evidence_url`,
        proposedBy: sql`excluded.proposed_by`,
        challengeEndsAt: sql`excluded.challenge_ends_at`,
        challengeCount: sql`excluded.challenge_count`,
        creator: sql`excluded.creator`,
        createdTxHash: sql`excluded.created_tx_hash`,
        createdBlock: sql`excluded.created_block`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
    .returning({ id: markets.id });

  return result.length;
}

/**
 * One indexing pass.
 *
 * `fullReplay` ignores the cursor and re-reads from the deployment block. It exists because
 * "replay produces the same answer" is a claim worth being able to demonstrate on demand
 * rather than merely assert — `pnpm --filter web index:replay` runs it.
 */
export async function runIndexer(
  options: { fullReplay?: boolean } = {},
): Promise<IndexReport> {
  const startedAt = Date.now();
  const provider = getProvider();

  const cursor = await readCursor();
  const headBlock = await provider.getBlockNumber();
  const toBlock = headBlock - cursor.confirmations;
  const fromBlock = options.fullReplay === true ? DEPLOY_BLOCK : cursor.lastBlock + 1;

  if (toBlock < fromBlock) {
    // Nothing confirmed since last time. Not an error — the common case on a quiet chain.
    return {
      fromBlock,
      toBlock,
      headBlock,
      logsFetched: 0,
      logsInserted: 0,
      marketsUpserted: 0,
      undecodable: 0,
      unprojected: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  const logs = await fetchLogs(fromBlock, toBlock);

  // Timestamps for the blocks we actually saw logs in — never for the whole range, which
  // would be thousands of pointless requests.
  const blockTimes = new Map<number, Date>();
  for (const blockNumber of new Set(logs.map((l) => l.blockNumber))) {
    const block = await provider.getBlock(blockNumber);
    if (block !== null) blockTimes.set(blockNumber, toDate(block.timestamp));
  }

  const logsInserted = await persistLogs(logs, blockTimes);

  // The projection folds over EVERY stored log, not just this run's, so an incremental run
  // and a full replay produce byte-identical market rows. Doing otherwise would make market
  // state depend on how the indexing happened to be chunked.
  const stored = await db
    .select()
    .from(chainEvents)
    .orderBy(chainEvents.blockNumber, chainEvents.logIndex);

  const asDecoded: DecodedLog[] = stored.map((row) => ({
    txHash: row.txHash,
    logIndex: row.logIndex,
    blockNumber: row.blockNumber,
    blockHash: row.blockHash,
    address: row.address,
    topic0: row.topic0,
    rawTopics: row.rawTopics,
    rawData: row.rawData,
    eventName: row.eventName,
    args: (row.args as Record<string, string | boolean> | null) ?? null,
  }));

  const projection = projectMarkets(asDecoded);
  const marketsUpserted = await upsertMarkets([...projection.markets.values()]);

  await writeCursor(toBlock, cursor.confirmations);

  return {
    fromBlock,
    toBlock,
    headBlock,
    logsFetched: logs.length,
    logsInserted,
    marketsUpserted,
    undecodable: projection.undecodable,
    unprojected: projection.unprojected,
    durationMs: Date.now() - startedAt,
  };
}
