/**
 * Applies pending migrations.
 *
 *   pnpm --filter web db:migrate
 *
 * Prints what it did instead of a spinner, which matters when the output is a CI log. Never
 * prints the connection string — only the host.
 */
import { loadRootEnv } from "../lib/env";
import { applyMigrations } from "../lib/db/migrate";

async function main(): Promise<void> {
  loadRootEnv();

  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. See docs/RUNBOOK.md §3.");
  }

  console.log(`Applying migrations to ${new URL(url).hostname} …`);
  await applyMigrations(url);
  console.log("Migrations applied.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
