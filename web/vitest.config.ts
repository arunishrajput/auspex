import { defineConfig } from "vitest/config";

/**
 * Vitest configuration.
 *
 * The generous timeouts are for `lib/db/schema.test.ts`, which talks to the real Neon
 * database in `aws-us-east-1` — roughly half a second per round trip from here, and up to
 * ~25 seconds for the first connection after the free tier has scaled the compute to zero.
 * Vitest's 5s default turned "the database is far away and was asleep" into a test failure.
 *
 * The pure tests (projection, revert decoding, spec hashing) run in single-digit
 * milliseconds and are unaffected — they are the ones that run in CI, where there is no
 * database credential.
 */
export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // The DB suite creates and drops a real database; running suites in parallel against one
    // Neon free-tier compute is a good way to exhaust its connection limit.
    fileParallelism: false,
  },
});
