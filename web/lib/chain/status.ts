import { rpcCall } from "../rpc";
import { auspexInterface } from "./auspex";
import { AUSPEX_MARKET_ADDRESS, addressMismatch } from "./deployment";

/**
 * Live reads of the deployed contract for the status page.
 *
 * Phase 1 shipped this with two hand-written ABI fragments. Phase 2 deletes them: the
 * interface now comes from `deployment.ts`, which reads the committed deploy record, so there
 * is exactly one ABI in the repository and the status panel cannot decode a different
 * contract from the one `/markets` reads.
 *
 * Nothing here has a fallback value. If the contract cannot be read, the UI says so — a
 * plausible-looking market count on a page that could not reach the chain is precisely the
 * fabricated chain data hard rule #1 forbids.
 */

export type ContractStatus =
  | { deployed: false; address: string; error: string }
  | {
      deployed: true;
      address: string;
      bytecodeBytes: number;
      marketCount: number;
      challengeWindowSeconds: number;
      paused: boolean;
      /** Non-null when the env override disagrees with the committed deployment record. */
      configWarning: string | null;
    };

async function readUint(
  address: string,
  fn: "marketCount" | "challengeWindow",
): Promise<bigint> {
  const data = auspexInterface.encodeFunctionData(fn);
  const raw = await rpcCall<string>("eth_call", [{ to: address, data }, "latest"]);
  const [value] = auspexInterface.decodeFunctionResult(fn, raw);
  return value as bigint;
}

async function readPausedFlag(address: string): Promise<boolean> {
  const data = auspexInterface.encodeFunctionData("paused");
  const raw = await rpcCall<string>("eth_call", [{ to: address, data }, "latest"]);
  const [value] = auspexInterface.decodeFunctionResult("paused", raw);
  return value as boolean;
}

/**
 * Reads the deployed contract over the public RPC on every call.
 *
 * `eth_getCode` comes first on purpose: it is the difference between "an address we wrote in a
 * config file" and "a contract that exists on chain 91562037".
 */
export async function getContractStatus(): Promise<ContractStatus> {
  const address = AUSPEX_MARKET_ADDRESS;

  try {
    const code = await rpcCall<string>("eth_getCode", [address, "latest"]);
    if (code === "0x" || code === "0x0") {
      return { deployed: false, address, error: "no bytecode at this address" };
    }

    const [marketCount, challengeWindow, paused] = await Promise.all([
      readUint(address, "marketCount"),
      readUint(address, "challengeWindow"),
      readPausedFlag(address),
    ]);

    return {
      deployed: true,
      address,
      bytecodeBytes: (code.length - 2) / 2,
      marketCount: Number(marketCount),
      challengeWindowSeconds: Number(challengeWindow),
      paused,
      configWarning: addressMismatch(),
    };
  } catch (error) {
    return {
      deployed: false,
      address,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
