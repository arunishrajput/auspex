"use client";

/**
 * Run the keeper's pass now, instead of waiting for the next cron tick.
 *
 * **No wallet, and no authority check.** Everything this queues — `closeMarket`,
 * `finalizeResolution`, `claim` — is permissionless in the contract, so gating the button would be
 * theatre. Anyone can make these calls from any address; the server signs them with an agent
 * wallet that holds no role, because that is the only kind of key the deployed application has.
 *
 * It exists because the challenge window is 120 seconds and the cron tick is three minutes. A demo
 * should not have to wait out the difference.
 */

import { useState, useTransition } from "react";
import { settleNow } from "./actions";

export function SettleButton() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() =>
          startTransition(async () => {
            setResult(null);
            const outcome = await settleNow();
            setResult(
              outcome.ok
                ? { ok: true, text: outcome.summary }
                : { ok: false, text: outcome.error },
            );
          })
        }
        disabled={isPending}
        className="self-start rounded border border-signal-500/40 bg-signal-500/10 px-3 py-1.5 font-mono text-xs text-signal-500 transition-colors hover:border-signal-500/70 hover:bg-signal-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "⋯ closing, finalising, claiming…" : "Run the keeper now"}
      </button>

      {result !== null && (
        <p
          role="status"
          className={`font-mono text-[11px] break-words ${
            result.ok ? "text-ink-300" : "text-bad-500"
          }`}
        >
          {result.text}
        </p>
      )}
    </div>
  );
}
