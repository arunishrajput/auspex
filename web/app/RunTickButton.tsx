"use client";

import { useState, useTransition } from "react";
import { runTickAction, type RunTickResult } from "./actions";

/**
 * Runs one pipeline tick and shows what moved.
 *
 * `useTransition` rather than a manual loading flag: the action calls `revalidatePath("/")`, so
 * the pending state has to cover both the tick *and* the re-render that follows it. A plain
 * `useState` spinner would clear the moment the promise resolved, leaving several seconds where
 * the button looked idle while the page was still showing the old numbers.
 */
export function RunTickButton() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<RunTickResult | null>(null);

  function onClick() {
    setResult(null);
    startTransition(async () => {
      setResult(await runTickAction());
    });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-accent-500/40 bg-accent-500/10 px-3 py-1.5 font-mono text-xs text-accent-600 transition-colors hover:border-accent-500/70 hover:bg-accent-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? (
          <>
            <span className="size-2 animate-pulse rounded-full bg-accent-500" />
            running tick…
          </>
        ) : (
          <>▶ Run tick</>
        )}
      </button>

      {result !== null && (
        <p
          className={`font-mono text-[11px] ${result.ok ? "text-ink-300" : "text-warn-500"}`}
          role="status"
        >
          {result.message}
        </p>
      )}

      {isPending && (
        <p className="font-mono text-[11px] text-ink-400" role="status">
          fetching feeds, clustering, adjudicating borderline pairs — up to ~45s
        </p>
      )}
    </div>
  );
}
