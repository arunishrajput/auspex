import React from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { RevertCard } from "../components/RevertCard";
import { Screen } from "../components/Screen";
import { Terminal } from "../components/Terminal";
import { Card, Eyebrow, Headline } from "../components/Type";
import { CHECK_LINKS } from "../checkLinks";
import { C, MONO, SANS } from "../theme";
import manifest from "../../public/capture-manifest.json";

const M = manifest.shots as any;
const CAP = new Date(manifest.capturedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** 7 — the peak. Build, then silence, then the chain says no. */
export const S7Refusal: React.FC = () => {
  const { fps } = useVideoConfig();
  const S = (s: number) => Math.round(s * fps);

  return (
    <>
      {/* the admission */}
      <Sequence durationInFrames={S(8.2)}>
        <Backdrop>
          <AbsoluteFill style={{ padding: "0 180px", justifyContent: "center" }}>
            <Headline at={0.2} size={68}>
              Everything so far is <span style={{ color: C.ink400 }}>my code</span>.
              <br />
              My code can be wrong, or compromised.
            </Headline>
          </AbsoluteFill>
        </Backdrop>
      </Sequence>

      {/* the button, on the public site */}
      <Sequence from={S(8.2)} durationInFrames={S(9.0)}>
        <Screen
          src="shots/trust.png" cssWidth={M.trust.cssWidth} cssHeight={M.trust.cssHeight}
          from={{ x: 135, y: 3640, w: 1010, h: 520 }}
          to={{ x: 190, y: 3700, w: 830, h: 430 }}
          label="/trust — judge mode · no wallet required"
          capturedAt={CAP}
        />
      </Sequence>

      {/* the drop */}
      <Sequence from={S(17.2)} durationInFrames={S(1.2)}>
        <Fade />
      </Sequence>

      {/* the refusal */}
      <Sequence from={S(18.4)} durationInFrames={S(7.6)}>
        <RevertCard />
      </Sequence>

      {/* the proof, on the real explorer */}
      <Sequence from={S(26.0)} durationInFrames={S(9.2)}>
        <Screen
          src="shots/scan-revert.png"
          cssWidth={M["scan-revert"].cssWidth} cssHeight={M["scan-revert"].cssHeight}
          from={{ x: 96, y: 404, w: 1146, h: 262 }}
          to={{ x: 352, y: 545, w: 810, h: 130 }}
          label="MSTScan — the transaction anyone can open"
          capturedAt={CAP}
        />
      </Sequence>

      {/* the line */}
      <Sequence from={S(35.2)}>
        <Backdrop>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: "0 180px" }}>
            <div style={{ fontFamily: SANS, fontSize: 78, fontWeight: 600, letterSpacing: "-0.028em", textAlign: "center", lineHeight: 1.2, color: C.ink100 }}>
              A failed transaction is not a bug here.
              <br />
              <span style={{ color: C.bad }}>It is the product.</span>
            </div>
          </AbsoluteFill>
        </Backdrop>
      </Sequence>
    </>
  );
};

const Fade: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const o = interpolate(frame, [0, durationInFrames * 0.7], [1, 0], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink950 }}>
      <AbsoluteFill style={{ backgroundColor: C.ink900, opacity: o * 0.4 }} />
    </AbsoluteFill>
  );
};

/** 8 — the limitations, stated plainly. Naming them is what makes the rest credible. */
export const S8Honesty: React.FC = () => (
  <Backdrop>
    <AbsoluteFill style={{ padding: "0 150px", justifyContent: "center" }}>
      <Eyebrow at={0.2}>What I am not claiming</Eyebrow>
      <div style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 8 }}>
        <Card at={2.1} accent={C.warn} title="Resolution is trusted">
          An authorised set, an evidence URL on chain, a challenge window, permissionless finalisation.
          That bounds a bad resolver. It is <span style={{ color: C.ink100 }}>not a decentralised oracle</span>.
        </Card>
        <Card at={14.1} accent={C.warn} title="One wallet, two jobs">
          The market creator and the resolver are currently the same wallet, and they should not be.
        </Card>
        <Card at={18.7} accent={C.warn} title="Fortuna VRF — cut, not faked">
          The organisers’ VRF contract has no bytecode on this testnet, so randomised resolver
          selection was removed rather than mocked.
        </Card>
      </div>
    </AbsoluteFill>
  </Backdrop>
);

/** 9 — check it yourself. */
export const S9Verify: React.FC = () => (
  <Backdrop>
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <Terminal command="pnpm check:links" lines={CHECK_LINKS} startAt={0.15} />
    </AbsoluteFill>
  </Backdrop>
);
