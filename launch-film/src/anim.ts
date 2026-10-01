import { Easing, interpolate } from "remotion";
import { EASE, EASE_IO } from "./theme";

const ez = Easing.bezier(...EASE);
const ezio = Easing.bezier(...EASE_IO);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 0 → 1 over `len` frames starting at `start`, expo-out. */
export const rise = (frame: number, start: number, len = 18) =>
  interpolate(frame, [start, start + len], [0, 1], { ...clamp, easing: ez });

/** 0 → 1, ease-in-out, for camera moves. */
export const glide = (frame: number, start: number, len = 30) =>
  interpolate(frame, [start, start + len], [0, 1], { ...clamp, easing: ezio });

/** 1 → 0 at the end of a scene, so every cut has an exit. */
export const fall = (frame: number, end: number, len = 10) =>
  interpolate(frame, [end - len, end], [1, 0], { ...clamp, easing: Easing.in(Easing.cubic) });

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
