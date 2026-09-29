#!/usr/bin/env node
/**
 * The mock-data guard.  `pnpm --filter web check:provenance`
 *
 * Hard rule #2: mock data must never be presented as real, and CI must fail if `MOCK` provenance
 * reaches a production build. This is that check. It replaces the Phase 6 placeholder grep, which
 * only looked for two exact spellings of a JSX attribute and would have missed an origin arriving
 * through a variable.
 *
 * Four checks, each closing a hole the others leave open:
 *
 *   1. **Nothing may name it.** The token `MOCK` must not appear anywhere under `app/`,
 *      `components/`, `lib/` or `scripts/` outside the three files in `NAMING_ALLOWLIST`. Blunt on
 *      purpose: a three-path allowlist is auditable at a glance, and it catches every spelling —
 *      `origin="MOCK"`, `origin={SOME_CONST}`, a const named `MOCK_ROWS`, even a comment promising
 *      to remove one later.
 *
 *   2. **The runtime guard must still be there.** A checker that can be defeated by deleting the
 *      throw it relies on is not a check. This asserts `provenanceRefusal` still returns a
 *      refusal for `MOCK` in production, by reading the source rather than trusting the test to
 *      have been run.
 *
 *   3. **No rendered badge in the build output.** Any prerendered HTML in `.next` carrying
 *      `data-provenance="MOCK"` is a page that actually rendered invented data. This is the only
 *      check that operates on the build, and it can only work on *output*: `Provenance.tsx`
 *      necessarily contains the string `MOCK`, so every JS bundle does too, whether or not a page
 *      uses it. Grepping bundles would fail always or never.
 *
 *   4. **Every page must declare something.** A page that renders no `<Provenance>` at all is not
 *      caught by any of the above — it just makes no claim. So each route file is required to
 *      either use the component or be on a stated exemption list, which keeps "I forgot" from
 *      looking identical to "there is nothing to label".
 *
 * Exit code 1 with a named file and line on failure, so a CI log points at the fix.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The token, assembled rather than written, so this file does not trip its own check. */
const TOKEN = ["M", "O", "C", "K"].join("");

/**
 * The only files permitted to name it: the component that implements the rule, its test, and this
 * checker — which has to be able to describe what it forbids. Three paths, listed explicitly, so
 * the exception is auditable at a glance rather than inferred from a pattern.
 */
const NAMING_ALLOWLIST = new Set([
  "components/Provenance.tsx",
  "components/Provenance.test.ts",
  "scripts/check-provenance.mjs",
]);

/**
 * Routes that legitimately render no provenance badge, with the reason.
 *
 * Kept here rather than inferred: "this page has nothing to label" is a claim someone should have
 * to write down. A new page is not exempt by default.
 */
const NO_BADGE_NEEDED = {
  "app/layout.tsx": "the shell — renders no data",
};

const SOURCE_DIRS = ["app", "components", "lib", "scripts"];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mjs", ".js"];

const failures = [];

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(join(WEB_ROOT, dir));
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = `${dir}/${entry}`;
    const abs = join(WEB_ROOT, rel);
    if (statSync(abs).isDirectory()) {
      out.push(...walk(rel));
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      out.push(rel);
    }
  }
  return out;
}

const sourceFiles = SOURCE_DIRS.flatMap((dir) => walk(dir));

// --- 1. Nothing outside the allowlist may name it -------------------------------------------
//
// `scripts/` is scanned like the rest, so a fixture or a seed script cannot smuggle invented rows
// in through the back door. This file is on the allowlist because a check has to be able to name
// what it forbids; the token is still assembled from characters above rather than written, so the
// failure message can print it without that line becoming a second thing to except.
for (const file of sourceFiles) {
  if (NAMING_ALLOWLIST.has(file)) continue;
  const lines = readFileSync(join(WEB_ROOT, file), "utf8").split("\n");
  lines.forEach((line, i) => {
    if (line.includes(TOKEN)) {
      failures.push(
        `${file}:${i + 1}  names ${TOKEN} provenance. Nothing outside components/Provenance.tsx may. ` +
          `If this data is not real, do not ship it. See CLAUDE.md hard rule #2.\n    ${line.trim()}`,
      );
    }
  });
}

// --- 2. The runtime guard must still exist ---------------------------------------------------
{
  const component = readFileSync(join(WEB_ROOT, "components/Provenance.tsx"), "utf8");
  const guards = [
    [`origin !== "${TOKEN}"`, "the early return that lets every real origin through"],
    ['nodeEnv !== "production"', "the production-only condition"],
    ["throw new Error(refusal)", "the throw that stops the render"],
  ];
  for (const [needle, what] of guards) {
    if (!component.includes(needle)) {
      failures.push(
        `components/Provenance.tsx no longer contains ${what} (\`${needle}\`). The runtime guard ` +
          `is the backstop behind this checker — removing it silently weakens hard rule #2.`,
      );
    }
  }
}

// --- 3. No rendered badge in the build output ------------------------------------------------
{
  const marker = `data-provenance="${TOKEN}"`;
  const html = [];
  const collect = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) collect(abs);
      else if (entry.endsWith(".html") || entry.endsWith(".rsc")) html.push(abs);
    }
  };
  collect(join(WEB_ROOT, ".next/server/app"));

  if (html.length === 0) {
    console.log(
      "  note: no prerendered HTML found in .next/server/app. Every page in this app is " +
        "`force-dynamic`, so there is nothing to scan and the runtime throw is what covers them. " +
        "Not treated as a failure — but it does mean check 3 proved nothing on this run.",
    );
  }
  for (const file of html) {
    if (readFileSync(file, "utf8").includes(marker)) {
      failures.push(
        `${relative(WEB_ROOT, file)} contains a rendered ${TOKEN} badge. A page in this build ` +
          `actually displayed invented data.`,
      );
    }
  }
}

// --- 4. Every route must declare its provenance ----------------------------------------------
{
  const routes = sourceFiles.filter(
    (file) => file.startsWith("app/") && /\/(page|layout)\.tsx$/.test(file),
  );
  for (const route of routes) {
    if (route in NO_BADGE_NEEDED) continue;
    const source = readFileSync(join(WEB_ROOT, route), "utf8");
    // Either the page renders a badge itself, or it composes a component that does. Both are
    // matched by looking for the import, which is what makes the intent explicit.
    if (!source.includes("Provenance")) {
      failures.push(
        `${route} renders no <Provenance> badge and is not on the exemption list in ` +
          `scripts/check-provenance.mjs. A page that shows data must say where it came from.`,
      );
    }
  }
}

// --- Report -----------------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`\nProvenance check FAILED — ${failures.length} problem(s):\n`);
  for (const failure of failures) console.error(`  ✖ ${failure}`);
  console.error("");
  process.exit(1);
}

console.log(
  `Provenance check passed: ${sourceFiles.length} source files scanned, the runtime guard is ` +
    `intact, and every route declares where its data comes from.`,
);
