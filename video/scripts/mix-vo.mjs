#!/usr/bin/env node
/** Flattens the per-line Polly clips into one voiceover track, with the scripted pauses baked in. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const t = JSON.parse(fs.readFileSync(path.join(ROOT, "script", "timings.json"), "utf8"));
const TMP = path.join(ROOT, "audio", ".tmp");
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const ff = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
const parts = [];
let i = 0;

for (const scene of t.scenes) {
  for (const line of scene.lines) {
    const wav = path.join(TMP, `${String(i).padStart(3, "0")}a.wav`);
    ff(["-i", path.join(ROOT, line.file), "-ar", "48000", "-ac", "2", wav]);
    parts.push(wav);
    if (line.pad > 0) {
      const sil = path.join(TMP, `${String(i).padStart(3, "0")}b.wav`);
      ff(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(line.pad), sil]);
      parts.push(sil);
    }
    i++;
  }
}

const list = path.join(TMP, "list.txt");
fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
const out = path.join(ROOT, "audio", "vo-full.wav");
ff(["-f", "concat", "-safe", "0", "-i", list, "-c:a", "pcm_s16le", out]);
fs.rmSync(TMP, { recursive: true, force: true });

const dur = parseFloat(
  execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out], { encoding: "utf8" }).trim()
);
console.log(`vo-full.wav  ${dur.toFixed(2)}s   (timings.json says ${t.total.toFixed(2)}s, drift ${(dur - t.total).toFixed(3)}s)`);
