import { NextRequest, NextResponse } from "next/server";
import { runChainSync } from "@/lib/pipeline/sync";
import { optionalEnv } from "@/lib/env";

/**
 * The notification path, on its own.
 *
 *   POST /api/sync   — index confirmed logs, then announce what is new. Requires a secret.
 *
 * `POST /api/tick` also ends in the notifier, but a tick costs ~19s of feed fetching and model
 * calls to get there. This does the same last two steps in well under a second, which is what
 * makes it safe to call often — and calling it often is the entire point, because the interval
 * between calls *is* the notification delay.
 *
 * Authenticated for the same reason the tick is: it spends RPC quota and database writes, and
 * an open endpoint that spends quota is a free denial-of-service against our own free tiers.
 * It is not authenticated because it is dangerous — it only reads the chain, and running it
 * twice sends nothing twice.
 *
 * `CRON_SECRET` first, `TICK_SECRET` second. The name is Vercel's: their cron scheduler sends
 * `Authorization: Bearer $CRON_SECRET` automatically, so a `vercel.json` cron would need no
 * further wiring. Falling back to `TICK_SECRET` means an existing deployment keeps working
 * without a new variable being set first.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const expected = optionalEnv("CRON_SECRET") ?? optionalEnv("TICK_SECRET");

  if (expected === undefined) {
    // Refuse rather than run unauthenticated. Defaulting to open is how a misconfiguration
    // becomes an incident.
    return NextResponse.json(
      { error: "Neither CRON_SECRET nor TICK_SECRET is configured on this deployment." },
      { status: 503 },
    );
  }

  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.nextUrl.searchParams.get("secret");

  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await runChainSync();
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Hard rule #6: log the reason, take no action, return a real error rather than a partial
    // report that would read as success.
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api/sync] sync failed:", message);
    return NextResponse.json({ error: "Sync failed", detail: message }, { status: 500 });
  }
}
