// render-bridge.ts: a pinned scene's exact progress feeds the 3d skill's conductor (vendored in
// tests/fixtures/render-bridge), and `frame()` renders only when the scene is awake, the page visible and the bridge
// dirty (input since the last render, smooth still settling after a render that ticked, or priming after a mount,
// resume, rehydrate or requestRender, PRIME_FRAMES at most). Reduced motion holds; the route refresh is registered
// while the bridge lives; destroy() is idempotent and leaves the bridge inert. The GSAP adapter owns one ticker
// callback, and the Motion hook renders on the server. The browser half is tests/render-bridge.mjs.

import './load-ts.mjs'

import assert from 'node:assert/strict'
import { test } from 'node:test'

globalThis.document = { visibilityState: 'visible' }

const { PRIME_FRAMES, createRenderBridge } = await import('../../skills/scroll-animation/assets/render-bridge.ts')
const { routeChanged } = await import('../../skills/scroll-animation/assets/smooth/route.ts')
const { createConductor } = await import('../fixtures/render-bridge/src/vendor-3d/conductor.ts')

const CHAPTERS = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

function fakeScene({ awake = true, reduced = false } = {}) {
  const scene = { isAwake: awake, isReduced: reduced, rehydrates: [] }
  scene.awake = () => scene.isAwake
  scene.reduced = () => scene.isReduced
  scene.rehydrate = (reason) => scene.rehydrates.push(reason)
  return scene
}

/** The conductor with its listener sets counted, so a test can see what the bridge left subscribed. */
function counted(conductor) {
  const live = { input: 0, tick: 0 }
  const wrap = (method, key) => {
    const original = conductor[method].bind(conductor)
    conductor[method] = (listener) => {
      live[key]++
      const off = original(listener)
      let on = true
      return () => {
        if (on) (on = false), live[key]--
        return off()
      }
    }
  }
  wrap('onInput', 'input')
  wrap('subscribe', 'tick')
  return { conductor, live }
}

/**
 * A bridge whose render, like R3F's advance() with a ConductorDriver mounted, ticks the conductor (`canvas: true`),
 * or ticks nothing (`canvas: false`: no canvas yet, or never one).
 */
function setup({ damping = null, canvas = true, scene = fakeScene(), hold } = {}) {
  const { conductor, live } = counted(createConductor({ chapters: CHAPTERS, damping }))
  const log = { renders: 0, canvas }
  const bridge = createRenderBridge(scene, conductor, {
    render: () => {
      log.renders++
      if (log.canvas) conductor.tick(1 / 60)
    },
    ...(hold === undefined ? {} : { hold }),
  })
  let ms = 0
  const frames = (n) => {
    const before = log.renders
    for (let i = 0; i < n; i++) bridge.frame((ms += 16.7))
    return log.renders - before
  }
  return { bridge, conductor, scene, log, live, frames }
}

test('primes once: the first awake frame renders, then nothing renders at rest', () => {
  const { frames } = setup()
  assert.equal(frames(1), 1)
  assert.equal(frames(120), 0)
})

test('gated: nothing renders while the scene sleeps or the page is hidden, input or not', () => {
  const { bridge, scene, frames } = setup({ scene: fakeScene({ awake: false }) })
  bridge.onProgress(0.3)
  assert.equal(frames(30), 0)
  scene.isAwake = true
  document.visibilityState = 'hidden'
  bridge.onProgress(0.4)
  assert.equal(frames(30), 0)
  document.visibilityState = 'visible'
  assert.equal(frames(30), 1)
})

test('a resume (the gate opening again) re-primes: one render with no new input', () => {
  const { scene, frames } = setup()
  frames(5)
  scene.isAwake = false
  assert.equal(frames(10), 0)
  scene.isAwake = true
  assert.equal(frames(10), 1)
  document.visibilityState = 'hidden'
  frames(10)
  document.visibilityState = 'visible'
  assert.equal(frames(10), 1)
})

test('dirty: one render per input, in the frame after it, and none for an unchanged value', () => {
  const { bridge, conductor, frames } = setup()
  frames(2)
  bridge.onProgress(0.25)
  assert.equal(conductor.state.exact, 0.25)
  assert.equal(frames(1), 1)
  assert.equal(frames(10), 0)
  bridge.onProgress(0.25)
  assert.equal(frames(10), 0)
  bridge.onProgress(0.5)
  bridge.onProgress(0.6)
  assert.equal(frames(10), 1, 'two inputs in one frame are one render')
})

