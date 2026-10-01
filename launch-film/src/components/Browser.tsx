import React, { createContext, useContext } from "react";
import { Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { rise } from "../anim";
import { C, mono, sans } from "../theme";

/**
 * A browser window showing a real capture of the live deployment (1600×900 CSS px at 2x), with a
 * camera that can push in on a region, and highlights drawn in the page's own CSS coordinates —
 * the boxes come from the DOM at capture time (public/frames/manifest.json), not from guessing.
 */
export type Rect = [number, number, number, number];
export type CamKey = { f: number; rect?: Rect; zoom?: number; len?: number };
export type Shot = { src: string; from: number; url?: string };

const VW = 1600;
const VH = 900;
const Zoom = createContext(1);

const camAt = (keys: CamKey[], frame: number) => {
  const target = (k: CamKey) => {
    if (!k.rect) return { z: k.zoom ?? 1, cx: VW / 2, cy: VH / 2 };
    const [x, y, w, h] = k.rect;
    const z = k.zoom ?? Math.max(1, Math.min(2.6, Math.min(VW / w, VH / h) * 0.78));
    return { z, cx: x + w / 2, cy: y + h / 2 };
  };
  let cur = target({ f: 0 });
  for (const k of keys) {
    if (frame < k.f) break;
    const next = target(k);
    const t = interpolate(frame, [k.f, k.f + (k.len ?? 26)], [0, 1], {
      extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.65, 0, 0.35, 1),
    });
    cur = { z: cur.z + (next.z - cur.z) * t, cx: cur.cx + (next.cx - cur.cx) * t, cy: cur.cy + (next.cy - cur.cy) * t };
  }
  const tx = Math.min(0, Math.max(VW - VW * cur.z, VW / 2 - cur.cx * cur.z));
  const ty = Math.min(0, Math.max(VH - VH * cur.z, VH / 2 - cur.cy * cur.z));
  return { z: cur.z, tx, ty };
};


export const Page: React.FC<{
  shots: Shot[]; url: string; cam?: CamKey[]; width?: number; top?: number; left?: number; enter?: number; tilt?: number; overlay?: React.ReactNode;
}> = (props) => {
  const frame = useCurrentFrame();
  const { shots, url, cam = [], width = 1400, top = 92, left, enter = 0, tilt = 0, overlay } = props;
  const k = width / VW;
  const h = VH * k;
  const x = left ?? (1920 - width) / 2;
  const { z, tx, ty } = camAt(cam, frame);
  const t = rise(frame, enter, 22);
  const active = shots.reduce((a, s, i) => (frame >= s.from ? i : a), 0);
  const curUrl = shots[active].url ?? url;
  const layer: React.CSSProperties = { position: "absolute", left: 0, top: 0, width: VW, height: VH, transformOrigin: "0 0", transform: `scale(${k}) translate(${tx}px, ${ty}px) scale(${z})` };
  return (
    <div style={{ position: "absolute", left: x, top, width, opacity: t, translate: `0px ${(1 - t) * 40}px`, rotate: `${tilt}deg`, filter: `drop-shadow(0 30px 60px #000000cc)` }}>
      <div style={{ height: 46, background: C.s880, borderRadius: "14px 14px 0 0", border: `1px solid ${C.line2}`, borderBottom: "none", display: "flex", alignItems: "center", padding: "0 18px", gap: 9 }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <span key={c} style={{ width: 13, height: 13, borderRadius: 99, background: c, opacity: 0.85 }} />
        ))}
        <div style={{ marginLeft: 22, flex: 1, height: 28, borderRadius: 8, background: C.bg, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", padding: "0 14px", gap: 10 }}>
          <svg width="13" height="13" viewBox="0 0 16 16"><path d="M4 7V5a4 4 0 1 1 8 0v2h1v8H3V7zm2 0h4V5a2 2 0 1 0-4 0z" fill={C.ok} /></svg>
          <span style={{ fontFamily: mono, fontSize: 16, color: C.t400 }}>{curUrl}</span>
        </div>
      </div>
      <div style={{ position: "relative", width, height: h, overflow: "hidden", borderRadius: "0 0 14px 14px", border: `1px solid ${C.line2}`, borderTop: "none", background: C.bg }}>
        <div style={layer}>
          {shots.map((s, i) => {
            const into = i === 0 ? 1 : interpolate(frame, [s.from, s.from + 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.65, 0, 0.35, 1) });
            const next = shots[i + 1];
            const out = next ? interpolate(frame, [next.from, next.from + 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.65, 0, 0.35, 1) }) : 0;
            if (into <= 0 || out >= 1) return null;
            return (
              <div key={i} style={{ position: "absolute", inset: 0, translate: `0px ${(1 - into) * VH - out * VH * 0.35}px`, opacity: 1 - out }}>
                <Img src={staticFile(s.src)} style={{ width: VW, height: VH, display: "block" }} />
              </div>
            );
          })}
          <Zoom.Provider value={z * k}>{overlay}</Zoom.Provider>
        </div>
      </div>
    </div>
  );
};

