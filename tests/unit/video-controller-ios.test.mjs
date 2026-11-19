// assets/media/video-controller.ts under iOS's media policy, found on the Phase 2 device pass: a video that has never
// played gets its metadata, then the network idles with no frame (preload is a hint iOS ignores). The controller must
// keep the poster (a seek clears the poster flag, and there is no frame to paint instead) and prime the data with one
// muted play(). Driven in Node with a fake element and a hand-cranked requestAnimationFrame.

import './load-ts.mjs'

import assert from 'node:assert/strict'
import { test } from 'node:test'

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
// The window's listeners: a refused prime waits on the reader's next activation there.
const win = listeners()
globalThis.addEventListener = win.addEventListener
globalThis.removeEventListener = win.removeEventListener
globalThis.document = { visibilityState: 'visible', documentElement: { dataset: {} }, ...listeners() }
globalThis.location = { search: '' }
globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })

const { createVideoController } = await import('../../skills/scroll-animation/assets/media/video-controller.ts')

function fakeVideo() {
  const attrs = new Map()
  let currentTime = 0
  const video = {
    ...listeners(),
    readyState: 0,
    networkState: 0,
    duration: NaN,
    paused: true,
    seeking: false,
    ended: false,
    muted: false,
    playsInline: false,
    loop: false,
    preload: 'none',
    poster: '',
    seeks: [],
    plays: 0,
    get currentTime() {
      return currentTime
    },
    set currentTime(time) {
      currentTime = time
      video.seeks.push(time)
    },
    get src() {
      return attrs.get('src') ?? ''
    },
    set src(value) {
      attrs.set('src', value)
    },
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute: (name, value) => attrs.set(name, String(value)),
    removeAttribute: (name) => attrs.delete(name),
    querySelector: () => null,
    load() {},
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

let clock = 0
function crank(n) {
  for (let i = 0; i < n; i++) {
    clock += 16
    for (const cb of frames.splice(0)) cb(clock)
  }
}
const settle = () => new Promise((resolve) => setImmediate(resolve))

/** A controller whose source is set and whose metadata is in, with the network in `networkState`. */
function atMetadata(networkState) {
  const video = fakeVideo()
  const controller = createVideoController(video, { fps: 30, src: '/clip.mp4' })
  crank(1) // the tier pick sets the source a frame after mount
  assert.equal(video.getAttribute('src'), '/clip.mp4')
  controller.warm()
  Object.assign(video, { readyState: 1, networkState, duration: 8 })
  video.dispatch('loadedmetadata')
  controller.setMode('scrub')
  controller.setBand(0.5)
  controller.setAwake(true)
  return { video, controller }
}

test('iOS, metadata then an idle network: no seek before a frame (the poster stays), one muted play() primes', async () => {
  const { video, controller } = atMetadata(1)
  crank(30)
  assert.deepEqual(video.seeks, [], 'nothing seeks before a frame exists')
  assert.equal(video.plays, 1, 'one prime')
  await settle()
  assert.equal(video.paused, true, 'the prime pauses again: no loop owns the scrub')

  Object.assign(video, { readyState: 4 })
  video.dispatch('loadeddata')
  crank(5)
  assert.ok(video.seeks.length > 0, 'with a frame, the glide seeks toward the band')
  crank(60)
  assert.equal(video.plays, 1, 'primed once per source')
  controller.destroy()
})

test('a load still running (desktop) is left alone: no prime, and no seek until a frame', () => {
  const { video, controller } = atMetadata(2)
  crank(30)
  assert.equal(video.plays, 0, 'no prime while the network is loading')
  assert.deepEqual(video.seeks, [], 'no seek before a frame exists')
  controller.destroy()
})

test('a refused prime (Low Power Mode) keeps the poster: still no seek', async () => {
  const video = fakeVideo()
  video.play = () => {
    video.plays++
    return Promise.reject(Object.assign(new Error('refused'), { name: 'NotAllowedError' }))
  }
  const controller = createVideoController(video, { fps: 30, src: '/clip.mp4' })
  crank(1)
  Object.assign(video, { readyState: 1, networkState: 1, duration: 8 })
  video.dispatch('loadedmetadata')
  controller.setMode('scrub')
  controller.setBand(0.5)
  controller.setAwake(true)
  crank(30)
  await settle()
  crank(30)
  assert.equal(video.plays, 1, 'one attempt, no retry loop')
  assert.deepEqual(video.seeks, [], 'the poster stays: no seek without a frame')
  assert.equal(controller.debug().video?.rejections ?? controller.debug().rejections, 1, 'the refusal is counted')
  controller.destroy()
})

/** A controller whose prime iOS refuses (Low Power Mode) until `allow()`. */
function refusing() {
  const video = fakeVideo()
  let refuse = true
  video.play = () => {
    video.plays++
    if (refuse) return Promise.reject(Object.assign(new Error('refused'), { name: 'NotAllowedError' }))
    video.paused = false
    return Promise.resolve()
  }
  const controller = createVideoController(video, { fps: 30, src: '/clip.mp4' })
  crank(1)
  Object.assign(video, { readyState: 1, networkState: 1, duration: 8 })
  video.dispatch('loadedmetadata')
  controller.setMode('scrub')
  controller.setBand(0.5)
  controller.setAwake(true)
  return { video, controller, allow: () => (refuse = false) }
}

test('a refused prime retries inside the reader\'s next activation: touchend or a click, never touchstart', async () => {
  const { video, controller, allow } = refusing()
  crank(30)
  await settle()
  assert.equal(video.plays, 1, 'the refused prime')
  win.dispatch('touchstart')
  assert.equal(video.plays, 1, 'touchstart grants no activation: no retry')
  allow()
  win.dispatch('touchend')
  assert.equal(video.plays, 2, 'the lift retries the prime, inside the event')
  await settle()
  crank(30)
  assert.equal(video.plays, 2, 'no retry loop: only activations retry')
  // The played source loads: once it shows a frame the listener is gone.
  Object.assign(video, { readyState: 4 })
  crank(2)
  win.dispatch('click')
  assert.equal(video.plays, 2, 'a framed source never primes on a tap')
  controller.destroy()
})

/** A play the browser grants only inside a gesture event (WebKit: a tap's touchend or click), refused otherwise. */
function gestureOnly(video) {
  let inGesture = false
  video.play = () => {
    video.plays++
    if (!inGesture) return Promise.reject(Object.assign(new Error('refused'), { name: 'NotAllowedError' }))
    video.paused = false
    return Promise.resolve()
  }
  return (type) => {
    inGesture = type === 'touchend' || type === 'click'
    win.dispatch(type)
    inGesture = false
  }
}

test('one tap retries on each of its events: the pointerup before it does not use up the touchend', async () => {
  const { video, controller } = refusing()
  const tap = gestureOnly(video)
  crank(30)
  await settle()
  const before = video.plays
  tap('pointerup')
  tap('touchend')
  assert.ok(video.plays >= before + 2, 'the pointerup and the touchend each retried, synchronously')
  assert.equal(video.paused, false, 'the touchend, which carries the gesture, played')
  controller.destroy()
})

test('a refused play() left pending for good still leaves the next tap a retry', async () => {
  const video = fakeVideo()
  let pend = true
  video.play = () => {
    video.plays++
    if (pend) return new Promise(() => {})
    video.paused = false
    return Promise.resolve()
  }
  const controller = createVideoController(video, { fps: 30, src: '/clip.mp4' })
  crank(1)
  Object.assign(video, { readyState: 1, networkState: 1, duration: 8 })
  video.dispatch('loadedmetadata')
  controller.setMode('scrub')
  controller.setBand(0.5)
  controller.setAwake(true)
  crank(30)
  await settle()
  assert.equal(video.plays, 1, 'the first prime pends: never resolved, never refused')
  pend = false
  win.dispatch('touchend')
  assert.equal(video.plays, 2, 'the tap still retries')
  controller.destroy()
})

test('a source that loses its data (iOS dropping a sleeping clip) is primed again, and a tap can unlock it', async () => {
  const { video, controller, allow } = refusing()
  allow()
  crank(30)
  await settle()
  Object.assign(video, { readyState: 4, paused: true })
  crank(3)
  const primed = video.plays
  // Asleep and back: the element kept its metadata but no frame, and nothing is seeking.
  controller.setAwake(false)
  Object.assign(video, { readyState: 1, seeking: false, networkState: 1 })
  controller.setAwake(true)
  crank(5)
  assert.equal(video.plays, primed + 1, 'primed again once the frame is gone')
  controller.destroy()
})

test('destroy drops a pending activation retry', async () => {
  const { video, controller } = refusing()
  crank(30)
  await settle()
  controller.destroy()
  win.dispatch('touchend')
  win.dispatch('click')
  assert.equal(video.plays, 1, 'no prime after destroy')
})

test('a tap while the scene sleeps fetches nothing; the retry waits for the scene to run', async () => {
  const { video, controller, allow } = refusing()
  crank(30)
  await settle()
  allow()
  controller.setAwake(false)
  win.dispatch('touchend')
  assert.equal(video.plays, 1, 'asleep: no prime, so a far-away clip fetches nothing')
  controller.setAwake(true)
  crank(5)
  win.dispatch('touchend')
  assert.equal(video.plays, 2, 'running again: the next activation retries')
  controller.destroy()
})
