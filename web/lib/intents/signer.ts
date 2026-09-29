import { Wallet } from "ethers";
import { getProvider } from "../chain/provider";
import { optionalEnv } from "../env";
import { decryptAgentKey } from "../agents/crypto";
import { memberByAgentAddress } from "../agents/members";

/**
 * Key material for the intent engine.
 *
 * **Nothing outside this module reads a private key**, and no function here ever returns, logs
 * or stringifies one. `Wallet` instances are handed out; the key itself is not.
 *
 * ## Two kinds of key, and the deployment where one of them is absent
 *
 * `SERVER`-signed intents now come from two different wallets:
 *
 *   **the deployer**, which holds `DEFAULT_ADMIN_ROLE` and is the only address that can
 *   `registerAgent`. Its key is in the repo-root `.env.local` and **is deliberately not in
 *   Vercel** — see `docs/RUNBOOK.md`. Registration is run by hand, locally, once.
 *
 *   **a member's agent wallet**, whose key lives AES-256-GCM-encrypted in
 *   `members.agent_key_ciphertext` and is decrypted here. This is the only key the deployed
 *   application can sign with, and that is the point: production holds keys that are capped by
 *   the contract and hold no role, and holds no key that can create a market, resolve one,
 *   grant a role or pause anything.
 *
 * So `resolveSigner` must be able to say **"not here"** without that being an error. A Vercel
 * tick that claims a `REGISTER_AGENT` intent cannot sign it and must not burn an attempt trying
 * — see how `processIntent` handles `{ ok: false }`.
 *
 * The distinction that matters is not the encryption. It is that an agent wallet holds no role
 * and is capped on-chain, so a stolen agent key can lose at most its capped stake and cannot
 * steal winnings (`docs/ARCHITECTURE.md` §7).
 */

const deployerCache = new Map<string, Wallet>();

/** The deployer/admin wallet. The only signer that can `registerAgent`. */
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

/** True when a deployer signer is available at all, so callers can degrade instead of throwing. */
export function canSign(): boolean {
  return optionalEnv("DEPLOYER_PRIVATE_KEY") !== undefined;
}

/** The deployer address, or null where no deployer key exists. Safe to log — it is public. */
export function deployerAddress(): string | null {
  return canSign() ? getDeployerWallet().address.toLowerCase() : null;
}

/** The address the engine signs from by default. Safe to log — it is public on the explorer. */
export function signerAddress(): string {
  return getDeployerWallet().address.toLowerCase();
}

export type ResolvedSigner =
  | { ok: true; wallet: Wallet; kind: "DEPLOYER" | "AGENT" }
  /** No key for this address *in this process*. A condition to wait out, not a failure. */
  | { ok: false; reason: string };

/**
 * Finds the wallet that can sign for an address, or explains why this process cannot.
 *
 * Never throws: every caller is on a path where the honest answer to "can you sign this?" may be
 * no, and an exception would be recorded as an error against an intent that is merely waiting
 * for the right process to pick it up.
 *
 * A decryption failure is reported as `{ ok: false }` rather than rethrown, deliberately. If the
 * encryption secret has rotated or a row was tampered with, the correct behaviour is to leave
 * the intent alone and say so — never to proceed with a key we could not authenticate, and never
 * to abandon a bet that a corrected secret would make signable again.
 */
export async function resolveSigner(fromAddress: string): Promise<ResolvedSigner> {
  const from = fromAddress.toLowerCase();

  const deployer = deployerAddress();
  if (deployer !== null && deployer === from) {
    return { ok: true, wallet: getDeployerWallet(), kind: "DEPLOYER" };
  }

  const member = await memberByAgentAddress(from).catch(() => null);
  if (member !== null) {
    try {
      return {
        ok: true,
        wallet: new Wallet(decryptAgentKey(member.agentKeyCiphertext, from), getProvider()),
        kind: "AGENT",
      };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    ok: false,
    reason:
      deployer === null
        ? `No key for ${from} in this process. It is not a registered agent wallet, and ` +
          `DEPLOYER_PRIVATE_KEY is not set here — admin transactions are signed locally, ` +
          `not in production.`
        : `No key for ${from} in this process. It is neither the deployer (${deployer}) nor a ` +
          `member's agent wallet.`,
  };
}
