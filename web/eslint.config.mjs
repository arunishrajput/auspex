// ESLint 9 flat config. eslint-config-next v16 exports flat configs directly,
// so FlatCompat/eslintrc is not needed (and in fact breaks on this version).
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
  },
  ...coreWebVitals,
  ...typescript,
];

export default config;
