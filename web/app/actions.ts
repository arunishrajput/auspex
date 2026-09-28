"use server";

import { revalidatePath } from "next/cache";
import { runTick } from "@/lib/pipeline/tick";

/**
 * The dashboard's "Run tick" button.
 *
 * ## Why this is a server action and not a `fetch` to `/api/tick`
 *
 * `POST /api/tick` is authenticated with `TICK_SECRET`, and that secret exists so the endpoint
 * cannot be used to burn our free tiers. A browser button cannot hold it — anything the page
 * can send, a visitor can read. Calling the route from the client would mean either shipping
 * the secret to the browser or removing the authentication, and both are worse than this.
 *
 * ## What bounds it instead
 *
 * A server action is still a public HTTP endpoint, so it gets its own bound: one tick every
 * `COOLDOWN_MS`, enforced in the module scope of the serving instance. Combined with the
 * tick's own design — bounded feeds, a bounded LLM budget, `ON CONFLICT DO NOTHING` at every
 * write — the worst a visitor holding the button down can do is re-read some RSS.
 *
 * The cooldown is deliberately **not** in Postgres. It is a courtesy limit on a demo button,
 * and a limiter that needs a database round trip to decide whether to do a database round trip
 * is worse than the problem. A serverless deployment runs several instances, so the real bound
 * is "a few ticks per cooldown", not exactly one — which is fine, because the tick is
 * idempotent. That is the property being relied on, and it is the same one Phase 2 proved on
 * chain.
 */

const COOLDOWN_MS = 20_000;

let lastRunAt = 0;

export type RunTickResult = {
  ok: boolean;
  message: string;
};

export async function runTickAction(): Promise<RunTickResult> {
  const now = Date.now();
  const since = now - lastRunAt;

  if (since < COOLDOWN_MS) {
    return {
      ok: false,
      message: `Cooling down — try again in ${Math.ceil((COOLDOWN_MS - since) / 1000)}s.`,
    };
  }
  lastRunAt = now;

  try {
    const report = await runTick();

    const parts: string[] = [];
    if (report.ingest !== null) {
      parts.push(
        `${report.ingest.itemsInserted} new of ${report.ingest.itemsFetched} fetched` +
          ` from ${report.ingest.feedsOk}/${report.ingest.feedsAttempted} feeds`,
      );
    }
    if (report.cluster !== null) {
      parts.push(
        `${report.cluster.eventsCreated} events created, ` +
          `${report.cluster.eventsConfirmed} confirmed`,
      );
      if (report.cluster.adjudicated > 0) {
        parts.push(`${report.cluster.adjudicated} borderline pairs adjudicated`);
      }
    }
    parts.push(`${report.llm.callsMade}/${report.llm.budget} LLM calls`);
    parts.push(`${(report.durationMs / 1000).toFixed(1)}s`);

    if (report.errors.length > 0) {
      parts.push(`${report.errors.length} stage error(s): ${report.errors.map((e) => e.stage).join(", ")}`);
    }

    revalidatePath("/");
    // `ok` reflects whether the tick ran, not whether every stage succeeded — a tick that
    // completed with one dead feed is a success, and saying otherwise would train the reader
    // to ignore the indicator.
    return { ok: true, message: parts.join(" · ") };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[runTickAction] tick failed:", message);
    return { ok: false, message: `Tick failed: ${message}` };
  }
}
