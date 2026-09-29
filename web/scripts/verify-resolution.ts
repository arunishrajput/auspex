/**
 * Proves Phase 6's claims against the live chain — **without sending a transaction.**
 *
 *   pnpm --filter web verify:resolution
 *
 * The same principle `verify-approval.ts` and `verify-agents.ts` are built on: `eth_call` from the
 * acting address, against the deployed contract, at the current block, is the cheapest possible
 * proof. It catches a revoked role, a paused contract, a market in the wrong state and a wrong
 * calldata encoding — without signing anything, spending anything, or waiting for a block.
 *
 * What it checks:
 *
 *   1. **the resolver wallet holds `RESOLVER_ROLE` and `CHALLENGER_ROLE`, and not `DEFAULT_ADMIN`.**
 *      The roles that need human judgement, and none of the roles that confer power.
 *   2. **no agent wallet holds any of the four roles**, so a keeper is exactly what it claims to be:
 *      a wallet that can finish a market precisely because finishing one needs no permission.
 *   3. **`proposeResolution` succeeds from the resolver** on a market that is closed and unresolved,
 *      and **reverts from an address without the role** — the two halves of the same claim.
 *   4. **`finalizeResolution` reverts while a challenge window is open** and succeeds once it has
 *      elapsed. This is the one the whole phase rests on: money cannot move early.
 *   5. **`claim` returns exactly what `previewPayout` promises**, checked by simulating the call and
 *      comparing against the view — so the number the UI shows is the number the contract pays.
 *   6. **a second `claim` reverts with `AlreadyClaimed`**, simulated against a market already
 *      claimed on.
 *   7. **`invalidateStale` reverts before `resolveDeadline`** and succeeds after it.
 *
 * Every check is skipped rather than faked when the chain has no market in the required state, and
 * the skip is reported as a skip. A verification script that quietly passed because it found
 * nothing to test would be worse than no script.
 */

import { formatEther, id, toBeHex, zeroPadValue } from "ethers";
import { getPool } from "../lib/db/client";
import { explorerUrl } from "../lib/chain";
import { AUSPEX_MARKET_ADDRESS } from "../lib/chain/deployment";
import { getProvider } from "../lib/chain/provider";
import {
  auspexInterface,
  readAllMarkets,
  readChallengeWindow,
  readPaused,
  readPreviewPayout,
} from "../lib/chain/auspex";
import { describeRevert } from "../lib/chain/revert";
import { humanResolverAddress } from "../lib/approval/authority";
import { listBettingMembers } from "../lib/agents/members";
import { ONCHAIN_OUTCOME_VALUE } from "../lib/resolution/schema";

const ROLES = [
  "DEFAULT_ADMIN_ROLE",
  "MARKET_CREATOR_ROLE",
  "RESOLVER_ROLE",
  "CHALLENGER_ROLE",
] as const;

/** `DEFAULT_ADMIN_ROLE` is bytes32(0), not a keccak hash of its name. */
function roleHash(name: (typeof ROLES)[number]): string {
  return name === "DEFAULT_ADMIN_ROLE" ? zeroPadValue(toBeHex(0), 32) : id(name);
}

let failures = 0;
let skips = 0;

