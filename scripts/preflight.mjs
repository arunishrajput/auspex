#!/usr/bin/env node
/**
 * Pre-flight health check.
 *
 *   pnpm preflight
 *
 * Verifies every external dependency the build needs, and says plainly which phase each
 * failure blocks. Run this before a demo — discovering a dead RPC or an exhausted LLM
 * quota while someone is watching the site is avoidable.
 *
 * Never prints a secret. Only ever reports whether one is present and whether it works.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const EXPECTED_CHAIN_ID = 91562037;
const RPC_URL = "https://testnetrpc.mstblockchain.com";
const EXPLORER = "https://testnet.mstscan.com";

// ---------------------------------------------------------------------------
// Minimal .env.local loader — avoids a dependency for a 15-line job.
// ---------------------------------------------------------------------------
function loadEnvLocal() {
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const env = { ...loadEnvLocal(), ...process.env };

const results = [];
const record = (name, ok, detail, blocks) =>
  results.push({ name, ok, detail, blocks });

async function rpc(method, params = []) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${body.error.code}: ${body.error.message}`);
  return body.result;
}

// ---------------------------------------------------------------------------
// 1. Chain reachability + correct chain
// ---------------------------------------------------------------------------
async function checkChain() {
  try {
    const started = Date.now();
    const [chainIdHex, blockHex] = await Promise.all([
      rpc("eth_chainId"),
      rpc("eth_blockNumber"),
    ]);
    const latency = Date.now() - started;
    const chainId = Number.parseInt(chainIdHex, 16);
    const block = Number.parseInt(blockHex, 16);

    if (chainId !== EXPECTED_CHAIN_ID) {
      record(
        "MST RPC",
        false,
        `reachable but chainId is ${chainId}, expected ${EXPECTED_CHAIN_ID}`,
        "everything on-chain",
      );
      return;
    }
    record(
      "MST RPC",
      true,
      `chain ${chainId}, block ${block.toLocaleString("en-US")}, ${latency}ms`,
    );
  } catch (error) {
    record("MST RPC", false, String(error.message ?? error), "everything on-chain");
  }
}

// ---------------------------------------------------------------------------
// 2. Explorer (the one people get wrong)
// ---------------------------------------------------------------------------
async function checkExplorer() {
  try {
    const response = await fetch(`${EXPLORER}/api?module=block&action=eth_block_number`, {
      signal: AbortSignal.timeout(12_000),
    });
    const body = await response.json();
    const block = Number.parseInt(body.result, 16);
    record("MSTScan explorer", true, `${EXPLORER}, block ${block.toLocaleString("en-US")}`);
  } catch (error) {
    record("MSTScan explorer", false, String(error.message ?? error), "verification, demo links");
  }
}

// ---------------------------------------------------------------------------
// 3. Deployer wallet + balance
// ---------------------------------------------------------------------------
async function checkDeployer() {
  const key = env.DEPLOYER_PRIVATE_KEY;
  const placeholder = /^0x0+$/.test(key ?? "");

  if (!key || placeholder) {
    record(
      "Deployer wallet",
      false,
      "DEPLOYER_PRIVATE_KEY not set in .env.local — run `pnpm wallets:new`",
      "Phase 1 deploy",
    );
    return;
  }

  let address;
  try {
    const { Wallet } = await import("ethers");
    address = new Wallet(key).address;
  } catch {
    record("Deployer wallet", false, "DEPLOYER_PRIVATE_KEY is not a valid key", "Phase 1 deploy");
    return;
  }

  try {
    const balanceHex = await rpc("eth_getBalance", [address, "latest"]);
    const wei = BigInt(balanceHex);
    const mstc = Number(wei) / 1e18;
    if (wei === 0n) {
      record(
        "Deployer wallet",
        false,
        `${address} has 0 tMSTC — fund it at https://faucet.masterstroke.academy`,
        "Phase 1 deploy",
      );
    } else {
      record("Deployer wallet", true, `${address} — ${mstc.toFixed(4)} tMSTC`);
    }
  } catch (error) {
    record("Deployer wallet", false, String(error.message ?? error), "Phase 1 deploy");
  }
}

// ---------------------------------------------------------------------------
// 3b. Human authority wallet — funded, and holding exactly the right role
// ---------------------------------------------------------------------------

/**
 * The BridgeKey wallet the human signs `createMarket` from (RUNBOOK §5).
 *
 * Checked here rather than taken on trust because two things can silently break it between
 * now and a demo: the balance can go to zero, and the role can be revoked. Both would surface
 * as a confusing revert in the `/review` queue while someone is using it.
 *
 * It also asserts the wallet does **not** hold `DEFAULT_ADMIN_ROLE`. That is not paranoia —
 * "the human can create markets and nothing else" is the project's central trust claim, and a
 * claim worth making is worth a check that fails when it stops being true.
 */
