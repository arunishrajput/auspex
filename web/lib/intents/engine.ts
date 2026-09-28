import { and, eq, inArray, sql } from "drizzle-orm";
import { Transaction, type Wallet } from "ethers";
import { db } from "../db/client";
import { auditLog, onchainIntents, type OnchainIntent } from "../db/schema";
import { AUSPEX_MARKET_ADDRESS } from "../chain/deployment";
import { getProvider } from "../chain/provider";
import { auspexInterface } from "../chain/auspex";
import { describeRevert } from "../chain/revert";
import { getDeployerWallet } from "./signer";
import { crashPointReached } from "./crash-hook";

/**
 * The OnChainIntent engine. **The only code in this repository that broadcasts a transaction.**
 *
 * ── The problem ────────────────────────────────────────────────────────────────────────
 * A worker that crashes between "broadcast" and "record what I broadcast" leaves a
 * transaction on chain that no row knows about. The obvious fix — write a row first, then
 * send — narrows the window but does not close it: the process can still die in the
 * microseconds between `eth_sendRawTransaction` returning and the UPDATE committing. Retrying
 * then re-signs, and a re-signed transaction with a fresh nonce is a SECOND transaction.
 *
 * ── The fix (ADR-027) ──────────────────────────────────────────────────────────────────
 * **Sign first, persist the signed bytes, then broadcast.**
 *
 *   PENDING ──sign──> SIGNED ──broadcast──> BROADCAST ──receipt──> CONFIRMED | REVERTED
 *
 * A signed transaction is immutable and its hash is fixed before it ever leaves this process.
 * Recovery from any crash point re-broadcasts the *same bytes*, which the network deduplicates
 * by hash. So:
 *
 *   crash after signing, before broadcast → rebroadcast the stored bytes → 1 tx
 *   crash after broadcast, before receipt → rebroadcast the stored bytes → 1 tx (already known)
 *   crash after receipt, before commit    → re-poll the stored hash      → 1 tx
 *
 * There is no path that produces two. The retry is not "try again", it is "finish the thing
 * that was already decided".
 *
 * ── And the contract refuses duplicates independently ───────────────────────────────────
 * `createMarket` reverts on a `specHash` it has seen. Two mechanisms, neither relying on the
 * other (docs/ARCHITECTURE.md §4). This engine is what makes "exactly one transaction" true;
 * the contract is what makes "exactly one market" true even if this engine were replaced by
 * something careless.
 */

/** How long a worker's claim on a row lasts before another worker may take it. */
const LEASE_SECONDS = 90;

/** Attempts before an intent stops being retried. Kept low — stuck rows should be visible. */
const MAX_ATTEMPTS = 8;

/** How long one pass waits for a receipt before releasing the row and trying again later. */
const RECEIPT_WAIT_MS = 45_000;

/**
 * Gas limit used when `eth_estimateGas` reverts.
 *
 * A reverting estimate is not always an error to avoid — Phase 5 deliberately sends an
 * over-cap bet so the chain can refuse it *on the explorer*, which is the project's whole
 * argument made visible. Estimation cannot price a transaction that reverts, so we fall back
 * to a fixed limit and let the revert happen on chain where a judge can read it.
 */
const FALLBACK_GAS_LIMIT = 500_000n;

export type IntentKind = OnchainIntent["kind"];

export type CreateIntentInput = {
  /** Derived from the business fact, never random. See the column comment in schema.ts. */
  idempotencyKey: string;
  kind: IntentKind;
  functionName: string;
  args: unknown[];
  valueWei?: bigint;
  to?: string;
  from?: string;
};

export type ProcessResult = {
  intentId: string;
  status: OnchainIntent["status"];
  txHash: string | null;
  blockNumber: number | null;
  revertReason: string | null;
  note: string;
};

// ---------------------------------------------------------------------------
// Creating an intent
// ---------------------------------------------------------------------------

/**
 * Records an intention to write to the chain. Never broadcasts.
 *
 * Idempotent on `idempotencyKey`: two ticks racing to create the same intent produce one row
 * and therefore, eventually, one transaction. The existing row is returned rather than an
 * error, because "it already exists" is the success case for a retry.
 */
