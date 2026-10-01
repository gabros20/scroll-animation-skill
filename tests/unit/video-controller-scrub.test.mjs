// assets/media/video-controller.ts, the band driver, from the device pass 2 report (iPhone, Folio's orbit, a scene of
// holds): scrolling back up, the rotation started late and then sped up to catch the scroll; skimming down, it
// stuttered and trailed. Measured in the iOS 18.6 simulator with a frame code burned into the clip:
// - the tail hold latched through the mode's hysteresis: the last frame stayed up for 280 px (54 frames of band) on
//   the way back, then the glide spun through ~40 frames in 100 ms to catch up;
// - the glide trailed a skim by ~30 frames (84 ms of scroll), leapt after every long main-thread frame (its rate is
//   dt-scaled), and it advanced once per LANDED seek, so a decoder slower than a frame multiplied the lag;
// - the glide came to rest up to half a frame short: the tail showed frame 238 of 239.
// Driven in Node with a fake element whose seeks land a set number of frames after they are sent.

import './load-ts.mjs'

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

const frames = []
globalThis.requestAnimationFrame = (cb) => frames.push(cb)
globalThis.cancelAnimationFrame = () => {}

function listeners() {
  const map = new Map()
  return {
    addEventListener: (type, fn) => map.set(type, [...(map.get(type) ?? []), fn]),
    removeEventListener: (type, fn) => map.set(type, (map.get(type) ?? []).filter((g) => g !== fn)),
    dispatch: (type) => (map.get(type) ?? []).forEach((fn) => fn({ type })),
  }
}

globalThis.window = globalThis
globalThis.document = { visibilityState: 'visible', documentElement: { dataset: {} }, ...listeners() }
globalThis.location = { search: '' }
globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })

const { createVideoController, frameOf, frameTime, wantedFrame, FRAME_BIAS } = await import(
  '../../skills/scroll-animation/assets/media/video-controller.ts'
)

const FPS = 30
// The orbit's clip: 240 frames, 8 s; with holds the band spans frames 0..239.
const LAST = 239
// The band's frame the way the controller works it out (band × the band's span in seconds, then to the nearest frame).
const frameAt = (band) => wantedFrame(band * (LAST / FPS), FPS, LAST)

let clock = 0
// The band the scene last handed over, stamped on each seek so a test can say what the seek should have asked for.
const scene = { band: 0 }

/** An element with data, whose seeks land `latency` frames after they are sent (Gecko's model: a new seek replaces
 * one in flight). `shown` is the frame the last landed seek put on screen. */
function fakeVideo(latency) {
  let time = 0
  const video = {
    ...listeners(),
    readyState: 4,
    networkState: 1,
    duration: 8,
    paused: true,
    seeking: false,
    ended: false,
    muted: false,
    playsInline: false,
    loop: false,
    preload: 'auto',
    poster: '',
    landAt: 0,
    shown: 0,
    seeks: [],
    get currentTime() {
      return time
    },
    set currentTime(t) {
      time = t
      video.seeks.push({ frame: frameOf(t, FPS), time: t, band: scene.band, busy: video.seeking, at: clock })
      video.seeking = true
      video.landAt = clock + latency
    },
    /** Playback moving the playhead (a loop), not a seek. */
    playTo(t) {
      time = t
      video.shown = frameOf(t, FPS)
    },
    getAttribute: (name) => (name === 'src' ? '/clip.mp4' : null),
    setAttribute() {},
    removeAttribute() {},
    querySelector: () => null,
    load() {},
    play() {
      video.paused = false
      return Promise.resolve()
    },
    pause() {
      video.paused = true
    },
  }
  return video
}

/** One display frame: a seek due now lands (`seeked` runs between frames), then the frame's rAF callbacks. `gap`
 * stretches the frame by that many frames, a busy main thread. */
function crank(video, n = 1, gap = 0) {
  for (let i = 0; i < n; i++) {
    clock += 1 + gap
    if (video.seeking && clock >= video.landAt) {
      video.seeking = false
      video.shown = frameOf(video.currentTime, FPS)
      video.dispatch('seeked')
    }
    for (const cb of frames.splice(0)) cb(clock * 16.667)
  }
}

