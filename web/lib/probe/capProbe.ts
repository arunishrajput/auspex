/**
 * The cap probe: anyone with no wallet asks the chain to refuse something, and it does.
 *
 * ## What this exists for
 *
 * Nobody should have to install BridgeKey, find a faucet and fund an address to satisfy themselves
 * that AuspeX is really on chain and that the agent limits are really enforced there. One click
 * should produce a **real transaction hash that resolves on MSTScan**, from a browser holding
 * nothing.
 *
 * The transaction chosen is the over-cap bet — the same demonstration as
 * `scripts/over-cap-bet.ts`, triggered from the page instead of a terminal. A registered agent's
 * on-chain per-transaction cap is read from the contract, **one wei** is added, and the bet is
 * sent with the policy gate deliberately not consulted. The contract refuses it and names both
 * numbers:
 *
 *     AgentPerTxCapExceeded(20000000000000001, 20000000000000000)
 *
 * ## Why a refused transaction and not a successful one
 *
 * Four reasons, in the order they mattered:
 *
 *   1. **It is the claim.** Every other page says "the chain bounds the agents". This lets a
 *      stranger make the chain say it, from an address they do not control, in ten seconds.
 *   2. **It cannot move money.** A reverted `placeBet` returns its value. The pools are unchanged,
 *      the agent's per-market spend is unchanged, and the only cost is gas — which is ~0.0001
 *      tMSTC on a chain whose base fee is zero.
 *   3. **It needs no authority whatsoever.** A public button that created a market or resolved one
 *      would mean this application holds a key that can, which is the opposite of what the project
 *      claims. The only kind of transaction it is *safe* to hand a stranger is one the contract is
 *      going to refuse.
 *   4. **It is repeatable.** Unlike `finalizeResolution` or `invalidateStale`, which are real
 *      permissionless calls but one-shot per market and usually out of scope, this works whenever
 *      an open market exists.
 *
 * ## The guard that makes it safe
 *
 * `eth_call` is made first, from the agent's address, with the over-cap value. **If it does not
 * revert, nothing is broadcast.** That inverts the usual relationship with a simulation: here a
 * successful call is the failure condition, because it would mean the next step stakes real funds
 * on a market on a visitor's behalf. A probe that cannot prove it will be refused does not run.
 *
 * ## What it deliberately does not write
 *
 * No `agent_decisions` row. That table means "this agent decided this", and no model was asked and
 * no gate ran here — a row would put a stranger's button press into a member's trading record and
 * render on `/agents` beside real decisions. `scripts/over-cap-bet.ts` does write one, because an
 * operator running it by hand *is* claiming the row. ADR-062.
 *
 * The complete record of a probe is its `audit_log` row, its `onchain_intents` row and its
 * transaction hash, which is everything a reader needs and nothing a member's record does not want.
 *
 * ## The stored action id says `judge.cap_probe`, and it stays that way
 *
 * This feature was built under the name "judge mode" and five `audit_log` rows were written under
 * `judge.cap_probe` before it was renamed. `audit_log` is append-only, so renaming the action string
 * now would give one event two names and make the older rows read as a different kind of event. The
 * label changed; the identifier did not. ADR-069.
 */

import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { auditLog, markets, onchainIntents } from "../db/schema";
import { AUSPEX_MARKET_ADDRESS } from "../chain/deployment";
import { getProvider } from "../chain/provider";
import { auspexInterface, readMarket } from "../chain/auspex";
import { describeRevert } from "../chain/revert";
import { createIntent, processIntent } from "../intents/engine";
import { listBettingMembers } from "../agents/members";
import { readOnChainLimits } from "../agents/registry";

/**
 * Gas floor for the probing wallet.
 *
 * Above `KEEPER_MIN_BALANCE_WEI` (0.0005) because this wallet must also be able to *hold* the
 * over-cap value while the node checks it: a node rejects a transaction whose value exceeds the
 * sender's balance before the contract ever sees it, and "insufficient funds" teaches a reader
 * nothing about the cap. So the wallet needs cap + 1 wei + gas, and this is the gas part.
 */
const PROBE_GAS_FLOOR_WEI = 10n ** 15n; // 0.001 tMSTC

