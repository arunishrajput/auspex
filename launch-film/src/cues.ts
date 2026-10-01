import { useVideoConfig } from "remotion";
import captions from "./data/captions.json";
import timeline from "./data/timeline.json";

type Caps = Record<string, { duration: number; phrases: { text: string; start: number; end: number }[] }>;
const caps = captions as Caps;

export const sceneOf = (id: string) => {
  const s = timeline.scenes.find((x) => x.id === id);
  if (!s) throw new Error(`no scene ${id}`);
  return s;
};

/**
 * Frame numbers, relative to the start of a scene, for the moment the narrator starts (or ends)
 * phrase i. Every animation cue in the film is one of these, so picture follows the voice.
 */
export const useCue = (id: string) => {
  const { fps } = useVideoConfig();
  const s = sceneOf(id);
  const p = caps[id].phrases;
  return {
    at: (i: number, offset = 0) => Math.round(s.voFrom + p[i].start * fps + offset * fps),
    end: (i: number, offset = 0) => Math.round(s.voFrom + p[i].end * fps + offset * fps),
    dur: s.durationInFrames,
    vo: s.voFrom,
  };
};