/** A running controller on a scene of holds (or the given loops), resting at `band` in `mode`. */
function setup({ latency = 1, mode = 'scrub', band = 0, headLoop = null } = {}) {
  frames.length = 0
  const video = fakeVideo(latency)
  const controller = createVideoController(video, { fps: FPS, headLoop })
  scene.band = band
  controller.setAwake(true)
  controller.rehydrate({ mode, band, awake: true })
  crank(video, latency + 2)
  video.seeks.length = 0
  return { video, controller }
}

/** The scene's order on a progress event: the mode steps first, then the band follows. */
function progress(controller, band, mode) {
  if (mode) controller.setMode(mode)
  scene.band = band
  controller.setBand(band)
}

describe('frames', () => {
  test('a seek lands a quarter frame into its frame, and reads back as that frame', () => {
    assert.equal(FRAME_BIAS, 0.25)
    for (const f of [0, 1, 29, 30, 120, 238, 239]) assert.equal(frameOf(frameTime(f, FPS), FPS), f)
  })

  test('the frame showing at a time is the one whose span contains it, float noise included', () => {
    assert.equal(frameOf(239 / 30, 30), 239)
    assert.equal(frameOf(7.953, 30), 238)
    assert.equal(frameOf(0, 30), 0)
  })

  test('the wanted frame is the nearest, clamped to the clip', () => {
    assert.equal(wantedFrame(4.0, 30, 239), 120)
    assert.equal(wantedFrame(7.9667, 30, 239), 239)
    assert.equal(wantedFrame(9, 30, 239), 239)
    assert.equal(wantedFrame(-1, 30, 239), 0)
    assert.equal(wantedFrame(9, 30, Number.NaN), 270)
  })
})

describe('holds follow the band in every mode', () => {
  test('on the way back the tail lets go with the band, not after the mode hysteresis', () => {
    const { video, controller } = setup({ mode: 'tail', band: 1 })
    assert.equal(video.shown, LAST, 'resting in the tail on the clip last frame')
    // Scrolling up: the band leaves its end while the scene keeps `tail` (it steps back at tailExit, 280 px on).
    for (const band of [0.97, 0.93, 0.89, 0.85, 0.81]) {
      progress(controller, band)
      crank(video, 3)
      assert.equal(video.shown, frameAt(band), `band ${band} in tail mode`)
    }
    controller.destroy()
  })

  test('the head hold is frame 0 and stays with the band as the scrub starts', () => {
    const { video, controller } = setup({ mode: 'head', band: 0 })
    assert.equal(video.shown, 0)
    progress(controller, 0.02, 'scrub')
    crank(video, 3)
    assert.equal(video.shown, frameAt(0.02))
    controller.destroy()
  })
})

describe('the band tracks the scroll frame for frame', () => {
  test('a band step is one seek, straight to the band frame (no glide in the band)', () => {
    const { video, controller } = setup({ band: 0.3 })
    progress(controller, 0.6)
    crank(video, 20)
    assert.deepEqual(
      video.seeks.map((s) => s.frame),
      [frameAt(0.6)],
    )
    controller.destroy()
  })

  test('comes to rest on the exact frame: the last frame at the band end, not the one before', () => {
    const { video, controller } = setup({ band: 0.9 })
    progress(controller, 1)
    crank(video, 20)
    assert.equal(video.shown, LAST)
    controller.destroy()
  })

  test('a move inside the frame on screen sends no seek', () => {
    const { video, controller } = setup({ band: 120 / LAST })
    progress(controller, 120.3 / LAST)
    crank(video, 5)
    progress(controller, 119.7 / LAST)
    crank(video, 5)
    assert.equal(video.seeks.length, 0)
    controller.destroy()
  })

  test('a long frame (a busy main thread) moves the playhead no further than the scroll moved', () => {
    const { video, controller } = setup({ band: 0 })
    // A steady scroll, 4 frames of band per display frame, with one 100 ms frame in the middle.
    let band = 0
    let worstOvershoot = 0
    for (let i = 1; i <= 40; i++) {
      const gap = i === 20 ? 5 : 0
      const before = video.shown
      const step = 4 * (1 + gap)
      band = Math.min(1, band + step / LAST)
      progress(controller, band)
      crank(video, 1, gap)
      worstOvershoot = Math.max(worstOvershoot, video.shown - before - step)
    }
    assert.ok(worstOvershoot <= 0, `the playhead stepped ${worstOvershoot} frames further than the scroll in one frame`)
    controller.destroy()
  })
})

