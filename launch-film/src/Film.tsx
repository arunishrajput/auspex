import { Audio } from "@remotion/media";
import React from "react";
import { AbsoluteFill, Sequence, staticFile } from "remotion";
import { Captions } from "./components/Captions";
import timeline from "./data/timeline.json";
import { Close, Audit, Market8, Resolution, Roles } from "./scenes/Ending";
import { Honest, Probe, Revert } from "./scenes/Climax";
import { Agents, Injection, Layers, Pipeline, Review } from "./scenes/Middle";
import { Hook, Overview, Title } from "./scenes/Opening";

export const SCENES: Record<string, React.FC> = {
  hook: Hook, title: Title, overview: Overview, pipeline: Pipeline, review: Review, injection: Injection,
  agents: Agents, layers: Layers, probe: Probe, revert: Revert, honest: Honest, roles: Roles,
  resolution: Resolution, market8: Market8, audit: Audit, close: Close,
};

/**
 * The whole film. Scenes run back to back on the shared timeline (src/data/timeline.json); each
 * scene's narration starts at its own lead-in; the score runs underneath; captions sit on top.
 */
export const Film: React.FC<{ captions?: boolean }> = ({ captions = true }) => (
  <AbsoluteFill style={{ backgroundColor: "#070709" }}>
    {timeline.scenes.map((s) => {
      const Scene = SCENES[s.id];
      return (
        <Sequence key={s.id} from={s.from} durationInFrames={s.durationInFrames} name={s.id}>
          <Scene />
          <Sequence from={s.voFrom} name={`vo ${s.id}`} layout="none">
            <Audio src={staticFile(`vo/${s.id}.mp3`)} volume={0.84} />
          </Sequence>
        </Sequence>
      );
    })}
    <Audio src={staticFile("audio/score.wav")} volume={0.16} />
    {captions && <Captions />}
  </AbsoluteFill>
);
