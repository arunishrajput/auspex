"use server";

import { revalidatePath } from "next/cache";
import { runCapProbe, type ProbeResult } from "@/lib/judge/probe";

/**
 * Judge mode's one action.
 *
 * ## Why this is not gated on a wallet signature
 *
 * Every other mutating action in this app re-checks authority on the server — `/review` and
 * `/resolve` both do, because a page saying who is connected is a claim and not a fact. This one
 * does not, and the reason is the same reason `settleNow()` does not: **the transaction it produces
 * is one the contract is going to refuse.** A gate protecting a call that cannot succeed would be
 * theatre, and it would also defeat the point — the whole feature is that a stranger with no wallet
 * can produce it.
 *
 * What bounds it instead is not trust, it is arithmetic:
 *
 *   - `runCapProbe` makes an `eth_call` first and **refuses to broadcast unless the contract says
 *     it will revert with `AgentPerTxCapExceeded`**. A probe that could succeed does not run.
 *   - a reverted `placeBet` returns its value, so the maximum cost of a click is gas.
 *   - the cooldown below caps the rate, and the probe itself refuses to run from a wallet that
 *     cannot cover gas, so the floor cannot be dug through.
 *
 * ## The cooldown is in module scope, and that is the honest bound
 *
 * Same reasoning as `runTickAction`: a serverless deployment runs several instances, so the real
 * limit is "a few probes per cooldown" rather than exactly one. That is acceptable here because the
 * worst case is bounded in tMSTC — a few reverted transactions' worth of gas on a testnet whose
 * base fee is zero — and because a Postgres round trip to decide whether to make a Postgres round
 * trip is worse than the problem. What would *not* be acceptable is a limiter whose failure mode
 * was a successful bet, which is why the eth_call guard and not the cooldown is the real safety.
 */

const COOLDOWN_MS = 45_000;

let lastProbeAt = 0;

export type JudgeProbeResponse = ProbeResult | { ok: false; reason: string };

export async function runCapProbeAction(): Promise<JudgeProbeResponse> {
  const now = Date.now();
  const since = now - lastProbeAt;

  if (since < COOLDOWN_MS) {
    return {
      ok: false,
      reason:
        `Cooling down — try again in ${Math.ceil((COOLDOWN_MS - since) / 1000)}s. Each probe spends ` +
        `gas from a real agent wallet, so the button is rate-limited rather than free.`,
    };
  }
  lastProbeAt = now;

  try {
    const result = await runCapProbe("web");
    // Revalidated whether or not the probe succeeded: a refusal to run is itself worth showing in
    // the counters, and a successful probe adds a row to the refused-transactions table below.
    revalidatePath("/trust");
    revalidatePath("/audit");
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[runCapProbeAction] probe failed:", message);
    return { ok: false, reason: `The probe could not be run: ${message}` };
  }
}
