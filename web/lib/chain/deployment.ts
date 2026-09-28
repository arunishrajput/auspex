import deployment from "../../../contracts/deployments/mstTestnet.json";

/**
 * The deployed contract, read from the deploy script's own output record.
 *
 * **There is one ABI in this repository and this is where it comes from.** The record in
 * `contracts/deployments/mstTestnet.json` is written by the deploy script at the moment of
 * deployment and committed, so the ABI, address and block here cannot drift from what is
 * actually on chain — they are the same bytes that produced it. Phase 1's hand-written ABI
 * fragments in `lib/contract.ts` are deleted; re-introducing a second copy is how a UI ends
 * up decoding a contract it is not talking to.
 */

const record = deployment.contracts.AuspexMarket;

export const AUSPEX_MARKET_ABI = record.abi;

/**
 * Address of the deployed contract.
 *
 * The committed record is authoritative. `NEXT_PUBLIC_AUSPEX_MARKET_ADDRESS` can override it
 * so a preview deployment can point at a different instance, but a *mismatch* is a
 * configuration error worth surfacing rather than silently resolving — see `addressMismatch`.
 */
export const AUSPEX_MARKET_ADDRESS: string =
  process.env.NEXT_PUBLIC_AUSPEX_MARKET_ADDRESS?.trim() || record.address;

export const DEPLOYED_ADDRESS: string = record.address;
export const DEPLOY_TX_HASH: string = record.deployTxHash;

/**
 * The block the contract was created in.
 *
 * The indexer starts here, never at 0: there is provably nothing to find below it, and
 * scanning ~5.79M empty blocks on every cold start would make the indexer unusable.
 */
export const DEPLOY_BLOCK: number = record.blockNumber;

export const DEPLOY_CHAIN_ID: number = deployment.chainId;

/** Non-null when an env override disagrees with the committed deployment record. */
export function addressMismatch(): string | null {
  if (AUSPEX_MARKET_ADDRESS.toLowerCase() === DEPLOYED_ADDRESS.toLowerCase()) return null;
  return (
    `NEXT_PUBLIC_AUSPEX_MARKET_ADDRESS (${AUSPEX_MARKET_ADDRESS}) does not match the ` +
    `committed deployment record (${DEPLOYED_ADDRESS}).`
  );
}

/** Addresses are compared as strings in a dozen places. Lowercase them once, here. */
export function normalizeAddress(value: string): string {
  return value.toLowerCase();
}
