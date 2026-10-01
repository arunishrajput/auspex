// Narration: Amazon Polly, voice Matthew, generative engine. One clip per scene so each scene's
// length is set by its own line, then durations go to src/data/timings.json for the composition.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const lines = JSON.parse(fs.readFileSync("script/vo.json", "utf8"));
const only = process.argv.slice(2);
const timings = fs.existsSync("src/data/timings.json") ? JSON.parse(fs.readFileSync("src/data/timings.json")) : {};
for (const { id, ssml } of lines) {
  const out = `public/vo/${id}.mp3`;
  if (!only.length || only.includes(id)) {
    execFileSync("aws", ["polly", "synthesize-speech", "--engine", "generative", "--voice-id", "Matthew",
      "--output-format", "mp3", "--sample-rate", "24000", "--text-type", "ssml",
      "--text", `<speak>${ssml}</speak>`, out], { stdio: "ignore" });
  }
  const d = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString());
  timings[id] = Math.round(d * 1000) / 1000;
  console.log(id.padEnd(11), d.toFixed(2) + "s");
}
fs.writeFileSync("src/data/timings.json", JSON.stringify(timings, null, 2));
console.log("total", Object.values(timings).reduce((a, b) => a + b, 0).toFixed(1) + "s");
