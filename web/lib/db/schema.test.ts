import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { applyMigrations } from "./migrate";
import { loadRootEnv } from "../env";

/**
 * Migrations and the constraints that carry the idempotency guarantees.
 *
 * Phase 2's exit criterion is *"migrations apply cleanly to a fresh Neon database"*, so this
 * creates a genuinely fresh database on the real Neon project, migrates it from empty, asserts
 * the constraints exist and then proves each one actually fires. Running against the shared
 * development database would test a database that is already migrated, which is a different
 * and much weaker claim.
 *
 * It skips — loudly — when `DATABASE_URL` is absent, which is the case in CI: the credential
 * is a Vercel/Neon secret and this repository is public. The suite is run locally before every
 * commit that touches the schema, and its result is recorded in PROGRESS.md.
 */

loadRootEnv();

const ADMIN_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const canRun = ADMIN_URL !== undefined && ADMIN_URL.length > 0;

if (!canRun) {
  console.warn(
    "[schema.test] DATABASE_URL is not set — skipping the migration tests. " +
      "They are expected to skip in CI and to run locally.",
  );
}

/** `sslmode` handled explicitly, for the reason in `lib/db/client.ts`. */
function connectionFor(url: string, database?: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete("sslmode");
  if (database !== undefined) parsed.pathname = `/${database}`;
  return parsed.toString();
}

function clientFor(url: string, database?: string): Client {
  return new Client({
    connectionString: connectionFor(url, database),
    ssl: { rejectUnauthorized: true },
  });
}

