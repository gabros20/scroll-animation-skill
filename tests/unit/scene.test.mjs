// assets/scene.ts: bounds, the live mode stepper, absolute mode, the band and acts. Both engines' pinned scenes run
// these functions, so the stepper is tested once, here.

import './load-ts.mjs'

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

const {
  SCENE_HOLDS,
  actFromProgress,
  bandProgress,
  isNear,
  modeFromProgress,
  progressFromRect,
  rangeFromHeight,
  sceneAt,
  sceneBounds,
  stepAct,
  stepMode
} = await import('../../skills/scroll-animation/assets/scene.ts')

const MODES = ['head', 'scrub', 'tail']

// Round numbers, ordered the way sceneBounds orders them: each end's enter/exit pair is split by its hysteresis gap.
const B = { headEnter: 0.1, headExit: 0.2, tailExit: 0.7, tailEnter: 0.8 }

// What sceneBounds gives for the defaults (headHoldPx 12, tailLeadPx 320, hysteresisRatio 0.7) on the trace
// fixtures' 1800px range at 1440x900.
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
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-12, `${msg}: ${a} vs ${b}`)

describe('sceneBounds', () => {
  test('converts the holds through the measured range, hysteresis as a ratio of each hold', () => {
    const b = sceneBounds(range, SCENE_HOLDS)
    for (const k of Object.keys(REAL)) close(b[k], REAL[k], k)
  })

  test('caps each hold at a quarter of the range, so a short range keeps half of it for the band', () => {
    const b = sceneBounds(400, { headHoldPx: 1000, tailLeadPx: 1000, hysteresisRatio: 0.5 })
    close(b.headExit, 0.25, 'headExit')
    close(b.headEnter, 0.125, 'headEnter')
    close(b.tailEnter, 0.75, 'tailEnter')
    close(b.tailExit, 0.625, 'tailExit')
  })

  test('orders the edges for any range and valid ratio', () => {
    for (const r of [1, 10, 100, 900, 1800, 9000]) {
      for (const ratio of [0, 0.3, 0.7, 1]) {
        const b = sceneBounds(r, { headHoldPx: 12, tailLeadPx: 320, hysteresisRatio: ratio })
        assert.ok(b.headEnter <= b.headExit && b.headExit < b.tailExit + 1e-12 && b.tailExit <= b.tailEnter, `${r} ${ratio}`)
      }
    }
  })

  test('never divides by a zero range', () => {
    const b = sceneBounds(0, SCENE_HOLDS)
    for (const v of Object.values(b)) assert.ok(Number.isFinite(v))
  })
})

describe('stepMode', () => {
  test('takes one step per boundary crossed, with the same edges as v1', () => {
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
    // headEnter above headExit: head and scrub would hand p=0.15 back and forth forever. sceneBounds never builds
    // this; the bound still holds.
    const overlapping = { headEnter: 0.2, headExit: 0.1, tailExit: 0.7, tailEnter: 0.8 }
    assert.equal(stepMode('head', 0.15, overlapping), 'scrub')
  })
})

describe('modeFromProgress', () => {
  test('is the absolute answer a resume needs: head through headExit, tail from tailEnter', () => {
    assert.equal(modeFromProgress(0, B), 'head')
    assert.equal(modeFromProgress(0.2, B), 'head')
    assert.equal(modeFromProgress(0.2001, B), 'scrub')
    assert.equal(modeFromProgress(0.7999, B), 'scrub')
    assert.equal(modeFromProgress(0.8, B), 'tail')
    assert.equal(modeFromProgress(1, B), 'tail')
  })

  test('agrees with the stepper away from the hysteresis gaps', () => {
    for (const p of grid) {
      const inGap = (p >= B.headEnter && p <= B.headExit) || (p >= B.tailExit && p <= B.tailEnter)
      if (inGap) continue
      for (const mode of MODES) assert.equal(stepMode(mode, p, B), modeFromProgress(p, B), `${mode} @${p}`)
    }
  })
})

