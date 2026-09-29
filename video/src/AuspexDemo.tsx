import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { Captions } from "./components/Captions";
import { EndCard } from "./components/EndCard";
import { Backdrop } from "./components/Backdrop";
import { S1Thesis, S2Problem } from "./scenes/Intro";
import { S3Boundary, S4Pipeline, S5Gate, S6Agents } from "./scenes/Product";
import { S7Refusal, S8Honesty, S9Verify } from "./scenes/Climax";
import timings from "../script/timings.json";
import { C } from "./theme";

export const FPS = 30;
export const TOTAL_SECONDS = 240;

const SCENES: Record<string, React.FC> = {
  s1_thesis: S1Thesis,
  s2_problem: S2Problem,
  s3_boundary: S3Boundary,
  s4_pipeline: S4Pipeline,
  s5_gate: S5Gate,
  s6_agents: S6Agents,
  s7_refusal: S7Refusal,
  s8_honesty: S8Honesty,
  s9_verify: S9Verify,
};

/**
 * Where the spoken line is already the headline on screen, the caption would just
 * repeat it. Those stretches are suppressed rather than doubled up.
 */
const SUPPRESS: [number, number][] = [
  [0, 17.5],        // s1 — the thesis is the headline
  [17.5, 37.2],     // s2 — the pivot is the headline
  [186.8, 191.3],   // "A failed transaction is not a bug here."
  [191.3, 218.4],   // s8 — the limitation cards carry the text
];

export const AuspexDemo: React.FC = () => {
  const scenes = timings.scenes as any[];

  return (
    <AbsoluteFill style={{ backgroundColor: C.ink950 }}>
      <Audio src={staticFile("audio/mix.wav")} />

      {scenes.map((s, i) => {
        const from = Math.round(s.start * FPS);
        const next = scenes[i + 1] ? Math.round(scenes[i + 1].start * FPS) : Math.round(timings.total * FPS);
        const Scene = SCENES[s.id];
        return (
          <Sequence key={s.id} from={from} durationInFrames={next - from} name={s.beat}>
            <Scene />
          </Sequence>
        );
      })}

      <Sequence from={Math.round(timings.total * FPS)} name="End card">
        <Backdrop>
          <EndCard />
        </Backdrop>
      </Sequence>

      <Sequence from={0} name="Captions">
        <Captions suppress={SUPPRESS} />
      </Sequence>
    </AbsoluteFill>
  );
};
