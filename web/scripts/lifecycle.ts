/**
 * THE FULL LIFECYCLE, ON CHAIN.  `pnpm --filter web lifecycle`
 *
 * Phase 6's exit criteria say the whole loop must be exercised on MST Testnet with real transaction
 * hashes: create → bet → close → propose → challenge → re-propose → finalize → claim, plus a double
 * claim that reverts, a losing claim that reverts, and `invalidateStale` on a market whose resolver
 * never appeared. This script is that, end to end, in about five minutes.
 *
 * ## Why it runs on a market of its own, and why that market says so
 *
 * The four real markets (#4–#7) close on 2026-09-30 and carry live agent stakes. They are the ones
 * worth resolving on camera, and they cannot be resolved today. Markets #1–#3 are past close but
 * have only one bettor each, so their payout is a degenerate refund that demonstrates the
 * arithmetic without exercising it.
 *
 * So this creates **one market of its own with a short close time and bets on both sides**, which is
 * the only way to show a real parimutuel split today. It is labelled as a Phase 6 lifecycle test
 * **in its own on-chain question text**, exactly as markets #1–#3 are, so the label travels with it
 * to MSTScan and cannot be lost when it is quoted out of context. It is not presented anywhere as a
 * product market, and no agent decision row is written for it.
 *
 * ## The agent bet is an operator action, and it is recorded as one
 *
 * One side is bet by the deployer (an ordinary uncapped bettor, as anyone would be) and the other by
 * `atlas`'s agent wallet. That second bet does **not** go through the policy gate: no model was
 * asked and no gate authorised it. That is stated in the audit log rather than dressed up, because
 * the reason it exists is the claim in the last step — `claim()` pays the agent's registered
 * **owner**, not the agent, and demonstrating that needs an agent with a winning stake. The bet is
 * within `atlas`'s caps, and the chain enforced them regardless of what this script believed.
 *
 * ## What the assertions are worth
 *
 * The payout is checked three ways, none of which is derived from the others:
 *
 *   1. hand-computed parimutuel, from the two stakes this script chose;
 *   2. `previewPayout(marketId, agent)` — the contract's own answer, before claiming;
 *   3. the owner's balance delta across the claim transaction, measured by `eth_getBalance`.
 *
 * All three must agree to the wei. A contract test can prove the arithmetic; only this can prove
 * the arithmetic *and* that the money arrives at the right address on a real chain.
 *
 * Re-runnable: every run creates a fresh market with a fresh `specHash`, so nothing collides.
 */

import { formatEther, keccak256, toUtf8Bytes } from "ethers";
import { eq } from "drizzle-orm";
import { db, getPool } from "../lib/db/client";
import { auditLog, markets } from "../lib/db/schema";
import { explorerUrl } from "../lib/chain";
import { AUSPEX_MARKET_ADDRESS } from "../lib/chain/deployment";
import { getProvider } from "../lib/chain/provider";
import { auspexInterface, readMarket, readPreviewPayout } from "../lib/chain/auspex";
import { describeRevert } from "../lib/chain/revert";
import { createIntent, processIntent } from "../lib/intents/engine";
import { getDeployerWallet } from "../lib/intents/signer";
import { listBettingMembers } from "../lib/agents/members";
import { runIndexer } from "../lib/indexer/run";

/** Seconds of betting before the market closes. Long enough for two bets to confirm. */
const BETTING_SECONDS = 70;

/** Deployer's stake on YES — the losing side, once the outcome is NO. */
const YES_STAKE_WEI = 10n ** 16n; // 0.01 tMSTC

/** Agent's stake on NO — the winning side. Inside `atlas`'s 0.02 tMSTC on-chain per-tx cap. */
const NO_STAKE_WEI = 5n * 10n ** 15n; // 0.005 tMSTC

/**
 * Evidence URL written on chain by `proposeResolution`.
 *
 * A real, stable, publisher-owned URL — the same standard `proposer/run.ts` holds a market's
 * resolution source to. It points at this project's own repository because the thing being resolved
 * is a statement about this project, which is what makes the market honestly settleable at all.
 */
const EVIDENCE_URL = "https://github.com/arunishrajput/auspex";

const RUN_ID = Date.now();

