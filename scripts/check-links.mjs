#!/usr/bin/env node
/**
 * Proves the README's claim that every value in it is real.
 *
 * The rule being enforced is "every tx hash in the README resolves on testnet.mstscan.com".
 * That is worth automating rather than asserting once, because the README is the document a reader
 * reads first and a single mistyped character in it looks exactly like fabricated data — which the
 * hard rule #1 treats as the whole product failing. So this runs five checks over any markdown file:
 *
 *   1. **Every 32-byte hash resolves** through the explorer's API, and its status is printed.
 *      A reverted transaction is reported as reverted rather than as a failure, because six of
 *      ours are deliberate.
 *   2. **Every abbreviated hash is really an abbreviation** of the hash it links to. `0xabc…def`
 *      must be a prefix and suffix of the full hash in the href. This caught four typos on the
 *      first run, none of which any other check would have found: the link worked, the text beside
 *      it was wrong, and anyone comparing the two would have concluded the table was invented.
 *   2b. **Every named sender is the address that actually signed.** The most important check, and
 *      the reason the others were not enough: the first draft credited three transactions to the
 *      human's browser wallet that the operator key had sent. Nothing else would have caught it.
 *   3. **Every relative link exists on disk.**
 *   4. **Every absolute link answers.** Explorer pages and our own deployed routes included, so a
 *      broken production deploy fails this too.
 *
 * Read-only. It fetches; it signs nothing and writes nothing.
 *
 *   node scripts/check-links.mjs                 # checks README.md
 *   node scripts/check-links.mjs docs/WALKTHROUGH.md
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const EXPLORER_API = "https://testnet.mstscan.com/api/v2";

/** Between requests, so a 40-hash README does not look like a scraper to the explorer. */
const THROTTLE_MS = 150;

const target = process.argv[2] ?? "README.md";
const path = resolve(process.cwd(), target);

if (!existsSync(path)) {
  console.error(`No such file: ${target}`);
  process.exit(1);
}

const text = readFileSync(path, "utf8");
const root = dirname(path);

const green = (s) => `\u001b[32m${s}\u001b[0m`;
const red = (s) => `\u001b[31m${s}\u001b[0m`;
const dim = (s) => `\u001b[2m${s}\u001b[0m`;
const bold = (s) => `\u001b[1m${s}\u001b[0m`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const fail = (message) => {
  console.log(`  ${red("FAIL")}  ${message}`);
  failures++;
};
const pass = (message) => console.log(`  ${green("ok")}    ${message}`);

console.log(bold(`\nChecking every claim in ${target} against the live chain and the live site\n`));

// ---------------------------------------------------------------------------
// 1. Every 32-byte hash resolves, and we say what it is.
// ---------------------------------------------------------------------------

const hashes = [...new Set(text.match(/0x[0-9a-fA-F]{64}/g) ?? [])];
console.log(bold(`1. ${hashes.length} transaction hashes, against ${EXPLORER_API}`));

