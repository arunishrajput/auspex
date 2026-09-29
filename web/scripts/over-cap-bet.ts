/**
 * THE OVER-CAP BET.  `pnpm --filter web agents:over-cap`
 *
 * Phase 5's claim, from `docs/TRUST_MODEL.md` §5:
 *
 *   > Even with our server fully compromised and the off-chain policy gate bypassed entirely, an
 *   > agent wallet cannot exceed its cap — because the chain refuses the transaction.
 *
 * This script is that sentence, executed. It takes a real agent wallet, works out the per-
 * transaction cap the contract holds for it, adds **one wei**, and sends the bet — with the policy
 * gate deliberately not consulted. The resulting **reverted transaction on MSTScan is the
 * evidence**, not a bug, and the revert reason carries both numbers:
 *
 *     AgentPerTxCapExceeded(20000000000000001, 20000000000000000)
 *
 * ## Why one wei and not ten times the cap
 *
 * A wildly over-sized bet reverting proves almost nothing — any threshold anywhere would stop it.
 * One wei over proves the boundary is exactly where the contract says it is. It is also the same
 * boundary `policyGate` clamps to, and `policyGate.test.ts` pins from the other side: at the cap it
 * allows, one wei above it clamps. Two independent layers agreeing on one wei is the claim.
 *
 * ## What it proves, and what it does not
 *
 * It proves the contract refuses an over-cap stake from a registered agent. It does not prove our
 * server is secure — the whole point is that the server is *assumed* broken here, because this
 * script is what a broken server would do. The measurements after the transaction confirm the
 * second half: the market's pools are unchanged and the agent's per-market spend is unchanged, so
 * the refusal cost the agent nothing but gas.
 *
 * Safe to re-run. Each run uses its own decision round, so it neither collides with the betting
 * pass nor consumes the agent's daily budget — a rejected bet never staked anything, and
 * `spentTodayByMember` counts only stakes the chain accepted or is still considering.
 */

import { formatEther } from "ethers";
import { eq } from "drizzle-orm";
import { db, getPool } from "../lib/db/client";
import { agentDecisions, auditLog, markets, onchainIntents, proposals } from "../lib/db/schema";
import { explorerUrl } from "../lib/chain";
import { AUSPEX_MARKET_ADDRESS } from "../lib/chain/deployment";
import { getProvider } from "../lib/chain/provider";
import { auspexInterface, readMarket } from "../lib/chain/auspex";
import { describeRevert } from "../lib/chain/revert";
import { createIntent, processIntent } from "../lib/intents/engine";
import { listBettingMembers } from "../lib/agents/members";
import { readOnChainLimits } from "../lib/agents/registry";

/**
 * A round of its own, far from the betting pass's round 1.
 *
 * `agent_decisions` is unique on `(market_id, member_id, round)`, so a dedicated round keeps this
 * demonstration out of the ordinary flow while still recording it in the same table with the same
 * columns — which is what lets `/agents` render it beside the honest decisions and label it.
 */
const OVER_CAP_ROUND = 99;

