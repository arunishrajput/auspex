import { Interface } from "ethers";
import { rpcCall } from "./rpc";

/**
 * Live reads of the deployed AuspexMarket contract.
 *
 * Phase 1 only needs to prove the deployment is real and answering: that there is bytecode
 * at the address, and that two `view` calls return the values the constructor was given.
 * Phase 2 replaces this with the full typed ethers client and the generated bindings.
 *
 * Nothing here has a fallback value. If the contract cannot be read, the UI says so — a
 * plausible-looking market count on a status page would be exactly the fabricated chain
 * data the buildathon rules prohibit.
 */

/** Only the fragments this module actually calls. The full ABI arrives with Phase 2. */
const AUSPEX_READ_ABI = [
  "function marketCount() view returns (uint256)",
  "function challengeWindow() view returns (uint64)",
] as const;

const iface = new Interface(AUSPEX_READ_ABI);

/** Set after Phase 1's deploy. Absent locally until `.env.local` is filled in. */
export const AUSPEX_MARKET_ADDRESS =
  process.env.NEXT_PUBLIC_AUSPEX_MARKET_ADDRESS?.trim() || null;

export type ContractStatus =
  | { deployed: false; address: null }
  | { deployed: false; address: string; error: string }
  | {
      deployed: true;
      address: string;
      bytecodeBytes: number;
      marketCount: number;
      challengeWindowSeconds: number;
    };

async function readUint(address: string, fn: "marketCount" | "challengeWindow"): Promise<bigint> {
  const data = iface.encodeFunctionData(fn);
  const raw = await rpcCall<string>("eth_call", [{ to: address, data }, "latest"]);
  const [value] = iface.decodeFunctionResult(fn, raw);
  return value as bigint;
}

/**
 * Reads the deployed contract over the public RPC on every call.
 *
 * `eth_getCode` comes first on purpose: it is the difference between "an address we wrote
 * in a config file" and "a contract that exists on chain 91562037".
 */
export async function getContractStatus(): Promise<ContractStatus> {
  const address = AUSPEX_MARKET_ADDRESS;
  if (address === null) return { deployed: false, address: null };

  try {
    const code = await rpcCall<string>("eth_getCode", [address, "latest"]);
    if (code === "0x" || code === "0x0") {
      return { deployed: false, address, error: "no bytecode at this address" };
    }

    const [marketCount, challengeWindow] = await Promise.all([
      readUint(address, "marketCount"),
      readUint(address, "challengeWindow"),
    ]);

    return {
      deployed: true,
      address,
      bytecodeBytes: (code.length - 2) / 2,
      marketCount: Number(marketCount),
      challengeWindowSeconds: Number(challengeWindow),
    };
  } catch (error) {
    return {
      deployed: false,
      address,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
