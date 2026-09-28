import { existsSync, readFileSync } from "node:fs";

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
 * `file://` URL to a filesystem path, without `node:url`.
 *
 * Node's own `fileURLToPath` rejects the `URL` this module constructs once Turbopack has
 * bundled it: the bundle's `URL` is a different realm's class, so the `instanceof` check
 * inside Node fails and the build dies with "Received an instance of URL". Reading
 * `.pathname` works from any realm. `decodeURIComponent` is not optional — this repository's
 * own checkout path contains spaces.
 *
 * POSIX only, which is every environment this runs in (macOS locally, Linux on Vercel), and
 * on Vercel the file does not exist so the caller returns before using the result.
 */
function fileUrlToPath(url: URL): string {
  return decodeURIComponent(url.pathname);
}

export function loadRootEnv(): void {
  if (loaded) return;
  loaded = true;

  // web/lib/env.ts -> web/ -> repo root
  for (const candidate of ["../.env.local", "../../.env.local"]) {
    const path = fileUrlToPath(new URL(candidate, import.meta.url));
    if (!existsSync(path)) continue;

    for (const line of readFileSync(path, "utf8").split("\n")) {
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
