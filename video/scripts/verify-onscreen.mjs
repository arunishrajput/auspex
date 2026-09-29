#!/usr/bin/env node
/**
 * Re-checks every transaction and address the film puts on screen against the
 * explorer, and fails the build if any of them disagrees with what the script claims.
 *
 * This exists because of the defect PROGRESS.md records: every link resolved and every
 * hash was real, but the column beside them was flattering and wrong. A caption that
 * misattributes a signer is the one mistake this demo cannot survive, so the claim is
 * checked, not just the hash.
 *
 * Mirrors scripts/check-links.mjs at the repo root. Exits non-zero on any mismatch.
 */
import fs from "node:fs";
import path from "node:path";

const API = "https://testnet.mstscan.com/api/v2";
const ROOT = path.resolve(import.meta.dirname, "..");
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, "script", "script.json"), "utf8"));

const C = { ok: "\x1b[32m", bad: "\x1b[31m", dim: "\x1b[2m", b: "\x1b[1m", r: "\x1b[0m" };
const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

const get = async (url) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (res.ok) return await res.json();
      if (attempt === 3) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt === 3) throw err;
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
};

const failures = [];
const pass = (msg) => console.log(`  ${C.ok}ok${C.r}     ${msg}`);
const fail = (msg, detail) => {
  console.log(`  ${C.bad}FAIL${C.r}   ${msg}`);
  console.log(`         ${C.dim}${detail}${C.r}`);
  failures.push(`${msg} — ${detail}`);
};

console.log(`${C.b}Re-checking every on-screen claim against ${API}${C.r}\n`);

for (const t of spec.verifyTargets) {
  const label = t.kind === "tx" ? `${t.hash.slice(0, 12)}…` : `${t.address.slice(0, 12)}…`;
  const what = `${label}  ${C.dim}${t.claim}${C.r}`;

  try {
    if (t.kind === "tx") {
      const tx = await get(`${API}/transactions/${t.hash}`);
      const problems = [];

      if (!eq(tx.status, t.expectStatus)) problems.push(`status is "${tx.status}", script claims "${t.expectStatus}"`);
      const from = tx.from?.hash ?? "";
      if (t.expectFrom && !eq(from, t.expectFrom)) problems.push(`sent by ${from}, script claims ${t.expectFrom}`);

      if (t.expectRevert) {
        const decoded = JSON.stringify(tx.revert_reason ?? "");
        if (!decoded.includes(t.expectRevert)) problems.push(`revert reason lacks "${t.expectRevert}": ${decoded.slice(0, 120)}`);
      }

      if (problems.length) fail(what, problems.join(" · "));
      else pass(`${what}\n         ${C.dim}block ${tx.block_number} · ${tx.status} · from ${from}${C.r}`);
    } else {
      const addr = await get(`${API}/addresses/${t.address}`);
      const problems = [];
      if (t.expectContract && !addr.is_contract) problems.push("not a contract");
      if (t.expectVerified && !addr.is_verified) problems.push("source is NOT verified");
      if (problems.length) fail(what, problems.join(" · "));
      else pass(`${what}\n         ${C.dim}${addr.name ?? "contract"} · verified: ${addr.is_verified}${C.r}`);
    }
  } catch (err) {
    fail(what, `could not reach the explorer: ${err.message}`);
  }
}

console.log("");
if (failures.length) {
  console.log(`${C.bad}${C.b}${failures.length} on-screen claim(s) do not match the chain. The render is blocked.${C.r}`);
  process.exit(1);
}
console.log(`${C.ok}${C.b}All ${spec.verifyTargets.length} on-screen claims match the chain. Safe to render.${C.r}`);
