import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, MONO, SANS } from "../theme";
import { GateMark } from "./GateMark";

export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const row = (at: number) => ({
    opacity: interpolate(frame, [at * fps, at * fps + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    transform: `translateY(${interpolate(frame, [at * fps, at * fps + 18], [18, 0], {
      extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: (x) => 1 - Math.pow(1 - x, 3),
    })}px)`,
  });

  const Line: React.FC<{ k: string; v: string; at: number; color?: string }> = ({ k, v, at, color = C.signal }) => (
    <div style={{ ...row(at), display: "flex", gap: 34, alignItems: "baseline" }}>
      <div style={{ fontFamily: MONO, fontSize: 20, letterSpacing: "0.16em", textTransform: "uppercase", color: C.ink500, width: 210, textAlign: "right" }}>
        {k}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 30, color }}>{v}</div>
    </div>
  );

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ ...row(0), marginBottom: 40 }}>
        <GateMark size={132} delay={0} />
      </div>
      <div style={{ ...row(0.25), fontFamily: SANS, fontSize: 74, fontWeight: 600, letterSpacing: "-0.025em", color: C.ink100 }}>
        AuspeX
      </div>
      <div style={{ ...row(0.45), fontFamily: SANS, fontSize: 33, color: C.signal400, marginTop: 14, marginBottom: 56 }}>
        AI proposes. Humans and the chain decide.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <Line k="live" v="auspex-web-mu.vercel.app" at={0.7} />
        <Line k="contract" v="0xc4743d6295311AFead12161881Bfcf601B70104C" at={0.9} color={C.ink200} />
        <Line k="explorer" v="testnet.mstscan.com · chain 91562037" at={1.1} color={C.ink200} />
        <Line k="repo" v="github.com/arunishrajput/auspex" at={1.3} color={C.ink200} />
      </div>

      <div style={{ ...row(1.7), marginTop: 62, fontFamily: MONO, fontSize: 22, color: C.ink500, letterSpacing: "0.06em" }}>
        MST Blockchain × Newrro Buildathon · AI &amp; Web3
      </div>
    </AbsoluteFill>
  );
};
