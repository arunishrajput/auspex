/**
 * TLS policy for Postgres connections, stated once.
 *
 * Two reasons this is not left to the connection string:
 *
 * **Noise.** `pg` v8 treats `sslmode=require` as `verify-full` and prints a deprecation
 * warning saying so on every single connection, which would sit in every script run and CI
 * log from here on.
 *
 * **Safety.** Deriving "use TLS" from the *presence* of `sslmode` means a connection string
 * that simply omits it connects in clear text — which is how a database credential ends up on
 * the wire. Here TLS with certificate verification is the default, and only an explicit
 * `sslmode=disable` turns it off, for a local Postgres that has no certificate.
 *
 * Its own module rather than a helper in `client.ts` so that `migrate.ts` can use it without
 * importing the app's connection pool, which requires `DATABASE_URL` at import time.
 */
export function splitSsl(url: string): { connectionString: string; verifyTls: boolean } {
  const parsed = new URL(url);
  const mode = parsed.searchParams.get("sslmode");
  parsed.searchParams.delete("sslmode");
  return { connectionString: parsed.toString(), verifyTls: mode !== "disable" };
}