test('damped: frames keep coming while smooth settles, then stop', () => {
  const { bridge, conductor, frames } = setup({ damping: 5.5 })
  bridge.onRehydrate({ p: 0, reduced: false })
  frames(2)
  bridge.onProgress(0.8)
  const n = frames(600)
  assert.ok(n > 30 && n < 600, `rendered ${n} frames to settle`)
  assert.equal(conductor.state.settled, true)
  assert.equal(frames(60), 0)
})

test('no canvas: priming gives up after PRIME_FRAMES, and an unsettled conductor nobody ticks costs nothing', () => {
  const { bridge, log, frames } = setup({ damping: 5.5, canvas: false })
  bridge.onRehydrate({ p: 0, reduced: false })
  assert.equal(frames(PRIME_FRAMES + 50), PRIME_FRAMES)
  bridge.onProgress(0.5)
  assert.equal(frames(60), 1, 'input renders once; !settled alone does not keep frames coming')
  // The canvas mounts late and asks: it renders until the conductor ticks, then settles and stops.
  log.canvas = true
  bridge.requestRender()
  const n = frames(600)
  assert.ok(n >= 1 && n < 600)
  assert.equal(frames(60), 0)
})

test('rehydrate: setExact + settle (smooth lands on exact, no sweep), then one render', () => {
  const { bridge, conductor, frames } = setup({ damping: 5.5 })
  frames(2)
  bridge.onRehydrate({ p: 0.7, reduced: false })
  assert.equal(conductor.state.exact, 0.7)
  assert.equal(conductor.state.smooth, 0.7)
  assert.equal(conductor.state.settled, true)
  assert.equal(frames(30), 1)
})

test('no sweep: progress before the first rehydrate, or while gated, lands settled; live progress is damped', () => {
  const scene = fakeScene({ awake: false })
  const { bridge, conductor, frames } = setup({ damping: 5.5, scene })
  bridge.onProgress(0.5)
  assert.equal(conductor.state.smooth, 0.5, 'a reload\'s first progress event, before the mount rehydrate')
  bridge.onRehydrate({ p: 0.5, reduced: false })
  frames(5)
  bridge.onProgress(0.2)
  assert.equal(conductor.state.smooth, 0.2, 'gated (asleep): settled')
  scene.isAwake = true
  frames(30)
  bridge.onProgress(0.6)
  assert.ok(conductor.state.smooth < 0.6, 'awake: smooth follows exact, damped')
})

test('reduced motion: the hold, settled, scroll ignored, one render; off again rehydrates from scroll', () => {
  const scene = fakeScene()
  const { bridge, conductor, frames } = setup({ damping: 5.5, scene })
  bridge.onRehydrate({ p: 0.6, reduced: false })
  frames(30)
  scene.isReduced = true
  bridge.onRehydrate({ p: 0.6, reduced: true })
  assert.equal(conductor.state.reduced, true)
  assert.equal(conductor.state.exact, 0)
  assert.equal(conductor.state.smooth, 0)
  assert.equal(frames(30), 1)
  bridge.onProgress(0.9)
  assert.equal(conductor.state.exact, 0, 'scroll is ignored while reduced')
  assert.equal(frames(30), 0)
  scene.isReduced = false
  bridge.onRehydrate({ p: 0.9, reduced: false })
  assert.equal(conductor.state.reduced, false)
  assert.equal(conductor.state.exact, 0.9)
  assert.equal(conductor.state.settled, true)
  assert.equal(frames(30), 1)
})

test('reduced motion: `hold` sets the held progress, and bindReducedMotion having flipped the conductor first is fine', () => {
  const scene = fakeScene({ reduced: true })
  const { bridge, conductor } = setup({ scene, hold: 0.25 })
  conductor.setReduced(true)
  bridge.onRehydrate({ p: 0.8, reduced: true })
  assert.equal(conductor.state.exact, 0.25)
  conductor.setReduced(false)
  scene.isReduced = false
  bridge.onRehydrate({ p: 0.8, reduced: false })
  assert.equal(conductor.state.exact, 0.8)
})

