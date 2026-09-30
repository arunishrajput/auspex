#!/usr/bin/env node
/**
 * The three things about a redesign that only the rendered page can tell you.
 *
 * This project's most expensive recurring lesson is that a defect can compile, typecheck and
 * lint clean and still be obvious in one look at the served output — eight times now. Phase 10
 * changed every colour, every font and the shell of all eight routes, so the class of bug this
 * catches is exactly the class the phase was most likely to introduce. Source cannot answer any
 * of these questions; a browser can answer all three in about a minute.
 *
 *   1. **No horizontal scroll at 390px.** Phase 7 found the role matrix on `/trust` was a table
 *      whose payload columns all started off the right edge of a phone. It checked three routes
 *      by hand. This checks all eight, at 390px and at 1280px, and reports *which* element
 *      sticks out — an element overflowing inside a container that is deliberately
 *      `overflow-x-auto` is fine and the page-level measurement is what fails.
 *
 *   2. **A visible focus ring on every interactive element.** A redesign that changes every
 *      background can leave a ring invisible, or remove one, and nothing in the build notices.
 *      Every focusable element is focused in turn and its computed outline and box-shadow read
 *      back.
 *
 *   3. **`prefers-reduced-motion` actually stops the motion.** Declaring the media query is not
 *      the same as it covering the animations that shipped; this loads each route with the
 *      preference set and asserts nothing has a running animation.
 *
 * Needs a server already running and Playwright available. Neither is a project dependency, so
 * this is a local check rather than a CI gate — it skips with an explanation instead of failing
 * a build that cannot run it:
 *
 *   pnpm --filter web build && pnpm --filter web start -p 3210 &
 *   BASE=http://localhost:3210 node scripts/check-render.mjs
 */

const BASE = process.env.BASE ?? "http://localhost:3000";
const ROUTES = ["/", "/markets", "/review", "/agents", "/resolve", "/trust", "/audit", "/markets/13"];

let chromium;
try {
  // `PLAYWRIGHT` lets a machine point at an install outside this repo, which is the normal case
  // here: Playwright is not a dependency of this project and should not become one for a check
  // that runs by hand a few times a phase.
  ({ chromium } = await import(process.env.PLAYWRIGHT ?? "playwright"));
} catch {
  console.log(
    "check-render: Playwright is not installed, so the rendered-page checks were skipped.\n" +
      "  This is not a failure — Playwright is deliberately not a dependency of this project.\n" +
      "  To run them, either add it here, or point at an existing install:\n" +
      "    PLAYWRIGHT=/path/to/playwright/index.mjs BASE=… node scripts/check-render.mjs",
  );
  process.exit(0);
}

try {
  const probe = await fetch(BASE, { method: "HEAD" });
  if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
} catch (error) {
  console.error(
    `check-render: nothing is serving ${BASE} (${error.message}).\n` +
      "  Start the built app first — this checks the real output, not the source.",
  );
  process.exit(1);
}

const failures = [];
const browser = await chromium.launch();

// --- 1. no horizontal scroll ------------------------------------------------------------------
for (const width of [390, 1280]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  console.log(`\n${width}px — horizontal overflow`);
  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60_000 });
    const r = await page.evaluate(() => {
      const de = document.documentElement;
      const out = [...document.querySelectorAll("*")]
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.right > window.innerWidth + 1;
        })
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ").slice(0, 2).join(".")}`);
      return { scrollW: de.scrollWidth, clientW: de.clientWidth, out };
    });
    const bad = r.scrollW > r.clientW + 1;
    if (bad) {
      failures.push(
        `${route} scrolls horizontally at ${width}px (${r.scrollW} > ${r.clientW}). ` +
          `Widest: ${r.out.join(", ")}`,
      );
    }
    console.log(`  ${bad ? "✖" : "·"} ${route.padEnd(14)} ${r.scrollW}/${r.clientW}`);
  }
  await ctx.close();
}

// --- 2. focus is visible ----------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  console.log("\nfocus ring");
  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60_000 });
    const r = await page.evaluate(() => {
      const els = [
        ...document.querySelectorAll(
          "a[href], button:not([disabled]), input, select, textarea, summary, [tabindex]:not([tabindex='-1'])",
        ),
      ];
      const invisible = new Set();
      let checked = 0;
      for (const el of els.slice(0, 400)) {
        el.focus();
        if (document.activeElement !== el) continue;
        checked += 1;
        const cs = getComputedStyle(el);
        const ring =
          (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 1) || cs.boxShadow !== "none";
        if (!ring) invisible.add(`${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}`);
      }
      return { checked, total: els.length, invisible: [...invisible].slice(0, 5) };
    });
    if (r.invisible.length > 0) {
      failures.push(`${route} has focusable elements with no visible ring: ${r.invisible.join(", ")}`);
    }
    console.log(`  ${r.invisible.length ? "✖" : "·"} ${route.padEnd(14)} ${r.checked}/${r.total} focusable`);
  }
  await ctx.close();
}

// --- 3. reduced motion is honoured -------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  console.log("\nprefers-reduced-motion: reduce");
  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60_000 });
    const moving = await page.evaluate(() =>
      [...document.querySelectorAll("*")]
        .filter((el) => {
          const cs = getComputedStyle(el);
          return cs.animationName !== "none" && cs.animationDuration !== "0s";
        })
        .map((el) => `${el.tagName.toLowerCase()}:${getComputedStyle(el).animationName}`)
        .slice(0, 4),
    );
    if (moving.length > 0) {
      failures.push(`${route} still animates with reduced motion requested: ${moving.join(", ")}`);
    }
    console.log(`  ${moving.length ? "✖" : "·"} ${route.padEnd(14)} ${moving.length} animating`);
  }
  await ctx.close();
}

await browser.close();

if (failures.length > 0) {
  console.error(`\nRender check FAILED — ${failures.length} problem(s):\n`);
  for (const failure of failures) console.error(`  ✖ ${failure}`);
  console.error("");
  process.exit(1);
}

console.log(
  `\nRender check passed: ${ROUTES.length} routes, no horizontal scroll at 390px or 1280px, ` +
    `a visible focus ring on every interactive element, and no animation when reduced motion is requested.`,
);
