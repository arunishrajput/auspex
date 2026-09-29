/**
 * One-time setup for member agents.  `pnpm --filter web agents:register`
 *
 *   1. seeds the members in `lib/agents/members.ts`, each with a fresh agent wallet whose key is
 *      encrypted at rest;
 *   2. tops each agent wallet up to a target balance from the deployer;
 *   3. creates a `registerAgent` intent per agent and drives it to confirmation;
 *   4. reads the registry back off the chain and prints what it found.
 *
 * ## Why this is a script and not a tick stage
 *
 * `registerAgent` is `onlyRole(DEFAULT_ADMIN_ROLE)`, and **`DEPLOYER_PRIVATE_KEY` is deliberately
 * not in Vercel.** Putting it there so a tick could register agents would mean production held a
 * key that can create markets, resolve them, grant roles and pause the contract — to save a human
 * running one command, once. The deployed application holds only agent keys, which hold no role
 * and are capped by the contract.
 *
 * Safe to re-run. Seeding is idempotent on `members.handle`, the registration intent is idempotent
 * on the agent address *and its caps*, and the funding step tops up to a target rather than
 * sending a fixed amount.
 *
 * ## The one honest caveat, stated rather than hidden
 *
 * Step 2 sends native tMSTC with `wallet.sendTransaction` — the only place in this repository that
 * broadcasts outside the intent engine. The engine encodes `AuspexMarket` calldata, and a plain
 * value transfer has none, so it could not go through it without inventing a second kind of
 * intent for a setup step that a human runs while watching the output. It is idempotent in effect
 * (it computes `target - balance` after reading the balance) but not crash-proof: a kill between
 * broadcast and receipt, re-run, could overfund an agent by one top-up. The consequence is that
 * one of our own wallets holds slightly more testnet coin than intended — bounded, recoverable,
 * and not a risk worth a migration to remove.
 */

import { formatEther, parseEther } from "ethers";
import { and, inArray } from "drizzle-orm";
import { db, getPool } from "../lib/db/client";
import { onchainIntents } from "../lib/db/schema";
import { explorerUrl } from "../lib/chain";
import { AUSPEX_MARKET_ADDRESS } from "../lib/chain/deployment";
import { getProvider } from "../lib/chain/provider";
import { readAgent, readPaused } from "../lib/chain/auspex";
import { getDeployerWallet } from "../lib/intents/signer";
import { processIntent } from "../lib/intents/engine";
import { listBettingMembers, onChainCapsFor, seedMembers } from "../lib/agents/members";
import { createRegistrationIntent } from "../lib/agents/registry";

/** Each agent is topped up to this. Enough for its whole daily budget plus many transactions. */
const TARGET_BALANCE = parseEther("0.08");