async function checkHumanAuthority() {
  const address = env.HUMAN_AUTHORITY_ADDRESS;
  if (!address) {
    record(
      "Human authority",
      false,
      "HUMAN_AUTHORITY_ADDRESS not set in .env.local — see docs/RUNBOOK.md §5",
      "Phase 4 approvals",
    );
    return;
  }

  const contract = env.NEXT_PUBLIC_AUSPEX_MARKET_ADDRESS;
  if (!contract) {
    record("Human authority", false, "NEXT_PUBLIC_AUSPEX_MARKET_ADDRESS not set", "Phase 4 approvals");
    return;
  }

  // keccak256 of each role name, confirmed equal to what the deployed contract returns from its
  // own getters. DEFAULT_ADMIN_ROLE is zero by OpenZeppelin convention. Literals, so this check
  // needs no ABI and no workspace dependency.
  const MARKET_CREATOR_ROLE =
    "0xd3065a24ad9e7725d223007135762d2902038999e3e5829146654498a58d9795";
  const RESOLVER_ROLE =
    "0x92a19c77d2ea87c7f81d50c74403cb2f401780f3ad919571121efe2bdb427eb1";
  const CHALLENGER_ROLE =
    "0xe752add323323eb13e36c71ee508dfd16d74e9e4c4fd78786ba97989e5e13818";
  const DEFAULT_ADMIN_ROLE = `0x${"0".repeat(64)}`;
  // hasRole(bytes32,address) selector
  const SELECTOR = "0x91d14854";

  const hasRole = async (role) => {
    const data = SELECTOR + role.slice(2) + address.slice(2).toLowerCase().padStart(64, "0");
    const result = await rpc("eth_call", [{ to: contract, data }, "latest"]);
    return BigInt(result) === 1n;
  };

  try {
    const balanceHex = await rpc("eth_getBalance", [address, "latest"]);
    const mstc = Number(BigInt(balanceHex)) / 1e18;

    const [creator, resolver, challenger, admin] = await Promise.all([
      hasRole(MARKET_CREATOR_ROLE),
      hasRole(RESOLVER_ROLE),
      hasRole(CHALLENGER_ROLE),
      hasRole(DEFAULT_ADMIN_ROLE),
    ]);

    if (mstc === 0) {
      record(
        "Human authority",
        false,
        `${address} has 0 tMSTC — fund it at https://faucet.masterstroke.academy`,
        "Phase 4 approvals",
      );
      return;
    }
    if (!creator) {
      record(
        "Human authority",
        false,
        `${address} does not hold MARKET_CREATOR_ROLE — ` +
          `run: ROLE=MARKET_CREATOR_ROLE TO=${address} pnpm --filter contracts grant:testnet`,
        "Phase 4 approvals",
      );
      return;
    }
    // Phase 6 granted this wallet RESOLVER_ROLE and CHALLENGER_ROLE too — the other two roles that
    // require human judgement (ADR-052). Missing either is not the hard failure a missing
    // MARKET_CREATOR_ROLE is (markets can still be created and bet on) but it is reported loudly,
    // because resolution would then revert in front of an audience.
    const missing = [
      resolver ? null : "RESOLVER_ROLE",
      challenger ? null : "CHALLENGER_ROLE",
    ].filter((role) => role !== null);

    if (admin) {
      // Louder than a missing role, because this is THE trust claim: the wallet holds every role
      // that needs judgement and none that confers power. DEFAULT_ADMIN_ROLE would let it register
      // agents, change a cap and pause the contract.
      record(
        "Human authority",
        false,
        `${address} holds DEFAULT_ADMIN_ROLE. It should hold the judgement roles ` +
          `(MARKET_CREATOR, RESOLVER, CHALLENGER) and NOT admin.`,
        "the trust model in the README",
      );
      return;
    }

    if (missing.length > 0) {
      record(
        "Human authority",
        false,
        `${address} does not hold ${missing.join(" or ")} — Phase 6 resolution needs it. Run: ` +
          missing
            .map((role) => `ROLE=${role} TO=${address} pnpm --filter contracts grant:testnet`)
            .join(" && "),
        "Phase 6 resolution",
      );
      return;
    }

    record(
      "Human authority",
      true,
      `${address} — ${mstc.toFixed(4)} tMSTC, holds MARKET_CREATOR + RESOLVER + CHALLENGER, ` +
        `NOT admin`,
    );
  } catch (error) {
    record("Human authority", false, String(error.message ?? error), "Phase 4 approvals");
  }
}

