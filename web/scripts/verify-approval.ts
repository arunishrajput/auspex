/**
 * Proves an approval would succeed on chain — **without signing anything.**
 *
 *   pnpm --filter web verify:approval
 *
 * The human gate's whole point is that the key which creates a market lives in a browser wallet
 * and on no server. That is a good property and an awkward one to test: nothing in this
 * repository can produce the signature, so "does approval work?" cannot be answered by running
 * code here.
 *
 * What *can* be answered, entirely from a read, is everything up to the signature:
 *
 *   1. the stored spec still hashes to the stored `specHash`  (nothing edited the row)
 *   2. the authority wallet holds MARKET_CREATOR_ROLE          (`hasRole`, live)
 *   3. the contract is not paused                              (`paused()`, live)
 *   4. that `specHash` has not been used                       (`specHashUsed`, live)
 *   5. `eth_call` of the exact calldata, *from the authority address*, succeeds and returns
 *      the market id it would create
 *
 * Step 5 is the real check: it runs the transaction against the current state of the deployed
 * contract and reports what would happen. A revert here is the same revert the wallet would
 * produce, decoded, before it matters instead of while someone is waiting on it.
 *
 * It writes nothing — no intent, no market row, no audit entry. `prepareApproval` performs the
 * same simulation on the live path; this is the version you can run at any time.
 */

import { getProvider } from "../lib/chain/provider";
import { auspexInterface } from "../lib/chain/auspex";
import { AUSPEX_MARKET_ADDRESS } from "../lib/chain/deployment";
import { describeRevert } from "../lib/chain/revert";
import { computeSpecHash, type MarketSpec } from "../lib/chain/spec";
import { humanAuthorityAddress } from "../lib/approval/authority";
import { db } from "../lib/db/client";
import { proposals } from "../lib/db/schema";
import { eq } from "drizzle-orm";
import { explorerUrl } from "../lib/chain";

const MARKET_CREATOR_ROLE =
  "0xd3065a24ad9e7725d223007135762d2902038999e3e5829146654498a58d9795";

function line(ok: boolean, label: string, detail: string): void {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(34)} ${detail}`);
}

async function main(): Promise<void> {
  const authority = humanAuthorityAddress();
  if (authority === null) {
    console.error("HUMAN_AUTHORITY_ADDRESS is not set. See docs/RUNBOOK.md §5.");
    process.exitCode = 1;
    return;
  }

  const queued = await db
    .select()
    .from(proposals)
    .where(eq(proposals.status, "PENDING_REVIEW"))
    .orderBy(proposals.createdAt);

  if (queued.length === 0) {
    console.log("No proposal is awaiting review. Run `pnpm --filter web tick` first.");
    return;
  }

  const provider = getProvider();
  const contract = AUSPEX_MARKET_ADDRESS;

  console.log(`AuspeX — approval dry run`);
  console.log(`  contract  ${contract}`);
  console.log(`  authority ${authority}`);
  console.log(`  queue     ${queued.length} proposal(s) awaiting a human\n`);

  // Contract-wide preconditions, read once.
  const paused = (await provider.call({
    to: contract,
    data: auspexInterface.encodeFunctionData("paused", []),
  })) as string;
  const isPaused = BigInt(paused) === 1n;

  const hasRole = (await provider.call({
    to: contract,
    data: auspexInterface.encodeFunctionData("hasRole", [MARKET_CREATOR_ROLE, authority]),
  })) as string;
  const holdsRole = BigInt(hasRole) === 1n;

  line(holdsRole, "authority holds MARKET_CREATOR_ROLE", holdsRole ? "hasRole() == true" : "NOT granted");
  line(!isPaused, "contract is not paused", isPaused ? "paused() == true" : "paused() == false");

  const balance = await provider.getBalance(authority);
  line(balance > 0n, "authority can pay for gas", `${balance / 10n ** 15n} mtMSTC`);
  console.log();

  let allOk = holdsRole && !isPaused && balance > 0n;

  for (const proposal of queued) {
    const spec = proposal.spec as unknown as MarketSpec | null;
    console.log(`  ${proposal.id}`);
    console.log(`    ${spec?.question ?? "(no spec)"}\n`);

    if (spec === null || proposal.specHash === null) {
      line(false, "spec present", "the row has no spec");
      allOk = false;
      continue;
    }

    const derived = computeSpecHash(spec);
    const hashOk = derived === proposal.specHash;
    line(hashOk, "stored hash matches the spec", hashOk ? derived : `stored ${proposal.specHash} != ${derived}`);

    const used = (await provider.call({
      to: contract,
      data: auspexInterface.encodeFunctionData("specHashUsed", [proposal.specHash]),
    })) as string;
    const alreadyUsed = BigInt(used) === 1n;
    line(!alreadyUsed, "specHash is unused on chain", alreadyUsed ? "ALREADY USED — replay guard would revert" : "free");

    const remaining = spec.closeTime - Math.floor(Date.now() / 1000);
    line(remaining > 300, "closeTime is still in the future", `${(remaining / 3600).toFixed(1)} h left`);

    // The check that matters: the real calldata, from the real address, against the real
    // contract at the current block.
    const data = auspexInterface.encodeFunctionData("createMarket", [
      proposal.specHash,
      spec.question,
      spec.resolutionSourceUrl,
      spec.closeTime,
      spec.resolveDeadline,
    ]);

    try {
      const returned = await provider.call({ to: contract, data, from: authority });
      const [marketId] = auspexInterface.decodeFunctionResult("createMarket", returned);
      line(true, "eth_call createMarket succeeds", `would create market #${marketId}`);
      console.log(`          calldata ${data.slice(0, 26)}… (${(data.length - 2) / 2} bytes)`);
    } catch (error) {
      line(false, "eth_call createMarket succeeds", describeRevert(error));
      allOk = false;
    }

    console.log();
  }

  console.log(
    allOk
      ? `All checks pass. Approving in /review will produce a real transaction.\n` +
          `Nothing was signed and nothing was written. Explorer: ${explorerUrl("address", contract)}`
      : `Something would fail. Fix it before approving in front of anyone.`,
  );

  if (!allOk) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