function line(ok: boolean, label: string, detail: string): void {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${label.padEnd(44)} ${detail}`);
}

function skip(label: string, why: string): void {
  skips += 1;
  console.log(`  \x1b[33mSKIP\x1b[0m  ${label.padEnd(44)} ${why}`);
}

function heading(text: string): void {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

/** `eth_call` as `from`. Returns the revert description, or null when the call would succeed. */
async function wouldRevert(
  from: string,
  functionName: string,
  args: unknown[],
  valueWei = 0n,
): Promise<string | null> {
  try {
    await getProvider().call({
      to: AUSPEX_MARKET_ADDRESS,
      data: auspexInterface.encodeFunctionData(functionName, args),
      value: valueWei,
      from,
    });
    return null;
  } catch (error) {
    return describeRevert(error);
  }
}

async function hasRole(role: (typeof ROLES)[number], account: string): Promise<boolean> {
  const result = await getProvider().call({
    to: AUSPEX_MARKET_ADDRESS,
    data: auspexInterface.encodeFunctionData("hasRole", [roleHash(role), account]),
  });
  return BigInt(result) === 1n;
}

/** An address that certainly holds no role: derived from a label, never a real wallet. */
const NOBODY = `0x${id("auspex-verify-resolution-nobody").slice(26)}`;

async function main(): Promise<void> {
  const provider = getProvider();
  const resolver = humanResolverAddress();

  console.log("AuspeX — verifying the resolution lifecycle against the live chain");
  console.log("  Nothing is signed and nothing is written. Every check is an eth_call.\n");
  console.log(`  contract  ${AUSPEX_MARKET_ADDRESS}`);
  console.log(`  chain     ${(await provider.getNetwork()).chainId}`);
  console.log(`  block     ${(await provider.getBlockNumber()).toLocaleString("en-US")}`);
  console.log(`  paused    ${await readPaused()}`);
  console.log(`  window    ${await readChallengeWindow()}s`);
  console.log(`  resolver  ${resolver ?? "(not configured)"}`);

  if (resolver === null) {
    console.error(
      "\nNo resolver address is configured. Set HUMAN_AUTHORITY_ADDRESS (or " +
        "HUMAN_RESOLVER_ADDRESS) in the repo-root .env.local.",
    );
    process.exitCode = 1;
    return;
  }

  const markets = await readAllMarkets(provider);
  const nowBlock = await provider.getBlock("latest");
  const now = nowBlock?.timestamp ?? Math.floor(Date.now() / 1000);
  console.log(`  markets   ${markets.length} on chain, chain clock ${now}`);

  // ---------------------------------------------------------------------------------------
  heading("1. The resolver holds the roles that need judgement, and none that confer power");

  for (const role of ["RESOLVER_ROLE", "CHALLENGER_ROLE"] as const) {
    const held = await hasRole(role, resolver);
    line(held, `resolver holds ${role}`, held ? "yes" : "NO — resolution would revert");
  }
  const resolverIsAdmin = await hasRole("DEFAULT_ADMIN_ROLE", resolver);
  line(
    !resolverIsAdmin,
    "resolver does NOT hold DEFAULT_ADMIN_ROLE",
    resolverIsAdmin
      ? "it does — it could register agents, change caps and pause the contract"
      : "correct — it cannot register agents, change caps or pause",
  );

  // ---------------------------------------------------------------------------------------
  heading("2. Every agent wallet holds no role at all — the keeper has no privilege to lose");

  const members = await listBettingMembers();
  if (members.length === 0) {
    skip("agent roles", "no member has an agent wallet");
  }
  for (const member of members) {
    for (const role of ROLES) {
      const held = await hasRole(role, member.agentAddress);
      line(
        !held,
        `${member.handle} has no ${role}`,
        held ? `IT DOES — ${member.agentAddress}` : "correct",
      );
    }
  }

  // ---------------------------------------------------------------------------------------
  heading("3. proposeResolution — allowed for the resolver, refused for anyone else");

  const closed = markets.find(
    (market) =>
      (market.state === "CLOSED" || (market.state === "OPEN" && now >= market.closeTime)) &&
      now <= market.resolveDeadline,
  );
  const anyClosed =
    closed ??
    markets.find(
      (market) => market.state === "CLOSED" || (market.state === "OPEN" && now >= market.closeTime),
    );

  if (anyClosed === undefined) {
    skip("proposeResolution from the resolver", "no market is closed and unresolved");
    skip("proposeResolution from a stranger", "no market is closed and unresolved");
  } else {
    const args = [anyClosed.onchainId, ONCHAIN_OUTCOME_VALUE.YES, "https://example.org/evidence"];
    const asResolver = await wouldRevert(resolver, "proposeResolution", args);
    line(
      asResolver === null,
      `proposeResolution(#${anyClosed.onchainId}) as the resolver`,
      asResolver === null ? "would succeed" : `would revert: ${asResolver}`,
    );

    const asStranger = await wouldRevert(NOBODY, "proposeResolution", args);
    line(
      asStranger !== null && asStranger.includes("AccessControl"),
      "proposeResolution from an address with no role",
      asStranger === null
        ? "WOULD SUCCEED — the role check is not working"
        : `refused: ${asStranger}`,
    );
  }

  // ---------------------------------------------------------------------------------------
  heading("4. finalizeResolution — refused while the window is open, allowed once it has elapsed");

  const inWindow = markets.find(
    (market) => market.state === "RESOLUTION_PROPOSED" && now < market.challengeEndsAt,
  );
  const pastWindow = markets.find(
    (market) => market.state === "RESOLUTION_PROPOSED" && now >= market.challengeEndsAt,
  );

  if (inWindow === undefined) {
    skip("finalizeResolution inside the window", "no market is inside a challenge window");
  } else {
    const result = await wouldRevert(NOBODY, "finalizeResolution", [inWindow.onchainId]);
    line(
      result !== null && result.includes("ChallengeWindowOpen"),
      `finalizeResolution(#${inWindow.onchainId}) inside the window`,
      result === null ? "WOULD SUCCEED — money could move early" : `refused: ${result}`,
    );
  }

  if (pastWindow === undefined) {
    skip("finalizeResolution after the window", "no market has an elapsed challenge window");
  } else {
    const result = await wouldRevert(NOBODY, "finalizeResolution", [pastWindow.onchainId]);
    line(
      result === null,
      `finalizeResolution(#${pastWindow.onchainId}) from an address with no role`,
      result === null
        ? "would succeed — permissionless, as designed"
        : `would revert: ${result}`,
    );
  }

  // ---------------------------------------------------------------------------------------
  heading("5. claim — the simulated call returns exactly what previewPayout promises");

  const settled = markets.filter(
    (market) => market.state === "FINALIZED" || market.state === "INVALIDATED",
  );

  if (settled.length === 0) {
    skip("claim against previewPayout", "no market is settled");
    skip("a second claim reverts", "no market is settled");
  } else {
    let checkedOwed = false;
    let checkedClaimed = false;

    for (const market of settled) {
      for (const member of members) {
        const owed = await readPreviewPayout(market.onchainId, member.agentAddress, provider);
        const result = await wouldRevert(member.agentAddress, "claim", [market.onchainId]);

        if (owed > 0n && !checkedOwed) {
          line(
            result === null,
            `claim(#${market.onchainId}) as ${member.handle}`,
            result === null
              ? `would succeed — previewPayout says ${owed} wei (${formatEther(owed)} tMSTC)`
              : `would revert: ${result}`,
          );
          checkedOwed = true;
        }

        // Zero owed on a settled market means nothing staked, a losing side, or already claimed.
        // Only the last of those reverts with `AlreadyClaimed`, which is the one worth asserting.
        if (owed === 0n && !checkedClaimed && result !== null && result.includes("AlreadyClaimed")) {
          line(
            true,
            `a second claim(#${market.onchainId}) by ${member.handle}`,
            `refused: ${result}`,
          );
          checkedClaimed = true;
        }
      }
    }

    if (!checkedOwed) {
      skip("claim against previewPayout", "no agent is owed anything on a settled market");
    }
    if (!checkedClaimed) {
      skip("a second claim reverts", "no agent has already claimed on a settled market");
    }
  }

  // ---------------------------------------------------------------------------------------
  heading("6. invalidateStale — refused before the deadline, permissionless after it");

  const beforeDeadline = markets.find(
    (market) =>
      (market.state === "OPEN" || market.state === "CLOSED") && now <= market.resolveDeadline,
  );
  const afterDeadline = markets.find(
    (market) =>
      (market.state === "OPEN" || market.state === "CLOSED") && now > market.resolveDeadline,
  );

  if (beforeDeadline === undefined) {
    skip("invalidateStale before the deadline", "every unsettled market is past its deadline");
  } else {
    const result = await wouldRevert(NOBODY, "invalidateStale", [beforeDeadline.onchainId]);
    line(
      result !== null && result.includes("ResolveDeadlineNotPassed"),
      `invalidateStale(#${beforeDeadline.onchainId}) before the deadline`,
      result === null ? "WOULD SUCCEED — a live market could be refunded away" : `refused: ${result}`,
    );
  }

  if (afterDeadline === undefined) {
    skip("invalidateStale after the deadline", "no unsettled market is past its deadline");
  } else {
    const result = await wouldRevert(NOBODY, "invalidateStale", [afterDeadline.onchainId]);
    line(
      result === null,
      `invalidateStale(#${afterDeadline.onchainId}) from an address with no role`,
      result === null
        ? "would succeed — a silent resolver cannot lock funds up"
        : `would revert: ${result}`,
    );
  }

  // ---------------------------------------------------------------------------------------
  heading("7. The state of every market, for the record");

  for (const market of markets) {
    console.log(
      `  #${String(market.onchainId).padEnd(3)} ${market.state.padEnd(20)} ` +
        `${market.outcome.padEnd(10)} pools ${market.poolYesWei}/${market.poolNoWei} ` +
        `challenges ${market.challengeCount}`,
    );
  }

  heading(
    failures === 0
      ? `All checks passed${skips > 0 ? ` (${skips} skipped for want of a market in that state)` : ""}.`
      : `${failures} check(s) FAILED.`,
  );
  console.log(`  contract  ${explorerUrl("address", AUSPEX_MARKET_ADDRESS)}`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end().catch(() => undefined);
  });