for (const hash of hashes) {
  try {
    const res = await fetch(`${EXPLORER_API}/transactions/${hash}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      fail(`${hash} — explorer returned HTTP ${res.status}`);
    } else {
      const tx = await res.json();
      const method = tx.method ?? tx.decoded_input?.method_call ?? "contract creation";
      const reverted = tx.result !== "success";
      // A revert is evidence here, not an error — six of ours are deliberate.
      const verdict = reverted ? `${dim("reverted")} ${revertName(tx)}` : "success";
      pass(`${hash.slice(0, 12)}…  block ${tx.block_number}  ${method.padEnd(20)} ${verdict}`);
    }
  } catch (error) {
    fail(`${hash} — ${error.message}`);
  }
  await sleep(THROTTLE_MS);
}

function revertName(tx) {
  const raw = tx.revert_reason;
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw.slice(0, 60);
  return String(raw.method_call ?? "").slice(0, 60);
}

// ---------------------------------------------------------------------------
// 2. An abbreviated hash must genuinely abbreviate the hash it links to.
//
// `[`0xabc…def`](…/tx/0xabc…full…def)`. The text beside a correct link being wrong is the
// failure mode that reads as fabrication, so it is checked as strictly as the link itself.
// ---------------------------------------------------------------------------

const abbreviations = [...text.matchAll(/\[`(0x[0-9a-fA-F]+)…([0-9a-fA-F]+)`\]\(([^)]+)\)/g)];
console.log(bold(`\n2. ${abbreviations.length} abbreviated hashes match the hash they link to`));

for (const [, head, tail, href] of abbreviations) {
  const full = href.match(/0x[0-9a-fA-F]{64}/)?.[0];
  if (full === undefined) {
    fail(`${head}…${tail} links to something with no 32-byte hash in it: ${href}`);
    continue;
  }
  if (!full.startsWith(head)) fail(`"${head}…" is not the start of ${full}`);
  else if (!full.endsWith(tail)) fail(`"…${tail}" is not the end of ${full}`);
  else pass(`${head}…${tail}`);
}

// ---------------------------------------------------------------------------
// 2b. A table row that names a sender must name the address that actually signed.
//
// This is the check that matters most, and it exists because the first draft of the README's
// evidence table credited three transactions to the human's browser wallet when the operator key
// had sent them. Every individual link worked; the column beside them was flattering and wrong,
// which is the worst failure available to this project — it is the exact claim the whole design is
// supposed to earn. A reader can check it in one click, so it has to be checked here first.
//
// Any markdown table row containing a /tx/ link and an abbreviated address is verified against the
// transaction's real `from`.
// ---------------------------------------------------------------------------

const senderRows = [];
for (const line of text.split("\n")) {
  if (!line.startsWith("|")) continue;
  // The hash may be a /tx/ link (README) or bare, for copy-pasting (WALKTHROUGH).
  const hash = line.match(/0x[0-9a-fA-F]{64}/)?.[0];
  if (hash === undefined) continue;
  // An abbreviated 20-byte address: 0x + at least 4 hex, an ellipsis, then at least 4 hex.
  // The tx hash links are `0x…64 hex`, so they cannot match this.
  const claimed = [...line.matchAll(/`(0x[0-9a-fA-F]{4,10})…([0-9a-fA-F]{4,8})`/g)].filter(
    (m) => !line.includes(`/tx/${m[1]}`) || m[0].length < 24,
  );
  const sender = claimed.find((m) => !hash.startsWith(m[1]) || !hash.endsWith(m[2]));
  if (sender !== undefined) senderRows.push({ hash, head: sender[1], tail: sender[2] });
}

console.log(bold(`\n2b. ${senderRows.length} rows naming a sender match the address that signed`));

for (const { hash, head, tail } of senderRows) {
  try {
    const res = await fetch(`${EXPLORER_API}/transactions/${hash}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      fail(`${hash.slice(0, 12)}… — explorer returned HTTP ${res.status}, sender unchecked`);
    } else {
      const from = (await res.json()).from?.hash ?? "";
      const lower = from.toLowerCase();
      if (lower.startsWith(head.toLowerCase()) && lower.endsWith(tail.toLowerCase())) {
        pass(`${hash.slice(0, 12)}…  sent by ${head}…${tail}`);
      } else {
        fail(
          `${hash.slice(0, 12)}… is credited to ${head}…${tail} but was sent by ${from} — ` +
            `fix the table, not this check`,
        );
      }
    }
  } catch (error) {
    fail(`${hash.slice(0, 12)}… — ${error.message}`);
  }
  await sleep(THROTTLE_MS);
}

// ---------------------------------------------------------------------------
// 3. Relative links point at files that exist.
// ---------------------------------------------------------------------------

const relatives = [...new Set([...text.matchAll(/\]\((\.\/[^)#\s]+)/g)].map((m) => m[1]))];
console.log(bold(`\n3. ${relatives.length} relative links exist on disk`));

for (const link of relatives) {
  if (existsSync(resolve(root, link))) pass(link);
  else fail(`missing file: ${link}`);
}

// ---------------------------------------------------------------------------
// 4. Absolute links answer. Transaction links are skipped — check 1 did those properly.
// ---------------------------------------------------------------------------

const urls = [
  ...new Set([...text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1])),
].filter((url) => !url.includes("/tx/"));
console.log(bold(`\n4. ${urls.length} absolute links answer`));

for (const url of urls) {
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "auspex-link-check" } });
    if (res.ok) pass(`${res.status}  ${url}`);
    else fail(`HTTP ${res.status}  ${url}`);
  } catch (error) {
    fail(`${url} — ${error.message}`);
  }
  await sleep(THROTTLE_MS);
}

console.log(
  failures === 0
    ? bold(green(`\nEvery hash, abbreviation and link in ${target} checks out.\n`))
    : bold(red(`\n${failures} problem(s) in ${target}.\n`)),
);
process.exit(failures === 0 ? 0 : 1);
