import React from "react";
import { AbsoluteFill, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import { rise } from "../anim";
import { C, display, mono, sans } from "../theme";

/** The product's backdrop: near-black, a faint instrument grid, one warm pool of accent light. */
export const Backdrop: React.FC<{ glow?: number; glowX?: number; glowY?: number }> = ({ glow = 1, glowX = 50, glowY = -10 }) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 90) * 3;
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${C.line}55 1px, transparent 1px), linear-gradient(90deg, ${C.line}55 1px, transparent 1px)`,
          backgroundSize: "64px 64px",
          backgroundPosition: `${drift}px ${frame * 0.15}px`,
          maskImage: "radial-gradient(ellipse 80% 70% at 50% 40%, black 30%, transparent 85%)",
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 60% 45% at ${glowX + drift}% ${glowY}%, ${C.accent}${Math.round(0x38 * glow).toString(16).padStart(2, "0")}, transparent 70%)`,
        }}
      />
      <Grain />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 100% 100% at 50% 50%, transparent 55%, #000000aa 100%)" }} />
    </AbsoluteFill>
  );
};

/** Film grain: a static noise texture nudged every two frames. Cheap, and it kills banding. */
const Grain: React.FC = () => {
  const frame = useCurrentFrame();
  const k = Math.floor(frame / 2);
  return (
    <AbsoluteFill style={{ opacity: 0.07, mixBlendMode: "overlay", pointerEvents: "none" }}>
      <svg width="100%" height="100%">
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={k % 17} />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" transform={`translate(${random(k) * 40 - 20} ${random(k + 1) * 40 - 20})`} />
      </svg>
    </AbsoluteFill>
  );
};

/** The app's section eyebrow: a small orange square, a number, a mono caps label. */
export const Eyebrow: React.FC<{ n: string; label: string; start?: number; style?: React.CSSProperties }> = ({ n, label, start = 0, style }) => {
  const frame = useCurrentFrame();
  const t = rise(frame, start, 20);
  return (
    <div
      style={{
        position: "absolute", left: 96, top: 34, display: "flex", alignItems: "center", gap: 16,
        fontFamily: mono, fontSize: 20, letterSpacing: "0.22em", color: C.t400, textTransform: "uppercase",
        opacity: t, translate: `${(1 - t) * -30}px 0px`, ...style,
      }}
    >
      <span style={{ width: 11, height: 11, background: C.accent, display: "inline-block" }} />
      <span style={{ color: C.accent2 }}>{n}</span>
      <span>{label}</span>
    </div>
  );
};

type Tone = "ok" | "warn" | "signal" | "bad" | "human" | "accent" | "quiet";
export const toneColor = (t: Tone) => (t === "quiet" ? C.t400 : C[t]);

export const Chip: React.FC<{ tone: Tone; children: React.ReactNode; size?: number; style?: React.CSSProperties; solid?: boolean }> = ({ tone, children, size = 20, style, solid }) => {
  const c = toneColor(tone);
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 8, fontFamily: mono, fontSize: size, letterSpacing: "0.08em",
        textTransform: "uppercase", color: solid ? C.bg : c, background: solid ? c : `${c}1f`, border: `1.5px solid ${c}88`,
        padding: `${size * 0.3}px ${size * 0.6}px`, borderRadius: 6, whiteSpace: "nowrap", fontWeight: 500, ...style,
      }}
    >
      {children}
    </span>
  );
};

/** The AuspeX mark, from web/app/icon.svg: three proposals in, one gate, one decision out. */
export const Mark: React.FC<{ size: number; progress?: number }> = ({ size, progress = 1 }) => {
  const p = (a: number, b: number) => Math.max(0, Math.min(1, (progress - a) / (b - a)));
  return (
    <svg viewBox="0 0 32 32" width={size} height={size}>
      <rect width="32" height="32" rx="7" fill={C.s900} />
      <rect x="0.5" y="0.5" width="31" height="31" rx="6.5" fill="none" stroke={C.line} />
      {[["M7 9h8", 8], ["M7 16h12", 12], ["M7 23h8", 8]].map(([d, len], i) => (
        <path key={i} d={d as string} stroke={C.signal} strokeWidth="2.5" strokeLinecap="round" fill="none"
          strokeDasharray={len as number} strokeDashoffset={(len as number) * (1 - p(0.1 * i, 0.1 * i + 0.4))} />
      ))}
      <path d="M23 6v20" stroke={C.human} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={20} strokeDashoffset={20 * (1 - p(0.35, 0.7))} />
      <circle cx="23" cy="16" r={3.5 * p(0.6, 0.9)} fill={C.ok} />
    </svg>
  );
};

/** Words that arrive one by one, each sliding up out of a mask. */
export const Reveal: React.FC<{
  text: string; start: number; stagger?: number; style?: React.CSSProperties; colorFor?: (w: string, i: number) => string | undefined;
}> = ({ text, start, stagger = 3, style, colorFor }) => {
  const frame = useCurrentFrame();
  const words = text.split(" ");
  return (
    <span style={{ display: "inline", ...style }}>
      {words.map((w, i) => {
        const t = rise(frame, start + i * stagger, 16);
        return (
          <span key={i} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "bottom", paddingBottom: "0.08em", marginBottom: "-0.08em" }}>
            <span style={{ display: "inline-block", translate: `0px ${(1 - t) * 105}%`, opacity: t, color: colorFor?.(w, i) }}>
              {w}
              {i < words.length - 1 ? " " : ""}
            </span>
          </span>
        );
      })}
    </span>
  );
};

/** A fade/scale in at the start and a fade out at the end of every scene, so no cut is bare. */
export const SceneShell: React.FC<{ children: React.ReactNode; glow?: number; glowX?: number; glowY?: number }> = ({ children, glow, glowX, glowY }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const inT = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const outT = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <AbsoluteFill>
      <Backdrop glow={glow} glowX={glowX} glowY={glowY} />
      <AbsoluteFill style={{ opacity: Math.min(inT, outT), scale: String(1 + (1 - inT) * 0.015) }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Big: React.FC<{ children: React.ReactNode; size?: number; style?: React.CSSProperties }> = ({ children, size = 96, style }) => (
  <div style={{ fontFamily: display, fontWeight: 800, fontSize: size, lineHeight: 0.98, letterSpacing: "-0.04em", color: C.t100, ...style }}>{children}</div>
);

export const Body: React.FC<{ children: React.ReactNode; size?: number; style?: React.CSSProperties }> = ({ children, size = 34, style }) => (
  <div style={{ fontFamily: sans, fontSize: size, lineHeight: 1.35, color: C.t300, ...style }}>{children}</div>
);

export const MonoText: React.FC<{ children: React.ReactNode; size?: number; color?: string; style?: React.CSSProperties }> = ({ children, size = 24, color = C.t300, style }) => (
  <span style={{ fontFamily: mono, fontSize: size, color, ...style }}>{children}</span>
);
