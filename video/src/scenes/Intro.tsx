import React from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { GateMark } from "../components/GateMark";
import { Card, Eyebrow, Headline } from "../components/Type";
import { C, MONO, SANS } from "../theme";

/** 1 — the thesis. The mark animates into its own meaning, then states the sentence. */
export const S1Thesis: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const markOut = interpolate(frame, [11.4 * fps, 12.6 * fps], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const thesisIn = interpolate(frame, [12.6 * fps, 13.6 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const thesisScale = interpolate(frame, [12.6 * fps, 17.5 * fps], [0.985, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <Backdrop>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: markOut }}>
        <GateMark size={360} delay={6} />
        <div style={{ marginTop: 54, opacity: interpolate(frame, [80, 100], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
          <div style={{ fontFamily: SANS, fontSize: 96, fontWeight: 600, letterSpacing: "-0.03em", color: C.ink100, textAlign: "center" }}>
            AuspeX
          </div>
          <div style={{ fontFamily: MONO, fontSize: 24, letterSpacing: "0.2em", textTransform: "uppercase", color: C.ink400, textAlign: "center", marginTop: 20 }}>
            Prediction markets under human authority
          </div>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: thesisIn, transform: `scale(${thesisScale})` }}>
        <div style={{ fontFamily: SANS, fontSize: 92, fontWeight: 600, letterSpacing: "-0.03em", textAlign: "center", lineHeight: 1.2 }}>
          <span style={{ color: C.signal }}>AI proposes.</span>
          <br />
          <span style={{ color: C.ink100 }}>Humans and the chain </span>
          <span style={{ color: C.ok }}>decide.</span>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

/** 2 — the problem, and the pivot. */
export const S2Problem: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = interpolate(frame, [11.4 * fps, 12.5 * fps], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pivot = interpolate(frame, [12.2 * fps, 13.4 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <Backdrop>
      <AbsoluteFill style={{ padding: "0 160px", justifyContent: "center", opacity: fade }}>
        <Eyebrow at={0.1}>Two things break prediction markets</Eyebrow>
        <div style={{ display: "flex", gap: 34, marginTop: 14 }}>
          <Card at={2.3} accent={C.warn} title="Quality" width={760}>
            “Will the economy improve?” is unresolvable. Disputes are guaranteed.
          </Card>
          <Card at={8.4} accent={C.warn} title="Scale" width={760}>
            Research does not scale, so most people bet on vibes.
          </Card>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ padding: "0 160px", justifyContent: "center", opacity: pivot }}>
        <Headline size={70}>
          The question is not whether AI <span style={{ color: C.ink400 }}>can</span> do this.
          <br />
          It is how you let it — <span style={{ color: C.human }}>without giving it authority.</span>
        </Headline>
      </AbsoluteFill>
    </Backdrop>
  );
};
