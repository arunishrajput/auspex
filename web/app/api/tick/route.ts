import { NextRequest, NextResponse } from "next/server";
import { runTick, type TickSource } from "@/lib/pipeline/tick";
import { optionalEnv } from "@/lib/env";

/**
 * The pipeline driver.
 *
 *   POST /api/tick   — advance the state machine one bounded step. Requires `TICK_SECRET`.
 *
 * Two callers: the GitHub Actions heartbeat and the dashboard's "Run tick" button. The
 * button is what a visitor actually presses, because GitHub's cron is best-effort — measured
 * over 46 hours it delivered 1.6% of the runs its expression asked for, a mean gap of about
 * five hours — and it pauses altogether on inactive public repositories. The delivered cadence
 * is computed from `audit_log` and shown on `/audit`; no comment here states one, because a
 * cadence written into a comment is a number that goes wrong without anyone noticing.
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

/**
 * The tick's time budget, tied to `maxDuration` above so the two cannot drift.
 *
 * `runTick` derives every stage deadline from this. A budget larger than the function's limit would
 * let a stage start work the platform then kills mid-flight — losing the report and the tick's own
 * audit row, which is the one failure the deadline ladder exists to prevent.
 */
const TICK_BUDGET_MS = maxDuration * 1000;

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

/**
 * Who asked, from the body the caller sent.
 *
 * The GitHub workflows have posted `{"source":"github-actions"}` since Phase 3 and nothing read it
 * until Phase 11, when `/audit` started reporting the pipeline's real cadence and an unattended
 * tick stopped being interchangeable with a button press.
 *
 * **Mapped through an allowlist, never stored as sent.** This is an authenticated endpoint, but a
 * string from a request body that reaches a page is a string a reader will believe, and a caller
 * that could write its own label could make the cron look busier than it is. Anything unrecognised
 * — including a malformed body, which is why this never throws — is `api`: an authenticated caller
 * we decline to classify.
 */
async function triggerSource(request: NextRequest): Promise<TickSource> {
  try {
    const body: unknown = await request.json();
    const claimed = (body as { source?: unknown } | null)?.source;
    if (claimed === "github-actions" || claimed === "cron") return "cron";
    if (claimed === "dashboard" || claimed === "button") return "button";
  } catch {
    // No body, or not JSON. The button posts nothing.
  }
  return "api";
}

export async function POST(request: NextRequest) {
  const rejection = authorize(request);
  if (rejection !== null) return rejection;

  const skipIndex = request.nextUrl.searchParams.get("skipIndex") === "true";
  const source = await triggerSource(request);

  try {
    const report = await runTick({ skipIndex, source, maxDurationMs: TICK_BUDGET_MS });
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
