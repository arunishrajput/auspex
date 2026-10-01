import { chromium } from "playwright";
import fs from "node:fs";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
await ctx.route(/slise|czilladx|walletconnect|web3modal|cloudflareinsights/, r => r.abort());
const p = await ctx.newPage();
const out = JSON.parse(fs.readFileSync("public/frames/manifest.json"));
for (const [name, hash, picks] of [
  ["scan-revert", "0xbfe9bb2c3ffee4be2f660473b3de916380f5d10da8548173d44810118ced060a", [/^Failed$/, /AgentPerTxCapExceeded/, /^20000000000000001$/, /^20000000000000000$/]],
  ["scan-create", "0x2e70a1cbe7bd72b33e68afdc4742c0416b2eee3ed3ed4297bf938d2be825a504", [/^Success$/, /^createMarket$/, /^0xA9F68fDf84388fa548a685085E2bee0e5b311fF1$/i]],
]) {
  await p.goto(`https://testnet.mstscan.com/tx/${hash}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await p.waitForTimeout(10000);
  await p.screenshot({ path: `public/frames/${name}.png` });
  const marks = [];
  for (const re of picks) {
    let box = { error: "none" };
    for (const el of await p.getByText(re).all()) {
      const r = await el.boundingBox();
      if (r && r.y > 0 && r.y < 900) { box = { x: r.x, y: r.y, w: r.width, h: r.height }; break; }
    }
    marks.push({ re: String(re), ...box });
  }
  out[name] = { url: p.url(), capturedAt: new Date().toISOString(), marks };
  console.log(name, JSON.stringify(marks.map(m => m.error ?? [m.x, m.y, m.w, m.h].map(Math.round))));
}
fs.writeFileSync("public/frames/manifest.json", JSON.stringify(out, null, 2));
await b.close();
