#!/usr/bin/env node
/**
 * Generate a fresh EOA for MST Testnet.
 *
 *   pnpm wallets:new              # deployer / generic wallet
 *   pnpm wallets:new --agent      # labels output as an agent wallet
 *
 * Writes NOTHING to disk. The private key is printed once, to stdout, and it is your
 * job to paste it into .env.local (git-ignored). This is deliberate: a script that
 * writes keys to a file is one `git add -A` away from committing a secret.
 *
 * Testnet keys only. Never reuse one of these on a network with real value.
 */
import { Wallet } from "ethers";

const isAgent = process.argv.includes("--agent");
const wallet = Wallet.createRandom();

const envVar = isAgent ? "AGENT_PRIVATE_KEY_<n>" : "DEPLOYER_PRIVATE_KEY";

console.log(`
┌─────────────────────────────────────────────────────────────────────────┐
│  NEW ${isAgent ? "AGENT " : "DEPLOYER"} WALLET — MST Testnet (chain 91562037)
└─────────────────────────────────────────────────────────────────────────┘

  Address      ${wallet.address}
  Private key  ${wallet.privateKey}

  1. Paste the key into .env.local:

       ${envVar}=${wallet.privateKey}

  2. Fund the ADDRESS (never paste the private key anywhere):

       https://faucet.masterstroke.academy

  3. Confirm the balance landed:

       pnpm preflight

  ⚠  This key was not saved. If you lose it, generate another.
  ⚠  .env.local is git-ignored. Never commit a key, never paste one into a chat.
  ⚠  Clear your terminal scrollback when you are done.
`);
