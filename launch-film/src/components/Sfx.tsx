import { Audio } from "@remotion/media";
import React from "react";
import { Sequence, staticFile } from "remotion";

export type SfxName = "tick" | "pop" | "whoosh" | "swoosh-down" | "deny" | "confirm" | "type" | "stamp";

/** A synthesised sound effect (scripts/score.py) placed on the frame the picture changes. */
export const Sfx: React.FC<{ name: SfxName; at: number; volume?: number }> = ({ name, at, volume = 0.6 }) => (
  <Sequence from={Math.max(0, Math.round(at))} durationInFrames={45} layout="none" name={`sfx ${name}`}>
    <Audio src={staticFile(`sfx/${name}.wav`)} volume={volume} />
  </Sequence>
);
