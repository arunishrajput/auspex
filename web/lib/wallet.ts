/**
 * Wallet configuration for the human gate.
 *
 * `injected()` and nothing else. BridgeKey is an EIP-1193 / EIP-6963 provider, which is a
 * standard, so the connector that speaks the standard is the connector that works — no vendor
 * SDK, no WalletConnect project id, no third-party relay in the path between a human and the
 * transaction they are signing. It also means this page works with any injected wallet a visitor
 * happens to have installed, which is worth more on demo day than supporting a specific one.
 *
 * The chain is defined here from the same constants `lib/chain.ts` exports, so there is exactly
 * one place that says what chain 91562037 is. A wallet pointed at a look-alike network is the
 * failure mode this guards: the RPC url and the explorer come from the verified block in
 * CLAUDE.md, not from a wallet's own idea of what "MST Testnet" means.
 */

import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";
import { MST_TESTNET } from "./chain";

export const mstTestnet = defineChain({
  id: MST_TESTNET.id,
  name: MST_TESTNET.name,
  nativeCurrency: { ...MST_TESTNET.nativeCurrency },
  rpcUrls: { default: { http: [MST_TESTNET.rpcUrl] } },
  blockExplorers: {
    default: { name: "MSTScan", url: MST_TESTNET.explorerUrl },
  },
  testnet: true,
});

/**
 * One config, created once at module scope.
 *
 * The transport is the public RPC directly rather than our `/api/rpc` proxy: the MST RPC does
 * send `Access-Control-Allow-Origin: *` (verified 2026-09-28), and a relative proxy path cannot
 * be resolved during the server render that `ssr: true` performs. The proxy remains useful for
 * server-side reads; it has no job here.
 */
export const wagmiConfig = createConfig({
  chains: [mstTestnet],
  connectors: [injected()],
  transports: { [mstTestnet.id]: http(MST_TESTNET.rpcUrl) },
  ssr: true,
});
