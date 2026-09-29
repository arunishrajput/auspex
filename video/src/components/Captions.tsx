import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { C, SANS } from "../theme";
import timings from "../../script/timings.json";

type Line = { text: string; start: number; end: number };
const LINES: Line[] = timings.scenes.flatMap((s: any) => s.lines.map((l: any) => ({ text: l.text, start: l.start, end: l.end })));

/** Burned-in captions, timed from the same measured clip durations the edit uses. */
export const Captions: React.FC<{ suppress?: [number, number][] }> = ({ suppress = [] }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  if (suppress.some(([a, b]) => t >= a && t < b)) return null;

  const line = LINES.find((l) => t >= l.start - 0.12 && t < l.end + 0.32);
  if (!line) return null;

  const age = t - (line.start - 0.12);
  const opacity = Math.min(1, age / 0.14);

  return (
    <div
      style={{
        position: "absolute", left: 0, right: 0, bottom: 62,
        display: "flex", justifyContent: "center", padding: "0 190px",
      }}
    >
      <div
        style={{
          fontFamily: SANS, fontSize: 32, lineHeight: 1.42, color: C.ink100,
          textAlign: "center", textWrap: "balance", opacity,
          textShadow: "0 2px 18px rgba(7,9,13,0.95), 0 0 42px rgba(7,9,13,0.8)",
        }}
      >
        {line.text}
      </div>
    </div>
  );
};
