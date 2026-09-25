// assets/media/camera.ts: the camera's framing maths (subject placement, the coverage clamp, tiers), the frame-size
// CSS, the backdrop ramp and the two writers.

import './load-ts.mjs'

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

const {
  backdropAt,
  cameraTier,
  cameraTransform,
  createBackdropWriter,
  createCameraWriter,
  frameCamera,
  frameSizeCss
} = await import('../../skills/scroll-animation/assets/media/camera.ts')

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`)
const lerp = (a, b, t) => a + (b - a) * t

// v1's applyFraming (ScrubStage.tsx / scrubStage.ts), verbatim, as the reference the extraction must reproduce.
function v1Frame({ pw, ph, bw, bh }, { crop, subject, shots }, t) {
  const sx = (lerp(subject.head.x, subject.tail.x, t) - crop.x) / crop.w
  const sy = (lerp(subject.head.y, subject.tail.y, t) - crop.y) / crop.h
  const ax = lerp(shots.head.at[0], shots.tail.at[0], t)
  const ay = lerp(shots.head.at[1], shots.tail.at[1], t)
  const design = lerp(shots.head.zoom, shots.tail.zoom, t)
  const zoom = Math.max(design, (pw * Math.max(ax / sx, (1 - ax) / (1 - sx))) / bw, (ph * Math.max(ay / sy, (1 - ay) / (1 - sy))) / bh)
  return `translate3d(${Math.round(ax * pw - sx * bw * zoom)}px,${Math.round(ay * ph - sy * bh * zoom)}px,0) scale(${zoom.toFixed(4)})`
}

// A small deterministic generator, so a failure names a reproducible case.
function rng(seed) {
  let s = seed
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296)
}

function randomCase(r) {
  const cw = 0.3 + r() * 0.7
  const ch = 0.3 + r() * 0.7
  const crop = { x: r() * (1 - cw), y: r() * (1 - ch), w: cw, h: ch }
  const point = () => ({ x: crop.x + (0.1 + r() * 0.8) * crop.w, y: crop.y + (0.1 + r() * 0.8) * crop.h })
  const shot = () => ({ zoom: 0.8 + r() * 1.2, at: [0.1 + r() * 0.8, 0.1 + r() * 0.8] })
  const tier = { crop, subject: { head: point(), tail: point() }, shots: { head: shot(), tail: shot() } }
  const ph = 600 + r() * 800
  const geom = { pw: 360 + r() * 2200, ph, bw: ph * (0.5 + r() * 2), bh: ph * (0.8 + r() * 1.2) }
  return { tier, geom }
}

describe('cameraTier', () => {
  test('every field defaults to the identity camera', () => {
    const t = cameraTier({}, 'desktop')
    assert.deepEqual(t.crop, { x: 0, y: 0, w: 1, h: 1 })
    assert.deepEqual(t.subject, { head: { x: 0.5, y: 0.5 }, tail: { x: 0.5, y: 0.5 } })
    assert.deepEqual(t.shots.head, { zoom: 1, at: [0.5, 0.5] })
    assert.equal(t.frameSize, null)
  })

  test('mobile falls back to desktop, and uses its own tier when given', () => {
    const desktop = { crop: { x: 0.1, y: 0, w: 0.8, h: 1 }, frameSize: { w: 150, h: 100 } }
    assert.deepEqual(cameraTier({ desktop }, 'mobile').crop, desktop.crop)
    const mobile = { crop: { x: 0.3, y: 0, w: 0.4, h: 1 } }
    assert.deepEqual(cameraTier({ desktop, mobile }, 'mobile').crop, mobile.crop)
    assert.equal(cameraTier({ desktop, mobile }, 'mobile').frameSize, null)
  })
})

describe('frameCamera', () => {
  test('the identity camera on a pin-sized box is no transform at all', () => {
    const f = frameCamera({ pw: 1440, ph: 900, bw: 1440, bh: 900 }, cameraTier({}, 'desktop'), 0.5)
    assert.deepEqual(f, { x: 0, y: 0, zoom: 1 })
    assert.equal(cameraTransform(f), 'translate3d(0px,0px,0) scale(1.0000)')
  })

  test('waits for measured geometry', () => {
    assert.equal(frameCamera({ pw: 0, ph: 900, bw: 1440, bh: 900 }, cameraTier({}, 'desktop'), 0), null)
    assert.equal(frameCamera({ pw: 1440, ph: 900, bw: 0, bh: 0 }, cameraTier({}, 'desktop'), 0), null)
  })

  test('reproduces v1 exactly', () => {
    const r = rng(7)
    for (let i = 0; i < 500; i++) {
      const { tier, geom } = randomCase(r)
      const t = r()
      assert.equal(cameraTransform(frameCamera(geom, { ...tier, frameSize: null }, t)), v1Frame(geom, tier, t), `case ${i}`)
    }
  })

  test('lands the subject where the shot puts it, and covers the pin', () => {
    const r = rng(11)
    for (let i = 0; i < 500; i++) {
      const { tier, geom } = randomCase(r)
      const t = r()
      const { x, y, zoom } = frameCamera(geom, { ...tier, frameSize: null }, t)
      const sx = (lerp(tier.subject.head.x, tier.subject.tail.x, t) - tier.crop.x) / tier.crop.w
      const sy = (lerp(tier.subject.head.y, tier.subject.tail.y, t) - tier.crop.y) / tier.crop.h
      near(x + sx * geom.bw * zoom, lerp(tier.shots.head.at[0], tier.shots.tail.at[0], t) * geom.pw, 1e-6, `subject x, case ${i}`)
      near(y + sy * geom.bh * zoom, lerp(tier.shots.head.at[1], tier.shots.tail.at[1], t) * geom.ph, 1e-6, `subject y, case ${i}`)
      assert.ok(x <= 1e-6 && y <= 1e-6, `left/top edge on screen, case ${i}`)
      assert.ok(x + geom.bw * zoom >= geom.pw - 1e-6 && y + geom.bh * zoom >= geom.ph - 1e-6, `right/bottom edge on screen, case ${i}`)
      assert.ok(zoom >= lerp(tier.shots.head.zoom, tier.shots.tail.zoom, t) - 1e-9, `below the design zoom, case ${i}`)
    }
  })

  test('honours the design zoom where there is room', () => {
    const tier = cameraTier({ desktop: { shots: { head: { zoom: 1.5, at: [0.5, 0.5] }, tail: { zoom: 2, at: [0.5, 0.5] } } } }, 'desktop')
    const geom = { pw: 1000, ph: 800, bw: 1000, bh: 800 }
    near(frameCamera(geom, tier, 0).zoom, 1.5, 1e-12, 'head')
    near(frameCamera(geom, tier, 1).zoom, 2, 1e-12, 'tail')
    near(frameCamera(geom, tier, 0.5).zoom, 1.75, 1e-12, 'between')
    near(frameCamera(geom, tier, 3).zoom, 2, 1e-12, 'clamped past the band')
  })

  test('a subject on the crop edge stays finite', () => {
    const tier = cameraTier({ desktop: { subject: { head: { x: 0, y: 1 }, tail: { x: 1, y: 0 } } } }, 'desktop')
    const f = frameCamera({ pw: 1000, ph: 800, bw: 1000, bh: 800 }, tier, 0)
    assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y) && Number.isFinite(f.zoom))
  })
})

describe('frameSizeCss', () => {
  test('mobile by default, desktop under the desktop query', () => {
    const css = frameSizeCss('[data-scene-frame="a"]', { desktop: { frameSize: { w: 178, h: 100 } }, mobile: { frameSize: { w: 90, h: 160 } } }, '(min-width: 1024px)')
    assert.equal(
      css,
      '[data-scene-frame="a"]{--scene-frame-w:90svh;--scene-frame-h:160svh}' +
        '@media (min-width: 1024px){[data-scene-frame="a"]{--scene-frame-w:178svh;--scene-frame-h:100svh}}'
    )
  })

  test('the mobile size falls back to the desktop one, and no size writes nothing', () => {
    const css = frameSizeCss('.x', { desktop: { frameSize: { w: 178, h: 100 } } }, '(min-width: 1024px)')
    assert.ok(css.startsWith('.x{--scene-frame-w:178svh;--scene-frame-h:100svh}@media'))
    assert.equal(frameSizeCss('.x', {}, '(min-width: 1024px)'), '')
  })
})

describe('backdrop', () => {
  const stops = [
    { at: 0, top: '#000000', bottom: '#ffffff' },
    { at: 0.5, top: '#ff0000', bottom: '#00ff00' },
    { at: 1, top: '#0000ff', bottom: '#000000' }
  ]

  test('interpolates between the surrounding stops and clamps outside them', () => {
    assert.deepEqual(backdropAt(0, stops), { top: 'rgb(0,0,0)', bottom: 'rgb(255,255,255)' })
    assert.deepEqual(backdropAt(0.25, stops), { top: 'rgb(128,0,0)', bottom: 'rgb(128,255,128)' })
    assert.deepEqual(backdropAt(0.75, stops), { top: 'rgb(128,0,128)', bottom: 'rgb(0,128,0)' })
    assert.deepEqual(backdropAt(-1, stops), backdropAt(0, stops))
    assert.deepEqual(backdropAt(2, stops), backdropAt(1, stops))
    assert.equal(backdropAt(0.5, []), null)
    assert.deepEqual(backdropAt(0.3, [stops[0]]), { top: 'rgb(0,0,0)', bottom: 'rgb(255,255,255)' })
  })

  test('the writer paints two custom properties, and skips a repeat within 1/256', () => {
    const writes = []
    const el = { style: { setProperty: (k, v) => writes.push([k, v]) } }
    const w = createBackdropWriter(el, stops)
    w.paint(0.25)
    w.paint(0.2501)
    assert.equal(writes.length, 2)
    assert.deepEqual(writes.map(([k]) => k), ['--scene-g-top', '--scene-g-bottom'])
    w.paint(0.3)
    assert.equal(writes.length, 4)
  })
})

describe('createCameraWriter', () => {
  test('writes the transform once per distinct frame, and again after reset', () => {
    const el = { style: { transform: '' } }
    let sets = 0
    Object.defineProperty(el.style, 'transform', { set: () => sets++, get: () => '' })
    const w = createCameraWriter(el)
    w.write({ x: 1.2, y: 2, zoom: 1 })
    w.write({ x: 1.4, y: 2, zoom: 1 })
    assert.equal(sets, 1, 'sub-px changes round to the same string')
    w.write({ x: 3, y: 2, zoom: 1 })
    assert.equal(sets, 2)
    w.write(null)
    assert.equal(sets, 2)
    w.reset()
    w.write({ x: 3, y: 2, zoom: 1 })
    assert.equal(sets, 3)
  })
})