export type ProbeResult =
  | {
      ok: true;
      /** The market the probe was aimed at. */
      onchainId: number;
      question: string;
      agentHandle: string;
      agentAddress: string;
      /** The contract's own cap, as a decimal wei string — never a `bigint` (it crosses JSON). */
      capWei: string;
      attemptedWei: string;
      /** What `eth_call` predicted before anything was signed. */
      predictedRevert: string;
      /** What actually happened on chain. */
      txHash: string | null;
      blockNumber: number | null;
      revertReason: string | null;
      intentStatus: string;
      /** Verified after the fact by re-reading the contract. */
      poolsUnchanged: boolean;
      explorerPath: string;
    }
  | { ok: false; reason: string };

/**
 * Runs one probe. Never throws — the caller is a server action rendering into a page.
 *
 * Every early return carries the real reason, because "the probe is unavailable" with no
 * explanation is exactly the kind of blank wall this project is trying not to build.
 */
export async function runCapProbe(trigger: string): Promise<ProbeResult> {
  const provider = getProvider();

  // --- A market that is genuinely open --------------------------------------------------------
  const openMarkets = await db
    .select({
      rowId: markets.id,
      onchainId: markets.onchainId,
      question: markets.question,
    })
    .from(markets)
    .where(eq(markets.state, "OPEN"))
    .orderBy(markets.closeTime)
    .limit(5);

  const nowSeconds = Math.floor(Date.now() / 1000);
  let target: { rowId: string; onchainId: number; question: string } | null = null;

  for (const market of openMarkets) {
    if (market.onchainId === null) continue;
    const onChain = await readMarket(market.onchainId, provider);
    // A closed market would revert with `BettingClosed()`, which proves nothing about a cap. The
    // chain is asked rather than the projection, because the projection is by design a little
    // behind and this decides what the revert reason will be.
    if (onChain.state !== "OPEN" || onChain.closeTime <= nowSeconds) continue;
    target = { rowId: market.rowId, onchainId: market.onchainId, question: market.question };
    break;
  }

  if (target === null) {
    return {
      ok: false,
      reason:
        "No market is currently open for betting, so an over-cap bet would be refused for being " +
        "late rather than for being over the cap — which would demonstrate the wrong thing. " +
        "Approve a market in /review, or wait for the next one.",
    };
  }

  // --- An agent the contract knows, funded enough to be refused properly ----------------------
  const members = await listBettingMembers();
  let chosen: { handle: string; address: string; capWei: bigint } | null = null;
  const skipped: string[] = [];

  for (const member of members) {
    const limits = await readOnChainLimits(member.agentAddress, target.onchainId);
    if (!limits.registered || !limits.active) {
      skipped.push(`${member.handle}: not registered or not active on chain`);
      continue;
    }
    const balance = await provider.getBalance(member.agentAddress);
    if (balance < limits.perTxCapWei + 1n + PROBE_GAS_FLOOR_WEI) {
      skipped.push(
        `${member.handle}: holds ${balance} wei, needs ${limits.perTxCapWei + 1n + PROBE_GAS_FLOOR_WEI}`,
      );
      continue;
    }
    chosen = { handle: member.handle, address: member.agentAddress, capWei: limits.perTxCapWei };
    break;
  }

  if (chosen === null) {
    return {
      ok: false,
      reason:
        "No registered agent wallet holds enough tMSTC to have an over-cap bet refused on its " +
        "merits. A wallet short of the amount is rejected by the node for insufficient funds " +
        `before the contract sees it, which proves nothing. Candidates: ${skipped.join("; ") || "none"}.`,
    };
  }

  const attempted = chosen.capWei + 1n;
  const data = auspexInterface.encodeFunctionData("placeBet", [target.onchainId, true]);

  // --- The guard: it must be refused BEFORE anything is signed --------------------------------
  let predictedRevert: string;
  try {
    await provider.call({
      to: AUSPEX_MARKET_ADDRESS,
      data,
      value: attempted,
      from: chosen.address,
    });
    // A *successful* simulation is the failure case here. Broadcasting now would stake real funds
    // on a visitor's click, which no button on this site is allowed to do.
    return {
      ok: false,
      reason:
        `eth_call says this bet would SUCCEED, not revert. Nothing was broadcast. That means the ` +
        `on-chain cap for ${chosen.handle} is not what the contract reported a moment ago, and ` +
        `sending it would have staked ${attempted} wei rather than demonstrating a refusal.`,
    };
  } catch (error) {
    predictedRevert = describeRevert(error);
    if (!predictedRevert.startsWith("AgentPerTxCapExceeded")) {
      // It reverts, but for the wrong reason. Sending it would put a transaction on chain whose
      // revert says something other than what the page is about to claim.
      return {
        ok: false,
        reason:
          `The contract would refuse this bet, but with \`${predictedRevert}\` rather than ` +
          `AgentPerTxCapExceeded. Nothing was broadcast, because the transaction would not show ` +
          `what this button says it shows.`,
      };
    }
  }

  const before = await readMarket(target.onchainId, provider);

  // --- Send it ------------------------------------------------------------------------------
  //
  // A fresh key per probe: each click is its own transaction rather than a rebroadcast of the
  // last one, which is the whole point — the person who clicked gets *their* hash. The idempotency
  // guarantee still holds within a probe: a crash between `createIntent` and the broadcast leaves
  // a row whose signed bytes the worker re-broadcasts byte-identically (ADR-027).
  const intent = await createIntent({
    // Prefix unchanged on purpose: every stored identifier this feature ever wrote stays as it
    // was written, so one predicate still finds all of them. ADR-069.
    idempotencyKey: `judge:cap-probe:${Date.now()}:${target.onchainId}`,
    kind: "PLACE_BET",
    signer: "SERVER",
    from: chosen.address,
    functionName: "placeBet",
    args: [target.onchainId, true],
    valueWei: attempted,
  });

  // Gas estimation reverts for exactly the reason we want, so the engine falls back to
  // FALLBACK_GAS_LIMIT and the transaction reaches the chain where the refusal is readable.
  const result = await processIntent(intent);

  const after = await readMarket(target.onchainId, provider);
  const poolsUnchanged =
    after.poolYesWei === before.poolYesWei && after.poolNoWei === before.poolNoWei;

  await db.insert(auditLog).values({
    // `actor` and `action` are the strings the first five probe rows were written with, kept as
    // they are so the log has one name per event rather than a before and an after. ADR-069.
    actor: `judge-mode:${trigger}`,
    action: "judge.cap_probe",
    subjectType: "market",
    subjectId: target.rowId,
    reason:
      `A visitor with no wallet triggered an over-cap bet: ${attempted} wei from ` +
      `${chosen.handle}'s agent against an on-chain per-transaction cap of ${chosen.capWei} wei, ` +
      `with the policy gate deliberately not consulted. eth_call predicted ` +
      `\`${predictedRevert}\` and the chain delivered \`${result.revertReason ?? "no reason decoded"}\`. ` +
      `Pools ${poolsUnchanged ? "unchanged" : "CHANGED — investigate"}; nothing was staked. No ` +
      `agent_decisions row was written, because no model was asked and no gate ran.`,
    txHash: result.txHash,
    metadata: {
      onchainId: target.onchainId,
      handle: chosen.handle,
      agentAddress: chosen.address,
      onChainPerTxCapWei: chosen.capWei.toString(),
      attemptedWei: attempted.toString(),
      predictedRevert,
      poolsUnchanged,
      trigger,
    },
  });

  const [settled] = await db
    .select({ status: onchainIntents.status })
    .from(onchainIntents)
    .where(eq(onchainIntents.id, intent.id))
    .limit(1);

  return {
    ok: true,
    onchainId: target.onchainId,
    question: target.question,
    agentHandle: chosen.handle,
    agentAddress: chosen.address,
    capWei: chosen.capWei.toString(),
    attemptedWei: attempted.toString(),
    predictedRevert,
    txHash: result.txHash,
    blockNumber: result.blockNumber,
    revertReason: result.revertReason,
    intentStatus: settled?.status ?? result.status,
    poolsUnchanged,
    explorerPath: result.txHash === null ? "" : `/tx/${result.txHash}`,
  };
}

export { PROBE_GAS_FLOOR_WEI };
