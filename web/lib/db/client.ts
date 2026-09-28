import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { splitSsl } from "./ssl";
import { optionalEnv, requireEnv } from "../env";

/**
 * The single Postgres connection pool.
 *
 * **Why `pg` and not `@neondatabase/serverless`.** Neon's HTTP driver is faster to cold-start
 * but issues each statement as its own request, so it cannot hold a transaction open — and
 * this codebase's central idempotency mechanism is
 * `SELECT … FOR UPDATE SKIP LOCKED` inside a transaction. `pg` speaks the ordinary Postgres
 * wire protocol, which Neon serves on its pooler endpoint, and which also runs against any
 * local Postgres. One driver, one code path, testable off Neon. See ADR-025.
 *
 * `max: 3` is deliberate. Neon's free tier caps connections, and on Vercel every warm lambda
 * holds its own pool; a large `max` per instance is how a serverless app exhausts a database.
 */

declare global {
  var __auspexPool: Pool | undefined;
}

function createPool(): Pool {
  const { connectionString, verifyTls } = splitSsl(requireEnv("DATABASE_URL"));

  const pool = new Pool({
    connectionString,
    ssl: verifyTls ? { rejectUnauthorized: true } : undefined,
    max: 3,
    idleTimeoutMillis: 10_000,
    // Neon's free tier scales the compute to zero when idle, and the first connection after
    // that has to wait for it to boot — observed at 10-25s on 2026-09-28. A 10s timeout made
    // "the database was asleep" look like "the database is broken", which is precisely the
    // kind of self-inflicted failure hard rule #6 is about.
    connectionTimeoutMillis: 45_000,
    // Neon terminates idle connections; without this an idle-client error becomes an
    // unhandled 'error' event and takes the process down instead of being retried.
    allowExitOnIdle: true,
  });

  // A pool-level error with no listener is an uncaught exception in Node. A dropped idle
  // connection must degrade into a retried query, never into a crashed tick (hard rule #6).
  pool.on("error", (error) => {
    console.error("[db] idle client error:", error.message);
  });

  return pool;
}

/**
 * Reused across hot reloads in dev and across warm invocations on Vercel. Without the global,
 * every edit in `next dev` leaks a pool and Neon starts refusing connections.
 */
export function getPool(): Pool {
  globalThis.__auspexPool ??= createPool();
  return globalThis.__auspexPool;
}

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let instance: DrizzleDb | undefined;

function getDb(): DrizzleDb {
  instance ??= drizzle(getPool(), { schema, casing: "snake_case" });
  return instance;
}

/**
 * The Drizzle handle. Looks like a plain object; connects on first use.
 *
 * The laziness is the point. `const db = drizzle(getPool())` at module scope would open a
 * pool — and therefore require `DATABASE_URL` — the instant anything imported this file. That
 * turned a missing credential into a *build* failure during Next.js page-data collection,
 * before `getMarketsForDisplay`'s own `hasDatabase()` check could ever run and render the
 * honest "database not configured" state. Importing this module now never throws; only
 * touching the database does.
 */
export const db: DrizzleDb = new Proxy({} as DrizzleDb, {
  get: (_target, property, receiver) => Reflect.get(getDb(), property, receiver),
  has: (_target, property) => property in getDb(),
});

export type Db = DrizzleDb;

/** True when a database is configured at all. Lets tests and `/api` routes degrade honestly. */
export function hasDatabase(): boolean {
  return optionalEnv("DATABASE_URL") !== undefined;
}

/**
 * The direct (non-pooled) connection string, for migrations.
 *
 * Neon's pooler is PgBouncer in transaction mode, which does not support the session-level
 * statements DDL migrations issue. Falls back to the pooled URL for a plain Postgres that has
 * no such split.
 */
export function migrationConnectionString(): string {
  return optionalEnv("DATABASE_URL_UNPOOLED") ?? requireEnv("DATABASE_URL");
}

export { schema };
