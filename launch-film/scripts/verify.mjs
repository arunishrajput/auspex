// The render gate. Re-reads every on-screen hash from the explorer and exits non-zero on any mismatch.
import fs from "node:fs";
const src = fs.readFileSync(new URL("../src/data/evidence.ts", import.meta.url), "utf8");
const consts = Object.fromEntries([...src.matchAll(/export const (\w+) = "([^"]+)"/g)].map(m => [m[1], m[2]]));
const txs = [...src.matchAll(/(\w+): \{ hash: "(0x[0-9a-f]{64})", status: "(\w+)", method: "(\w+)"(?:, from: (\w+))?(?:, revert: "(\w+)")?/g)];
const API = "https://testnet.mstscan.com/api/v2";
let bad = 0;
const get = async p => (await fetch(API + p)).json();
for (const [, key, hash, status, method, fromKey, revert] of txs) {
  const t = await get(`/transactions/${hash}`);
  const errs = [];
  if (t.status !== status) errs.push(`status ${t.status} != ${status}`);
  if (t.method !== method) errs.push(`method ${t.method} != ${method}`);
  if (t.to?.hash?.toLowerCase() !== consts.CONTRACT.toLowerCase()) errs.push(`to ${t.to?.hash}`);
  if (fromKey && t.from?.hash?.toLowerCase() !== consts[fromKey].toLowerCase()) errs.push(`from ${t.from?.hash} != ${fromKey}`);
  if (revert && !JSON.stringify(t.decoded_revert_reason ?? t.revert_reason ?? t.result ?? "").includes(revert)) errs.push(`revert ${JSON.stringify(t.revert_reason).slice(0, 120)}`);
  console.log(errs.length ? "FAIL" : "ok  ", key.padEnd(12), hash.slice(0, 12), t.method, t.status, "block", t.block_number ?? t.block, errs.join("; "));
  bad += errs.length ? 1 : 0;
}
const c = await get(`/smart-contracts/${consts.CONTRACT}`);
console.log(c.is_verified ? "ok  " : "FAIL", "contract verified", c.name, c.compiler_version);
if (!c.is_verified) bad++;
if (bad) { console.error(`${bad} claim(s) failed — refusing to render`); process.exit(1); }
console.log("all on-screen chain claims resolve on testnet.mstscan.com");
