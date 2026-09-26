// eslint.config.mjs — the React hooks rules a Next 16 project runs, over the skill's assets. Blocks are copied into
// projects byte for byte, so a finding here is one every Next 16 project that copies the block would inherit.
// eslint-config-next 16.3.6 spreads eslint-plugin-react-hooks' `configs.recommended.rules` (7.x: the compiler-based
// refs, purity, immutability, set-state-in-effect … rules) under the `react-hooks` name; this is that, and nothing
// else. `npm run test:lint`.

import tsParser from '@typescript-eslint/parser'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    files: ['skills/scroll-animation/assets/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
]
