import { readFileSync, existsSync } from "node:fs";

/**
 * Local-only: merge the repo-root `.env.local` into this app's environment.
 *
 * The whole monorepo keeps its secrets in ONE git-ignored file at the root — the same file
 * `contracts/hardhat.config.ts` reads — so a value like the deployed contract address is
 * written once rather than copied into two places that can drift.
 *
 * On Vercel this file does not exist and the real environment variables are already set, so
 * this is a no-op there. Existing values always win; nothing here ever overwrites them.
 */
function loadRootEnv() {
  const path = new URL("../.env.local", import.meta.url);
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match === null) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^["'](.*)["']$/, "$1");
  }
}

loadRootEnv();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The pipeline workers run inside route handlers and use Node APIs (crypto for
  // agent-key encryption, ethers for signing), so they must not be bundled for edge.
  serverExternalPackages: ["ethers"],

  env: {
    // Surfaced in the UI so a judge can tell which build they are looking at.
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;
