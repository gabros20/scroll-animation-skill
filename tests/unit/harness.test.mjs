// tests/lib: the browser suites' harness and the lint rule that bans fixed waits. The rule must catch every shape of a
// fixed wait the suites used (waitForTimeout, the old local sleep/wait helpers, a hand-built setTimeout sleep, the
// harness's own hold) and let through what is not one (a 0 ms yield, a timer that rejects or kills) and what carries a
// `fixed-wait: <reason>` comment. HARNESS_CHROME and the favicon filter are pure functions of their input.

import assert from 'node:assert/strict'
import { describe, it, test } from 'node:test'

import { RuleTester } from 'eslint'

import plugin from '../lib/eslint-no-fixed-wait.mjs'
import { chromeOptions, isFaviconMiss } from '../lib/harness.mjs'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const tester = new RuleTester({ languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } })
const fixed = (what) => ({ messageId: 'fixed', data: { what } })

tester.run('harness/no-fixed-wait', plugin.rules['no-fixed-wait'], {
  valid: [
    // conditions
    'await page.waitForFunction(() => window.ready, null, { polling: "raf" })',
    'await settle(page, () => scrollY)',
    // a 0 ms yield is one macrotask, not a guess
    'await new Promise((resolve) => setTimeout(resolve, 0))',
    // a timer that is not a sleep: it rejects, or it kills
    'new Promise((resolve, reject) => setTimeout(() => reject(new Error("refused")), 100))',
    'setTimeout(() => kill("SIGKILL"), 5000).unref()',
    // allowlisted, on the line above or the same line
    '// fixed-wait: an observation window: nothing may move\nawait page.waitForTimeout(300)',
    'await hold(40) // fixed-wait: wheel notches paced like a hand',
    '// fixed-wait: the poll interval of a condition loop\nawait new Promise((resolve) => setTimeout(resolve, 50))',
  ],
  invalid: [
    { code: 'await page.waitForTimeout(300)', errors: [fixed('waitForTimeout()')] },
    { code: 'await sleep(300)', errors: [fixed('sleep()')] },
    { code: 'await wait(300)', errors: [fixed('wait()')] },
    { code: 'await hold(300)', errors: [fixed('hold()')] },
    { code: 'await new Promise((resolve) => setTimeout(resolve, 300))', errors: [fixed('a setTimeout sleep')] },
    { code: 'await new Promise((r) => window.setTimeout(() => r(), ms))', errors: [fixed('a setTimeout sleep')] },
    { code: 'await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 100)))', errors: [fixed('a setTimeout sleep')] },
    // a reason is two words at least, and the comment must be on the line or the one above
    { code: '// fixed-wait: because\nawait sleep(300)', errors: [fixed('sleep()')] },
    { code: '// fixed-wait: an observation window\n\nawait sleep(300)', errors: [fixed('sleep()')] },
  ],
})

const type = (name) => ({ name: () => name })

test('HARNESS_CHROME: a channel name or an executable path, for Chromium only', () => {
  assert.deepEqual(chromeOptions(type('chromium'), {}), {})
  assert.deepEqual(chromeOptions(type('chromium'), { HARNESS_CHROME: 'chrome' }), { channel: 'chrome' })
  const path = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  assert.deepEqual(chromeOptions(type('chromium'), { HARNESS_CHROME: path }), { executablePath: path })
  assert.deepEqual(chromeOptions(type('webkit'), { HARNESS_CHROME: 'chrome' }), {})
  assert.deepEqual(chromeOptions(type('firefox'), { HARNESS_CHROME: path }), {})
})

const msg = (type, text, url) => ({ type: () => type, text: () => text, location: () => ({ url }) })
const NOT_FOUND = 'Failed to load resource: the server responded with a status of 404 (Not Found)'

test("the favicon filter matches branded Chrome's own /favicon.ico 404 and nothing else", () => {
  assert.equal(isFaviconMiss(msg('error', NOT_FOUND, 'http://127.0.0.1:5173/favicon.ico')), true)
  // any other missing file still fails a suite
  assert.equal(isFaviconMiss(msg('error', NOT_FOUND, 'http://127.0.0.1:5173/clip.mp4')), false)
  assert.equal(isFaviconMiss(msg('error', NOT_FOUND, 'http://127.0.0.1:5173/assets/favicon.ico')), false)
  // a different error on the favicon's URL, or a warning
  assert.equal(isFaviconMiss(msg('error', 'Failed to load resource: net::ERR_FAILED', 'http://127.0.0.1:5173/favicon.ico')), false)
  assert.equal(isFaviconMiss(msg('warning', NOT_FOUND, 'http://127.0.0.1:5173/favicon.ico')), false)
  assert.equal(isFaviconMiss(msg('error', NOT_FOUND, '')), false)
})