// ---------------------------------------------------------------------------
// 4. Gemini — makes one real call
// ---------------------------------------------------------------------------
async function checkGemini() {
  const key = env.GEMINI_API_KEY;
  if (!key) {
    record("Gemini API", false, "GEMINI_API_KEY not set — see docs/RUNBOOK.md §3", "Phase 3+");
    return;
  }

  // Walk the fallback chain, exactly as the pipeline does, and report which model
  // actually answered. A 503 here means capacity contention (free tier), not quota.
  const chain = (env.GEMINI_MODELS_FAST ?? "gemini-3.5-flash-lite,gemini-3.1-flash-lite")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const timeout = Number(env.GEMINI_TIMEOUT_MS ?? 20_000);

  const failures = [];

  for (const model of chain) {
    try {
      const started = Date.now();
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            contents: [{ parts: [{ text: "Reply with the single word: ok" }] }],
          }),
          signal: AbortSignal.timeout(timeout),
        },
      );

      if (response.ok) {
        const latency = Date.now() - started;
        const note = failures.length > 0 ? ` (after ${failures.length} unavailable)` : "";
        record("Gemini API", true, `${model} responded in ${latency}ms${note}`);
        return;
      }
      failures.push(`${model} → ${response.status}`);
    } catch {
      failures.push(`${model} → timeout`);
    }
  }

  const all503 = failures.every((f) => f.endsWith("503"));
  record(
    "Gemini API",
    false,
    all503
      ? `every model returned 503 (capacity contention, not quota): ${failures.join(", ")}. ` +
          "The free tier is not reliable enough for a live demo — enable billing on the key's " +
          "Google Cloud project. The pipeline fails safe regardless."
      : failures.join(", "),
    "Phase 3+ (degrades safely, does not crash)",
  );
}

// ---------------------------------------------------------------------------
// 5. Database
// ---------------------------------------------------------------------------
async function checkDatabase() {
  const url = env.DATABASE_URL;

  if (!url || url.includes("user:password@host")) {
    record("Neon Postgres", false, "DATABASE_URL not set — see docs/RUNBOOK.md §3", "Phase 2+");
    return;
  }

  // `vercel env pull` writes this literal string for any variable the Neon integration marked
  // sensitive, while reporting success. A preflight that only asks "is it set?" would pass.
  // That exact trap blocked the start of Phase 2 — see docs/RUNBOOK.md §3.
  if (url.includes("[SENSITIVE]")) {
    record(
      "Neon Postgres",
      false,
      'DATABASE_URL is the literal "[SENSITIVE]" — vercel env pull cannot decrypt it. ' +
        "Use `neonctl connection-string`. See docs/RUNBOOK.md §3.",
      "Phase 2+",
    );
    return;
  }

  // Actually connect. "The variable is set" is not the property that matters; "the database
  // answers and has a schema" is, and it is one query away.
  const startedAt = Date.now();
  try {
    const { Client } = await import("pg");
    const parsed = new URL(url);
    const mode = parsed.searchParams.get("sslmode");
    parsed.searchParams.delete("sslmode");

    const client = new Client({
      connectionString: parsed.toString(),
      ssl: mode !== "disable" ? { rejectUnauthorized: true } : undefined,
      // Neon's free tier scales the compute to zero; a cold start was seen at ~25s.
      connectionTimeoutMillis: 45_000,
    });

    await client.connect();
    const { rows } = await client.query(
      "select count(*)::int as tables from information_schema.tables where table_schema = 'public'",
    );
    await client.end();

    const tables = rows[0]?.tables ?? 0;
    const elapsed = Date.now() - startedAt;

    if (tables === 0) {
      record(
        "Neon Postgres",
        false,
        `connected in ${elapsed}ms but the schema is empty — run \`pnpm --filter web db:migrate\``,
        "Phase 2+",
      );
      return;
    }

    record(
      "Neon Postgres",
      true,
      `connected in ${elapsed}ms, ${tables} tables` +
        (url.includes("-pooler")
          ? ""
          : " — WARNING: direct string, use the POOLED one for serverless"),
    );
  } catch (error) {
    record(
      "Neon Postgres",
      false,
      `could not connect: ${error instanceof Error ? error.message : String(error)}`,
      "Phase 2+",
    );
  }
}

