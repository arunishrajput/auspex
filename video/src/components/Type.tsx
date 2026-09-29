import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, MONO, SANS } from "../theme";

const rise = (frame: number, at: number, fps: number) => {
  const f = (at * fps);
  const o = interpolate(frame, [f, f + 13], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const y = interpolate(frame, [f, f + 18], [26, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
    easing: (x) => 1 - Math.pow(1 - x, 3),
  });
  return { opacity: o, transform: `translateY(${y}px)` };
};

export const Eyebrow: React.FC<{ children: React.ReactNode; at?: number }> = ({ children, at = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ ...rise(frame, at, fps), fontFamily: MONO, fontSize: 21, letterSpacing: "0.22em", textTransform: "uppercase", color: C.ink400, marginBottom: 30 }}>
      {children}
    </div>
  );
};

export const Headline: React.FC<{ children: React.ReactNode; at?: number; size?: number; color?: string }> = ({
  children, at = 0, size = 76, color = C.ink100,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ ...rise(frame, at, fps), fontFamily: SANS, fontSize: size, lineHeight: 1.16, fontWeight: 600, letterSpacing: "-0.022em", color, maxWidth: 1400, textWrap: "balance" }}>
      {children}
    </div>
  );
};

/** A bordered statement card, in the same shape the app uses for its panels. */
export const Card: React.FC<{
  children: React.ReactNode; at?: number; accent?: string; title?: string; dim?: boolean; width?: number;
}> = ({ children, at = 0, accent = C.ink700, title, dim = false, width }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div
      style={{
        ...rise(frame, at, fps),
        width,
        background: C.ink900,
        border: `1px solid ${accent}`,
        borderRadius: 12,
        padding: "34px 38px",
        opacity: dim ? 0.42 : (rise(frame, at, fps).opacity as number),
      }}
    >
      {title ? (
        <div style={{ fontFamily: MONO, fontSize: 17, letterSpacing: "0.2em", textTransform: "uppercase", color: accent === C.ink700 ? C.ink400 : accent, marginBottom: 18 }}>
          {title}
        </div>
      ) : null}
      <div style={{ fontFamily: SANS, fontSize: 33, lineHeight: 1.4, color: C.ink200 }}>{children}</div>
    </div>
  );
};

export const Mono: React.FC<{ children: React.ReactNode; color?: string; size?: number }> = ({
  children, color = C.signal, size = 30,
}) => <span style={{ fontFamily: MONO, fontSize: size, color }}>{children}</span>;
