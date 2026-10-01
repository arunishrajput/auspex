"use client";

/**
 * Connect, and prove you are the resolver — or be told plainly that you are not.
 *
 * The check here is a courtesy, not a control. It exists so a resolver finds out they are on the
 * wrong wallet or the wrong chain *before* a wallet prompt appears, rather than from a revert. The
 * real control is the contract: `RESOLVER_ROLE` refuses anyone else, and it would refuse them even
 * if this component said "approved" in green.
 *
 * ## Why this is a separate component from `/review`'s `WalletGate`
 *
 * Not for want of a shared abstraction. The two pages guard different roles, and
 * `HUMAN_RESOLVER_ADDRESS` exists precisely so they can become different wallets — the market
 * creator and the resolver being the same person is a property of *this* deployment, stated as a
 * limitation in `docs/TRUST_MODEL.md`, not a design commitment. A component shared between them
 * would quietly encode the assumption that they are one address.
 */

import { createContext, useContext, useState, type ReactNode } from "react";
import {
  WagmiProvider,
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mstTestnet, wagmiConfig } from "@/lib/wallet";
import { shortHash } from "@/lib/chain";

type Resolver = { address: string | null; isResolver: boolean; onRightChain: boolean };

const ResolverContext = createContext<Resolver>({
  address: null,
  isResolver: false,
  onRightChain: false,
});

export function useResolver(): Resolver {
  return useContext(ResolverContext);
}

export function ResolveProviders({ children }: { children: ReactNode }) {
  // One client per mount. A module-scope QueryClient would be shared across requests in a server
  // render, which leaks one user's cache into another's page.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

export function ResolverGate({
  resolverAddress,
  sharedWithCreator,
  children,
}: {
  resolverAddress: string | null;
  /** True when this deployment's resolver and market creator are the same wallet. */
  sharedWithCreator: boolean;
  children: ReactNode;
}) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  const connector = connectors[0];
  const onRightChain = chainId === mstTestnet.id;
  const isResolver =
    resolverAddress !== null &&
    typeof address === "string" &&
    address.toLowerCase() === resolverAddress.toLowerCase();

  const resolver: Resolver = {
    address: address ?? null,
    isResolver: isResolver && onRightChain,
    onRightChain,
  };

  return (
    <ResolverContext.Provider value={resolver}>
      <div className="mb-8 overflow-hidden lit-edge rounded-2xl border border-ink-700 bg-ink-900">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-800 px-4 py-2.5">
          <span
            className={`size-2 shrink-0 rounded-full ${
              resolver.isResolver
                ? "live-dot bg-ok-500"
                : isConnected
                  ? "bg-warn-500"
                  : "bg-ink-600"
            }`}
          />
          <span className="font-mono text-xs text-ink-300">human resolver</span>

          {!isConnected ? (
            <button
              type="button"
              onClick={() => connector !== undefined && connect({ connector })}
              disabled={isPending || connector === undefined}
              className="ml-auto rounded-lg border border-accent-500/40 bg-accent-500/10 px-3 py-1.5 font-mono text-xs text-accent-600 transition-colors hover:border-accent-500/70 hover:bg-accent-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {connector === undefined
                ? "no injected wallet found"
                : isPending
                  ? "connecting…"
                  : "Connect wallet"}
            </button>
          ) : (
            <>
              <span className="font-mono text-[11px] text-ink-200">
                {shortHash(address ?? "", 10, 8)}
              </span>
              <button
                type="button"
                onClick={() => disconnect()}
                className="ml-auto rounded border border-ink-700 px-2 py-1 font-mono text-[11px] text-ink-400 transition-colors hover:border-ink-600 hover:text-ink-200"
              >
                disconnect
              </button>
            </>
          )}
        </div>

        <div className="px-4 py-3">
          {resolverAddress === null ? (
            <p className="font-mono text-xs text-bad-500">
              No resolver address is configured on this deployment, so nothing can be resolved here.
            </p>
          ) : !isConnected ? (
            <p className="text-xs leading-relaxed text-ink-400">
              Resolving a market means signing{" "}
              <span className="font-mono text-ink-300">proposeResolution</span> from{" "}
              <span className="font-mono text-ink-300">{shortHash(resolverAddress, 10, 8)}</span> —
              which holds <span className="font-mono">RESOLVER_ROLE</span>. That key is in a
              browser wallet and{" "}
              <span className="text-ink-300">not on any server AuspeX runs in production</span>.
              An AI drafts the outcome; it cannot send it.
            </p>
          ) : !onRightChain ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-mono text-xs text-warn-500">
                wrong network — chain {chainId}, expected {mstTestnet.id}
              </p>
              <button
                type="button"
                onClick={() => switchChain({ chainId: mstTestnet.id })}
                disabled={isSwitching}
                className="rounded border border-warn-500/40 bg-warn-500/10 px-2 py-1 font-mono text-[11px] text-warn-500 hover:bg-warn-500/20 disabled:opacity-50"
              >
                {isSwitching ? "switching…" : `switch to ${mstTestnet.name}`}
              </button>
            </div>
          ) : isResolver ? (
            <p className="text-xs leading-relaxed text-ok-500">
              Connected as the resolver wallet on {mstTestnet.name}. Outcomes signed below become
              proposals on chain, then wait out the challenge window before any payout.
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-warn-500">
              This wallet does not hold <span className="font-mono">RESOLVER_ROLE</span>. The
              contract would refuse a resolution from it. Switch to{" "}
              <span className="font-mono">{shortHash(resolverAddress, 10, 8)}</span>.
            </p>
          )}

          {sharedWithCreator && resolverAddress !== null && (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
              On this deployment the resolver and the market creator are the{" "}
              <span className="text-ink-300">same wallet</span>. Separating them is a configuration
              change — set <span className="font-mono">HUMAN_RESOLVER_ADDRESS</span> and grant the
              roles separately — and it is stated as a limitation rather than implied away.
            </p>
          )}

          {error !== null && (
            <p className="mt-2 font-mono text-[11px] break-words text-bad-500">{error.message}</p>
          )}
        </div>
      </div>

      {children}
    </ResolverContext.Provider>
  );
}