describe('a decoder slower than a frame', () => {
  // A skim: the band crosses the clip in 60 frames (240 frames of video a second) while each seek takes 3 frames.
  function skim(latency) {
    const { video, controller } = setup({ latency, band: 0 })
    let worst = 0
    for (let i = 1; i <= 60; i++) {
      progress(controller, i / 60)
      crank(video)
      worst = Math.max(worst, frameAt(i / 60) - video.shown)
    }
    crank(video, 2 * latency + 2)
    return { video, controller, worst }
  }

  test('never has two seeks in flight, and each one asks for the band frame at the moment it goes out', () => {
    const { video, controller } = skim(3)
    assert.ok(video.seeks.length > 10, `${video.seeks.length} seeks`)
    assert.ok(video.seeks.every((s) => !s.busy), 'a seek was sent while one was in flight')
    for (const s of video.seeks) assert.equal(s.frame, frameAt(s.band), `seek at clock ${s.at}`)
    controller.destroy()
  })

  test('the screen trails the scroll by what one seek takes, and lands on the band when it stops', () => {
    const { video, controller, worst } = skim(3)
    // 4 frames of band per display frame. The frame on screen was asked for when its seek went out, 3 frames before
    // it landed, and stays up until the next one lands 3 frames later: 4 × (2 × 3 − 1) at worst. The old glide, a
    // step per landed seek, trailed this skim by up to 77 frames.
    assert.ok(worst <= 4 * (2 * 3 - 1), `trailed by ${worst} frames`)
    assert.equal(video.shown, LAST)
    controller.destroy()
  })
})

describe('the handover out of a loop', () => {
  test('glides from the frame the loop left toward the band, then tracks it', () => {
    const headLoop = { fromFrame: 32, matchFrame: 80 }
    const { video, controller } = setup({ mode: 'head', band: 0, headLoop })
    // The loop is playing, on frame 50, when a fast scroll lands deep in the band in one progress event.
    video.playTo(50 / FPS)
    const band = 0.5
    // The scene steps the mode before it hands over the band (both adapters).
    progress(controller, band, 'scrub')
    const target = wantedFrame(80 / FPS + band * ((LAST - 80) / FPS), FPS, LAST)
    crank(video, 2)
    const first = video.seeks[0]?.frame
    assert.ok(first > 50 && first < target, `first seek ${first}: a glide from 50 toward ${target}, not a cut`)
    crank(video, 60)
    assert.equal(video.shown, target, 'then on the band')
    assert.equal(video.paused, true, 'the decoder is paused in the band')
    controller.destroy()
  })
})

describe('a resume mid-scroll', () => {
  // iOS fires `resize` many times as its toolbar hides or shows during a scroll, and the scene rehydrates on each one:
  // the controller snaps the playhead to where scroll says. Tracking the band, it is already there; the glide trailed
  // it, so each of those snaps jumped the picture forward by the glide's lag.
  test('moves the frame on screen no further than the scroll moved', () => {
    const { video, controller } = setup({ band: 0 })
    let biggest = 0
    for (let i = 1; i <= 30; i++) {
      const before = video.shown
      progress(controller, i / 60)
      if (i === 20) controller.rehydrate({ mode: 'scrub', band: i / 60, awake: true, reason: 'resize' })
      crank(video)
      biggest = Math.max(biggest, video.shown - before)
    }
    // 4 frames of band per display frame, and one of rounding.
    assert.ok(biggest <= 5, `the frame on screen stepped ${biggest} frames in one display frame`)
    controller.destroy()
  })
})
