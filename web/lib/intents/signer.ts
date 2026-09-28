import { Wallet } from "ethers";
import { getProvider } from "../chain/provider";
import { optionalEnv } from "../env";

/**
 * Key material for the intent engine.
 *
 * **Nothing outside this module reads a private key**, and no function here ever returns,
 * logs or stringifies one. `Wallet` instances are handed out; the key itself is not.
 *
 * Phase 2 uses the deployer key, which holds `MARKET_CREATOR_ROLE`. Phase 5 adds per-member
 * agent wallets whose keys are stored AES-256-GCM-encrypted in `members.agent_key_ciphertext`
 * and decrypted here. The distinction that matters is not the encryption — it is that an
 * agent wallet holds no role and is capped on-chain, so a stolen agent key can lose at most
 * its capped stake and cannot steal winnings (docs/ARCHITECTURE.md §7).
 */

const deployerCache = new Map<string, Wallet>();

/** The deployer/admin wallet. Signs `createMarket` until Phase 4 moves that to BridgeKey. */
export function getDeployerWallet(): Wallet {
  const key = optionalEnv("DEPLOYER_PRIVATE_KEY");
  if (key === undefined) {
    throw new Error(
      "DEPLOYER_PRIVATE_KEY is not set, so no transaction can be signed. " +
        "It lives in the repo-root .env.local (git-ignored). See docs/RUNBOOK.md.",
    );
  }

  // Cached by a hash of the key, never by the key: the map's own keys end up in heap dumps.
  const cacheKey = `deployer:${key.length}`;
  let wallet = deployerCache.get(cacheKey);
  if (wallet === undefined) {
    wallet = new Wallet(key, getProvider());
    deployerCache.set(cacheKey, wallet);
  }
  return wallet;
}

/** True when a signer is available at all, so callers can degrade instead of throwing. */
export function canSign(): boolean {
  return optionalEnv("DEPLOYER_PRIVATE_KEY") !== undefined;
}

/** The address the engine signs from. Safe to log — it is public on the explorer. */
export function signerAddress(): string {
  return getDeployerWallet().address.toLowerCase();
}