// ---------------------------------------------------------------------------
// 6. Other secrets — presence only, never value
// ---------------------------------------------------------------------------
function checkOtherSecrets() {
  const checks = [
    ["Discord webhook", env.DISCORD_WEBHOOK_URL, "Phase 4 notifications", "docs/RUNBOOK.md §4"],
    ["Agent key secret", env.AGENT_KEY_ENC_SECRET, "Phase 5 agent wallets", "openssl rand -hex 32"],
    ["Tick secret", env.TICK_SECRET, "Phase 3 heartbeat", "openssl rand -hex 24"],
  ];
  for (const [name, value, blocks, hint] of checks) {
    const placeholder = !value || /^0+$/.test(value);
    record(name, !placeholder, placeholder ? `not set — ${hint}` : "set", placeholder ? blocks : undefined);
  }
}

// ---------------------------------------------------------------------------
// 7. Deployed contract, once Phase 1 has run
// ---------------------------------------------------------------------------
async function checkContract() {
  const file = join(ROOT, "contracts", "deployments", "mstTestnet.json");
  if (!existsSync(file)) {
    record("AuspexMarket contract", false, "not deployed yet (expected until Phase 1)", "Phase 2+");
    return;
  }
  try {
    const record_ = JSON.parse(readFileSync(file, "utf8"));
    const entry = record_.contracts?.AuspexMarket ?? Object.values(record_.contracts ?? {})[0];
    if (!entry) {
      record("AuspexMarket contract", false, "deployments file has no contracts", "Phase 2+");
      return;
    }
    const code = await rpc("eth_getCode", [entry.address, "latest"]);
    if (code === "0x") {
      record(
        "AuspexMarket contract",
        false,
        `${entry.address} has NO bytecode on chain ${EXPECTED_CHAIN_ID}`,
        "Phase 2+",
      );
      return;
    }
    record(
      "AuspexMarket contract",
      true,
      `${entry.address} (${(code.length - 2) / 2} bytes) — ${EXPLORER}/address/${entry.address}`,
    );
  } catch (error) {
    record("AuspexMarket contract", false, String(error.message ?? error), "Phase 2+");
  }
}

// ---------------------------------------------------------------------------
// 8. Member agents — registered, capped and funded
// ---------------------------------------------------------------------------
/**
 * Asserts that every seeded agent wallet is capped **on chain** and can pay for gas.
 *
 * The same reasoning as `checkHumanAuthority`: this is a trust claim, so it gets a check that
 * fails when it stops being true. Three things break it quietly between now and a demo — an
 * agent's balance drains to nothing, `deactivateAgent` is called, or a policy is edited so the
 * registry no longer matches. Each would surface as a deferred pass with no bets and no obvious
 * reason, which is the worst way to find out.
 *
 * It reads the agent addresses from the database rather than from a constant, because the wallets
 * are generated at seed time and only Postgres knows them. A deployment that has not run
 * `agents:register` yet reports that plainly instead of failing.
 */
