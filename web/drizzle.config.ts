import { defineConfig } from "drizzle-kit";
import { loadRootEnv } from "./lib/env";

// drizzle-kit runs outside Next.js, so the repo-root .env.local is not loaded for it.
loadRootEnv();

/**
 * Migrations run against the DIRECT Neon endpoint, not the pooler: PgBouncer in transaction
 * mode rejects the session-level statements DDL needs. `DATABASE_URL_UNPOOLED` is the
 * `-pooler`-less host; on a plain Postgres it is absent and the pooled URL is the same server.
 */
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Put it in the repo-root .env.local (git-ignored). " +
      "See docs/RUNBOOK.md §3.",
  );
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
