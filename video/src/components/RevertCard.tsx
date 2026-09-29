import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, MONO, SANS } from "../theme";

/** The decoded custom error, held full width. The numbers are the contract's own. */
export const RevertCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const stamp = spring({ frame, fps, config: { damping: 13, mass: 0.55 } });
  const rows = interpolate(frame, [14, 34], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const flash = interpolate(frame, [0, 6, 20], [0.5, 0.14, 0], { extrapolateRight: "clamp" });

  const Row: React.FC<{ k: string; v: string; hi?: boolean; delay: number }> = ({ k, v, hi, delay }) => {
    const o = interpolate(frame, [18 + delay, 32 + delay], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return (
      <div style={{ display: "flex", gap: 40, alignItems: "baseline", opacity: o }}>
        <div style={{ fontFamily: MONO, fontSize: 26, color: C.ink400, width: 190 }}>{k}</div>
        <div style={{ fontFamily: MONO, fontSize: 44, color: hi ? C.bad : C.ink100, letterSpacing: "-0.01em" }}>{v}</div>
      </div>
    );
  };

  return (
    <AbsoluteFill style={{ backgroundColor: C.ink950, alignItems: "center", justifyContent: "center" }}>
      <AbsoluteFill style={{ backgroundColor: C.bad, opacity: flash }} />
      <div style={{ transform: `scale(${0.94 + 0.06 * Math.min(1, stamp)})`, opacity: Math.min(1, stamp * 1.4) }}>
        <div
          style={{
            border: `2px solid ${C.bad}`,
            background: "rgba(240,82,77,0.05)",
            borderRadius: 16,
            padding: "56px 76px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 26, marginBottom: 40 }}>
            <div
              style={{
                fontFamily: MONO, fontSize: 25, letterSpacing: "0.16em", textTransform: "uppercase",
                color: C.bad, border: `1.5px solid ${C.bad}`, borderRadius: 6, padding: "9px 18px",
              }}
            >
              Reverted
            </div>
            <div style={{ fontFamily: MONO, fontSize: 25, color: C.ink400 }}>placeBet · block 5798796</div>
          </div>

          <div style={{ fontFamily: MONO, fontSize: 52, color: C.ink100, marginBottom: 42, letterSpacing: "-0.015em" }}>
            AgentPerTxCapExceeded
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 22, opacity: rows }}>
            <Row k="attempted" v="20000000000000001" hi delay={0} />
            <Row k="cap" v="20000000000000000" delay={8} />
          </div>

          <div style={{ marginTop: 44, paddingTop: 30, borderTop: `1px solid ${C.ink700}`, fontFamily: SANS, fontSize: 28, color: C.ink300 }}>
            One wei over. The contract refused it — <span style={{ color: C.ink100 }}>no off-chain code had to be trusted.</span>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