test('routes: routeChanged() rehydrates the scene while the bridge lives, never after destroy()', () => {
  const { bridge, scene } = setup()
  routeChanged({ settle: 0 })
  assert.deepEqual(scene.rehydrates, ['route'])
  bridge.destroy()
  routeChanged({ settle: 0 })
  assert.deepEqual(scene.rehydrates, ['route'])
})

test('two bridges register two route refreshes', () => {
  const a = setup()
  const b = setup()
  routeChanged({ settle: 0 })
  assert.deepEqual([a.scene.rehydrates, b.scene.rehydrates], [['route'], ['route']])
  a.bridge.destroy()
  b.bridge.destroy()
})

test('destroy: idempotent, nothing left subscribed, and inert afterwards', () => {
  const { bridge, conductor, live, frames } = setup()
  assert.deepEqual(live, { input: 1, tick: 1 })
  frames(1)
  bridge.destroy()
  bridge.destroy()
  assert.deepEqual(live, { input: 0, tick: 0 })
  bridge.onProgress(0.5)
  bridge.onRehydrate({ p: 0.5, reduced: true })
  bridge.requestRender()
  assert.equal(conductor.state.exact, 0)
  assert.equal(conductor.state.reduced, false)
  assert.equal(frames(30), 0)
  assert.equal(bridge.debug().destroyed, true)
})

test('the 3d conductor fits the structural type: listeners get the state, the bridge ignores it', () => {
  const { conductor, frames } = setup()
  frames(1)
  conductor.setExact(0.4)
  assert.equal(frames(1), 1)
})

test('GSAP adapter: one ticker callback after the ones already added, the handle from the callbacks, removed on destroy', async () => {
  const { gsap } = await import('../../skills/scroll-animation/assets/gsap/setup.ts')
  const { pinnedSceneRender } = await import('../../skills/scroll-animation/assets/gsap/pinned-scene-render.ts')
  const added = []
  const add = gsap.ticker.add
  const remove = gsap.ticker.remove
  // The ticker's own add() removes the callback first, so the spy records it after the real add.
  gsap.ticker.add = (cb, ...rest) => {
    const out = add.call(gsap.ticker, cb, ...rest)
    added.push(cb)
    return out
  }
  gsap.ticker.remove = (cb) => {
    if (added.includes(cb)) added.splice(added.indexOf(cb), 1)
    return remove.call(gsap.ticker, cb)
  }
  try {
    const conductor = createConductor({ chapters: CHAPTERS, damping: null })
    let renders = 0
    const render = pinnedSceneRender(conductor, { render: () => (renders++, conductor.tick(0)) })
    assert.equal(added.length, 1)
    const [tick] = added
    tick(1)
    assert.equal(renders, 0, 'gated until the scene has called back')
    const handle = { awake: true, reduced: false, rehydrate() {} }
    render.onRehydrate({ p: 0.5, reduced: false }, handle)
    assert.equal(conductor.state.exact, 0.5)
    tick(1.016)
    assert.equal(renders, 1)
    render.onProgress(0.6, handle)
    tick(1.033)
    assert.equal(renders, 2)
    handle.awake = false
    render.onProgress(0.7, handle)
    tick(1.05)
    assert.equal(renders, 2, 'awake is read as a property on the GSAP handle')
    render.destroy()
    render.destroy()
    assert.equal(added.length, 0)
  } finally {
    gsap.ticker.add = add
    gsap.ticker.remove = remove
  }
})

test('Motion hook: renders on the server (no bridge, no frame registration) and hands back stable callbacks', async () => {
  const { createElement } = await import('react')
  const { renderToString } = await import('react-dom/server')
  const { usePinnedSceneRender } = await import('../../skills/scroll-animation/assets/motion/usePinnedSceneRender.ts')
  const conductor = createConductor({ chapters: CHAPTERS, damping: null })
  let state
  function Probe() {
    state = usePinnedSceneRender(conductor, { render: () => {} })
    return null
  }
  assert.equal(renderToString(createElement(Probe)), '')
  assert.equal(typeof state.onProgress, 'function')
  assert.equal(typeof state.onRehydrate, 'function')
  state.onProgress(0.5, { awake: () => true, reduced: () => false, rehydrate() {} })
  state.requestRender()
  assert.equal(conductor.state.exact, 0, 'no bridge before the effect: nothing is fed')
})