function heading(text: string): void {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

function ok(text: string): void {
  console.log(`  \x1b[32mPASS\x1b[0m  ${text}`);
}

function fail(text: string): void {
  console.log(`  \x1b[31mFAIL\x1b[0m  ${text}`);
  failures += 1;
}

let failures = 0;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits until the chain's own clock is past `unixSeconds`, printing progress. */
async function waitUntil(unixSeconds: number, what: string): Promise<void> {
  const provider = getProvider();
  for (;;) {
    const block = await provider.getBlock("latest");
    const now = block?.timestamp ?? Math.floor(Date.now() / 1000);
    if (now > unixSeconds) return;
    const left = unixSeconds - now + 1;
    console.log(`  waiting ${left}s for ${what} (chain clock ${now})…`);
    await sleep(Math.min(left, 15) * 1000);
  }
}

/**
 * Creates an intent, drives it to a receipt, and returns the result.
 *
 * Goes through the intent engine rather than signing directly, for two reasons: nothing else in this
 * repository may broadcast pipeline transactions, and the engine's rows are what make the market
 * detail page able to show which key sent each call.
 */
async function send(input: {
  label: string;
  key: string;
  kind: Parameters<typeof createIntent>[0]["kind"];
  from: string;
  functionName: string;
  args: unknown[];
  valueWei?: bigint;
  expectRevert?: string;
}): Promise<{ txHash: string | null; status: string; revertReason: string | null; block: number | null }> {
  const intent = await createIntent({
    idempotencyKey: input.key,
    kind: input.kind,
    signer: "SERVER",
    from: input.from,
    functionName: input.functionName,
    args: input.args,
    valueWei: input.valueWei,
  });

  const result = await processIntent(intent);
  const expectingRevert = input.expectRevert !== undefined;

  if (result.status === "CONFIRMED" && !expectingRevert) {
    ok(
      `${input.label} — block ${result.blockNumber}  ${explorerUrl("tx", result.txHash ?? "")}`,
    );
  } else if (result.status === "REVERTED" && expectingRevert) {
    const matched = (result.revertReason ?? "").includes(input.expectRevert ?? "");
    if (matched) {
      ok(`${input.label} — reverted with ${result.revertReason} (block ${result.blockNumber})`);
      console.log(`        ${explorerUrl("tx", result.txHash ?? "")}`);
    } else {
      fail(
        `${input.label} — reverted, but with "${result.revertReason}" and not ` +
          `"${input.expectRevert}"`,
      );
    }
  } else {
    fail(
      `${input.label} — ${result.status}: ${result.revertReason ?? result.note}` +
        (expectingRevert ? ` (expected a revert containing "${input.expectRevert}")` : ""),
    );
  }

  return {
    txHash: result.txHash,
    status: result.status,
    revertReason: result.revertReason,
    block: result.blockNumber,
  };
}

async function main(): Promise<void> {
  const provider = getProvider();
  const deployer = getDeployerWallet();

  console.log("AuspeX — the full resolution lifecycle, on MST Testnet");
  console.log(`  contract ${AUSPEX_MARKET_ADDRESS}`);
  console.log(`  run id   ${RUN_ID}\n`);

  const members = await listBettingMembers();
  const agent = members.find((member) => member.handle === "atlas") ?? members[0];
  if (agent === undefined) {
    console.error("No member with an agent wallet. Run `pnpm --filter web agents:register` first.");
    process.exitCode = 1;
    return;
  }

  const agentBalance = await provider.getBalance(agent.agentAddress);
  if (agentBalance < NO_STAKE_WEI * 2n) {
    console.error(
      `Agent ${agent.handle} holds ${formatEther(agentBalance)} tMSTC, which is not enough to ` +
        `stake ${formatEther(NO_STAKE_WEI)} and pay gas. Top it up with agents:register.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`  deployer ${deployer.address}  ${formatEther(await provider.getBalance(deployer.address))} tMSTC`);
  console.log(`  agent    ${agent.agentAddress}  (${agent.handle})  ${formatEther(agentBalance)} tMSTC`);
  console.log(`  owner    ${agent.ownerAddress}  <- where a winning claim must land`);

  // ---------------------------------------------------------------------------------------
  // 1. Create the market
  // ---------------------------------------------------------------------------------------
  heading("1. createMarket — a labelled Phase 6 lifecycle market, closing in 70 seconds");

  const latest = await provider.getBlock("latest");
  const chainNow = latest?.timestamp ?? Math.floor(Date.now() / 1000);
  const closeTime = chainNow + BETTING_SECONDS;
  // An hour, so `invalidateStale` cannot apply to this market — that path is exercised on a market
  // whose resolver genuinely never appeared, at the end.
  const resolveDeadline = closeTime + 3600;

  const question =
    `[Phase 6 lifecycle test ${RUN_ID}] Not a product market. Did the AuspeX resolution ` +
    `lifecycle complete on chain — propose, challenge, re-propose, finalize, claim?`;
  const specHash = keccak256(toUtf8Bytes(`auspex-lifecycle-${RUN_ID}`));

  console.log(`  question   ${question}`);
  console.log(`  specHash   ${specHash}`);
  console.log(`  closes     ${new Date(closeTime * 1000).toISOString()}`);

  const created = await send({
    label: "createMarket (deployer, MARKET_CREATOR_ROLE)",
    key: `lifecycle:${RUN_ID}:create-market`,
    kind: "CREATE_MARKET",
    from: deployer.address,
    functionName: "createMarket",
    args: [specHash, question, EVIDENCE_URL, closeTime, resolveDeadline],
  });
  if (created.status !== "CONFIRMED") {
    console.error("\nThe market was not created. Nothing further can run.");
    process.exitCode = 1;
    return;
  }

  // The id comes from the receipt's own log, not from a guess at `marketCount`.
  const receipt = await provider.getTransactionReceipt(created.txHash ?? "");
  let onchainId = 0;
  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = auspexInterface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === "MarketCreated") onchainId = Number(parsed.args.marketId as bigint);
    } catch {
      // Not one of ours. Skipped rather than assumed.
    }
  }
  if (onchainId === 0) {
    console.error("\nNo MarketCreated log in the receipt. Refusing to guess the market id.");
    process.exitCode = 1;
    return;
  }
  console.log(`  market id  #${onchainId}`);

  await db.insert(auditLog).values({
    actor: "operator:lifecycle-script",
    action: "lifecycle.market_created",
    subjectType: "market",
    subjectId: String(onchainId),
    reason:
      `scripts/lifecycle.ts created market #${onchainId} to exercise the Phase 6 resolution ` +
      `lifecycle on chain. It is labelled as a test in its own on-chain question text and is not a ` +
      `product market: no proposal, no human approval, no agent decision row.`,
    txHash: created.txHash,
    metadata: { runId: RUN_ID, specHash, closeTime, resolveDeadline },
  });

  // ---------------------------------------------------------------------------------------
  // 2. Bets on both sides
  // ---------------------------------------------------------------------------------------
  heading("2. placeBet — both sides, so the parimutuel split is real");
  console.log(`  YES ${formatEther(YES_STAKE_WEI)} from the deployer — an ordinary uncapped bettor`);
  console.log(`  NO  ${formatEther(NO_STAKE_WEI)} from ${agent.handle}'s agent wallet — capped by the contract`);

  await send({
    label: `placeBet YES ${formatEther(YES_STAKE_WEI)} (deployer)`,
    key: `market:${onchainId}:bet:yes:deployer`,
    kind: "PLACE_BET",
    from: deployer.address,
    functionName: "placeBet",
    args: [onchainId, true],
    valueWei: YES_STAKE_WEI,
  });

  await db.insert(auditLog).values({
    actor: `operator:lifecycle-script`,
    action: "lifecycle.agent_bet",
    subjectType: "market",
    subjectId: String(onchainId),
    reason:
      `An operator placed a ${NO_STAKE_WEI} wei bet from ${agent.handle}'s agent wallet on market ` +
      `#${onchainId}. No model was asked and the policy gate did not authorise it — this is a ` +
      `lifecycle test, not an agent decision, and no row was written to agent_decisions. The stake ` +
      `is inside the agent's on-chain caps and the contract enforced them regardless. It exists so ` +
      `the claim at the end of this run can demonstrate that winnings are paid to the agent's ` +
      `registered owner and not to the agent.`,
    metadata: {
      runId: RUN_ID,
      agentAddress: agent.agentAddress,
      ownerAddress: agent.ownerAddress,
      stakeWei: NO_STAKE_WEI.toString(),
    },
  });

  await send({
    label: `placeBet NO ${formatEther(NO_STAKE_WEI)} (${agent.handle}'s agent)`,
    key: `market:${onchainId}:bet:no:agent`,
    kind: "PLACE_BET",
    from: agent.agentAddress,
    functionName: "placeBet",
    args: [onchainId, false],
    valueWei: NO_STAKE_WEI,
  });

  const afterBets = await readMarket(onchainId, provider);
  console.log(`  pools      YES ${afterBets.poolYesWei}  NO ${afterBets.poolNoWei}`);
  if (afterBets.poolYesWei !== YES_STAKE_WEI || afterBets.poolNoWei !== NO_STAKE_WEI) {
    fail("the pools on chain do not match what was staked");
  } else {
    ok("both pools match the stakes, read back from getMarket()");
  }

  // ---------------------------------------------------------------------------------------
  // 3. Betting closes, and a bet after close is refused
  // ---------------------------------------------------------------------------------------
  heading("3. Betting closes");
  await waitUntil(closeTime, "betting to close");

  await send({
    label: "a late bet is refused by the contract",
    key: `market:${onchainId}:bet:late:deployer:${RUN_ID}`,
    kind: "PLACE_BET",
    from: deployer.address,
    functionName: "placeBet",
    args: [onchainId, true],
    valueWei: 10n ** 12n,
    expectRevert: "BettingClosed",
  });

  await send({
    label: `closeMarket (${agent.handle}'s agent — permissionless, holds no role)`,
    key: `market:${onchainId}:close`,
    kind: "CLOSE_MARKET",
    from: agent.agentAddress,
    functionName: "closeMarket",
    args: [onchainId],
  });

  // ---------------------------------------------------------------------------------------
  // 4. Propose, challenge, re-propose
  // ---------------------------------------------------------------------------------------
  heading("4. proposeResolution → challengeResolution → proposeResolution again");

  await send({
    label: "proposeResolution NO, round 1 (deployer, RESOLVER_ROLE)",
    key: `market:${onchainId}:propose:0`,
    kind: "PROPOSE_RESOLUTION",
    from: deployer.address,
    functionName: "proposeResolution",
    args: [onchainId, 2, EVIDENCE_URL],
  });

  const proposed = await readMarket(onchainId, provider);
  if (proposed.state === "RESOLUTION_PROPOSED" && proposed.outcome === "NO") {
    ok(`state RESOLUTION_PROPOSED, outcome NO, window closes ${proposed.challengeEndsAt}`);
  } else {
    fail(`expected RESOLUTION_PROPOSED/NO, chain says ${proposed.state}/${proposed.outcome}`);
  }

  // Finalising now must fail: the window is the point.
  await send({
    label: "finalizeResolution inside the window is refused",
    key: `market:${onchainId}:finalize-too-early:${RUN_ID}`,
    kind: "FINALIZE_RESOLUTION",
    from: agent.agentAddress,
    functionName: "finalizeResolution",
    args: [onchainId],
    expectRevert: "ChallengeWindowOpen",
  });

  await send({
    label: "challengeResolution (deployer, CHALLENGER_ROLE) — forces a re-proposal",
    key: `market:${onchainId}:challenge:0`,
    kind: "CHALLENGE_RESOLUTION",
    from: deployer.address,
    functionName: "challengeResolution",
    args: [onchainId, "Phase 6 lifecycle test: exercising the challenge path."],
  });

  const challenged = await readMarket(onchainId, provider);
  if (
    challenged.state === "CLOSED" &&
    challenged.outcome === "UNRESOLVED" &&
    challenged.challengeCount === 1 &&
    challenged.evidenceUrl === ""
  ) {
    ok("challenge returned the market to CLOSED, discarded the outcome, kept the count at 1");
  } else {
    fail(
      `after the challenge the chain says state=${challenged.state} outcome=${challenged.outcome} ` +
        `challenges=${challenged.challengeCount} evidence="${challenged.evidenceUrl}"`,
    );
  }

  await send({
    label: "proposeResolution NO, round 2 (deployer, RESOLVER_ROLE)",
    key: `market:${onchainId}:propose:1`,
    kind: "PROPOSE_RESOLUTION",
    from: deployer.address,
    functionName: "proposeResolution",
    args: [onchainId, 2, EVIDENCE_URL],
  });

  // ---------------------------------------------------------------------------------------
  // 5. The window elapses, and anyone can finalise
  // ---------------------------------------------------------------------------------------
  heading("5. The challenge window elapses, and finalizeResolution needs no permission");

  const reproposed = await readMarket(onchainId, provider);
  await waitUntil(reproposed.challengeEndsAt, "the challenge window to close");

  await send({
    label: `finalizeResolution (${agent.handle}'s agent — holds no role at all)`,
    key: `market:${onchainId}:finalize:1`,
    kind: "FINALIZE_RESOLUTION",
    from: agent.agentAddress,
    functionName: "finalizeResolution",
    args: [onchainId],
  });

  const finalized = await readMarket(onchainId, provider);
  if (finalized.state === "FINALIZED" && finalized.outcome === "NO") {
    ok("state FINALIZED, outcome NO");
  } else {
    fail(`expected FINALIZED/NO, chain says ${finalized.state}/${finalized.outcome}`);
  }

  // ---------------------------------------------------------------------------------------
  // 6. The payout — checked three independent ways
  // ---------------------------------------------------------------------------------------
  heading("6. claim — and the three numbers that must agree to the wei");

  // 1. Hand-computed, from the stakes this script chose. Parimutuel: the winners split the whole
  //    pool pro rata, so the sole NO backer takes all of it.
  const totalPool = YES_STAKE_WEI + NO_STAKE_WEI;
  const handComputed = (NO_STAKE_WEI * totalPool) / NO_STAKE_WEI;

  // 2. The contract's own answer.
  const preview = await readPreviewPayout(onchainId, agent.agentAddress, provider);

  console.log(`  hand-computed   ${handComputed} wei  (${formatEther(handComputed)} tMSTC)`);
  console.log(`  previewPayout   ${preview} wei`);
  if (preview === handComputed) {
    ok("previewPayout agrees with the hand-computed parimutuel payout");
  } else {
    fail(`previewPayout ${preview} ≠ hand-computed ${handComputed}`);
  }

  const blockBeforeClaim = await provider.getBlockNumber();
  console.log(`  owner before    ${await provider.getBalance(agent.ownerAddress)} wei`);

  const claim = await send({
    label: `claim (signed by ${agent.handle}'s agent, paid to its registered owner)`,
    key: `market:${onchainId}:claim:${agent.agentAddress}`,
    kind: "CLAIM",
    from: agent.agentAddress,
    functionName: "claim",
    args: [onchainId],
  });

  // 3. The balance delta across exactly the claim. Both reads are at explicit block tags — the
  //    block before the claim and the block it was mined in — so nothing that happened in between
  //    can be attributed to it, and the measurement is reproducible by anyone with the RPC.
  const at = claim.block ?? (await provider.getBlockNumber());
  const ownerBefore = await provider.getBalance(agent.ownerAddress, blockBeforeClaim);
  const agentBefore = await provider.getBalance(agent.agentAddress, blockBeforeClaim);
  const ownerAfter = await provider.getBalance(agent.ownerAddress, at);
  const agentAfter = await provider.getBalance(agent.agentAddress, at);
  const delta = ownerAfter - ownerBefore;

  console.log(`  owner after     ${ownerAfter} wei   (delta ${delta})`);
  if (delta === preview) {
    ok(`the owner's balance rose by exactly ${delta} wei — the amount previewPayout promised`);
  } else {
    fail(`the owner's balance rose by ${delta} wei, but previewPayout said ${preview}`);
  }

  // The agent paid gas and received nothing. That is the property worth demonstrating: the key that
  // signed the claim is not the key that got the money.
  const agentDelta = agentAfter - agentBefore;
  if (agentDelta <= 0n) {
    ok(`the agent wallet that signed received nothing (${agentDelta} wei, gas only)`);
  } else {
    fail(`the agent wallet gained ${agentDelta} wei — winnings must go to the owner, not the agent`);
  }

  heading("7. A second claim, and a losing claim, are both refused");

  await send({
    label: "claiming twice is refused",
    key: `market:${onchainId}:claim-again:${RUN_ID}`,
    kind: "CLAIM",
    from: agent.agentAddress,
    functionName: "claim",
    args: [onchainId],
    expectRevert: "AlreadyClaimed",
  });

  await send({
    label: "the losing side has nothing to claim",
    key: `market:${onchainId}:claim-loser:${RUN_ID}`,
    kind: "CLAIM",
    from: deployer.address,
    functionName: "claim",
    args: [onchainId],
    expectRevert: "NothingToClaim",
  });

  // ---------------------------------------------------------------------------------------
  // 7. invalidateStale — the counterpart to permissionless finalisation
  // ---------------------------------------------------------------------------------------
  heading("8. invalidateStale — a resolver who never appeared cannot lock funds up either");

  const staleId = await findStaleMarket();
  if (staleId === null) {
    console.log("  No market is past its resolveDeadline and still unsettled. Nothing to do.");
  } else {
    const before = await readMarket(staleId, provider);
    console.log(`  market #${staleId} — ${before.state}, resolve deadline ${before.resolveDeadline}`);
    console.log(`  pools YES ${before.poolYesWei} NO ${before.poolNoWei}`);

    await send({
      label: `invalidateStale(#${staleId}) (${agent.handle}'s agent — permissionless)`,
      key: `market:${staleId}:invalidate-stale`,
      kind: "INVALIDATE_STALE",
      from: agent.agentAddress,
      functionName: "invalidateStale",
      args: [staleId],
    });

    const after = await readMarket(staleId, provider);
    if (after.state === "INVALIDATED" && after.outcome === "INVALID") {
      ok(`market #${staleId} is INVALIDATED — every bettor can reclaim their exact stake`);
    } else {
      fail(`expected INVALIDATED/INVALID, chain says ${after.state}/${after.outcome}`);
    }

    // On an invalidated market a refund is a stake returned exactly, so this is the `winningPool`
    // path the contract test covers, observed live.
    const refund = await readPreviewPayout(staleId, getDeployerWallet().address, provider);
    if (before.poolYesWei + before.poolNoWei === 0n) {
      console.log("  the market had empty pools, so there is nothing to refund — as expected");
    } else if (refund > 0n) {
      ok(`previewPayout offers the deployer a refund of ${refund} wei on the invalidated market`);
      await send({
        label: `claim the refund on #${staleId} (deployer)`,
        key: `market:${staleId}:claim:${getDeployerWallet().address.toLowerCase()}`,
        kind: "CLAIM",
        from: getDeployerWallet().address,
        functionName: "claim",
        args: [staleId],
      });
    }
  }

  // ---------------------------------------------------------------------------------------
  // Index, so the app sees all of it
  // ---------------------------------------------------------------------------------------
  heading("9. Indexing everything this run put on chain");
  const report = await runIndexer();
  console.log(`  ${report.logsInserted} new log(s), ${report.marketsUpserted} market row(s) upserted`);

  const [row] = await db
    .select({ state: markets.state, outcome: markets.outcome })
    .from(markets)
    .where(eq(markets.onchainId, onchainId))
    .limit(1);
  if (row?.state === "FINALIZED" && row.outcome === "NO") {
    ok("the projection in Postgres agrees with the chain: FINALIZED / NO");
  } else {
    fail(`the projection says ${row?.state ?? "(missing)"} / ${row?.outcome ?? "-"}`);
  }

  heading(failures === 0 ? "Lifecycle complete." : `Lifecycle finished with ${failures} failure(s).`);
  console.log(`  market      ${explorerUrl("address", AUSPEX_MARKET_ADDRESS)}`);
  console.log(`  detail page /markets/${onchainId}`);
  if (failures > 0) process.exitCode = 1;
}

/**
 * A market past its `resolveDeadline` that is still OPEN or CLOSED.
 *
 * Read from the chain, market by market, because that is the exact condition `invalidateStale`
 * checks and the projection is not authoritative about it.
 */
async function findStaleMarket(): Promise<number | null> {
  const provider = getProvider();
  const block = await provider.getBlock("latest");
  const now = block?.timestamp ?? Math.floor(Date.now() / 1000);

  const rows = await db
    .select({ onchainId: markets.onchainId })
    .from(markets)
    .orderBy(markets.onchainId);

  for (const row of rows) {
    if (row.onchainId === null) continue;
    const market = await readMarket(row.onchainId, provider);
    if (market.state !== "OPEN" && market.state !== "CLOSED") continue;
    if (now <= market.resolveDeadline) continue;
    return row.onchainId;
  }
  return null;
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.stack : String(error)}\n`);
    console.error(describeRevert(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end().catch(() => undefined);
  });