async function checkAgents() {
  const url = env.DATABASE_URL;
  const contract = env.NEXT_PUBLIC_AUSPEX_MARKET_ADDRESS;

  if (!url || url.includes("[SENSITIVE]") || !contract) {
    record("Member agents", false, "needs DATABASE_URL and the contract address", "Phase 5 betting");
    return;
  }

  let rows = [];
  try {
    const { Client } = await import("pg");
    const parsed = new URL(url);
    const mode = parsed.searchParams.get("sslmode");
    parsed.searchParams.delete("sslmode");
    const client = new Client({
      connectionString: parsed.toString(),
      ssl: mode !== "disable" ? { rejectUnauthorized: true } : undefined,
      connectionTimeoutMillis: 45_000,
    });
    await client.connect();
    ({ rows } = await client.query(
      "select handle, agent_address from members where agent_address is not null order by handle",
    ));
    await client.end();
  } catch (error) {
    record("Member agents", false, String(error.message ?? error), "Phase 5 betting");
    return;
  }

  if (rows.length === 0) {
    record(
      "Member agents",
      false,
      "no agent wallets exist — run `pnpm --filter web agents:register`",
      "Phase 5 betting",
    );
    return;
  }

  // agents(address) returns (address owner, uint128 perTxCap, uint128 perMarketCap, bool active),
  // ABI-encoded as four 32-byte words. Selector computed once and inlined so this file keeps
  // needing no ABI and no workspace dependency.
  const AGENTS_SELECTOR = "0xfd66091e";
  const problems = [];
  const summary = [];

  for (const { handle, agent_address: agent } of rows) {
    try {
      const data = AGENTS_SELECTOR + agent.slice(2).toLowerCase().padStart(64, "0");
      const result = await rpc("eth_call", [{ to: contract, data }, "latest"]);
      const word = (n) => `0x${result.slice(2 + n * 64, 2 + (n + 1) * 64)}`;

      const owner = `0x${word(0).slice(26)}`;
      const perTxCap = BigInt(word(1));
      const active = BigInt(word(3)) === 1n;
      const registered = BigInt(owner) !== 0n;

      const balance = BigInt(await rpc("eth_getBalance", [agent, "latest"]));
      // 0.001 tMSTC is the gas reserve the policy gate holds back; below it an agent cannot
      // reliably send anything, so it is the honest floor for "funded".
      const funded = balance >= 10n ** 15n;

      if (!registered) problems.push(`${handle} is not in the agent registry`);
      else if (!active) problems.push(`${handle} is deactivated on chain`);
      if (!funded) problems.push(`${handle} holds only ${balance} wei`);

      summary.push(
        `${handle} ${registered && active ? "capped" : "UNCAPPED"} at ` +
          `${Number(perTxCap) / 1e18} tMSTC/tx, ${(Number(balance) / 1e18).toFixed(4)} tMSTC`,
      );
    } catch (error) {
      problems.push(`${handle}: ${String(error.message ?? error)}`);
    }
  }

  const killSwitch = (env.AGENTS_KILL_SWITCH ?? "").toLowerCase() === "true";
  const note = killSwitch ? "  [AGENTS_KILL_SWITCH is ON — no agent will bet]" : "";

  record(
    "Member agents",
    problems.length === 0,
    problems.length === 0 ? `${summary.join(" · ")}${note}` : problems.join("; "),
    "Phase 5 betting",
  );
}

// ---------------------------------------------------------------------------
async function main() {
  console.log("\nAuspeX preflight — checking every external dependency\n");

  await checkChain();
  await checkExplorer();
  await checkDeployer();
  await checkHumanAuthority();
  await checkDatabase();
  await checkGemini();
  checkOtherSecrets();
  await checkContract();
  await checkAgents();

  const pad = Math.max(...results.map((r) => r.name.length));
  for (const { name, ok, detail, blocks } of results) {
    const mark = ok ? "[32m✓[0m" : "[31m✖[0m";
    console.log(`  ${mark} ${name.padEnd(pad)}  ${detail}`);
    if (!ok && blocks) console.log(`    ${" ".repeat(pad)}  ↳ blocks: ${blocks}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n  ${results.length - failed.length}/${results.length} checks passed.\n`,
  );

  if (failed.length > 0) {
    console.log("  Not all failures are problems yet — later phases set up later items.");
    console.log("  See docs/RUNBOOK.md for the manual steps.\n");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
