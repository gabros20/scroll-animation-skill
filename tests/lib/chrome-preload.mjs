// chrome-preload.mjs: HARNESS_CHROME for a script that launches Playwright itself rather than through the harness (the
// pack's own scripts/tools/verify-motion.mjs, which run-smoke spawns). Loaded with `node --import`, it makes every
// chromium.launch in the process apply chromeOptions(); unset, it does nothing.
//
//   HARNESS_CHROME=chrome node --import ./tests/lib/chrome-preload.mjs \
//     skills/scroll-animation/scripts/tools/verify-motion.mjs <url>

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { chromeOptions } from './harness.mjs'

if (process.env.HARNESS_CHROME) {
  const require = createRequire(new URL('../../package.json', import.meta.url))
  const pw = await import(pathToFileURL(require.resolve('playwright')).href)
  const chromium = pw.chromium ?? pw.default.chromium
  const launch = chromium.launch.bind(chromium)
  chromium.launch = (options = {}) => launch({ ...chromeOptions(chromium), ...options })
}
