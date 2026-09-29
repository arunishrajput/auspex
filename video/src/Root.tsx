import React from "react";
import { Composition } from "remotion";
import { AuspexDemo, FPS, TOTAL_SECONDS } from "./AuspexDemo";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="AuspexDemo"
    component={AuspexDemo}
    durationInFrames={TOTAL_SECONDS * FPS}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
