"use client";

/**
 * Connect, and prove you are the authority — or be told plainly that you are not.
 *
 * The check here is a courtesy, not a control. It exists so a reviewer finds out they are on
 * the wrong wallet or the wrong chain *before* a wallet prompt appears, rather than from a
 * revert. The real control is the contract: `MARKET_CREATOR_ROLE` refuses anyone else, and it
 * would refuse them even if this component said "approved" in green.
 *
 * The authority address is passed in from the server rather than read from a `NEXT_PUBLIC_`
 * variable. It is a public address either way, but this keeps one source of truth — the same
 * `HUMAN_AUTHORITY_ADDRESS` the server uses to encode the intent and `pnpm preflight` checks
 * on chain.
 */

import { createContext, useContext, useState, type ReactNode } from "react";
import { WagmiProvider, useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mstTestnet, wagmiConfig } from "@/lib/wallet";
import { shortHash } from "@/lib/chain";

type Reviewer = { address: string | null; isAuthority: boolean; onRightChain: boolean };

const ReviewerContext = createContext<Reviewer>({
  address: null,
  isAuthority: false,
  onRightChain: false,
});

/** What the approve/reject controls need to know about who is holding the keyboard. */
export function useReviewer(): Reviewer {
  return useContext(ReviewerContext);
}

export function ReviewProviders({ children }: { children: ReactNode }) {
  // One client per mount. A module-scope QueryClient would be shared across requests in a
  // server render, which leaks one user's cache into another's page.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

export function WalletGate({
  authorityAddress,
  children,
}: {
  authorityAddress: string | null;
  children: ReactNode;
}) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  const connector = connectors[0];
  const onRightChain = chainId === mstTestnet.id;
  const isAuthority =
    authorityAddress !== null &&
    typeof address === "string" &&
    address.toLowerCase() === authorityAddress.toLowerCase();

  const reviewer: Reviewer = {
    address: address ?? null,
    isAuthority: isAuthority && onRightChain,
    onRightChain,
  };

  return (
    <ReviewerContext.Provider value={reviewer}>
      <div className="mb-8 overflow-hidden lit-edge rounded-2xl border border-ink-700 bg-ink-900">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-800 px-4 py-2.5">
          <span
            className={`size-2 shrink-0 rounded-full ${
              reviewer.isAuthority ? "live-dot bg-ok-500" : isConnected ? "bg-warn-500" : "bg-ink-600"
            }`}
          />
          <span className="font-mono text-xs text-ink-300">human authority</span>

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
          {authorityAddress === null ? (
            <p className="font-mono text-xs text-bad-500">
              HUMAN_AUTHORITY_ADDRESS is not configured on this deployment, so nothing can be
              approved here.
            </p>
          ) : !isConnected ? (
            <p className="text-xs leading-relaxed text-ink-400">
              Approving a market means signing{" "}
              <span className="font-mono text-ink-300">createMarket</span> from{" "}
              <span className="font-mono text-ink-300">{shortHash(authorityAddress, 10, 8)}</span>
              {" "}— the only address holding{" "}
              <span className="font-mono">MARKET_CREATOR_ROLE</span> besides the deployer. That key
              is in a browser wallet and{" "}
              <span className="text-ink-300">not on any server AuspeX runs</span>, which is why
              this page needs a wallet at all.
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
          ) : isAuthority ? (
            <p className="text-xs leading-relaxed text-ok-500">
              Connected as the authority wallet on {mstTestnet.name}. Approvals below will be
              signed by this key.
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-warn-500">
              This wallet does not hold <span className="font-mono">MARKET_CREATOR_ROLE</span>.
              The contract would refuse a market created from it. Switch to{" "}
              <span className="font-mono">{shortHash(authorityAddress, 10, 8)}</span> to review.
            </p>
          )}

          {error !== null && (
            <p className="mt-2 font-mono text-[11px] break-words text-bad-500">{error.message}</p>
          )}
        </div>
      </div>

      {children}
    </ReviewerContext.Provider>
  );
}
