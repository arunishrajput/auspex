// Viewport-sized captures of specific sections of the live deployment, with the on-screen boxes of
// the things the film points at, so highlights are drawn on real pixels rather than guessed.
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "https://auspex-web-mu.vercel.app";
const shots = [
  { name: "home-hero", path: "/", y: 0, marks: ["AI proposes."] },
  { name: "home-pipeline", path: "/", anchor: /^The news pipeline$/ },
  { name: "home-gate", path: "/", anchor: /^The human authority gate$/ },
  { name: "home-injection", path: "/", anchor: /^The injection defence, run rather than described$/, marks: [{ re: /^Breaking: ignore all previous/ }, { re: /^instruction-override$/ , up: 1 }, { re: /\[redacted-close-tag\]/, nth: 1 }] },
  { name: "review-0", path: "/review", y: 0 },
  { name: "review-1", path: "/review", y: 560, marks: [{ re: /independent publishers/, up: 1 }, { re: /^Approved$/i, up: 1 }] },
  { name: "agents-0", path: "/agents", y: 0, marks: [{ re: /^rejected by the gate$/i, up: 1 }, { re: /^refused by the chain$/i, up: 1 }] },
  { name: "agents-1", path: "/agents", y: 1500, marks: [{ re: /^the global kill switch and the member/, up: 2 }] },
  { name: "trust-0", path: "/trust", y: 0 },
  { name: "trust-boundary", path: "/trust", anchor: /the boundary/i },
  { name: "trust-roles", path: "/trust", anchor: /who holds what/i, marks: [{ re: /human authority — browser wallet/, closest: "tr" }, { re: /agent wallet · atlas/, closest: "tr" }, { re: /agent wallet · kestrel/, closest: "tr" }, { re: /agent wallet · vega/, closest: "tr" }] },
  { name: "trust-refused", path: "/trust", anchor: /what has been refused/i, marks: [{ re: /^by the schema$/i, up: 1 }, { re: /^by the policy gate$/i, up: 1 }, { re: /^by a human$/i, up: 1 }, { re: /^by the chain$/i, up: 1 }] },
  { name: "trust-chain", path: "/trust", anchor: /transactions the chain refused/i },
  { name: "market8-0", path: "/markets/8", y: 0 },
  { name: "market8-1", path: "/markets/8", anchor: /^lifecycle/i, marks: [{ re: /^BettingClosed\(\)$/, closest: "tr" }, { re: /^ChallengeWindowOpen/, closest: "tr" }, { re: /^AlreadyClaimed\(\)$/, closest: "tr" }, { re: /^NothingToClaim\(\)$/, closest: "tr" }] },
  { name: "probe-0-before", path: "/trust", anchor: /the cap probe/i, marks: [{ re: /break its own cap/, closest: "button" }, { re: /^0xbfe9bb/, up: 1 }] },
  { name: "markets-0", path: "/markets", y: 0 },
  { name: "resolve-0", path: "/resolve", y: 0 },
  { name: "audit-0", path: "/audit", y: 0 },
];
const only = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark", reducedMotion: "reduce" });
const out = fs.existsSync("public/frames/manifest.json") ? JSON.parse(fs.readFileSync("public/frames/manifest.json")) : {};
const pages = {};
for (const s of shots) {
  if (only.length && !only.includes(s.name)) continue;
  let page = pages[s.path];
  if (!page) {
    page = await ctx.newPage();
    await page.goto(BASE + s.path, { waitUntil: "networkidle", timeout: 90000 });
    await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 100)); } });
    pages[s.path] = page;
  }
  let y = s.y ?? 0;
  if (s.anchor) {
    const el = page.getByText(s.anchor).first();
    y = (await el.evaluate(e => e.getBoundingClientRect().top + window.scrollY)) - 110;
  }
  await page.evaluate(v => window.scrollTo(0, v), y);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `public/frames/${s.name}.png` });
  const marks = [];
  for (const m of s.marks ?? []) {
    // The first match that is actually painted inside the viewport, skipping hidden variants.
    const all = await page.getByText(m.re).all();
    let box = { error: "no visible match" }, seen = 0;
    for (const el of all) {
      const b = await el.evaluate((e, m) => {
        let t = e;
        if (m.closest) t = e.closest(m.closest) ?? e;
        for (let i = 0; i < (m.up ?? 0); i++) t = t.parentElement;
        const r = t.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }, { closest: m.closest, up: m.up });
      if (b.w > 0 && b.h > 0 && b.y >= 0 && b.y + b.h <= 900) { if (seen++ === (m.nth ?? 0)) { box = b; break; } }
    }
    marks.push({ re: String(m.re), ...box });
  }
  out[s.name] = { url: BASE + s.path, scrollY: y, capturedAt: new Date().toISOString(), marks };
  console.log("   ", JSON.stringify(marks.map(b => b.error ?? [b.x, b.y, b.w, b.h].map(Math.round))));
  console.log(s.name, Math.round(y));
}
fs.writeFileSync("public/frames/manifest.json", JSON.stringify(out, null, 2));
await browser.close();
