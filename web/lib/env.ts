import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Environment access for code that runs OUTSIDE the Next.js runtime — `drizzle.config.ts`,
 * the scripts in `web/scripts/`, and the DB tests.
 *
 * Next.js itself is already served by the loader in `next.config.mjs`, which merges the
 * repo-root `.env.local` (the same single secrets file `contracts/hardhat.config.ts` reads).
 * That loader cannot be shared with this module: it must run before Next boots, so it lives
 * in a `.mjs` config file that cannot import TypeScript. The duplication is ~10 lines and is
 * confined to these two places on purpose.
 *
 * On Vercel there is no `.env.local`; the real variables are already in `process.env` and
 * `loadRootEnv` is a no-op. Existing values always win — nothing here overwrites one.
 */

let loaded = false;

/**
 * Candidate locations for the repo-root `.env.local`, resolved from the **working directory**.
 *
 * Deliberately not `new URL("../.env.local", import.meta.url)`. Turbopack treats that pattern
 * as a static *asset reference* and tries to resolve the file at build time — so the build
 * failed in CI with `Module not found: Can't resolve '../.env.local'`, because the file is
 * git-ignored and does not exist there. It passed locally only because the file happened to
 * be on disk. A production build must not depend on a git-ignored file existing.
 *
 * `process.cwd()` is `web/` for every way this runs (`pnpm --filter web …`, vitest,
 * drizzle-kit, `next dev`, `next build`, and Vercel with its root directory set to `web`), and
 * the repo root for a command run from there. Both are covered, and neither is statically
 * analysable, which is the point.
 */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [resolve(cwd, "..", ".env.local"), resolve(cwd, ".env.local")];
}

export function loadRootEnv(): void {
  if (loaded) return;
  loaded = true;

  for (const path of candidatePaths()) {
    // `turbopackIgnore` stops Turbopack tracing the *whole project* into the serverless bundle.
    // Because the path is computed from `process.cwd()` rather than written as a literal,
    // static analysis cannot bound it, so it conservatively includes every source file and the
    // public folder in the deployed function — slower deploys, and eventually a size limit.
    // The comment changes nothing at runtime: this still reads the repo-root `.env.local` when
    // one exists, and is a no-op on Vercel where the real variables are already in `process.env`.
    if (!existsSync(/* turbopackIgnore: true */ path)) continue;

    for (const line of readFileSync(/* turbopackIgnore: true */ path, "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (match === null) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.trim().replace(/^["'](.*)["']$/, "$1");
    }
  }
}

/**
 * Reads a required variable, or throws a message that says exactly what to do about it.
 *
 * It never prints the value — a thrown error can end up in a build log, an HTTP response or
 * this repo's CI output, and `DATABASE_URL` and `DEPLOYER_PRIVATE_KEY` both go through here.
 */
export function requireEnv(key: string): string {
  loadRootEnv();
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable ${key}. ` +
        `Set it in the repo-root .env.local (git-ignored), and in Vercel for deployments. ` +
        `See docs/RUNBOOK.md.`,
    );
  }
  return value;
}

export function optionalEnv(key: string): string | undefined {
  loadRootEnv();
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}
