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
// The window's listeners: the controller arms its activation retry from creation.
const win = listeners()
globalThis.addEventListener = win.addEventListener
globalThis.removeEventListener = win.removeEventListener
globalThis.document = { visibilityState: 'visible', documentElement: { dataset: {} }, ...listeners() }
globalThis.location = { search: '' }
globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })

const { createVideoController, frameOf, frameTime, wantedFrame, FRAME_BIAS, STUCK_SEEK_MS, KICK_PLAYING_MS, LIFT_STALL_MS } = await import(
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
 * one in flight). `shown` is the frame the last landed seek put on screen. While a seek is pending `readyState` is
 * HAVE_METADATA (1), back to 4 on `seeked`, as measured in Chromium. */
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
      video.readyState = 1
      video.landAt = video.hang ? Infinity : clock + latency
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
    plays: 0,
    play() {
      video.plays++
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
      video.readyState = 4
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

describe('a seek that never answers', () => {
  // iOS has been seen to leave a seek `seeking` for good: with one seek in flight, that froze the frame for the visit.
  // The fake holds readyState at 1 while seeking, so this runs through the tick's wait for a frame, as in a browser.
  test('is sent again once STUCK_SEEK_MS passes without `seeked`, and not before', () => {
    const realNow = performance.now
    let now = 0
    performance.now = () => now
    try {
      const { video, controller } = setup()
      video.hang = true
      progress(controller, 0.5)
      crank(video, 1)
      const sent = video.seeks.length
      assert.equal(sent, 1, 'the band sends its frame')
      now += STUCK_SEEK_MS - 100
      crank(video, 10)
      progress(controller, 0.5)
      assert.equal(video.seeks.length, sent, 'still waiting: a slow seek is not a hung one')
      assert.equal(controller.debug().reseeks, 0, 'scroll events while waiting send nothing and count nothing')
      now += 200
      crank(video, 1)
      assert.equal(video.seeks.length, sent + 1, 're-sent once past the threshold')
      assert.equal(video.seeks.at(-1).frame, frameAt(0.5), 'the band\'s frame again')
      assert.equal(controller.debug().reseeks, 1)
      video.hang = false
      now += STUCK_SEEK_MS + 100
      crank(video, 3)
      assert.equal(video.shown, frameAt(0.5), 'the re-sent seek lands the band\'s frame')
      controller.destroy()
    } finally {
      performance.now = realNow
    }
  })
})

describe('priming', () => {
  // Found in Chromium: a pending seek drops readyState to 1, and a tick that then primed played a held tail from its
  // last frame to the clip's end (frame 60 of 60 on the holds check).
  test('a source that has shown a frame is never primed while a seek is pending', () => {
    // Seeks land three frames after they are sent, so ticks run while one is pending.
    const { video, controller } = setup({ latency: 3 })
    progress(controller, 1, 'tail')
    for (let i = 0; i < 5; i++) {
      crank(video, 1)
      progress(controller, 1 - i * 0.01)
    }
    assert.equal(video.plays, 0, 'no play() in a scene of holds')
    controller.destroy()
  })
})

describe('a first seek sent from a scroll event', () => {
  // setBand() can send the first seek before any tick has seen the frame; it drops readyState to 1, so the source
  // must already count as framed there, or a hang on that seek is never re-sent.
  test('is re-sent when it hangs, though no tick saw a frame before it', () => {
    const realNow = performance.now
    let now = 0
    performance.now = () => now
    try {
      frames.length = 0
      const video = fakeVideo(1)
      const controller = createVideoController(video, { fps: FPS })
      controller.setAwake(true)
      video.hang = true
      scene.band = 0.5
      controller.setBand(0.5)
      assert.equal(video.seeks.length, 1, 'the scroll event sends the first seek')
      now += STUCK_SEEK_MS + 100
      crank(video, 2)
      assert.equal(video.seeks.length, 2, 're-sent from the tick')
      assert.equal(video.plays, 0, 'and never primed mid-seek')
      controller.destroy()
    } finally {
      performance.now = realNow
    }
  })
})

describe('the kick after a hide', () => {
  // Found on the device (iPhone, Low Power Mode, a 1-2 s lock): seeks land, currentTime follows the scroll at
  // readyState 4, frame callbacks fire, and the picture stays on the old frame until the element plays. Nothing a page
  // reads reports it, so every return from hidden kicks unconditionally, behind the cover: two frames, play(), the
  // `playing` event, pause(), the band's frame. No `playing`: one retry, then load() and a fresh prime, then blocked.
  // Never a clone (a new element loses the unlock) and never a play() mid-scrub.

  /** play() as the element answers it: 'ok' plays and fires `playing`, 'refuse' rejects, 'hang' never settles. */
  function scripted(video, answers) {
    video.play = () => {
      video.plays++
      const answer = answers.length ? answers.shift() : 'ok'
      if (answer === 'refuse') return Promise.reject(new DOMException('refused', 'NotAllowedError'))
      if (answer === 'hang') return new Promise(() => {})
      video.paused = false
      return Promise.resolve().then(() => video.dispatch('playing'))
    }
    video.loads = 0
    video.load = () => video.loads++
    video.cloneNode = () => assert.fail('the ladder never clones the element')
  }

  function hideAndReturn() {
    document.visibilityState = 'hidden'
    document.dispatch('visibilitychange')
    document.visibilityState = 'visible'
    document.dispatch('visibilitychange')
  }

  const settle = () => new Promise((resolve) => setImmediate(resolve))
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  test('every return kicks behind the cover, lifts on the band frame, and never plays mid-scrub after', async () => {
    const { video, controller } = setup({ band: 0.4 })
    scripted(video, [])
    crank(video, 4)
    assert.equal(controller.debug().media, 'live')
    for (let round = 1; round <= 2; round++) {
      document.visibilityState = 'hidden'
      document.dispatch('visibilitychange')
      assert.equal(controller.debug().media, '', 'the cover goes up on the hide')
      document.visibilityState = 'visible'
      document.dispatch('visibilitychange')
      const plays = video.plays
      crank(video, 2)
      assert.equal(video.plays, plays, 'two frames pass before the play')
      crank(video, 1)
      assert.equal(video.plays, plays + 1, 'then one play()')
      await settle()
      assert.equal(video.paused, true, 'paused on `playing`')
      assert.equal(controller.debug().media, '', 'still covered while the band seek is in flight')
      crank(video, 3)
      const d = controller.debug()
      assert.equal(d.media, 'live', 'lifted once the seek landed, plus a frame')
      assert.equal(d.kicks, round)
      assert.equal(d.kickOk, round)
      assert.equal(d.kickFail, 0)
      assert.equal(video.shown, frameAt(0.4), 'on the band frame')
    }
    // The scrub after it: seeks only.
    const plays = video.plays
    for (const band of [0.45, 0.5, 0.55, 0.6]) {
      progress(controller, band)
      crank(video, 3)
    }
    assert.equal(video.plays, plays, 'no play() mid-scrub')
    assert.equal(video.shown, frameAt(0.6))
    controller.destroy()
  })

  test('refused on every rung: a retry, then load() and a fresh prime, then blocked with the tap armed', async () => {
    const { video, controller } = setup({ band: 0.4 })
    scripted(video, ['refuse', 'refuse', 'refuse'])
    crank(video, 4)
    hideAndReturn()
    crank(video, 3)
    await settle()
    let d = controller.debug()
    assert.equal(d.kickFail, 1)
    assert.equal(d.kicking, '2:wait', 'the retry waits its two frames')
    assert.equal(video.loads, 0)
    crank(video, 2)
    // The retry refused, the load() and its prime go out at once, and that refusal reads blocked.
    await settle()
    d = controller.debug()
    assert.equal(d.kickFail, 3, 'the retry and the fresh prime were refused too')
    assert.equal(video.loads, 1, 'one load()')
    assert.equal(d.loads, 1)
    assert.equal(d.media, 'blocked')
    assert.equal(d.kicking, null)
    assert.equal(video.plays, 3, 'no fourth play until a tap')
    crank(video, 6)
    await settle()
    assert.equal(video.plays, 3, 'nor from the tick')
    // The tap: the prime inside it plays, and the band frame lifts the cover.
    scripted(video, [])
    win.dispatch('touchend')
    await settle()
    crank(video, 6)
    assert.equal(controller.debug().media, 'live')
    assert.equal(video.shown, frameAt(0.4))
    controller.destroy()
  })

  test('a play that never starts times out and the retry recovers', async () => {
    const { video, controller } = setup({ band: 0.4 })
    scripted(video, ['hang'])
    crank(video, 4)
    hideAndReturn()
    crank(video, 3)
    assert.equal(controller.debug().kicking, '1:play')
    await wait(KICK_PLAYING_MS + 50)
    assert.equal(controller.debug().kickFail, 1)
    crank(video, 2)
    await settle()
    crank(video, 3)
    const d = controller.debug()
    assert.equal(d.kickOk, 1)
    assert.equal(d.loads, 0, 'no load() when the retry plays')
    assert.equal(d.media, 'live')
    controller.destroy()
  })

  test('focus kicks only after a hide, and takes a visible return that went unreported', async () => {
    const { video, controller } = setup({ band: 0.4 })
    scripted(video, [])
    crank(video, 4)
    win.dispatch('focus')
    crank(video, 4)
    assert.equal(controller.debug().kicks, 0, 'a focus with no hide is not a return from hidden')
    assert.equal(controller.debug().media, 'live')
    document.visibilityState = 'hidden'
    document.dispatch('visibilitychange')
    document.visibilityState = 'visible'
    win.dispatch('focus')
    crank(video, 3)
    await settle()
    crank(video, 3)
    assert.equal(controller.debug().kicks, 1)
    assert.equal(controller.debug().media, 'live')
    controller.destroy()
  })

  // Found on the device (iPhone, Low Power Mode, refreshed in view, the tap unlocked by play): readyState 4,
  // currentTime following the scroll through three stuck-seek resends, one frame callback, and `media` '' for good:
  // the poster never lifted. Covered over a frame with no lift for LIFT_STALL_MS, the controller kicks behind the
  // cover; a play unwedges what a paused seek can't, and past two such kicks the scene reads blocked for a tap.

  /** Covered at band 0.4 with every seek wedged (never landing) until a play `unwedges` (or forever). */
  function wedged({ unwedges = true } = {}) {
    frames.length = 0
    const video = fakeVideo(1)
    video.hang = true
    // As on the device: readyState 4 throughout, the seek pending or not.
    Object.defineProperty(video, 'readyState', { get: () => 4, set() {} })
    video.play = () => {
      video.plays++
      video.paused = false
      if (unwedges) {
        video.hang = false
        if (video.seeking) video.landAt = clock + 1
      }
      return Promise.resolve().then(() => video.dispatch('playing'))
    }
    const controller = createVideoController(video, { fps: FPS })
    scene.band = 0.4
    controller.setAwake(true)
    controller.rehydrate({ mode: 'scrub', band: 0.4, awake: true })
    return { video, controller }
  }
  const stallFrames = Math.ceil(LIFT_STALL_MS / 16.667) + 2

  test('covered over a frame whose seeks never land: a kick after LIFT_STALL_MS, and its play lifts on the band frame', async () => {
    const { video, controller } = wedged()
    crank(video, 10)
    assert.equal(controller.debug().media, '', 'the seek is wedged: covered')
    assert.equal(controller.debug().kicks, 0, 'not yet')
    crank(video, stallFrames)
    let d = controller.debug()
    assert.equal(d.stalls, 1)
    assert.equal(d.kicks, 1, 'the watchdog kicks')
    crank(video, 2)
    await settle()
    crank(video, 4)
    d = controller.debug()
    assert.equal(d.media, 'live', 'lifted once the kick\'s seek landed, plus a frame')
    assert.equal(video.shown, frameAt(0.4), 'on the band frame')
    assert.equal(video.paused, true)
    const plays = video.plays
    for (const band of [0.45, 0.5, 0.55]) {
      progress(controller, band)
      crank(video, 3)
    }
    assert.equal(video.plays, plays, 'no play() mid-scrub')
    assert.equal(video.shown, frameAt(0.55))
    controller.destroy()
  })

  test('a kick whose `seeked` never comes lifts anyway once the seek has landed on the band frame', async () => {
    const { video, controller } = wedged({ unwedges: false })
    crank(video, stallFrames + 1)
    crank(video, 2)
    await settle()
    // The kick's seek went out; the element lands it but never says so.
    assert.equal(controller.debug().kicking, '1:seek')
    Object.assign(video, { seeking: false, landAt: Infinity })
    await wait(STUCK_SEEK_MS + 50)
    assert.equal(controller.debug().media, 'live')
    controller.destroy()
  })

  test('never covered for good: past two stalled kicks the scene reads blocked, and the tap retry is armed', async () => {
    const { video, controller } = wedged({ unwedges: false })
    for (let kick = 1; kick <= 2; kick++) {
      crank(video, stallFrames)
      crank(video, 2)
      await settle()
      assert.equal(controller.debug().kicks, kick)
      await wait(STUCK_SEEK_MS + 50)
      assert.equal(controller.debug().media, '', 'the seek never landed: still covered, no lift')
    }
    crank(video, stallFrames)
    const d = controller.debug()
    assert.equal(d.media, 'blocked', 'the next tap reloads it')
    assert.equal(d.stalls, 3)
    assert.equal(d.kicks, 2)
    controller.destroy()
  })
})
