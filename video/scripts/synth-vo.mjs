#!/usr/bin/env node
/**
 * Cuts the voiceover with Amazon Polly, one clip per scripted line, and measures
 * each clip so the composition can derive its own timing.
 *
 * Why per line rather than per scene: the measured duration of every line is what
 * drives both scene lengths and caption timings, so sync is exact by construction
 * and no transcription step is needed.
 *
 * Synthesis is cached on a hash of (text, voice, engine). Re-running after a script
 * edit only re-cuts the lines that actually changed.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "script", "script.json");
const VO_DIR = path.join(ROOT, "audio", "vo");
const CACHE = path.join(VO_DIR, ".cache.json");

const spec = JSON.parse(fs.readFileSync(SCRIPT, "utf8"));
const voice = process.env.VOICE_ID || spec.voice.id;
const engine = process.env.VOICE_ENGINE || spec.voice.engine;
const region = spec.voice.region;

fs.mkdirSync(VO_DIR, { recursive: true });
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};

const durationOf = (file) =>
  parseFloat(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], {
      encoding: "utf8",
    }).trim()
  );

let synthesized = 0;
let reused = 0;
const timings = { voice, engine, fps: spec.fps, scenes: [] };
let cursor = 0;

for (const scene of spec.scenes) {
  const sceneEntry = { id: scene.id, beat: scene.beat, visual: scene.visual, shots: scene.shots ?? [], start: cursor, lines: [] };

  for (const [i, line] of scene.lines.entries()) {
    const file = path.join(VO_DIR, `${scene.id}-${String(i).padStart(2, "0")}.mp3`);
    const key = createHash("sha256").update(`${voice}|${engine}|${line.text}`).digest("hex").slice(0, 16);

    if (!(cache[file] === key && fs.existsSync(file))) {
      execFileSync("aws", [
        "polly", "synthesize-speech",
        "--region", region,
        "--engine", engine,
        "--voice-id", voice,
        "--output-format", "mp3",
        "--sample-rate", "24000",
        "--text", line.text,
        file,
      ], { stdio: ["ignore", "ignore", "pipe"] });
      cache[file] = key;
      synthesized++;
    } else {
      reused++;
    }

    const speech = durationOf(file);
    const pad = line.padAfter ?? 0;
    sceneEntry.lines.push({
      file: path.relative(ROOT, file),
      text: line.text,
      start: +cursor.toFixed(3),
      speech: +speech.toFixed(3),
      pad,
      end: +(cursor + speech).toFixed(3),
    });
    cursor += speech + pad;
  }

  sceneEntry.end = +cursor.toFixed(3);
  sceneEntry.duration = +(sceneEntry.end - sceneEntry.start).toFixed(3);
  sceneEntry.frames = Math.round(sceneEntry.duration * spec.fps);
  timings.scenes.push(sceneEntry);
}

timings.total = +cursor.toFixed(3);
timings.totalFrames = Math.round(cursor * spec.fps);
fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));
fs.writeFileSync(path.join(ROOT, "script", "timings.json"), JSON.stringify(timings, null, 2));

// SRT, from the same measured timings the video uses
const srt = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
};
let n = 0;
const cues = timings.scenes.flatMap((s) => s.lines).map((l) => `${++n}\n${srt(l.start)} --> ${srt(l.end)}\n${l.text}\n`);
fs.mkdirSync(path.join(ROOT, "out"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "out", "AuspeX-demo.srt"), cues.join("\n"));

const mm = Math.floor(timings.total / 60), ss = (timings.total % 60).toFixed(1);
console.log(`voice ${voice} (${engine})   synthesized ${synthesized}, reused ${reused}`);
console.log("");
for (const s of timings.scenes) {
  console.log(`  ${s.id.padEnd(14)} ${String(s.duration.toFixed(1)).padStart(6)}s  ${String(s.frames).padStart(5)}f`);
}
console.log("");
console.log(`  TOTAL          ${String(timings.total.toFixed(1)).padStart(6)}s  = ${mm}m ${ss}s  (${timings.totalFrames} frames)`);
