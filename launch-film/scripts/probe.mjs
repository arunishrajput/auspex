// Presses the public cap probe on /trust once, the way any visitor can, and captures what happens:
// the button, the pending state, the result panel, and the resulting transaction on MSTScan.
// The hash is then re-read from the explorer API; the film refuses to use it unless it reverted.
import { chromium } from "playwright";
import fs from "node:fs";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark", reducedMotion: "reduce" });
await ctx.route(/slise|czilladx|walletconnect|web3modal|cloudflareinsights/, r => r.abort());
const page = await ctx.newPage();
await page.goto("https://auspex-web-mu.vercel.app/trust", { waitUntil: "networkidle", timeout: 90000 });
const head = page.getByText(/the cap probe/i).first();
const y = (await head.evaluate(e => e.getBoundingClientRect().top + window.scrollY)) - 110;
await page.evaluate(v => window.scrollTo(0, v), y);
await page.waitForTimeout(800);
await page.screenshot({ path: "public/frames/probe-0-before.png" });
const btn = page.getByRole("button", { name: /break its own cap/i });
const bb = await btn.boundingBox();
await btn.click();
await page.waitForTimeout(1200);
await page.screenshot({ path: "public/frames/probe-1-pending.png" });
const status = page.locator("[role=status]").filter({ hasText: /your transaction|not run/i });
await status.first().waitFor({ timeout: 90000 });
await page.waitForTimeout(800);
await page.evaluate(v => window.scrollTo(0, v + 60), y);
await page.waitForTimeout(500);
await page.screenshot({ path: "public/frames/probe-2-result.png" });
const text = await status.first().innerText();
const hash = (text.match(/0x[0-9a-fA-F]{64}/) || [null])[0];
console.log(text);
const res = { pressedAt: new Date().toISOString(), button: bb, scrollY: y, panelText: text, txHash: hash };
if (hash) {
  await page.waitForTimeout(8000);
  const scan = await ctx.newPage();
  await scan.goto(`https://testnet.mstscan.com/tx/${hash}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await scan.waitForTimeout(10000);
  await scan.screenshot({ path: "public/frames/probe-3-scan.png" });
  const api = await (await fetch(`https://testnet.mstscan.com/api/v2/transactions/${hash}`)).json();
  res.explorer = { status: api.status, result: api.result, revert_reason: api.revert_reason, block: api.block_number ?? api.block, from: api.from?.hash, to: api.to?.hash, method: api.method };
  console.log(JSON.stringify(res.explorer, null, 2));
}
fs.writeFileSync("public/frames/probe.json", JSON.stringify(res, null, 2));
await browser.close();
