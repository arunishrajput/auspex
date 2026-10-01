import { loadFont as loadDisplay } from "@remotion/google-fonts/BricolageGrotesque";
import { loadFont as loadSans } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

// The product's own tokens (web/app/globals.css). Colour is semantic in AuspeX and stays so here:
// signal = a model proposing, warn = deterministic code, human = a person, ok = the chain,
// bad = a refusal. The orange accent is chrome only and never marks a fact.
export const C = {
  bg: "#070709",
  s900: "#101014",
  s880: "#15151a",
  s850: "#1a1a20",
  line: "#26262e",
  line2: "#35353f",
  faint: "#6b6b7a",
  t500: "#9094a3",
  t400: "#b2b6c4",
  t300: "#ced2dd",
  t200: "#e4e7ef",
  t100: "#f7f8fc",
  ok: "#0dea81",
  warn: "#f0aa28",
  signal: "#688cfb",
  bad: "#f92c70",
  human: "#da82ef",
  accent: "#ff5a1f",
  accent2: "#ff7a45",
};

export const { fontFamily: display } = loadDisplay("normal", { weights: ["500", "700", "800"], subsets: ["latin"] });
export const { fontFamily: sans } = loadSans("normal", { weights: ["400", "500", "600"], subsets: ["latin"] });
export const { fontFamily: mono } = loadMono("normal", { weights: ["400", "500", "700"], subsets: ["latin"] });

export const EASE = [0.16, 1, 0.3, 1] as const; // expo-out: things arrive fast and settle
export const EASE_IO = [0.65, 0, 0.35, 1] as const; // camera moves
