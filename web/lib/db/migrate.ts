import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { splitSsl } from "./ssl";

/**
 * Applies the SQL files in `web/drizzle/` to a database.
 *
 * A function rather than only a CLI, because the test that proves migrations apply cleanly to
 * a fresh database has to be able to call it. drizzle tracks what it has applied in
 * `drizzle.__drizzle_migrations`, so running it twice is a no-op.
 *
 * It opens its own single-use `Client` rather than borrowing the app's pool: migrations must
 * run on the DIRECT endpoint (Neon's pooler is PgBouncer in transaction mode and rejects the
 * session-level statements DDL needs), which is a different connection string entirely.
 */
export const MIGRATIONS_FOLDER = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "drizzle",
);

export async function applyMigrations(url: string): Promise<void> {
  // TLS policy stated explicitly, and verified by default — see `splitSsl` in db/client.ts.
  const { connectionString, verifyTls } = splitSsl(url);
  const client = new Client({
    connectionString,
    ssl: verifyTls ? { rejectUnauthorized: true } : undefined,
  });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}
