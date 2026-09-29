import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, MONO } from "../theme";

export type Box = { x: number; y: number; w: number; h: number };

/**
 * A captured page, framed and drifted.
 *
 * Coordinates are the CSS pixels of the capture (the pages were shot 1280 wide at
 * deviceScaleFactor 2, so there is roughly 2x of real detail behind every frame and a
 * zoom stays sharp). `from` and `to` are focus boxes; the shot eases between them.
 */
export const Screen: React.FC<{
  src: string;
  cssWidth: number;
  cssHeight: number;
  from: Box;
  to?: Box;
  highlight?: Box | null;
  highlightColor?: string;
  highlightAt?: number;
  capturedAt?: string;
  label?: string;
}> = ({ src, cssWidth, cssHeight, from, to, highlight, highlightColor = C.signal, highlightAt = 0, capturedAt, label }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const target = to ?? from;

  const p = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (x) => x * x * (3 - 2 * x), // smoothstep: no hard start or stop
  });

  const box = {
    x: from.x + (target.x - from.x) * p,
    y: from.y + (target.y - from.y) * p,
    w: from.w + (target.w - from.w) * p,
    h: from.h + (target.h - from.h) * p,
  };

  const scale = 1920 / box.w;
  const left = -box.x * scale;
  const top = -box.y * scale + (1080 - box.h * scale) / 2;

  const hlIn = interpolate(frame, [highlightAt * fps, highlightAt * fps + 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: C.ink950, overflow: "hidden" }}>
      <div style={{ position: "absolute", left, top, width: cssWidth * scale, height: cssHeight * scale }}>
        <Img src={staticFile(src)} style={{ width: "100%", height: "100%", display: "block" }} />
        {highlight ? (
          <div
            style={{
              position: "absolute",
              left: highlight.x * scale,
              top: highlight.y * scale,
              width: highlight.w * scale,
              height: highlight.h * scale,
              border: `${Math.max(2, 3 * scale)}px solid ${highlightColor}`,
              borderRadius: 8 * scale,
              boxShadow: `0 0 ${60 * scale}px ${highlightColor}40`,
              opacity: hlIn,
            }}
          />
        ) : null}
      </div>

      {/* vignette, so captions and labels always have something to sit on */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to bottom, rgba(7,9,13,0.55) 0%, rgba(7,9,13,0) 22%, rgba(7,9,13,0) 58%, rgba(7,9,13,0.92) 100%)",
        }}
      />

      {label ? (
        <div
          style={{
            position: "absolute", top: 46, left: 64,
            fontFamily: MONO, fontSize: 21, letterSpacing: "0.16em", textTransform: "uppercase",
            color: C.ink300,
          }}
        >
          {label}
        </div>
      ) : null}

      {/* A film is a snapshot and these counters move. Say when it was taken. */}
      {capturedAt ? (
        <div
          style={{
            position: "absolute", top: 52, right: 64,
            fontFamily: MONO, fontSize: 16, color: C.ink500, letterSpacing: "0.06em",
          }}
        >
          captured {capturedAt}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
