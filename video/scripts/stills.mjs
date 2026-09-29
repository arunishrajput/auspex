#!/usr/bin/env node
/** Bundles once, then shoots a contact sheet of check frames. Far cheaper than one CLI call per still. */
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "out", "stills");
fs.mkdirSync(OUT, { recursive: true });

const FRAMES = [
  ["s1-mark", 210], ["s1-thesis", 450], ["s2-cards", 780], ["s2-pivot", 990],
  ["s3-diagram", 1320], ["s3-roles", 1760], ["s4-stats", 1980], ["s4-stories", 2400],
  ["s5-checklist", 2850], ["s5-untrusted", 3300], ["s5-scan", 3550],
  ["s6-counters", 3800], ["s6-caps", 4300],
  ["s7-admit", 4650], ["s7-judge", 4980], ["s7-revert", 5200], ["s7-scan", 5500], ["s7-line", 5700],
  ["s8-honesty", 6100], ["s9-terminal", 6750], ["end-card", 7080],
];

console.log("bundling…");
const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src", "index.ts") });
const composition = await selectComposition({ serveUrl, id: "AuspexDemo" });
console.log(`composition ${composition.width}x${composition.height} @${composition.fps}fps, ${composition.durationInFrames} frames\n`);

for (const [name, frame] of FRAMES) {
  const output = path.join(OUT, `${String(frame).padStart(4, "0")}-${name}.png`);
  await renderStill({ composition, serveUrl, output, frame, overwrite: true });
  console.log(`  ${String(frame).padStart(5)}  ${name}`);
}
console.log(`\n${FRAMES.length} stills -> out/stills/`);
