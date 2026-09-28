import { NextRequest, NextResponse } from "next/server";
import { runTick } from "@/lib/pipeline/tick";
import { optionalEnv } from "@/lib/env";

/**
 * The pipeline driver.
 *
 *   POST /api/tick   — advance the state machine one bounded step. Requires `TICK_SECRET`.
 *
 * Two callers: the GitHub Actions heartbeat (every five minutes) and the dashboard's
 * "Run tick" button. The button is what gets pressed in front of judges, because GitHub's
 * cron is best-effort and pauses on inactive public repositories.
 *
 * Authenticated because a tick spends real quota — RSS fetches, Gemini calls, database
 * writes — and an open endpoint that spends quota is a free denial-of-service against our own
 * free tiers. A missing secret returns 503 rather than running unauthenticated: defaulting to
 * open is how a misconfiguration becomes an incident.
 *
 * Always returns the report, including when stages failed. A tick with three of four stages
 * green is useful information, and a 500 with no body would throw it away.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorize(request: NextRequest): NextResponse | null {
  const expected = optionalEnv("TICK_SECRET");
  if (expected === undefined) {
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
  return null;
}

export async function POST(request: NextRequest) {
  const rejection = authorize(request);
  if (rejection !== null) return rejection;

  const skipIndex = request.nextUrl.searchParams.get("skipIndex") === "true";

  try {
    const report = await runTick({ skipIndex });
    // 207 when some stage failed: the body is a real report, but calling it 200 would let the
    // heartbeat's `--fail-with-body` treat a half-broken pipeline as healthy.
    const status = report.errors.length === 0 ? 200 : 207;
    return NextResponse.json(report, { status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // runTick catches per stage, so reaching here means the machinery itself failed.
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api/tick] tick failed:", message);
    return NextResponse.json({ error: "Tick failed", detail: message }, { status: 500 });
  }
}
