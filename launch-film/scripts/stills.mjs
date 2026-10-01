// Renders review stills at given (scene, seconds-into-scene) points, from one bundle.
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import fs from "node:fs";
import path from "node:path";
const tl = JSON.parse(fs.readFileSync("src/data/timeline.json"));
const outDir = process.argv[2];
const points = process.argv.slice(3).map((p) => { const [id, s] = p.split("@"); const sc = tl.scenes.find((x) => x.id === id); return { name: `${id}-${s}`, frame: sc.from + Math.round(+s * tl.fps) }; });
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const composition = await selectComposition({ serveUrl, id: "AuspexFilm" });
for (const p of points) {
  await renderStill({ composition, serveUrl, frame: p.frame, output: `${outDir}/${p.name}.jpg`, imageFormat: "jpeg", scale: 0.5 });
  console.log(p.name, p.frame);
}
