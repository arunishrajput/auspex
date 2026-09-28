#!/usr/bin/env node
/**
 * Pre-flight health check.
 *
 *   pnpm preflight
 *
 * Verifies every external dependency the build needs, and says plainly which phase each
 * failure blocks. Run this before a demo — discovering a dead RPC or an exhausted LLM
 * quota in front of judges is avoidable.
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
  if (!url.includes("-pooler")) {
    record(
      "Neon Postgres",
      true,
      "set, but this looks like the DIRECT connection string — use the POOLED one for serverless",
    );
    return;
  }
  record("Neon Postgres", true, "DATABASE_URL set (pooled)");
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
async function main() {
  console.log("\nAuspeX preflight — checking every external dependency\n");

  await checkChain();
  await checkExplorer();
  await checkDeployer();
  await checkDatabase();
  await checkGemini();
  checkOtherSecrets();
  await checkContract();

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
