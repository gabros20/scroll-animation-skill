// assets/media/video-controller.ts, the pure half: the timeline, band <-> time, snap targets, the wrap rule and the
// dt-based glide. The decoder loop itself is traced in browsers (tests/scene-traces.mjs).

import './load-ts.mjs'

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

const { bandTime, glideAlpha, lastFrame, targetTime, timeBand, videoTimeline, wrapDue } = await import(
  '../../skills/scroll-animation/assets/media/video-controller.ts'
)

const near = (a, b, msg, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`)

// The trace fixtures' clip: 2 s at 30 fps, frames 0..59; head loop 0..4 (match 5), tail loop 55..58 (match 59).
const FPS = 30
const loops = videoTimeline(FPS, { fromFrame: 0, matchFrame: 5 }, { fromFrame: 55 }, 2)

describe('videoTimeline', () => {
  test('loops: the head sits at its first frame, the band runs from its match frame to the tail loop', () => {
    near(loops.headFrom, 0, 'headFrom')
    near(loops.scrubFrom, 5 / 30, 'scrubFrom')
    near(loops.tailFrom, 55 / 30, 'tailFrom')
    assert.equal(loops.headMatch, 5)
    assert.equal(loops.tailLoop, true)
    near(loops.glideRest, 0.5 / 30, 'glideRest')
  })

  test('holds: frame 0 and the clip last frame, which waits for the duration', () => {
    const holds = videoTimeline(FPS, null, null, 2)
    near(holds.headFrom, 0, 'headFrom')
    near(holds.scrubFrom, 0, 'scrubFrom')
    near(holds.tailFrom, 59 / 30, 'tailFrom')
    assert.equal(holds.headMatch, null)
    assert.equal(holds.tailLoop, false)
    assert.ok(Number.isNaN(videoTimeline(FPS, null, null).tailFrom))
  })

  test('lastFrame reads the clip length, NaN until it is known', () => {
    assert.equal(lastFrame(2, 30), 59)
    assert.equal(lastFrame(9.4333, 30), 282)
    assert.ok(Number.isNaN(lastFrame(Number.NaN, 30)))
    assert.ok(Number.isNaN(lastFrame(0, 30)))
  })
})

describe('band and time', () => {
  test('bandTime spans the band and clamps; timeBand inverts it', () => {
    near(bandTime(0, loops), 5 / 30, 'start')
    near(bandTime(1, loops), 55 / 30, 'end')
    near(bandTime(2, loops), 55 / 30, 'clamped')
    for (const b of [0, 0.1, 0.5, 0.9, 1]) near(timeBand(bandTime(b, loops), loops), b, `round trip ${b}`)
    assert.equal(timeBand(0, loops), 0)
    assert.equal(timeBand(10, loops), 1)
  })

  test('targetTime: the head loop start, the band position, the tail loop start', () => {
    near(targetTime('head', 0.7, loops), 0, 'head')
    near(targetTime('scrub', 0.5, loops), bandTime(0.5, loops), 'scrub')
    near(targetTime('tail', 0.2, loops), 55 / 30, 'tail')
  })
})

describe('wrapDue', () => {
  const f = (n) => n / FPS
  const tail = (presented, playback) => wrapDue(f(presented), f(playback), 59, f(55), FPS)
  const head = (presented, playback) => wrapDue(f(presented), f(playback), 5, 0, FPS)

  test('on time, it is the presented-frame rule: wrap once the loop last frame is presented', () => {
    // Chromium fires frame callbacks ahead of presentation, so the playback position trails the presented frame.
    assert.equal(tail(57, 56.5), false)
    assert.equal(tail(58, 57.45), true)
    assert.equal(head(3, 2.6), false)
    assert.equal(head(4, 3.5), true)
  })

  test('a callback running about 0.8 of a frame late (WebKit) still waits for the last frame', () => {
    assert.equal(tail(57, 57.8), false)
    assert.equal(tail(58, 58.8), true)
  })

  test('a callback more than a frame late wraps as soon as the last frame is due', () => {
    assert.equal(tail(57, 58.1), true)
    assert.equal(head(3, 4.05), true)
  })

  test('a playhead below the loop (arriving from the band) wraps at once', () => {
    assert.equal(tail(53, 53.2), true)
    assert.equal(tail(55, 55.1), false)
  })

  test('floating-point frame times land on the frame they name', () => {
    assert.equal(wrapDue(1.8999999999999997, 58 / 30 - 1e-12, 59, 55 / 30, FPS), true)
  })
})

describe('glideAlpha', () => {
  test('is the configured rate at 60 Hz, and the same approach per second at 120 Hz', () => {
    near(glideAlpha(0.18, 1000 / 60), 0.18, '60 Hz')
    const half = glideAlpha(0.18, 1000 / 120)
    near(1 - (1 - half) ** 2, 0.18, 'two 120 Hz frames')
    assert.equal(glideAlpha(0.18, 0), 0)
  })
})