describe('bandProgress', () => {
  test('maps [headExit, tailEnter] to 0..1 and clamps outside', () => {
    close(bandProgress(0.2, B), 0, 'start')
    close(bandProgress(0.5, B), 0.5, 'middle')
    close(bandProgress(0.8, B), 1, 'end')
    assert.equal(bandProgress(0, B), 0)
    assert.equal(bandProgress(1, B), 1)
  })

  test('puts the trace fixture at the frames v1 recorded (p 0.5 at 1440x900: frame 35.2)', () => {
    const t = bandProgress(0.5, REAL)
    const frame = 5 + t * (55 - 5)
    assert.ok(Math.abs(frame - 35.2) < 0.1, `frame ${frame}`)
  })
})

describe('sceneAt', () => {
  test('re-derives mode, band and bounds from progress alone', () => {
    const at = sceneAt(0.5, range, SCENE_HOLDS)
    assert.equal(at.mode, 'scrub')
    close(at.band, bandProgress(0.5, REAL), 'band')
    assert.equal(sceneAt(0, range, SCENE_HOLDS).mode, 'head')
    assert.equal(sceneAt(0.95, range, SCENE_HOLDS).mode, 'tail')
  })

  test('holds the head under reduced motion', () => {
    const at = sceneAt(0.95, range, SCENE_HOLDS, true)
    assert.equal(at.mode, 'head')
    assert.equal(at.band, 0)
  })
})

describe('acts', () => {
  test('N one-viewport acts land at 1/(N-1): three acts at 0, 1/2 and 1', () => {
    assert.equal(actFromProgress(0, 3), 0)
    assert.equal(actFromProgress(0.5, 3), 1)
    assert.equal(actFromProgress(1, 3), 2)
    assert.equal(actFromProgress(0.24, 3), 0)
    assert.equal(actFromProgress(0.26, 3), 1)
    assert.equal(actFromProgress(0.4, 4), 1)
    assert.equal(actFromProgress(0.7, 4), 2)
  })

  test('no acts, or one, is always act 0; progress outside 0..1 clamps', () => {
    for (const p of [-1, 0, 0.5, 1, 2]) {
      assert.equal(actFromProgress(p, 0), 0)
      assert.equal(actFromProgress(p, 1), 0)
      assert.equal(stepAct(0, p, 1), 0)
    }
    assert.equal(actFromProgress(-0.5, 3), 0)
    assert.equal(actFromProgress(1.5, 3), 2)
  })

  test('the live act switches only past the midpoint plus its hysteresis', () => {
    // Three acts: the midpoint between act 0 and act 1 is p = 0.25; 0.1 acts of hysteresis is 0.05 of progress.
    assert.equal(stepAct(0, 0.29, 3), 0)
    assert.equal(stepAct(0, 0.31, 3), 1)
    assert.equal(stepAct(1, 0.21, 3), 1)
    assert.equal(stepAct(1, 0.19, 3), 0)
  })

  test('a jump crosses every act in one call and lands where the absolute answer does', () => {
    assert.equal(stepAct(0, 1, 5), 4)
    assert.equal(stepAct(4, 0, 5), 0)
    for (const n of [2, 3, 5, 8]) {
      for (const p of grid) {
        const settled = stepAct(stepAct(0, p, n), p, n)
        assert.equal(stepAct(settled, p, n), settled, `stable ${n} @${p}`)
        assert.ok(Math.abs(settled - actFromProgress(p, n)) <= 1, `${n} @${p}`)
      }
    }
  })
})

describe('geometry', () => {
  test('rangeFromHeight is the pin travel, never below 1', () => {
    assert.equal(rangeFromHeight(2700, 900), 1800)
    assert.equal(rangeFromHeight(500, 900), 1)
  })

  test('progressFromRect: 0 above the range, 1 past it, 0 without travel', () => {
    assert.equal(progressFromRect(100, 2700, 900), 0)
    assert.equal(progressFromRect(-900, 2700, 900), 0.5)
    assert.equal(progressFromRect(-5000, 2700, 900), 1)
    assert.equal(progressFromRect(-100, 800, 900), 0)
  })

  test('isNear: within the margin on either side', () => {
    assert.equal(isNear(1000, 3700, 900, 200), true)
    assert.equal(isNear(1200, 3900, 900, 200), false)
    assert.equal(isNear(-2900, -100, 900, 200), true)
    assert.equal(isNear(-3100, -300, 900, 200), false)
  })
})
