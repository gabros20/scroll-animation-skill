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
