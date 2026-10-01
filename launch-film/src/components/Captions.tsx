import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import captions from "../data/captions.json";
import timeline from "../data/timeline.json";
import { C, sans } from "../theme";

type Word = { w: string; start: number; end: number };
type Chunk = { words: Word[]; start: number; end: number };

const MAX_WORDS = 8;

/** Burned-in captions: the narration in short chunks, the word being spoken lit up. */
const buildChunks = (fps: number): Chunk[] => {
  const out: Chunk[] = [];
  const caps = captions as Record<string, { phrases: { words: Word[] }[] }>;
  for (const s of timeline.scenes) {
    const base = (s.from + s.voFrom) / fps;
    for (const p of caps[s.id].phrases) {
      const ws = p.words.map((w) => ({ w: w.w, start: base + w.start, end: base + w.end }));
      const n = Math.ceil(ws.length / MAX_WORDS);
      const size = Math.ceil(ws.length / n);
      for (let i = 0; i < ws.length; i += size) {
        const part = ws.slice(i, i + size);
        out.push({ words: part, start: part[0].start, end: part[part.length - 1].end });
      }
    }
  }
  // hold each chunk until the next one starts if the gap is short, so captions do not flicker
  for (let i = 0; i < out.length - 1; i++) {
    const gap = out[i + 1].start - out[i].end;
    if (gap < 0.6) out[i].end = out[i + 1].start;
    else out[i].end += 0.25;
  }
  return out;
};

let cache: Chunk[] | null = null;

export const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  cache ??= buildChunks(fps);
  const t = frame / fps;
  const chunk = cache.find((c) => t >= c.start - 0.05 && t < c.end);
  if (!chunk) return null;
  const inT = interpolate(t, [chunk.start - 0.05, chunk.start + 0.1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 44, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <div
        style={{
          fontFamily: sans, fontWeight: 600, fontSize: 40, letterSpacing: "-0.01em", lineHeight: 1.2,
          padding: "12px 26px", borderRadius: 12, background: "#070709d9", border: `1px solid ${C.line}`,
          boxShadow: "0 10px 40px #000a", opacity: inT, translate: `0px ${(1 - inT) * 8}px`, maxWidth: 1500, textAlign: "center",
        }}
      >
        {chunk.words.map((w, i) => {
          const spoken = t >= w.start;
          const now = t >= w.start && t < w.end + 0.05;
          return (
            <span key={i} style={{ color: now ? C.t100 : spoken ? C.t300 : C.faint }}>
              {w.w}
              {i < chunk.words.length - 1 ? " " : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
};
