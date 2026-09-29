/**
 * The app's own design tokens, copied from web/app/globals.css.
 * The film and the product have to look like one system, so these are not
 * re-picked by eye — they are the same values the site renders with.
 */
export const C = {
  ink950: "#07090d",
  ink900: "#0b0e14",
  ink850: "#10141c",
  ink800: "#161b26",
  ink700: "#212837",
  ink600: "#323b4f",
  ink500: "#4d5871",
  ink400: "#6b7893",
  ink300: "#9aa6bf",
  ink200: "#c2cadd",
  ink100: "#dfe5f1",
  signal: "#3ba1ff",
  signal400: "#6fbcff",
  ok: "#26c281",
  warn: "#e8b339",
  bad: "#f0524d",
  human: "#a97bff",
} as const;

export const MONO = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace';
export const SANS = 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif';

/** .grid-backdrop — 48px blueprint grid at 6%, exactly as the site draws it. */
export const GRID: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(to right, rgba(107,120,147,0.06) 1px, transparent 1px)," +
    "linear-gradient(to bottom, rgba(107,120,147,0.06) 1px, transparent 1px)",
  backgroundSize: "48px 48px",
};

export const LABEL: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 19,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: C.ink400,
};