describe.skipIf(!canRun)("migrations against a fresh database", () => {
  const dbName = `auspex_test_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  let testUrl: string;
  let client: Client;

  beforeAll(async () => {
    const admin = clientFor(ADMIN_URL as string);
    await admin.connect();
    // Not parameterised because an identifier cannot be a bind parameter. The name is
    // generated above from a timestamp and Math.random, never from input.
    await admin.query(`create database "${dbName}"`);
    await admin.end();

    testUrl = connectionFor(ADMIN_URL as string, dbName);
    await applyMigrations(testUrl);

    client = clientFor(testUrl);
    await client.connect();
  }, 120_000);

  afterAll(async () => {
    await client?.end().catch(() => undefined);
    const admin = clientFor(ADMIN_URL as string);
    await admin.connect();
    await admin.query(`drop database if exists "${dbName}" with (force)`);
    await admin.end();
  }, 120_000);

  it("creates every table the architecture calls for", async () => {
    const { rows } = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const tables = rows.map((r) => r.table_name);

    // docs/ARCHITECTURE.md §8, plus indexer_cursors which the indexer needs and the doc's
    // table did not anticipate.
    for (const table of [
      "sources",
      "raw_items",
      "events",
      "event_items",
      "proposals",
      "markets",
      "members",
      "agent_policies",
      "agent_decisions",
      "onchain_intents",
      "chain_events",
      "notifications",
      "audit_log",
      "indexer_cursors",
    ]) {
      expect(tables, `missing table ${table}`).toContain(table);
    }
  });

  it("is re-runnable: applying migrations twice is a no-op", async () => {
    const applied = async () => {
      const { rows } = await client.query<{ count: string }>(
        "select count(*)::text as count from drizzle.__drizzle_migrations",
      );
      return Number(rows[0].count);
    };

    // Compared against itself, not against a literal. The property under test is "a second run
    // applies nothing new"; pinning a specific count instead meant every future migration broke
    // this test for a reason unrelated to what it checks — which is what Phase 4 did to it.
    const before = await applied();
    expect(before).toBeGreaterThan(0);

    await applyMigrations(testUrl);
    expect(await applied()).toBe(before);
  });

  describe("the unique constraints that carry idempotency", () => {
    it("UNIQUE(source_id, source_guid) makes re-ingesting a feed a no-op", async () => {
      const source = await client.query<{ id: string }>(
        `insert into sources (domain, name, independence_group)
         values ('reuters.com', 'Reuters', 'reuters') returning id`,
      );
      const sourceId = source.rows[0].id;

      const insert = `insert into raw_items (source_id, source_guid, title, url, content_hash)
                      values ($1, 'guid-1', 'A headline', 'https://example.org/a', $2)`;
      const hash = `0x${"a".repeat(64)}`;

      await client.query(insert, [sourceId, hash]);
      await expect(client.query(insert, [sourceId, hash])).rejects.toThrow(
        /duplicate key value|raw_items_source_guid_key/,
      );

      // The same guid from a DIFFERENT publisher is a different article, and must be allowed —
      // otherwise two independent reports of one story could not both be ingested, and
      // 2-source confirmation would be impossible.
      const other = await client.query<{ id: string }>(
        `insert into sources (domain, name, independence_group)
         values ('apnews.com', 'AP', 'ap') returning id`,
      );
      await expect(client.query(insert, [other.rows[0].id, hash])).resolves.toBeDefined();
    });

    it("UNIQUE(idempotency_key) makes two racing ticks produce one intent", async () => {
      const insert = `insert into onchain_intents
        (idempotency_key, kind, from_address, to_address, function_name, data)
        values ('create:0xabc', 'CREATE_MARKET', '0x01', '0x02', 'createMarket', '0xdead')`;

      await client.query(insert);
      await expect(client.query(insert)).rejects.toThrow(
        /duplicate key value|onchain_intents_idempotency_key_key/,
      );

      // And the ON CONFLICT DO NOTHING the engine actually uses inserts nothing.
      const { rowCount } = await client.query(`${insert} on conflict do nothing`);
      expect(rowCount).toBe(0);
    });

    it("UNIQUE(tx_hash, log_index) makes indexer replay a no-op", async () => {
      const insert = `insert into chain_events
        (tx_hash, log_index, block_number, block_hash, address, topic0, raw_topics, raw_data)
        values ($1, $2, 5786372, $3, '0xc47', $4, '[]'::jsonb, '0x')`;
      const tx = `0x${"1".repeat(64)}`;
      const block = `0x${"2".repeat(64)}`;
      const topic = `0x${"3".repeat(64)}`;

      await client.query(insert, [tx, 0, block, topic]);
      await expect(client.query(insert, [tx, 0, block, topic])).rejects.toThrow(
        /duplicate key value|chain_events_tx_log_key/,
      );

      // A different log in the SAME transaction is a distinct event. `createMarket` emits
      // one, but a future call could emit several, and collapsing them would lose data.
      await expect(client.query(insert, [tx, 1, block, topic])).resolves.toBeDefined();
    });

    const insertMarket = `insert into markets
      (spec_hash, onchain_id, question, resolution_source_url, close_time, resolve_deadline)
      values ($1, $2, 'Q?', 'https://example.org', now(), now())`;

    it("UNIQUE(spec_hash) mirrors the contract's own replay guard", async () => {
      const hash = `0x${"7".repeat(64)}`;
      await client.query(insertMarket, [hash, null]);
      await expect(client.query(insertMarket, [hash, null])).rejects.toThrow(
        /duplicate key value|markets_spec_hash_key/,
      );
    });

    it("onchain_id is unique but many markets may be ONCHAIN_PENDING at once", async () => {
      await client.query(insertMarket, [`0x${"8".repeat(64)}`, 1]);
      await expect(client.query(insertMarket, [`0x${"9".repeat(64)}`, 1])).rejects.toThrow(
        /duplicate key value|markets_onchain_id_key/,
      );

      // The partial index is what allows this: every pending market has a NULL id, and those
      // NULLs must not collide, or the human review queue could hold only one market at a
      // time. Scoped to these two hashes so earlier tests' rows cannot flatter the count.
      const pendingA = `0x${"a".repeat(64)}`;
      const pendingB = `0x${"b".repeat(64)}`;
      await client.query(insertMarket, [pendingA, null]);
      await client.query(insertMarket, [pendingB, null]);

      const { rows } = await client.query<{ count: string }>(
        "select count(*)::text as count from markets where onchain_id is null and spec_hash = any($1)",
        [[pendingA, pendingB]],
      );
      expect(Number(rows[0].count)).toBe(2);
    });

    it("UNIQUE(market_id, round) lets a challenge produce a second draft but not a duplicate", async () => {
      const { rows } = await client.query<{ id: string }>(
        `insert into markets (spec_hash, question, resolution_source_url, close_time, resolve_deadline)
         values ($1, 'Q?', 'https://example.org', now(), now()) returning id`,
        [`0x${"d".repeat(64)}`],
      );
      const marketId = rows[0].id;

      const insertDraft = `insert into resolution_drafts (market_id, round, outcome, evidence_url)
        values ($1, $2, 'YES', 'https://example.org/e')`;

      await client.query(insertDraft, [marketId, 1]);

      // A re-run pass derives the same round from the chain's challengeCount and conflicts, so a
      // human is never asked to read the same outcome twice.
      await expect(client.query(insertDraft, [marketId, 1])).rejects.toThrow(
        /duplicate key value|resolution_drafts_market_round_key/,
      );

      // But a challenge increments the round on chain, and that second draft is legitimate —
      // otherwise a challenged market could never be re-proposed and its funds would strand.
      await client.query(insertDraft, [marketId, 2]);

      const { rows: counted } = await client.query<{ count: string }>(
        "select count(*)::text as count from resolution_drafts where market_id = $1",
        [marketId],
      );
      expect(Number(counted[0].count)).toBe(2);
    });
  });

  it("money columns keep a uint256 exact", async () => {
    // 2^256 - 1. A float8 or a bigint column would silently mangle this.
    const max = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    await client.query(
      `insert into markets (spec_hash, question, resolution_source_url, close_time,
        resolve_deadline, pool_yes_wei) values ($1, 'Q?', 'https://e.org', now(), now(), $2)`,
      [`0x${"c".repeat(64)}`, max],
    );
    const { rows } = await client.query<{ pool_yes_wei: string }>(
      "select pool_yes_wei from markets where spec_hash = $1",
      [`0x${"c".repeat(64)}`],
    );
    expect(rows[0].pool_yes_wei).toBe(max);
  });

  it("rejects a status value that is not in the state machine", async () => {
    await expect(
      client.query(
        `insert into onchain_intents (idempotency_key, kind, status, from_address,
          to_address, function_name, data)
         values ('x', 'CREATE_MARKET', 'DEFINITELY_NOT_A_STATUS', '0x1', '0x2', 'f', '0x')`,
      ),
    ).rejects.toThrow(/invalid input value for enum/);
  });
});
