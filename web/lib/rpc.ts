import { MST_TESTNET } from "./chain";

/**
 * Minimal server-side JSON-RPC client.
 *
 * Deliberately dependency-free: the Phase 0 status page must be able to prove the chain
 * is reachable without pulling in ethers or wagmi. Phase 2 introduces the real typed
 * ethers client for contract work; this stays for health checks.
 *
 * Every function here either returns real chain data or throws. It never falls back to
 * a plausible-looking default — a fabricated block height on a status page would be
 * exactly the kind of misleading data hard rule #1 forbids.
 */

export class RpcError extends Error {
  constructor(
    message: string,
    readonly method: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

let requestId = 0;

export async function rpcCall<T>(
  method: string,
  params: unknown[] = [],
  timeoutMs = 10_000,
): Promise<T> {
  requestId += 1;

  let response: Response;
  try {
    response = await fetch(MST_TESTNET.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    throw new RpcError(`network error: ${String(error)}`, method);
  }

  if (!response.ok) {
    throw new RpcError(`HTTP ${response.status}`, method);
  }

  const body = (await response.json()) as {
    result?: T;
    error?: { code: number; message: string };
  };

  if (body.error) {
    throw new RpcError(`${body.error.code}: ${body.error.message}`, method);
  }
  if (body.result === undefined) {
    throw new RpcError("empty result", method);
  }
  return body.result;
}

export type ChainHealth = {
  reachable: true;
  chainId: number;
  chainIdMatches: boolean;
  blockNumber: number;
  blockTimestamp: number;
  gasPriceWei: bigint;
  latencyMs: number;
};

export type ChainHealthError = {
  reachable: false;
  error: string;
};

/**
 * Reads real chain state. Also asserts the chain ID matches what we expect, so a
 * misconfigured RPC surfaces immediately instead of producing confusing data later.
 */
export async function getChainHealth(): Promise<ChainHealth | ChainHealthError> {
  const startedAt = Date.now();
  try {
    const [chainIdHex, blockNumberHex, gasPriceHex] = await Promise.all([
      rpcCall<string>("eth_chainId"),
      rpcCall<string>("eth_blockNumber"),
      rpcCall<string>("eth_gasPrice"),
    ]);

    const blockNumber = Number.parseInt(blockNumberHex, 16);
    const block = await rpcCall<{ timestamp: string }>("eth_getBlockByNumber", [
      blockNumberHex,
      false,
    ]);

    const chainId = Number.parseInt(chainIdHex, 16);

    return {
      reachable: true,
      chainId,
      chainIdMatches: chainId === MST_TESTNET.id,
      blockNumber,
      blockTimestamp: Number.parseInt(block.timestamp, 16),
      gasPriceWei: BigInt(gasPriceHex),
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
