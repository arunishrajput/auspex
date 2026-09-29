#!/usr/bin/env node
/**
 * Captures the footage: real pixels from the live deployment and from MSTScan.
 *
 * Two design choices worth knowing:
 *
 *  - Full-page stills, not video. Scroll motion is authored later as a pan over the
 *    tall image, which is smoother than any encoder and costs nothing to re-time.
 *
 *  - Shots are located by the text on the page, and their bounding boxes are written
 *    into the manifest. The composition frames from those numbers, so no CSS selector
 *    is hard-coded here and a restyle cannot silently mis-frame a shot.
 *
 * Nothing is clicked and nothing is altered. This only reads.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "assets", "captured");
const SITE = "https://auspex-web-mu.vercel.app";
const SCAN = "https://testnet.mstscan.com";
const SCALE = 2;          // deviceScaleFactor: 2560px wide raw, headroom for 1.3x zooms at 1080p
const MAX_CSS_H = 6000;   // clip absurdly tall pages; every framing target sits well above this

const PAGES = [
  {
    name: "home", url: `${SITE}/`, settle: "Articles",
    anchors: {
      "home-stats":   "Articles",
      "home-gate":    "Human authority gate",
      "home-stories": "Stories, and the articles behind them",
    },
  },
  {
    name: "trust", url: `${SITE}/trust`, settle: "The boundary",
    anchors: {
      "trust-boundary": "An LLM may only propose",
      "trust-roles":    "Who holds what, according to the contract",
      "trust-kill":     "Kill switches",
      "trust-judge":    "Judge mode",
      "trust-refused":  "Transactions the chain refused",
    },
  },
  {
    name: "review", url: `${SITE}/review`, settle: "Review",
    anchors: {
      "review-checklist": "Spec hash",
      "review-untrusted": "UNTRUSTED",
    },
  },
  {
    name: "agents", url: `${SITE}/agents`, settle: "Member agents",
    anchors: {
      "agents-counters": "refused by the chain",
      "agents-caps":     "on-chain per-tx cap",
      "agents-refusals": "atlas",
    },
  },
  { name: "audit", url: `${SITE}/audit`, settle: "Audit", anchors: {} },
  { name: "market8", url: `${SITE}/markets/8`, settle: "Market", anchors: {} },
  {
    name: "scan-revert",
    url: `${SCAN}/tx/0xbfe9bb2c3ffee4be2f660473b3de916380f5d10da8548173d44810118ced060a`,
    settle: "AgentPerTxCapExceeded",
    anchors: { "scan-revert-error": "AgentPerTxCapExceeded" },
  },
  {
    name: "scan-createmarket",
    url: `${SCAN}/tx/0x2e70a1cbe7bd72b33e68afdc4742c0416b2eee3ed3ed4297bf938d2be825a504`,
    settle: "Success",
    anchors: {},
  },
  {
    name: "scan-contract",
    url: `${SCAN}/address/0xc4743d6295311AFead12161881Bfcf601B70104C?tab=contract`,
    settle: "AuspexMarket",
    anchors: {},
  },
];

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: SCALE,
  colorScheme: "dark",
  reducedMotion: "reduce",   // freeze the pulsing dot so stills are deterministic
});

const manifest = { site: SITE, scale: SCALE, capturedAt: new Date().toISOString(), shots: {} };

for (const spec of PAGES) {
  const page = await ctx.newPage();
  process.stdout.write(`${spec.name.padEnd(18)}`);
  try {
    // The explorer sells a sponsored slot, and what it served during capture was a
    // gambling ad. Block off-origin subresources so it never renders, then hide the
    // empty frame it leaves behind.
    const origin = new URL(spec.url).origin;
    await page.route("**/*", (route) => {
      const u = route.request().url();
      if (u.startsWith(origin) || u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
      const type = route.request().resourceType();
      if (type === "document" || type === "script" || type === "xhr" || type === "fetch") return route.continue();
      return route.abort();
    });
    // Pre-warm: Neon scales to zero, so the first hit can take 10-25s. Load, then reload
    // so what we photograph is a warm, fully-settled page.
    await page.goto(spec.url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(2500);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });

    try {
      await page.getByText(spec.settle, { exact: false }).first().waitFor({ timeout: 45000 });
    } catch {
      process.stdout.write(`\x1b[33m settle-text missing \x1b[0m`);
    }
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    // Blocking the ad leaves an empty "Sponsored" row that no framing avoids cleanly.
    // Drop the row itself so the layout closes up.
    await page.evaluate(() => {
      const leaves = Array.from(document.querySelectorAll("*")).filter(
        (e) => e.children.length === 0 && e.textContent.trim() === "Sponsored"
      );
      for (const leaf of leaves) {
        let n = leaf.parentElement;
        for (let i = 0; i < 6 && n; i++) {
          if (n.getBoundingClientRect().height > 80) { n.remove(); break; }
          n = n.parentElement;
        }
      }
    }).catch(() => {});

    await page.addStyleTag({
      content: `iframe, ins, [class*="banner" i], [id*="banner" i], [class*="-ad-" i], [data-testid*="ad" i] {
        display: none !important;
      }`,
    }).catch(() => {});
    await page.waitForTimeout(1200);

    const cssH = await page.evaluate(() => document.documentElement.scrollHeight);
    const clipH = Math.min(cssH, MAX_CSS_H);
    const file = path.join(OUT, `${spec.name}.png`);

    // fullPage is required: a clip alone is bounded by the viewport, which silently
    // yields an 800px-tall image of a 5000px page.
    await page.screenshot({ path: file, fullPage: true });

    // Trim the tail rather than carry a 12000px image the edit never frames.
    if (cssH > clipH) {
      const tmp = file.replace(/\.png$/, ".full.png");
      fs.renameSync(file, tmp);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", tmp,
        "-vf", `crop=${1280 * SCALE}:${clipH * SCALE}:0:0`, file]);
      fs.unlinkSync(tmp);
    }

    const [pw, ph] = execFileSync("ffprobe",
      ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", file],
      { encoding: "utf8" }).trim().split(",").map(Number);
    if (pw !== 1280 * SCALE) throw new Error(`unexpected capture width ${pw}`);

    // Locate each anchor by its text, then take the bounding box of the nearest card-like
    // ancestor. Recorded in CSS px; the composition multiplies by scale.
    const boxes = {};
    for (const [shot, text] of Object.entries(spec.anchors)) {
      try {
        const loc = page.getByText(text, { exact: false }).first();
        await loc.waitFor({ timeout: 8000 });
        const box = await loc.evaluate((el) => {
          const card = el.closest("section, article, li, [class*='rounded-lg'], [class*='rounded-md']") ?? el;
          const r = card.getBoundingClientRect();
          return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height };
        });
        boxes[shot] = {
          x: Math.round(box.x), y: Math.round(box.y),
          w: Math.round(box.w), h: Math.round(box.h),
        };
      } catch {
        boxes[shot] = null;
      }
    }

    manifest.shots[spec.name] = {
      url: spec.url,
      file: path.relative(ROOT, file),
      cssWidth: 1280,
      cssHeight: ph / SCALE,
      fullCssHeight: cssH,
      pxWidth: 1280 * SCALE,
      pxHeight: ph,
      capturedAt: new Date().toISOString(),
      anchors: boxes,
    };

    const found = Object.values(boxes).filter(Boolean).length;
    const total = Object.keys(boxes).length;
    const kb = Math.round(fs.statSync(file).size / 1024);
    console.log(`\x1b[32mok\x1b[0m  ${String(clipH).padStart(5)}css  ${String(kb).padStart(5)}KB  anchors ${found}/${total}`);
    if (total && found < total) {
      for (const [k, v] of Object.entries(boxes)) if (!v) console.log(`      \x1b[33mmissed anchor: ${k}\x1b[0m`);
    }
  } catch (err) {
    console.log(`\x1b[31mFAILED\x1b[0m ${err.message.split("\n")[0].slice(0, 90)}`);
    manifest.shots[spec.name] = { url: spec.url, error: err.message.split("\n")[0] };
  }
  await page.close();
}

await browser.close();
fs.writeFileSync(path.join(OUT, "capture-manifest.json"), JSON.stringify(manifest, null, 2));
const okCount = Object.values(manifest.shots).filter((s) => !s.error).length;
console.log(`\n${okCount}/${PAGES.length} pages captured -> assets/captured/capture-manifest.json`);