function heading(text: string): void {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

async function main(): Promise<void> {
  const provider = getProvider();

  console.log("AuspeX — the over-cap bet");
  console.log("  The policy gate is deliberately NOT consulted. The chain is the only thing");
  console.log("  standing between this transaction and an over-cap stake.\n");
  console.log(`  contract ${AUSPEX_MARKET_ADDRESS}`);

  // --- Pick a real agent and a real open market --------------------------------------------
  const [market] = await db
    .select({
      rowId: markets.id,
      onchainId: markets.onchainId,
      question: markets.question,
      spec: proposals.spec,
    })
    .from(markets)
    .innerJoin(proposals, eq(markets.proposalId, proposals.id))
    .where(eq(markets.state, "OPEN"))
    .orderBy(markets.closeTime)
    .limit(1);

  if (market === undefined || market.onchainId === null) {
    console.error("No open, human-approved market to bet into. Run a tick and approve one first.");
    process.exitCode = 1;
    return;
  }

  const onChainMarket = await readMarket(market.onchainId, provider);
  const secondsLeft = onChainMarket.closeTime - Math.floor(Date.now() / 1000);
  if (onChainMarket.state !== "OPEN" || secondsLeft <= 0) {
    console.error(
      `Market #${market.onchainId} is ${onChainMarket.state} with ${secondsLeft}s left. ` +
        `The revert would be BettingClosed(), not a cap — which would prove nothing.`,
    );
    process.exitCode = 1;
    return;
  }

  const members = await listBettingMembers();
  let chosen: (typeof members)[number] | undefined;
  let limits: Awaited<ReturnType<typeof readOnChainLimits>> | undefined;

  for (const member of members) {
    const candidate = await readOnChainLimits(member.agentAddress, market.onchainId);
    if (!candidate.registered || !candidate.active) continue;
    const balance = await provider.getBalance(member.agentAddress);
    // The wallet has to be able to pay the over-cap amount, or the node rejects the transaction
    // for insufficient funds and we learn nothing about the cap.
    if (balance <= candidate.perTxCapWei + 1n) continue;
    chosen = member;
    limits = candidate;
    break;
  }

  if (chosen === undefined || limits === undefined) {
    console.error(
      "No registered, active, funded agent found. Run `pnpm --filter web agents:register` first.",
    );
    process.exitCode = 1;
    return;
  }

  const attempted = limits.perTxCapWei + 1n;

  heading("What is about to be attempted");
  console.log(`  market      #${market.onchainId} — ${market.question.slice(0, 68)}…`);
  console.log(`  agent       ${chosen.agentAddress}  (${chosen.handle})`);
  console.log(`  on-chain per-tx cap   ${limits.perTxCapWei} wei  (${formatEther(limits.perTxCapWei)} tMSTC)`);
  console.log(`  amount being sent     ${attempted} wei  <- exactly one wei more`);
  console.log(`  policy gate           BYPASSED, on purpose`);

  const poolsBefore = { yes: onChainMarket.poolYesWei, no: onChainMarket.poolNoWei };
  const spentBefore = limits.perMarketCapWei - limits.remainingOnMarketWei;

  // --- Predict the revert before spending anything ------------------------------------------
  heading("1. eth_call — what the contract says it would do");
  const data = auspexInterface.encodeFunctionData("placeBet", [market.onchainId, true]);
  try {
    await provider.call({
      to: AUSPEX_MARKET_ADDRESS,
      data,
      value: attempted,
      from: chosen.agentAddress,
    });
    console.log("  \x1b[31mIt did NOT revert. That is a failure of this demonstration.\x1b[0m");
    console.log("  Check that the agent is registered and that the cap is what we think it is.");
    process.exitCode = 1;
    return;
  } catch (error) {
    console.log(`  reverts with  \x1b[33m${describeRevert(error)}\x1b[0m`);
    console.log("  Decoded from the error MESSAGE, not error.data — this RPC hides it there (ADR-023).");
  }

  // --- Record the decision, then send it ----------------------------------------------------
  heading("2. Recording the decision, then sending it anyway");
  const reasons = [
    `GATE_BYPASSED: scripts/over-cap-bet.ts created this bet with the policy gate deliberately ` +
      `skipped. No deterministic check authorised it. This is what a compromised server does.`,
    `ATTEMPTED: ${attempted} wei, against an on-chain per-transaction cap of ` +
      `${limits.perTxCapWei} wei — over by exactly one wei.`,
  ];

  const [decision] = await db
    .insert(agentDecisions)
    .values({
      marketId: market.rowId,
      memberId: chosen.id,
      round: OVER_CAP_ROUND,
      backsYes: true,
      confidence: null,
      stakeRequestedWei: attempted.toString(),
      // Deliberately null: nothing was ever staked, and this column feeds the daily-budget sum.
      // Writing the attempted amount here would let a refused bet consume a real budget.
      finalStakeWei: null,
      rationale: "No rationale. This bet exists to be refused by the contract.",
      sources: [],
      status: "TX_PENDING",
      reasons,
    })
    .onConflictDoUpdate({
      target: [agentDecisions.marketId, agentDecisions.memberId, agentDecisions.round],
      set: { reasons, status: "TX_PENDING", updatedAt: new Date() },
    })
    .returning({ id: agentDecisions.id });

  if (decision === undefined) throw new Error("Could not record the over-cap decision.");

  const intent = await createIntent({
    // The timestamp makes each run its own transaction rather than a rebroadcast of the last one.
    idempotencyKey: `over-cap:${decision.id}:${Date.now()}`,
    kind: "PLACE_BET",
    signer: "SERVER",
    from: chosen.agentAddress,
    functionName: "placeBet",
    args: [market.onchainId, true],
    valueWei: attempted,
  });

  await db
    .update(agentDecisions)
    .set({ intentId: intent.id, updatedAt: new Date() })
    .where(eq(agentDecisions.id, decision.id));

  console.log(`  decision ${decision.id}`);
  console.log(`  intent   ${intent.id}`);
  console.log("  Gas estimation will revert; the engine falls back to a fixed limit so the");
  console.log("  transaction reaches the chain and the revert is visible on the explorer.");

  const result = await processIntent(intent);

  heading("3. What the chain did");
  console.log(`  status  ${result.status}`);
  console.log(`  tx      ${result.txHash ?? "-"}`);
  console.log(`  block   ${result.blockNumber ?? "-"}`);
  console.log(`  revert  \x1b[33m${result.revertReason ?? "-"}\x1b[0m`);
  if (result.txHash !== null) console.log(`  explorer ${explorerUrl("tx", result.txHash)}`);

  // --- Prove nothing moved -----------------------------------------------------------------
  heading("4. Proof that nothing was staked");
  const after = await readMarket(market.onchainId, provider);
  const limitsAfter = await readOnChainLimits(chosen.agentAddress, market.onchainId);
  const spentAfter = limitsAfter.perMarketCapWei - limitsAfter.remainingOnMarketWei;

  const poolsUnchanged = after.poolYesWei === poolsBefore.yes && after.poolNoWei === poolsBefore.no;
  const spendUnchanged = spentAfter === spentBefore;

  console.log(`  ${poolsUnchanged ? "\x1b[32mOK  \x1b[0m" : "\x1b[31mBAD \x1b[0m"} market pools unchanged: ` +
    `YES ${poolsBefore.yes} → ${after.poolYesWei}, NO ${poolsBefore.no} → ${after.poolNoWei}`);
  console.log(`  ${spendUnchanged ? "\x1b[32mOK  \x1b[0m" : "\x1b[31mBAD \x1b[0m"} agent per-market spend unchanged: ` +
    `${spentBefore} → ${spentAfter} wei`);

  const decoded = (result.revertReason ?? "").startsWith("AgentPerTxCapExceeded");
  console.log(`  ${decoded ? "\x1b[32mOK  \x1b[0m" : "\x1b[31mBAD \x1b[0m"} reverted with AgentPerTxCapExceeded`);

  await db.insert(auditLog).values({
    actor: `agent:${chosen.agentAddress}`,
    action: "agent.over_cap_refused",
    subjectType: "agent_decision",
    subjectId: decision.id,
    reason:
      `The policy gate was bypassed and a bet of ${attempted} wei was sent against an on-chain ` +
      `per-transaction cap of ${limits.perTxCapWei} wei. The contract refused it: ` +
      `${result.revertReason ?? "no reason decoded"}. Pools unchanged, nothing staked.`,
    txHash: result.txHash,
    metadata: {
      attemptedWei: attempted.toString(),
      onChainPerTxCapWei: limits.perTxCapWei.toString(),
      handle: chosen.handle,
      onchainId: market.onchainId,
    },
  });

  const [settled] = await db
    .select({ status: onchainIntents.status })
    .from(onchainIntents)
    .where(eq(onchainIntents.id, intent.id))
    .limit(1);

  heading("What this shows");
  console.log("  The server said yes. The chain said no, and named both numbers.");
  console.log("  No off-chain code had to be trusted for that to happen — the cap is enforced in");
  console.log("  `AuspexMarket.placeBet`, which a compromised server cannot reach past.");

  const ok = poolsUnchanged && spendUnchanged && decoded && settled?.status === "REVERTED";
  if (!ok) {
    console.error("\nThe demonstration did not produce the expected refusal. Do not present it.");
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
