import manifest from "../../public/frames/manifest.json";
import type { Rect } from "../components/Browser";

type M = Record<string, { marks?: { x?: number; y?: number; w?: number; h?: number; error?: string }[] }>;

/** The on-screen box of element i in a captured frame, measured from the DOM when it was shot. */
export const mark = (shot: string, i: number): Rect => {
  const m = (manifest as M)[shot]?.marks?.[i];
  if (!m || m.error || m.w === undefined) throw new Error(`no mark ${shot}[${i}]`);
  return [m.x!, m.y!, m.w!, m.h!];
};

/** The smallest box containing several marks. */
export const union = (...rs: Rect[]): Rect => {
  const x0 = Math.min(...rs.map((r) => r[0]));
  const y0 = Math.min(...rs.map((r) => r[1]));
  const x1 = Math.max(...rs.map((r) => r[0] + r[2]));
  const y1 = Math.max(...rs.map((r) => r[1] + r[3]));
  return [x0, y0, x1 - x0, y1 - y0];
};
