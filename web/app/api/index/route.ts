import { NextRequest, NextResponse } from "next/server";
import { runIndexer } from "@/lib/indexer/run";
import { getIndexerStatus } from "@/lib/markets";
import { optionalEnv } from "@/lib/env";

/**
 * The indexer, over HTTP.
 *
 *   GET  /api/index   — read-only status. Safe to hit from anywhere.
 *   POST /api/index   — run one indexing pass. Requires `TICK_SECRET`.
 *
 * The write path is authenticated because it costs RPC calls and database writes, and an
 * unauthenticated endpoint that does both is a free denial-of-service against our own free
 * tiers. It is *not* authenticated because running it is dangerous — the indexer only reads
 * the chain, and running it twice is a no-op by construction.
 *
 * Phase 3 folds this into `POST /api/tick` as the first stage of the pipeline.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const status = await getIndexerStatus();
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const expected = optionalEnv("TICK_SECRET");

  if (expected === undefined) {
    // Refuse rather than run unauthenticated. A missing secret is a misconfiguration, and
    // defaulting to "open" is how a misconfiguration becomes an incident.
    return NextResponse.json(
      { error: "TICK_SECRET is not configured on this deployment." },
      { status: 503 },
    );
  }

  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.nextUrl.searchParams.get("secret");

  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const fullReplay = request.nextUrl.searchParams.get("replay") === "true";

  try {
    const report = await runIndexer({ fullReplay });
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Hard rule #6: log the reason, take no action, return a real error. Never a partial
    // report that would read as success.
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api/index] indexing failed:", message);
    return NextResponse.json({ error: "Indexing failed", detail: message }, { status: 500 });
  }
}
