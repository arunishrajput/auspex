// out/auspex.srt (for YouTube's caption track) and the chapter list for the description,
// both from the same timeline the film was rendered from.
import fs from "node:fs";
const tl = JSON.parse(fs.readFileSync("src/data/timeline.json"));
const caps = JSON.parse(fs.readFileSync("src/data/captions.json"));
const ts = (t) => { const ms = Math.round(t * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
let n = 0, srt = "";
for (const s of tl.scenes) {
  const base = (s.from + s.voFrom) / tl.fps;
  for (const p of caps[s.id].phrases) srt += `${++n}\n${ts(base + p.start)} --> ${ts(base + p.end + 0.2)}\n${p.text}\n\n`;
}
fs.mkdirSync("out", { recursive: true });
fs.writeFileSync("out/auspex.srt", srt);
const chapters = [["hook", "The problem with AI agents and money"], ["overview", "What AuspeX is"], ["pipeline", "From headline to market"], ["review", "The human gate"], ["injection", "Untrusted by default"], ["agents", "Member agents and the policy gate"], ["layers", "Four layers that can say no"], ["probe", "The cap probe: make the chain refuse"], ["roles", "Who holds authority"], ["resolution", "Resolution and market 8"], ["audit", "The append-only record"], ["close", "Check it yourself"]];
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const lines = chapters.map(([id, title], i) => `${i === 0 ? "0:00" : mmss(tl.scenes.find((x) => x.id === id).from / tl.fps)} ${title}`);
fs.writeFileSync("out/chapters.txt", lines.join("\n") + "\n");
console.log(lines.join("\n"), `\n${n} caption cues`);
