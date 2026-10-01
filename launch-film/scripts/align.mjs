// Phrase timings for each narration clip, from the pauses Polly actually left (ffmpeg silencedetect).
// Polly's generative engine has no speech marks, so phrase boundaries are snapped to the nearest
// real pause and words are spread across their phrase by length. Drives captions and animation cues.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const lines = JSON.parse(fs.readFileSync("script/vo.json", "utf8"));
const display = s => s
  .replace(/<sub alias="[^"]*">([^<]*)<\/sub>/g, "$1")
  .replace(/<break[^>]*\/>/g, " ")
  .replace(/Agent per T X cap exceeded/g, "AgentPerTxCapExceeded")
  .replace(/\bAuspex\b/g, "AuspeX")
  .replace(/\s+/g, " ").trim();

const out = {};
for (const { id, ssml } of lines) {
  const file = `public/vo/${id}.mp3`;
  const dur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());
  const err = (() => { try { return execFileSync("sh", ["-c", `ffmpeg -hide_banner -i "${file}" -af silencedetect=noise=-38dB:d=0.12 -f null - 2>&1`]).toString(); } catch (e) { return e.stdout.toString(); } })();
  const st = [...err.matchAll(/silence_start: ([\d.]+)/g)].map(m => +m[1]);
  const en = [...err.matchAll(/silence_end: ([\d.]+)/g)].map(m => +m[1]);
  const sil = st.map((s, i) => [s, en[i] ?? dur]);
  const speechStart = sil.length && sil[0][0] < 0.05 ? sil[0][1] : 0.0;
  const lastSil = sil.length && sil[sil.length - 1][1] >= dur - 0.05 ? sil[sil.length - 1][0] : dur;
  const pauses = sil.filter(([a, b]) => a > speechStart + 0.05 && b < dur - 0.05).map(([a, b]) => ({ a, b, m: (a + b) / 2, used: false }));

  const text = display(ssml);
  const phrases = text.split(/(?<=[.,:?!])\s+/).filter(Boolean);
  const speechTotal = (lastSil - speechStart) - pauses.reduce((s, p) => s + (p.b - p.a), 0);
  const totalChars = phrases.reduce((s, p) => s + p.length, 0);
  // expected boundary times by character share of speaking time, then snapped to a real pause
  let acc = 0, minT = speechStart;
  const bounds = [];
  for (let i = 0; i < phrases.length - 1; i++) {
    acc += phrases[i].length;
    const speechT = speechTotal * acc / totalChars;
    let t = speechStart, rem = speechT;
    // walk speech time across pauses to wall-clock time
    let cursor = speechStart;
    for (const p of pauses) { const seg = p.a - cursor; if (rem <= seg) break; rem -= seg; cursor = p.b; }
    t = cursor + rem;
    const cand = pauses.filter(p => !p.used && p.m > minT).sort((x, y) => Math.abs(x.m - t) - Math.abs(y.m - t))[0];
    if (cand && Math.abs(cand.m - t) < 1.2) { cand.used = true; bounds.push({ end: cand.a, start: cand.b }); minT = cand.m; }
    else { bounds.push({ end: t, start: t }); minT = t; }
  }
  const ph = phrases.map((p, i) => ({
    text: p,
    start: +(i === 0 ? speechStart : bounds[i - 1].start).toFixed(3),
    end: +(i === phrases.length - 1 ? lastSil : bounds[i].end).toFixed(3),
  }));
  const ov = JSON.parse(fs.readFileSync("script/align-overrides.json", "utf8"))[id];
  if (ov) { if (ov.length !== ph.length) throw new Error(`${id}: override has ${ov.length} bounds for ${ph.length} phrases`); ov.forEach(([a, b], i) => { ph[i].start = a; ph[i].end = b; }); }
  for (const p of ph) {
    const words = p.text.split(" "); const n = words.reduce((s, w) => s + w.length + 1, 0);
    let c = 0;
    p.words = words.map(w => { const s = p.start + (p.end - p.start) * c / n; c += w.length + 1; return { w, start: +s.toFixed(3), end: +(p.start + (p.end - p.start) * c / n).toFixed(3) }; });
  }
  out[id] = { duration: dur, phrases: ph };
  console.log(`\n${id} ${dur.toFixed(2)}s`); ph.forEach((p, i) => console.log(`  ${i} ${p.start.toFixed(2)}-${p.end.toFixed(2)} ${p.text}`));
}
fs.writeFileSync("src/data/captions.json", JSON.stringify(out, null, 1));