export async function createIntent(input: CreateIntentInput): Promise<OnchainIntent> {
  const data = auspexInterface.encodeFunctionData(input.functionName, input.args);
  const from = (input.from ?? getDeployerWallet().address).toLowerCase();

  const values = {
    idempotencyKey: input.idempotencyKey,
    kind: input.kind,
    fromAddress: from,
    toAddress: (input.to ?? AUSPEX_MARKET_ADDRESS).toLowerCase(),
    functionName: input.functionName,
    // Calldata is encoded ONCE, here, and never re-encoded on retry. A retry that re-derived
    // its arguments could send something subtly different from what was authorised.
    data,
    valueWei: (input.valueWei ?? 0n).toString(),
  };

  const [inserted] = await db
    .insert(onchainIntents)
    .values(values)
    .onConflictDoNothing({ target: onchainIntents.idempotencyKey })
    .returning();

  if (inserted !== undefined) {
    await record(inserted.id, "intent.created", `${input.kind} queued`, {
      idempotencyKey: input.idempotencyKey,
    });
    return inserted;
  }

  const [existing] = await db
    .select()
    .from(onchainIntents)
    .where(eq(onchainIntents.idempotencyKey, input.idempotencyKey))
    .limit(1);

  if (existing === undefined) {
    throw new Error(`Intent ${input.idempotencyKey} conflicted but could not be read back.`);
  }
  return existing;
}

// ---------------------------------------------------------------------------
// Claiming work
// ---------------------------------------------------------------------------

/**
 * Takes exclusive ownership of one unfinished intent.
 *
 * `FOR UPDATE SKIP LOCKED` inside a short transaction is what stops two concurrent ticks from
 * touching the same row: the second one skips it rather than blocking. The transaction is
 * held only for the claim — the chain work happens outside it, because holding a Postgres
 * connection open across a 45-second receipt wait is how a free-tier database runs out of
 * connections.
 *
 * Exclusivity outside the transaction comes from the **lease**: claiming pushes
 * `next_attempt_at` into the future, so no other worker considers the row until the lease
 * expires. A crashed worker's rows become claimable again on their own, with no reaper — and
 * that recovery is safe precisely because of the signed-bytes invariant above.
 */
