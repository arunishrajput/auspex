/**
 * Fault injection for the crash test. **Inert unless explicitly switched on.**
 *
 * Phase 2's exit criteria include: *kill the worker mid-send, re-run — exactly one transaction
 * on chain, no duplicate rows.* That claim is only worth making if it has been demonstrated,
 * and it cannot be demonstrated by a `try/catch` — a thrown error unwinds cleanly through the
 * engine's own error handling, which is precisely the path being tested around.
 *
 * So this calls `process.exit(1)`: an abrupt, unrecoverable death with in-flight work
 * abandoned and nothing flushed. That is the failure the design claims to survive.
 *
 * The switch is `AUSPEX_CRASH_AT`, read fresh on every call and never set outside
 * `scripts/crash-test.ts`. In production the environment variable is absent and this is a
 * string comparison against `undefined`.
 */

export type CrashPoint = "after_sign" | "after_broadcast";

const VALID: readonly CrashPoint[] = ["after_sign", "after_broadcast"];

/**
 * Exits the process hard if the configured crash point matches.
 *
 * Read at call time rather than at module load so a single process can arm the hook, run a
 * step, and disarm it — which is what makes the crash test a script rather than a ritual.
 */
export function crashPointReached(point: CrashPoint): void {
  const armed = process.env.AUSPEX_CRASH_AT;
  if (armed === undefined || armed !== point) return;

  if (!VALID.includes(armed as CrashPoint)) return;

  // stderr, synchronously, before dying: this line is the crash test's evidence that the
  // kill happened where it was aimed rather than somewhere incidental.
  process.stderr.write(`\n[crash-hook] AUSPEX_CRASH_AT=${point} — killing process now.\n`);
  process.exit(1);
}
