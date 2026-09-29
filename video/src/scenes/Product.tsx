import React from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Screen } from "../components/Screen";
import { Eyebrow } from "../components/Type";
import { C, MONO, SANS } from "../theme";
import manifest from "../../public/capture-manifest.json";

const M = manifest.shots as any;
const CAP = new Date(manifest.capturedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC";

const Column: React.FC<{ at: number; title: string; accent: string; items: string[]; authority?: boolean }> = ({
  at, title, accent, items, authority,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = interpolate(frame, [at * fps, at * fps + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const y = interpolate(frame, [at * fps, at * fps + 22], [24, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: (x) => 1 - Math.pow(1 - x, 3),
  });
  return (
    <div
      style={{
        flex: 1, opacity: o, transform: `translateY(${y}px)`,
        background: authority ? "rgba(169,123,255,0.06)" : C.ink900,
        border: `1px solid ${accent}${authority ? "" : "55"}`,
        borderRadius: 12, padding: "32px 30px",
      }}
    >
      <div style={{ fontFamily: MONO, fontSize: 18, letterSpacing: "0.17em", textTransform: "uppercase", color: accent, marginBottom: 24 }}>
        {title}
      </div>
      {items.map((t, i) => (
        <div key={i} style={{ fontFamily: SANS, fontSize: 26, lineHeight: 1.4, color: C.ink200, marginBottom: 16, display: "flex", gap: 12 }}>
          <span style={{ color: accent, fontFamily: MONO, fontSize: 20, lineHeight: 1.7 }}>·</span>
          <span>{t}</span>
        </div>
      ))}
    </div>
  );
};

/** 3 — the boundary: what may propose, what decides, what has authority. */
export const S3Boundary: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <>
      <Sequence durationInFrames={Math.round(17.5 * fps)}>
        <Backdrop>
          <AbsoluteFill style={{ padding: "0 110px", justifyContent: "center" }}>
            <Eyebrow at={0.2}>The boundary</Eyebrow>
            <div style={{ display: "flex", gap: 26, alignItems: "stretch", marginTop: 10 }}>
              <Column at={1.2} title="An LLM may only propose" accent={C.warn} items={[
                "which headlines describe one event",
                "a draft market question",
                "a side, a confidence and a stake",
              ]} />
              <Column at={5.0} title="Deterministic code decides" accent={C.signal} items={[
                "pure functions — no network, no model",
                "every refusal written down with its reason",
                "unit-tested from both sides",
              ]} />
              <Column at={9.2} title="Only a human or the chain" accent={C.human} authority items={[
                "createMarket — signed in a browser wallet",
                "the caps on every agent",
                "roles, and the pause switch",
              ]} />
            </div>
          </AbsoluteFill>
        </Backdrop>
      </Sequence>

      <Sequence from={Math.round(17.5 * fps)}>
        <Screen
          src="shots/trust.png" cssWidth={M.trust.cssWidth} cssHeight={M.trust.cssHeight}
          from={{ x: 130, y: 900, w: 1020, h: 600 }}
          to={{ x: 145, y: 930, w: 990, h: 580 }}
          label="/trust — asked of the contract, live"
          capturedAt={CAP}
        />
      </Sequence>
    </>
  );
};

/** 4 — the pipeline: deterministic first, the model only in the ambiguous band. */
export const S4Pipeline: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <>
      <Sequence durationInFrames={Math.round(11.7 * fps)}>
        <Screen
          src="shots/home.png" cssWidth={M.home.cssWidth} cssHeight={M.home.cssHeight}
          from={{ x: 130, y: 355, w: 1020, h: 300 }}
          to={{ x: 140, y: 375, w: 1000, h: 290 }}
          label="/ — the live news pipeline"
          capturedAt={CAP}
        />
      </Sequence>
      <Sequence from={Math.round(11.7 * fps)}>
        <Screen
          src="shots/home.png" cssWidth={M.home.cssWidth} cssHeight={M.home.cssHeight}
          from={{ x: 130, y: 940, w: 1020, h: 560 }}
          to={{ x: 130, y: 1560, w: 1020, h: 560 }}
          label="two distinct publishers, or it is not a market"
          capturedAt={CAP}
        />
      </Sequence>
    </>
  );
};

/** 5 — the human gate. Ends on the sender, which is the whole point. */
export const S5Gate: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <>
      <Sequence durationInFrames={Math.round(11.4 * fps)}>
        <Screen
          src="shots/review.png" cssWidth={M.review.cssWidth} cssHeight={M.review.cssHeight}
          from={{ x: 195, y: 690, w: 900, h: 560 }}
          to={{ x: 205, y: 730, w: 880, h: 545 }}
          label="/review — a checklist, not a paragraph"
          capturedAt={CAP}
        />
      </Sequence>
      <Sequence from={Math.round(11.4 * fps)} durationInFrames={Math.round(13.1 * fps)}>
        <Screen
          src="shots/review.png" cssWidth={M.review.cssWidth} cssHeight={M.review.cssHeight}
          from={{ x: 195, y: 1180, w: 900, h: 540 }}
          to={{ x: 195, y: 1320, w: 900, h: 540 }}
          label="the sources, fenced off as untrusted"
          capturedAt={CAP}
        />
      </Sequence>
      <Sequence from={Math.round(24.5 * fps)}>
        <Screen
          src="shots/scan-createmarket.png"
          cssWidth={M["scan-createmarket"].cssWidth} cssHeight={M["scan-createmarket"].cssHeight}
          from={{ x: 100, y: 620, w: 760, h: 300 }}
          to={{ x: 112, y: 640, w: 700, h: 280 }}
          highlight={{ x: 158, y: 686, w: 635, h: 48 }}
          highlightColor={C.human}
          highlightAt={1.6}
          label="MSTScan — sent by the human authority wallet"
          capturedAt={CAP}
        />
      </Sequence>
    </>
  );
};

/** 6 — bounded twice: the off-chain gate, then the contract. */
export const S6Agents: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <>
      <Sequence durationInFrames={Math.round(13.1 * fps)}>
        <Screen
          src="shots/agents.png" cssWidth={M.agents.cssWidth} cssHeight={M.agents.cssHeight}
          from={{ x: 130, y: 360, w: 1020, h: 300 }}
          to={{ x: 135, y: 470, w: 1010, h: 420 }}
          label="/agents — every decision, approved and refused"
          capturedAt={CAP}
        />
      </Sequence>
      <Sequence from={Math.round(13.1 * fps)}>
        <Screen
          src="shots/agents.png" cssWidth={M.agents.cssWidth} cssHeight={M.agents.cssHeight}
          from={{ x: 140, y: 600, w: 1000, h: 500 }}
          to={{ x: 140, y: 1245, w: 1000, h: 500 }}
          label="off chain in blue · on chain in purple"
          capturedAt={CAP}
        />
      </Sequence>
    </>
  );
};
