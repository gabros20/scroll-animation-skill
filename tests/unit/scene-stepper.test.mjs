// The scrubbed scene's live mode stepper, in both engines: `stepMode` from
// assets/gsap/scrubStage.ts and assets/motion/components/ScrubStage.tsx.

import './load-ts.mjs'

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

const engines = {
  gsap: (await import('../../skills/scroll-animation/assets/gsap/scrubStage.ts')).stepMode,
  react: (await import('../../skills/scroll-animation/assets/motion/components/ScrubStage.tsx')).stepMode
}

const MODES = ['head', 'scrub', 'tail']

// Round numbers, ordered the way boundsFromRangePx orders them: each end's
// enter/exit pair is split by its hysteresis gap.
const B = { headEnter: 0.1, headExit: 0.2, tailExit: 0.7, tailEnter: 0.8 }

// What boundsFromRangePx gives for v1's defaults (headHoldPx 12, tailLeadPx 320,
// hysteresisRatio 0.7) on the trace fixtures' 1800px range at 1440x900.
const range = 1800
const REAL = {
  headExit: 12 / range,
  headEnter: (12 - 12 * 0.7) / range,
  tailEnter: 1 - 320 / range,
  tailExit: 1 - (320 + 320 * 0.7) / range
}

// v1's stepper, which took at most one step per progress event.
function stepOnce(mode, p, b) {
  if (mode === 'head' && p > b.headExit) return 'scrub'
  if (mode === 'scrub' && p < b.headEnter) return 'head'
  if (mode === 'scrub' && p > b.tailEnter) return 'tail'
  if (mode === 'tail' && p < b.tailExit) return 'scrub'
  return mode
}

const grid = Array.from({ length: 1001 }, (_, i) => i / 1000)

for (const [engine, stepMode] of Object.entries(engines)) {
  describe(`${engine} stepMode`, () => {
    test('is exported', () => {
      assert.equal(typeof stepMode, 'function')
    })

    test('takes one step per boundary crossed, with the same edges as before', () => {
      const cases = [
        ['head', 0.2, 'head'], // at headExit: exits only once past it
        ['head', 0.21, 'scrub'],
        ['scrub', 0.15, 'scrub'], // inside the head gap: no flap back
        ['scrub', 0.09, 'head'],
        ['scrub', 0.8, 'scrub'], // at tailEnter: enters only once past it
        ['scrub', 0.81, 'tail'],
        ['tail', 0.75, 'tail'], // inside the tail gap: no flap back
        ['tail', 0.69, 'scrub'],
        ['head', 0, 'head'],
        ['tail', 1, 'tail']
      ]
      for (const [from, p, want] of cases) assert.equal(stepMode(from, p, B), want, `${from} @${p}`)
    })

    test('crosses every boundary a jump passes, in one call', () => {
      assert.equal(stepMode('head', 0.95, B), 'tail')
      assert.equal(stepMode('head', 1, B), 'tail')
      assert.equal(stepMode('tail', 0.05, B), 'head')
      assert.equal(stepMode('tail', 0, B), 'head')
      assert.equal(stepMode('head', 0.95, REAL), 'tail')
      assert.equal(stepMode('tail', 0, REAL), 'head')
    })

    test('a jump landing inside a hysteresis gap keeps the side it came from', () => {
      assert.equal(stepMode('tail', 0.15, B), 'scrub')
      assert.equal(stepMode('head', 0.75, B), 'scrub')
    })

    test('equals v1 stepped until stable, and one v1 step wherever one was enough', () => {
      for (const b of [B, REAL]) {
        for (const mode of MODES) {
          for (const p of grid) {
            let settled = mode
            for (let i = 0; i < 3; i++) settled = stepOnce(settled, p, b)
            assert.equal(stepMode(mode, p, b), settled, `${mode} @${p}`)
            const once = stepOnce(mode, p, b)
            if (stepOnce(once, p, b) === once) assert.equal(stepMode(mode, p, b), once, `${mode} @${p}`)
          }
        }
      }
    })

    test('returns a stable mode', () => {
      for (const mode of MODES) {
        for (const p of grid) {
          const next = stepMode(mode, p, B)
          assert.equal(stepMode(next, p, B), next, `${mode} @${p}`)
        }
      }
    })

    test('stops after three steps when bounds overlap', () => {
      // headEnter above headExit: head and scrub would hand p=0.15 back and
      // forth forever. boundsFromRangePx never builds this; the bound still holds.
      const overlapping = { headEnter: 0.2, headExit: 0.1, tailExit: 0.7, tailEnter: 0.8 }
      assert.equal(stepMode('head', 0.15, overlapping), 'scrub')
    })
  })
}

test('both engines step identically', () => {
  for (const b of [B, REAL]) {
    for (const mode of MODES) {
      for (const p of grid) assert.equal(engines.gsap(mode, p, b), engines.react(mode, p, b), `${mode} @${p}`)
    }
  }
})
