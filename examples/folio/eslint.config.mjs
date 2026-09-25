import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Blocks copied by `scroll-animation add` stay byte-identical to the hashes in
  // src/animation/.scroll-animation.lock.json, so lint findings in them are
  // fixed in the skill, not here. usePinnedScene hands its refs to a factory in
  // a lazy useState initializer; the factory only reads them in effects and
  // callbacks, which react-hooks/refs can't see. FrameSequence keeps a disable
  // comment this config never needs.
  {
    files: ["src/animation/motion/usePinnedScene.ts"],
    rules: { "react-hooks/refs": "off" },
  },
  {
    files: ["src/animation/motion/FrameSequence.tsx"],
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
