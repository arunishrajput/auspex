"use client";

import { useState, useTransition } from "react";
import { runCapProbeAction, type CapProbeResponse } from "./actions";

/**
 * The one button on this site a stranger is allowed to press.
 *
 * It shows the whole sequence afterwards — what the contract was asked, what `eth_call` predicted,
 * what the chain did, and the hash — because the point is not that something happened but that a
 * reader can follow it. A button that said "done ✓" would be worth nothing here.
 *
 * `useTransition` rather than a loading flag, for the same reason as `RunTickButton`: the action
 * calls `revalidatePath`, so the pending state has to cover the re-render as well as the request.
 * A probe takes ~10-20s — an `eth_call`, a signature, a broadcast and a receipt on 3-second blocks
 * — so the page says so up front rather than appearing to hang.
 */
export function CapProbeButton({ explorerBase }: { explorerBase: string }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<CapProbeResponse | null>(null);

  function onClick() {
    setResult(null);
    startTransition(async () => {
      setResult(await runCapProbeAction());
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={onClick}
          disabled={isPending}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded border border-bad-500/50 bg-bad-500/10 px-4 py-2 font-mono text-xs text-bad-500 transition-colors hover:border-bad-500 hover:bg-bad-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? (
            <>
              <span className="size-2 animate-pulse rounded-full bg-bad-500" />
              asking the chain…
            </>
          ) : (
            <>▶ Ask the contract to break its own cap</>
          )}
        </button>
        {isPending && (
          <p className="font-mono text-[11px] text-ink-400" role="status">
            eth_call → sign → broadcast → receipt. Up to ~20s on 3-second blocks.
          </p>
        )}
      </div>

      {result !== null && !result.ok && (
        <div className="rounded border border-warn-500/40 bg-warn-500/5 px-3 py-2.5" role="status">
          <p className="font-mono text-[11px] tracking-wide text-warn-500 uppercase">
            not run — and here is why
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-300">{result.reason}</p>
        </div>
      )}

      {result !== null && result.ok && (
        <div className="overflow-hidden rounded border border-ink-700 bg-ink-850" role="status">
          <dl className="divide-y divide-ink-800 font-mono text-[11px]">
            <ProbeRow label="market" value={`#${result.onchainId}`} />
            <ProbeRow
              label="agent"
              value={`${result.agentHandle} · ${result.agentAddress}`}
            />
            <ProbeRow label="on-chain cap" value={`${result.capWei} wei`} />
            <ProbeRow
              label="sent"
              value={`${result.attemptedWei} wei — exactly one wei more`}
              tone="warn"
            />
            <ProbeRow label="eth_call predicted" value={result.predictedRevert} tone="warn" />
            <ProbeRow
              label="chain said"
              value={result.revertReason ?? "no reason decoded"}
              tone="bad"
            />
            <ProbeRow
              label="intent"
              value={result.intentStatus}
              tone={result.intentStatus === "REVERTED" ? "ok" : "warn"}
            />
            <ProbeRow
              label="pools"
              value={
                result.poolsUnchanged
                  ? "unchanged — nothing was staked"
                  : "CHANGED — this should not happen, investigate"
              }
              tone={result.poolsUnchanged ? "ok" : "bad"}
            />
            {result.txHash !== null && (
              <div className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-3">
                <dt className="w-32 shrink-0 text-ink-400">your transaction</dt>
                <dd className="min-w-0">
                  <a
                    href={`${explorerBase}${result.explorerPath}`}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-signal-500 underline-offset-2 hover:underline"
                  >
                    {result.txHash} ↗
                  </a>
                  {result.blockNumber !== null && (
                    <span className="ml-2 text-ink-400">block {result.blockNumber}</span>
                  )}
                </dd>
              </div>
            )}
          </dl>
          <p className="border-t border-ink-800 px-3 py-2.5 text-xs leading-relaxed text-ink-300">
            You just made a server sign a transaction that exceeded an agent&apos;s limit, and the
            contract refused it. Open the hash: MSTScan will show it as{" "}
            <span className="font-mono text-bad-500">Reverted</span> with both numbers in the error.
            No off-chain code had to be trusted for that — the cap is enforced in{" "}
            <span className="font-mono text-ink-200">AuspexMarket.placeBet</span>, which a
            compromised server cannot reach past.
          </p>
        </div>
      )}
    </div>
  );
}

function ProbeRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad";
}) {
  const toneClass =
    tone === "ok"
      ? "text-ok-500"
      : tone === "warn"
        ? "text-warn-500"
        : tone === "bad"
          ? "text-bad-500"
          : "text-ink-200";
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-3">
      <dt className="w-32 shrink-0 text-ink-400">{label}</dt>
      <dd className={`min-w-0 break-all ${toneClass}`}>{value}</dd>
    </div>
  );
}
