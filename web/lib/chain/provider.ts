import { JsonRpcProvider, Network } from "ethers";
import { MST_TESTNET } from "../chain";

/**
 * The server-side ethers provider.
 *
 * Three choices worth defending:
 *
 * **`staticNetwork`.** Without it ethers re-issues `eth_chainId` before essentially every
 * call to detect a network change. On a serverless function that is a doubled round trip on
 * every read. The chain id is a compile-time constant here, so we assert it once.
 *
 * **`batchMaxCount: 1`.** Geth-family nodes vary in how they handle JSON-RPC batches, and a
 * partially-applied batch is far harder to reason about than a slow loop. The indexer's cost
 * is dominated by `eth_getLogs`, not by request count.
 *
 * **It talks to the RPC directly, not through `/api/rpc/testnet`.** That proxy exists for the
 * *browser*; server code calling its own HTTP endpoint would add a hop, and on Vercel a
 * function calling back into itself is a good way to deadlock a concurrency limit.
 */

declare global {
  var __auspexProvider: JsonRpcProvider | undefined;
}

const NETWORK = new Network(MST_TESTNET.name, MST_TESTNET.id);

export function getProvider(): JsonRpcProvider {
  globalThis.__auspexProvider ??= new JsonRpcProvider(MST_TESTNET.rpcUrl, NETWORK, {
    staticNetwork: NETWORK,
    batchMaxCount: 1,
    polling: false,
  });
  return globalThis.__auspexProvider;
}

/**
 * Asserts we are talking to chain 91562037 and not, say, a fork or the wrong testnet.
 *
 * Worth its round trip: every "this address has no bytecode" mystery starts as a chain-id
 * mismatch, and a UI that silently reads the wrong chain is exactly the fabricated-data
 * failure the buildathon rules prohibit.
 */
export async function assertCorrectChain(): Promise<void> {
  const { chainId } = await getProvider().getNetwork();
  if (Number(chainId) !== MST_TESTNET.id) {
    throw new Error(
      `Connected to chain ${chainId}, expected ${MST_TESTNET.id} (${MST_TESTNET.name}).`,
    );
  }
}
