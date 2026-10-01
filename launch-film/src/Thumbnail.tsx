import React from "react";
import { AbsoluteFill } from "remotion";
import { Backdrop, Mark } from "./components/ui";
import { C, display, mono } from "./theme";

/** The YouTube thumbnail, 1280×720. The numbers are the real cap and the real over-cap bet. */
export const Thumbnail: React.FC = () => (
  <AbsoluteFill>
    <div style={{ position: "absolute", inset: 0, scale: "0.6667", transformOrigin: "0 0", width: 1920, height: 1080 }}>
      <Backdrop glow={1.4} glowX={30} glowY={10} />
      <div style={{ position: "absolute", left: 110, top: 96, display: "flex", alignItems: "center", gap: 24 }}>
        <Mark size={92} />
        <div style={{ fontFamily: display, fontWeight: 800, fontSize: 84, letterSpacing: "-0.05em", color: C.t100 }}>Auspe<span style={{ color: C.accent }}>X</span></div>
      </div>
      <div style={{ position: "absolute", left: 110, top: 270, fontFamily: display, fontWeight: 800, fontSize: 168, lineHeight: 0.92, letterSpacing: "-0.05em", color: C.t100 }}>
        AI proposes.<br />
        <span style={{ color: C.ok }}>The chain</span><br />
        <span style={{ color: C.ok }}>decides.</span>
      </div>
      <div style={{ position: "absolute", right: 90, top: 330, width: 760, textAlign: "right" }}>
        <div style={{ fontFamily: mono, fontSize: 34, color: C.t400, letterSpacing: "0.1em" }}>AN AI AGENT BET</div>
        <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 200, color: C.accent, letterSpacing: "-0.04em", lineHeight: 1 }}>+1 wei</div>
        <div style={{ fontFamily: mono, fontSize: 34, color: C.t400, letterSpacing: "0.1em" }}>OVER ITS ON-CHAIN CAP</div>
      </div>
      <div style={{
        position: "absolute", right: 120, top: 690, rotate: "-7deg", padding: "10px 40px", border: `9px solid ${C.bad}`, borderRadius: 16,
        fontFamily: display, fontWeight: 800, fontSize: 132, color: C.bad, background: `${C.bg}dd`, boxShadow: `0 0 90px ${C.bad}77`,
      }}>
        REVERTED
      </div>
    </div>
  </AbsoluteFill>
);
