import React from "react";
import { AbsoluteFill } from "remotion";
import { C, GRID } from "../theme";

export const Backdrop: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ backgroundColor: C.ink950 }}>
    <AbsoluteFill style={GRID} />
    {children}
  </AbsoluteFill>
);
