import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C } from "../theme";

/**
 * The AuspeX mark, animated into its own meaning.
 *
 * web/app/icon.svg already encodes the thesis — "three proposals in, one decision out",
 * through a gate. Here the three bars draw in, the gate lands, and one decision leaves.
 */
export const GateMark: React.FC<{ size?: number; delay?: number }> = ({ size = 520, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = frame - delay;

  const bar = (i: number) =>
    interpolate(f, [8 + i * 7, 30 + i * 7], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const gate = interpolate(f, [34, 54], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const dot = spring({ frame: f - 56, fps, config: { damping: 11, mass: 0.7 } });
  const glow = interpolate(f, [56, 78], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const BARS = [
    { d: "M7 9h8", len: 8 },
    { d: "M7 16h12", len: 12 },
    { d: "M7 23h8", len: 8 },
  ];

  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ overflow: "visible" }}>
      <rect width="32" height="32" rx="7" fill={C.ink900} />
      <rect x="0.5" y="0.5" width="31" height="31" rx="6.5" fill="none" stroke={C.ink700} strokeWidth="0.35" />

      {BARS.map((b, i) => (
        <path
          key={i}
          d={b.d}
          stroke={C.signal}
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
          strokeDasharray={b.len}
          strokeDashoffset={b.len * (1 - bar(i))}
        />
      ))}

      <path
        d="M23 6v20"
        stroke={C.human}
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
        strokeDasharray={20}
        strokeDashoffset={20 * (1 - gate)}
      />

      <circle cx="23" cy="16" r={3.5 * Math.min(1, dot)} fill={C.ok} />
      <circle cx="23" cy="16" r={3.5 + glow * 5} fill="none" stroke={C.ok} strokeWidth="0.3" opacity={(1 - glow) * 0.8} />
    </svg>
  );
};
