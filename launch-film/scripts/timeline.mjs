// One timeline, read by both the Remotion composition and the score generator, so music hits,
// sound effects and visuals all land on the same frame. Each scene is: lead-in, its narration, tail.
import fs from "node:fs";
const FPS = 30;
const caps = JSON.parse(fs.readFileSync("src/data/captions.json", "utf8"));
const pad = {
  hook: [1.4, 0.9], title: [0.9, 1.0], overview: [0.4, 0.6], pipeline: [0.4, 1.0], review: [0.4, 0.6],
  injection: [0.4, 0.7], agents: [0.4, 0.6], layers: [0.4, 0.9], probe: [0.4, 0.4], revert: [0.3, 0.9],
  honest: [0.4, 0.6], roles: [0.4, 0.6], resolution: [0.4, 0.6], market8: [0.3, 0.6], audit: [0.4, 0.7],
  close: [0.7, 4.5],
};
let t = 0;
const scenes = [];
for (const [id, [lead, tail]] of Object.entries(pad)) {
  const vo = caps[id].duration;
  const durationInFrames = Math.round((lead + vo + tail) * FPS);
  scenes.push({ id, from: t, durationInFrames, voFrom: Math.round(lead * FPS), voDuration: vo });
  t += durationInFrames;
}
fs.writeFileSync("src/data/timeline.json", JSON.stringify({ fps: FPS, durationInFrames: t, scenes }, null, 1));
console.log(`${scenes.length} scenes, ${t} frames = ${(t / FPS).toFixed(1)}s (${Math.floor(t / FPS / 60)}:${String(Math.round(t / FPS % 60)).padStart(2, "0")})`);
