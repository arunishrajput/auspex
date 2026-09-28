/**
 * Grants (or revokes) a role on the deployed `AuspexMarket`.
 *
 *   ROLE=MARKET_CREATOR_ROLE TO=0xabc… pnpm --filter contracts grant:testnet
 *   ROLE=RESOLVER_ROLE TO=0xabc… REVOKE=true pnpm --filter contracts grant:testnet
 *
 * ## Why this exists as a committed script rather than a console one-liner
 *
 * Granting `MARKET_CREATOR_ROLE` to a human's wallet is the single most consequential
 * administrative action in this project: it is what turns "a human approves markets" from a
 * claim in the README into a property the chain enforces. An action like that should be
 * reviewable, re-runnable, and leave a transaction hash someone can check — not live in a
 * shell history.
 *
 * ## Why it does not go through the intent engine
 *
 * `CLAUDE.md` says nothing but `lib/intents/engine.ts` may broadcast. That rule governs the
 * *pipeline* — the code paths that run unattended on a timer, where a crashed worker must not
 * double-spend. This is an operator bootstrap action run by hand, in the same category as
 * `deploy.ts` and `smoke.ts`, which also broadcast. Routing it through the engine would mean
 * adding a `GRANT_ROLE` variant to the intent enum and a migration, to make a once-per-wallet
 * action idempotent — and `grantRole` is already idempotent on chain, because AccessControl
 * emits no event and changes no state when the account already holds the role.
 *
 * ## Safety
 *
 * - Refuses to run unless the signer actually holds `DEFAULT_ADMIN_ROLE`, rather than sending
 *   a transaction that will revert.
 * - Refuses an address with contract code: a role is being granted to a human's wallet, and a
 *   typo that lands on a contract is worth catching before it is broadcast.
 * - Reports "already held" and exits without sending anything, so re-running is free.
 */
import hre from "hardhat";
import { formatEther, isAddress, getAddress } from "ethers";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AuspexMarket__factory } from "../types/ethers-contracts/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPLORER = "https://testnet.mstscan.com";

/** Roles that may be granted from here. `DEFAULT_ADMIN_ROLE` is deliberately absent. */
const GRANTABLE = ["MARKET_CREATOR_ROLE", "RESOLVER_ROLE", "CHALLENGER_ROLE"] as const;
type Grantable = (typeof GRANTABLE)[number];

function readDeployment(): { address: string } {
  const path = join(__dirname, "..", "deployments", "mstTestnet.json");
  const record = JSON.parse(readFileSync(path, "utf8")) as {
    contracts: { AuspexMarket: { address: string } };
  };
  return record.contracts.AuspexMarket;
}

async function main(): Promise<void> {
  const roleName = process.env.ROLE?.trim();
  const target = process.env.TO?.trim();
  const revoke = process.env.REVOKE === "true";

  if (roleName === undefined || !GRANTABLE.includes(roleName as Grantable)) {
    throw new Error(`ROLE must be one of: ${GRANTABLE.join(", ")}. Got: ${roleName ?? "(unset)"}`);
  }
  if (target === undefined || !isAddress(target)) {
    throw new Error(`TO must be a valid address. Got: ${target ?? "(unset)"}`);
  }

  const to = getAddress(target); // checksummed — a mixed-case typo fails here, not on chain
  const { ethers } = await hre.network.connect();
  const [signer] = await ethers.getSigners();
  const { address } = readDeployment();
  const market = AuspexMarket__factory.connect(address, signer);

  // Hardhat's signer types `provider` as nullable; a signer obtained from a connected network
  // always has one. Narrowed once here rather than asserted at each use.
  const provider = signer.provider;
  if (provider === null) throw new Error("signer has no provider");

  const network = await provider.getNetwork();
  console.log(`\nAuspexMarket  ${address}`);
  console.log(`chain         ${network.chainId}`);
  console.log(`signer        ${signer.address}  (${formatEther(await provider.getBalance(signer.address))} tMSTC)`);
  console.log(`action        ${revoke ? "REVOKE" : "GRANT"} ${roleName}`);
  console.log(`target        ${to}\n`);

  // The signer must be an admin. Checking first turns a confusing on-chain revert into a
  // sentence that says what is wrong.
  const adminRole = await market.DEFAULT_ADMIN_ROLE();
  if (!(await market.hasRole(adminRole, signer.address))) {
    throw new Error(
      `Signer ${signer.address} does not hold DEFAULT_ADMIN_ROLE on ${address}. ` +
        `Only an admin can change roles.`,
    );
  }

  // A role on a contract address is almost always a typo. Granting is for humans and, in
  // Phase 5, for agent EOAs — neither has bytecode.
  if ((await provider.getCode(to)) !== "0x") {
    throw new Error(`${to} has contract code. Roles are granted to externally-owned accounts.`);
  }

  const roleId = await market[roleName as Grantable]();
  const alreadyHas = await market.hasRole(roleId, to);

  if (alreadyHas === !revoke) {
    console.log(`Nothing to do — ${to} ${revoke ? "does not hold" : "already holds"} ${roleName}.`);
    return;
  }

  const tx = revoke ? await market.revokeRole(roleId, to) : await market.grantRole(roleId, to);
  console.log(`tx sent       ${tx.hash}`);
  const receipt = await tx.wait();
  if (receipt === null) throw new Error("no receipt");

  console.log(`confirmed     block ${receipt.blockNumber}, gas ${receipt.gasUsed}`);
  console.log(`explorer      ${EXPLORER}/tx/${tx.hash}`);

  // Read the state back over the RPC rather than trusting the receipt. This is the same
  // discipline the rest of the project uses: the chain is authoritative, so ask it.
  const confirmed = await market.hasRole(roleId, to);
  if (confirmed === revoke) {
    throw new Error(`Post-check failed: hasRole(${roleName}, ${to}) is ${confirmed}`);
  }
  console.log(`\nverified      hasRole(${roleName}, ${to}) = ${confirmed}`);

  // What this actually means, printed where the operator will see it.
  if (!revoke && roleName === "MARKET_CREATOR_ROLE") {
    console.log(
      `\n${to} can now create markets, and nothing else. It cannot resolve, pause, or grant\n` +
        `roles. Market creation now requires a signature from a key held by a person.`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