function heading(text: string): void {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

async function main(): Promise<void> {
  console.log("AuspeX — member agent setup");
  console.log(`  contract ${AUSPEX_MARKET_ADDRESS}`);

  const deployer = getDeployerWallet();
  const provider = getProvider();
  const deployerBalance = await provider.getBalance(deployer.address);
  console.log(`  admin    ${deployer.address} — ${formatEther(deployerBalance)} tMSTC`);

  if (await readPaused(provider)) {
    console.error("\nThe contract is paused. Registration would revert. Unpause first.");
    process.exitCode = 1;
    return;
  }

  // --- 1. Members -------------------------------------------------------------------------
  heading("1. Members and agent wallets");
  const seeded = await seedMembers();
  console.log(`  created  ${seeded.created.join(", ") || "none"}`);
  console.log(`  existing ${seeded.existing.join(", ") || "none"}`);
  console.log(`  policies ${seeded.policiesUpdated.join(", ") || "none"} (re-asserted)`);

  const members = await listBettingMembers();
  if (members.length === 0) {
    console.error("\nNo members have both an agent wallet and a policy. Nothing to register.");
    process.exitCode = 1;
    return;
  }

  // --- 2. Funding -------------------------------------------------------------------------
  heading("2. Funding the agent wallets");
  for (const member of members) {
    const balance = await provider.getBalance(member.agentAddress);
    if (balance >= TARGET_BALANCE) {
      console.log(
        `  ${member.handle.padEnd(9)} ${member.agentAddress}  ${formatEther(balance)} tMSTC — already funded`,
      );
      continue;
    }

    const topUp = TARGET_BALANCE - balance;
    const sent = await deployer.sendTransaction({ to: member.agentAddress, value: topUp });
    const receipt = await sent.wait(1);
    console.log(
      `  ${member.handle.padEnd(9)} ${member.agentAddress}  +${formatEther(topUp)} tMSTC ` +
        `in block ${receipt?.blockNumber ?? "?"}  ${sent.hash}`,
    );
  }

  // --- 3. Registration ---------------------------------------------------------------------
  heading("3. Registering caps on chain  (admin only, signed locally)");
  const intentIds: string[] = [];

  for (const member of members) {
    const caps = onChainCapsFor(member.policy);
    const intent = await createRegistrationIntent(member);
    intentIds.push(intent.id);
    console.log(
      `  ${member.handle.padEnd(9)} perTx ${formatEther(caps.perTxCapWei)} · ` +
        `perMarket ${formatEther(caps.perMarketCapWei)} tMSTC · owner ${member.ownerAddress}`,
    );
    console.log(`            intent ${intent.id}  ${intent.status}`);
  }

  // Driven here rather than left to a tick: the tick cannot sign these, and a human running this
  // command wants to see the transactions land.
  const pending = await db
    .select()
    .from(onchainIntents)
    .where(
      and(
        inArray(onchainIntents.id, intentIds),
        inArray(onchainIntents.status, ["PENDING", "SIGNED", "BROADCAST"]),
      ),
    );

  for (const intent of pending) {
    const result = await processIntent(intent);
    console.log(
      `  → ${result.status.padEnd(10)} ${result.txHash ?? "-"}  ${result.note}` +
        (result.revertReason === null ? "" : `\n      revert: ${result.revertReason}`),
    );
  }

  // --- 4. Read it back off the chain -------------------------------------------------------
  heading("4. What the contract now holds  (read, not assumed)");
  let allGood = true;

  for (const member of members) {
    const onChain = await readAgent(member.agentAddress, provider);
    const expected = onChainCapsFor(member.policy);
    const ok =
      onChain.registered &&
      onChain.active &&
      onChain.perTxCapWei === expected.perTxCapWei &&
      onChain.perMarketCapWei === expected.perMarketCapWei &&
      onChain.owner === member.ownerAddress;

    allGood = allGood && ok;
    console.log(`  ${ok ? "\x1b[32mOK  \x1b[0m" : "\x1b[31mBAD \x1b[0m"} ${member.handle}`);
    console.log(`       agent      ${member.agentAddress}`);
    console.log(`       registered ${onChain.registered}   active ${onChain.active}`);
    console.log(`       perTx      ${formatEther(onChain.perTxCapWei)} tMSTC`);
    console.log(`       perMarket  ${formatEther(onChain.perMarketCapWei)} tMSTC`);
    console.log(`       pays       ${onChain.owner}`);
    console.log(`       explorer   ${explorerUrl("address", member.agentAddress)}`);
  }

  heading("The property this buys");
  console.log("  An agent wallet holds NO role on this contract. It can place a capped bet and");
  console.log("  claim — nothing else. Its winnings are paid to the owner above, not to itself.");
  console.log("  Those are contract rules, so they hold even with this server fully compromised.");
  console.log(`\n  Verify: ${explorerUrl("address", AUSPEX_MARKET_ADDRESS)}`);

  if (!allGood) {
    console.error("\nAt least one agent is not registered as expected. Fix before betting.");
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