export async function claimIntent(workerId: string): Promise<OnchainIntent | null> {
  return db.transaction(async (tx) => {
    const found = await tx.execute<{ id: string }>(sql`
      select id from onchain_intents
      where status in ('PENDING', 'SIGNED', 'BROADCAST')
        and attempts < ${MAX_ATTEMPTS}
        and next_attempt_at <= now()
      order by next_attempt_at asc, created_at asc
      for update skip locked
      limit 1
    `);

    const row = found.rows[0];
    if (row === undefined) return null;

    const [claimed] = await tx
      .update(onchainIntents)
      .set({
        claimedAt: new Date(),
        claimedBy: workerId,
        attempts: sql`${onchainIntents.attempts} + 1`,
        nextAttemptAt: sql`now() + make_interval(secs => ${LEASE_SECONDS})`,
        updatedAt: new Date(),
      })
      .where(eq(onchainIntents.id, row.id))
      .returning();

    return claimed ?? null;
  });
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * Chooses the nonce for a new transaction.
 *
 * Two sources, because neither alone is enough: the node's `pending` count can lag a
 * transaction we broadcast moments ago, and our own records cannot know about a transaction
 * sent from this address by anything else (the deploy script, a manual `cast send`). The
 * maximum of the two is the first nonce that is certainly free.
 *
 * Runs under a Postgres advisory lock keyed on the sending address, so two workers signing
 * for the same wallet at the same instant cannot pick the same nonce — which would make one
 * of the two transactions permanently unminable.
 */
async function nextNonce(from: string): Promise<number> {
  const onChain = await getProvider().getTransactionCount(from, "pending");

  const local = await db
    .select({ maxNonce: sql<number | null>`max(${onchainIntents.nonce})` })
    .from(onchainIntents)
    .where(
      and(
        eq(onchainIntents.fromAddress, from.toLowerCase()),
        inArray(onchainIntents.status, ["SIGNED", "BROADCAST", "CONFIRMED", "REVERTED"]),
      ),
    );

  const localMax = local[0]?.maxNonce;
  return localMax === null || localMax === undefined
    ? onChain
    : Math.max(onChain, localMax + 1);
}

/**
 * Builds, signs and persists a transaction — without broadcasting it.
 *
 * On return, the row holds the exact bytes that will be sent and the hash they will have.
 * From this point on, every recovery path is a rebroadcast rather than a re-signing.
 */
async function signIntent(intent: OnchainIntent, wallet: Wallet): Promise<OnchainIntent> {
  const provider = getProvider();
  const value = BigInt(intent.valueWei);

  // Gas is effectively free here (baseFee 0, 1 gwei priority) — see ARCHITECTURE §1. These
  // are set explicitly rather than left to fee estimation so a signed transaction's contents
  // never depend on what the node happened to report at signing time.
  const request = {
    to: intent.toAddress,
    data: intent.data,
    value,
    chainId: (await provider.getNetwork()).chainId,
    maxPriorityFeePerGas: 1_000_000_000n,
    maxFeePerGas: 2_000_000_000n,
  };

  let gasLimit: bigint;
  let estimateNote = "";
  try {
    const estimated = await provider.estimateGas({ ...request, from: wallet.address });
    gasLimit = (estimated * 125n) / 100n;
  } catch (error) {
    // Deliberate: a transaction we expect to revert must still reach the chain, because the
    // revert IS the evidence (Phase 5's over-cap bet). Recorded so it is never a surprise.
    gasLimit = FALLBACK_GAS_LIMIT;
    estimateNote = `gas estimation reverted (${describeRevert(error)}); using fallback limit`;
  }

  // The advisory lock covers nonce selection AND signing, so the window in which two workers
  // could agree on the same nonce does not exist.
  const signed = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${intent.fromAddress}))`);

    const nonce = await nextNonce(intent.fromAddress);
    const raw = await wallet.signTransaction({ ...request, nonce, gasLimit, type: 2 });
    const hash = Transaction.from(raw).hash;

    if (hash === null) throw new Error("Signed transaction has no hash — refusing to send.");

    const [updated] = await tx
      .update(onchainIntents)
      .set({
        status: "SIGNED",
        nonce,
        gasLimit: Number(gasLimit),
        signedRawTx: raw,
        txHash: hash,
        lastError: estimateNote === "" ? null : estimateNote,
        updatedAt: new Date(),
      })
      .where(eq(onchainIntents.id, intent.id))
      .returning();

    return updated;
  });

  await record(
    intent.id,
    "intent.signed",
    estimateNote === ""
      ? `signed nonce ${signed.nonce}, hash fixed before broadcast`
      : `signed nonce ${signed.nonce}; ${estimateNote}`,
    { txHash: signed.txHash },
  );

  return signed;
}

// ---------------------------------------------------------------------------
// Broadcasting
// ---------------------------------------------------------------------------

/** Node responses that mean "this transaction is already in flight or already mined". */
const BENIGN_BROADCAST_ERRORS = [
  "already known",
  "already exists",
  "nonce too low",
  "transaction underpriced",
  "replacement transaction underpriced",
];

function isBenignBroadcastError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return BENIGN_BROADCAST_ERRORS.some((needle) => message.includes(needle));
}

/**
 * Sends the stored bytes.
 *
 * Safe to call any number of times: the payload is byte-identical every time, so the network
 * either accepts it once or tells us it already has it. Both outcomes advance the intent to
 * `BROADCAST`, and a re-broadcast cannot create a second transaction because the hash is a
 * function of the bytes.
 */
async function broadcastIntent(intent: OnchainIntent): Promise<OnchainIntent> {
  if (intent.signedRawTx === null) {
    throw new Error(`Intent ${intent.id} is ${intent.status} but has no signed transaction.`);
  }

  let note = "broadcast accepted";
  try {
    await getProvider().broadcastTransaction(intent.signedRawTx);
  } catch (error) {
    if (!isBenignBroadcastError(error)) throw error;
    // The proof that rebroadcast is safe, observed in the wild rather than assumed.
    note = "node already had this transaction — rebroadcast was a no-op";
  }

  const [updated] = await db
    .update(onchainIntents)
    .set({ status: "BROADCAST", updatedAt: new Date() })
    .where(eq(onchainIntents.id, intent.id))
    .returning();

  await record(intent.id, "intent.broadcast", note, { txHash: intent.txHash });
  return updated;
}

// ---------------------------------------------------------------------------
// Settling
// ---------------------------------------------------------------------------

/**
 * Waits for the receipt and writes the terminal state.
 *
 * A reverted transaction is `REVERTED`, not `FAILED`: it succeeded at reaching the chain and
 * being refused there, which for this project is frequently the *desired* outcome. The revert
 * reason is decoded and stored so the UI can show `AgentPerTxCapExceeded(attempted, cap)`
 * rather than an anonymous failure.
 */
async function settleIntent(intent: OnchainIntent): Promise<ProcessResult> {
  const provider = getProvider();
  const hash = intent.txHash;
  if (hash === null) throw new Error(`Intent ${intent.id} is BROADCAST with no tx hash.`);

  const receipt = await provider.waitForTransaction(hash, 1, RECEIPT_WAIT_MS).catch(() => null);

  if (receipt === null) {
    // Not a failure — the chain is simply slow. Release the lease with backoff and let a
    // later pass re-poll the same hash. Nothing is re-signed and nothing is re-sent.
    const backoffSeconds = Math.min(5 * 2 ** intent.attempts, 300);
    await db
      .update(onchainIntents)
      .set({
        nextAttemptAt: sql`now() + make_interval(secs => ${backoffSeconds})`,
        lastError: "no receipt yet",
        claimedAt: null,
        claimedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(onchainIntents.id, intent.id));

    return {
      intentId: intent.id,
      status: "BROADCAST",
      txHash: hash,
      blockNumber: null,
      revertReason: null,
      note: `no receipt after ${RECEIPT_WAIT_MS}ms; will re-poll the same hash in ${backoffSeconds}s`,
    };
  }

  const succeeded = receipt.status === 1;
  let revertReason: string | null = null;

  if (!succeeded) {
    // Replay the call at the block it was mined in to recover the revert data. The receipt
    // itself carries only status 0 — the reason has to be asked for.
    try {
      await provider.call({
        to: intent.toAddress,
        data: intent.data,
        value: BigInt(intent.valueWei),
        from: intent.fromAddress,
        blockTag: receipt.blockNumber,
      });
      revertReason = "reverted on chain, but replay at that block succeeded";
    } catch (error) {
      revertReason = describeRevert(error);
    }
  }

  const [updated] = await db
    .update(onchainIntents)
    .set({
      status: succeeded ? "CONFIRMED" : "REVERTED",
      blockNumber: receipt.blockNumber,
      gasUsed: Number(receipt.gasUsed),
      revertReason,
      lastError: null,
      claimedAt: null,
      claimedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(onchainIntents.id, intent.id))
    .returning();

  await record(
    intent.id,
    succeeded ? "intent.confirmed" : "intent.reverted",
    succeeded
      ? `mined in block ${receipt.blockNumber}`
      : `refused by the contract in block ${receipt.blockNumber}: ${revertReason}`,
    { txHash: hash },
  );

  return {
    intentId: intent.id,
    status: updated.status,
    txHash: hash,
    blockNumber: receipt.blockNumber,
    revertReason,
    note: succeeded ? "confirmed" : "reverted on chain",
  };
}

// ---------------------------------------------------------------------------
// The worker
// ---------------------------------------------------------------------------

/**
 * Drives one intent from wherever it is to wherever it can get in one pass.
 *
 * Every entry point is a resume point. The function does not know or care whether this is the
 * first attempt or the fifth after three crashes — the row's status says what remains to be
 * done, and the signed bytes make redoing the last step harmless.
 */
export async function processIntent(intent: OnchainIntent): Promise<ProcessResult> {
  let current = intent;

  try {
    if (current.status === "PENDING") {
      current = await signIntent(current, getDeployerWallet());
      // Test-only fault injection. Simulates a hard kill between signing and broadcasting —
      // the window where a naive engine would later re-sign and double-send.
      crashPointReached("after_sign");
    }

    if (current.status === "SIGNED" || current.status === "BROADCAST") {
      current = await broadcastIntent(current);
      crashPointReached("after_broadcast");
    }

    return await settleIntent(current);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const backoffSeconds = Math.min(5 * 2 ** current.attempts, 300);
    const exhausted = current.attempts >= MAX_ATTEMPTS;

    // An intent that never reached SIGNED has no bytes on the network and can be abandoned
    // safely. One that HAS been signed is never abandoned — its transaction may be in a
    // mempool right now, and forgetting it is how a duplicate gets sent later.
    const giveUp = exhausted && current.status === "PENDING";

    await db
      .update(onchainIntents)
      .set({
        status: giveUp ? "ABANDONED" : current.status,
        lastError: message.slice(0, 500),
        nextAttemptAt: sql`now() + make_interval(secs => ${backoffSeconds})`,
        claimedAt: null,
        claimedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(onchainIntents.id, current.id));

    await record(
      current.id,
      giveUp ? "intent.abandoned" : "intent.retry",
      `${message.slice(0, 200)}${giveUp ? "" : ` — retrying in ${backoffSeconds}s`}`,
      { txHash: current.txHash },
    );

    return {
      intentId: current.id,
      status: giveUp ? "ABANDONED" : current.status,
      txHash: current.txHash,
      blockNumber: null,
      revertReason: null,
      note: message.slice(0, 200),
    };
  }
}

/**
 * Claims and processes up to `limit` intents.
 *
 * Bounded on purpose: a tick must finish inside a serverless function's time limit, and an
 * unbounded worker is one slow RPC away from being killed halfway through.
 */
export async function runIntentWorker(
  options: { limit?: number; workerId?: string } = {},
): Promise<ProcessResult[]> {
  const limit = options.limit ?? 5;
  const workerId = options.workerId ?? `worker-${process.pid}`;
  const results: ProcessResult[] = [];

  for (let i = 0; i < limit; i += 1) {
    const intent = await claimIntent(workerId);
    if (intent === null) break;
    results.push(await processIntent(intent));
  }

  return results;
}

/** Appends to the audit log. Hard rule #7: every decision is recorded with a reason. */
async function record(
  intentId: string,
  action: string,
  reason: string,
  extra: { txHash?: string | null; idempotencyKey?: string } = {},
): Promise<void> {
  await db.insert(auditLog).values({
    actor: "system:intent-engine",
    action,
    subjectType: "onchain_intent",
    subjectId: intentId,
    reason,
    txHash: extra.txHash ?? null,
    metadata: extra.idempotencyKey ? { idempotencyKey: extra.idempotencyKey } : null,
  });
}