/**
 * A ring drawn around a real element: the stroke draws itself on, a soft glow settles, and an
 * optional tag hangs off one corner. Optional spotlight dims everything else on the page.
 */
export const Ring: React.FC<{
  rect: Rect; from: number; until?: number; color?: string; label?: string; labelSide?: "top" | "bottom" | "right" | "left";
  pad?: number; spot?: boolean; radius?: number; fill?: boolean;
}> = ({ rect, from, until = 1e9, color = C.accent, label, labelSide = "top", pad = 8, spot = false, radius = 8, fill = false }) => {
  const frame = useCurrentFrame();
  const z = useContext(Zoom);
  const t = rise(frame, from, 22);
  const off = interpolate(frame, [until, until + 10], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (frame < from || off <= 0) return null;
  const [x0, y0, w0, h0] = rect;
  const x = x0 - pad, y = y0 - pad, w = w0 + pad * 2, h = h0 + pad * 2;
  const per = 2 * (w + h);
  const sw = 3 / z;
  return (
    <>
      {spot && (
        <svg style={{ position: "absolute", left: 0, top: 0, width: VW, height: VH, opacity: t * off * 0.62 }}>
          <defs>
            <mask id={`m${x}${y}`}>
              <rect width={VW} height={VH} fill="white" />
              <rect x={x} y={y} width={w} height={h} rx={radius} fill="black" />
            </mask>
          </defs>
          <rect width={VW} height={VH} fill="#000" mask={`url(#m${x}${y})`} />
        </svg>
      )}
      <svg style={{ position: "absolute", left: 0, top: 0, width: VW, height: VH, overflow: "visible", opacity: off, filter: `drop-shadow(0 0 ${8 / z}px ${color})` }}>
        {fill && <rect x={x} y={y} width={w} height={h} rx={radius} fill={`${color}1c`} opacity={t} />}
        <rect x={x} y={y} width={w} height={h} rx={radius} fill="none" stroke={color} strokeWidth={sw} strokeDasharray={per} strokeDashoffset={per * (1 - t)} />
      </svg>
      {label && (
        <div
          style={{
            position: "absolute",
            ...(labelSide === "top" ? { left: x, top: y - 8 / z, translate: "0 -100%" } : {}),
            ...(labelSide === "bottom" ? { left: x, top: y + h + 8 / z } : {}),
            ...(labelSide === "right" ? { left: x + w + 10 / z, top: y + h / 2, translate: "0 -50%" } : {}),
            ...(labelSide === "left" ? { left: x - 10 / z, top: y + h / 2, translate: "-100% -50%" } : {}),
            opacity: t * off, scale: String(1 / z), transformOrigin: labelSide === "left" ? "right center" : labelSide === "top" ? "left bottom" : "left top",
            fontFamily: mono, fontSize: 22, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
            color: C.bg, background: color, padding: "7px 12px", borderRadius: 6, whiteSpace: "nowrap",
            boxShadow: `0 8px 30px ${color}55`,
          }}
        >
          {label}
        </div>
      )}
    </>
  );
};

/** A caption card that floats over a page, outside its camera. */
export const Callout: React.FC<{ from: number; until?: number; x: number; y: number; w?: number; tone?: string; children: React.ReactNode }> = ({ from, until = 1e9, x, y, w = 560, tone = C.accent, children }) => {
  const frame = useCurrentFrame();
  const t = rise(frame, from, 20);
  const off = interpolate(frame, [until, until + 10], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (frame < from || off <= 0) return null;
  return (
    <div
      style={{
        position: "absolute", left: x, top: y, width: w, opacity: t * off, translate: `${(1 - t) * 40}px 0px`,
        background: `${C.s900}f2`, border: `1.5px solid ${tone}aa`, borderRadius: 14, padding: "22px 26px",
        boxShadow: `0 24px 60px #000000cc, 0 0 40px ${tone}22`, fontFamily: sans, fontSize: 28, lineHeight: 1.35, color: C.t200,
      }}
    >
      {children}
    </div>
  );
};
