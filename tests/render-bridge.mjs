#!/usr/bin/env node
// render-bridge.mjs: the render-bridge block (assets/render-bridge.ts, motion/usePinnedSceneRender.ts,
// gsap/pinned-scene-render.ts, the canvas slot in css/scene.css) in a browser: the roadmap's Phase 5 gate, the WebGL
// smoke. The fixture (tests/fixtures/render-bridge) puts the 3d skill's conductor and SceneCanvas (vendored, each with
// its provenance line) in our pinned scene under our authority, frameloop="never", advanced by the bridge.
//
// Chromium with SwiftShader (WebGL in a headless browser), per engine and authority (Motion native, Motion + Lenis
// on motionDriver, GSAP native, GSAP + Lenis on gsap.ticker, GSAP + ScrollSmoother; and both Lenis drivers started
// in a parent's layout effect, after the scene's, without StrictMode: `-late`):
//   load       the first frames drawn on load and on a mid-page reload are at the scene's progress (±1 px): no sweep
//              from 0, no default pose, and nothing drawn before the conductor's pose
//   lag        over a wheel run, every frame the canvas draws while the range moves is drawn in that frame, with that
//              frame's scrollTop: 0 frames late; on load, after reduced motion on and off (the authority restarts)
//              and after a remount
//   rest       0 renders/s at rest once settled, off-screen and while hidden; renders again on return
//   reduced    a live switch to reduced motion holds (exact = 0, settled), renders at most a couple of frames, ignores
//              scroll, and css/scene.css shows the poster; switching back rehydrates from scroll
//   lost       WEBGL_lose_context: the poster shows (no canvas left in the slot), nothing is thrown, scrolling on is
//              harmless
//   destroy    unmounting the scene leaves no conductor listener, no ticker callback, no keep-alive `frame.render`
//              step, no live context; renders stop
// and on routes.html (Motion, native): 10 round trips between the canvas route and a plain one end with one live
// context, none detached, every mount's listeners released, and only the shown mount answers routeChanged().
// WebKit, Firefox (and Chromium): the core's gating and timing with the `dom` stand-in (no WebGL needed): load, lag,
// rest, reduced, destroy; `nowebgl`: getContext('webgl') returns null, so SceneCanvas takes its poster path and the
// poster shows, nothing thrown; and the canvas slot's CSS alone on static.html: the poster without JavaScript, under
// reduced motion and in print, the canvas slot over it otherwise, and with acts stacked in the pin a
// [data-scene-still] that keeps poster and slot 16:9 when reduced motion collapses the pin.
// First, the fixture's TSX is typechecked (tsconfig.json beside it, against Folio's pinned types).
//
// three and @react-three/fiber are the fixture's only extra dependencies, resolved from examples/folio's node_modules
// (pinned there: three 0.186.1, @react-three/fiber 9.8.1); exits 2 without them (`pnpm install` in examples/folio).
// Built in development mode (React's StrictMode double effects run) with Vite, served with `vite preview`. One
// PASS/FAIL line per check, a NUM line per measurement; exits 1 on any FAIL. `npm run test:render-bridge`.
//
//   node tests/render-bridge.mjs [--browsers chromium,webkit,firefox] [--only load,lag,…]

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium, firefox, webkit } from 'playwright'
import { build, preview } from 'vite'

const testsDir = dirname(fileURLToPath(import.meta.url))
const repo = join(testsDir, '..')
const fixtureRoot = join(testsDir, 'fixtures', 'render-bridge')
const outDir = join(testsDir, '.scratch', 'render-bridge-dist')
const folioModules = join(repo, 'examples', 'folio', 'node_modules')
const PINS = { three: '0.186.1', '@react-three/fiber': '9.8.1' }

const BROWSERS = { chromium, webkit, firefox }
// Headless Chromium uses SwiftShader for WebGL only with this switch (spike S11).
const LAUNCH = { chromium: { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }, webkit: {}, firefox: {} }
const VIEWPORT = { width: 1000, height: 600 }
/** Agreement with the rect, px of the range. */
const TOL_PX = 1.01

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ── args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { browsers: Object.keys(BROWSERS), only: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--browsers') out.browsers = argv[++i].split(',')
    else if (a === '--only') out.only = argv[++i].split(',')
    else throw new Error(`unknown argument: ${a}`)
  }
  for (const b of out.browsers) if (!BROWSERS[b]) throw new Error(`unknown browser: ${b}`)
  return out
}

// ── build + serve ──────────────────────────────────────────────────────

function folioPackage(name) {
  const dir = join(folioModules, name)
  const pkg = join(dir, 'package.json')
  if (!existsSync(pkg)) return null
  return { dir, version: JSON.parse(readFileSync(pkg, 'utf8')).version }
}

function onwarn(warning, warn) {
  // The React blocks open with 'use client', meaningless outside a server-components bundler.
  if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
  if (warning.code === 'SOURCEMAP_ERROR') return
  warn(warning)
}

async function serve(deps) {
  const config = {
    root: fixtureRoot,
    configFile: false,
    logLevel: 'warn',
    publicDir: false,
    mode: 'development',
    define: { 'process.env.NODE_ENV': '"development"' },
    esbuild: { jsx: 'automatic' },
    resolve: {
      alias: [
        { find: /^three$/, replacement: join(deps.three.dir, 'build', 'three.module.js') },
        { find: /^@react-three\/fiber$/, replacement: join(deps['@react-three/fiber'].dir, 'dist', 'react-three-fiber.esm.js') },
      ],
      // R3F's own dependencies resolve inside Folio's store; React must stay the one copy the page renders with.
      dedupe: ['react', 'react-dom'],
    },
  }
  await build({
    ...config,
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      rollupOptions: {
        input: Object.fromEntries(['scene', 'routes', 'static'].map((p) => [p, join(fixtureRoot, `${p}.html`)])),
        onwarn,
      },
    },
  })
  return preview({ ...config, build: { outDir }, preview: { host: '127.0.0.1', port: 0, strictPort: false } })
}

// ── page helpers ────────────────────────────────────────────────────────

/** Errors a page may print that say nothing about the block: SwiftShader's driver chatter. */
const IGNORED = /GL Driver Message|GPU stall due to ReadPixels/

const PROBE_PAGE = `() => {
  const poster = document.querySelector('[data-scene-poster]')
  const slot = document.querySelector('[data-scene-canvas]')
  const ps = getComputedStyle(poster)
  const ss = getComputedStyle(slot)
  const pr = poster.getBoundingClientRect()
  const mode = slot.querySelector('[data-scene-mode]')
  return {
    posterShown: ps.display !== 'none' && ps.visibility === 'visible' && pr.width > 0 && pr.height > 0,
    slotShown: ss.display !== 'none' && ss.visibility === 'visible',
    canvas: !!slot.querySelector('canvas'),
    mode: mode ? mode.getAttribute('data-scene-mode') : null,
  }
}`
const slotState = (page) => page.evaluate(`(${PROBE_PAGE})()`)
/** The poster is what a reader sees: shown, and the slot hidden or holding no canvas. */
const posterVisible = (s) => s.posterShown && (!s.slotShown || !s.canvas)

const jump = (page, y) => page.evaluate((v) => window.__rb.jump(v), y)
const renders = (page) => page.evaluate(() => window.__rb.log.renders)
async function rendersOver(page, ms) {
  const before = await renders(page)
  await sleep(ms)
  return (await renders(page)) - before
}
async function wheel(page, steps, delta, gap = 40) {
  await page.mouse.move(300, 300)
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, delta)
    await sleep(gap)
  }
}
/** The last frame drawn against the rect now, px of the range. */
async function lastDrawn(page) {
  return page.evaluate(() => {
    const last = window.__rb.log.last
    const truth = window.__rb.truth()
    const range = window.__rb.scene()?.rangePx ?? 1
    return { last, truth, errPx: last && truth !== null ? Math.abs(last.e - truth) * range : Infinity, sErrPx: last && truth !== null ? Math.abs(last.s - truth) * range : Infinity }
  })
}
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : x)

async function waitReady(page, webgl) {
  await page.waitForFunction(() => window.__rb?.ready && !!window.__rb.scene?.(), null, { timeout: 15000 })
  if (webgl) await page.waitForSelector('[data-scene-ready="true"]', { timeout: 20000 })
  // The mount rehydrate, the first frames, a damped settle.
  await sleep(1500)
}

/** Every frame drawn so far: at the rect's progress (exact and smooth), and at least one ticked by the driver. */
function drawnAtTruth(drawn, range) {
  if (!drawn.length) return [false, 'nothing drawn']
  const bad = drawn.filter((d) => d.truth === null || Math.abs(d.e - d.truth) * range > TOL_PX || Math.abs(d.s - d.truth) * range > TOL_PX)
  const first = drawn[0]
  const detail = `${drawn.length} frames, first e=${first.e.toFixed(4)} s=${first.s.toFixed(4)} truth=${first.truth?.toFixed(4)}, ${drawn.filter((d) => d.ticked).length} ticked`
  return [bad.length === 0 && drawn.some((d) => d.ticked), bad.length ? `${bad.length} off, e.g. ${JSON.stringify(bad[0])}; ${detail}` : detail]
}

/** Over the moving frames inside the range: drawn in the frame, with that frame's progress. */
function analyseLag(rows) {
  let moving = 0
  let inFrame = 0
  let worst = 0
  let movingRenders = 0
  const late = []
  for (let n = 1; n < rows.length; n++) {
    const r = rows[n]
    if (Math.abs(r.y - rows[n - 1].y) <= 0.5 || r.truth === null || r.truth <= 0 || r.truth >= 1) continue
    moving++
    movingRenders += r.rn - rows[n - 1].rn
    const err = r.ue === null ? Infinity : Math.abs(r.ue - r.truth) * r.range
    worst = Math.max(worst, err)
    if (r.rf === r.f && err <= TOL_PX) inFrame++
    else if (late.length < 3) late.push({ f: r.f, rf: r.rf, errPx: r1(err) })
  }
  const dt = []
  for (let n = 1; n < rows.length; n++) dt.push(rows[n].t - rows[n - 1].t)
  dt.sort((a, b) => a - b)
  const frameMs = dt[Math.floor(dt.length / 2)] || 16.7
  return { moving, inFrame, worstPx: r1(worst), late, rendersPerSecond: Math.round((movingRenders / Math.max(1, moving)) * (1000 / frameMs)) }
}

// ── checks ──────────────────────────────────────────────────────────────

const VARIANTS = {
  'motion-native': 'engine=motion&auth=native',
  'motion-lenis': 'engine=motion&auth=lenis',
  'gsap-native': 'engine=gsap&auth=native',
  'gsap-lenis': 'engine=gsap&auth=lenis',
  // The authority started in a parent's layout effect (a layout's <SmoothScroll>), after the scene's, without
  // StrictMode (production's single effects): the bridge exists before the authority's driver does.
  'motion-lenis-late': 'engine=motion&auth=lenis&late=1&strict=0',
  'gsap-lenis-late': 'engine=gsap&auth=lenis&late=1&strict=0',
  'gsap-smoother': 'engine=gsap&auth=smoother',
}

/** A wheel run down and back up the range, recorded at the end of every frame. */
async function lagRun(t, page, g, push, when) {
  await jump(page, Math.round(g.top - 100))
  await sleep(800)
  await page.evaluate(() => window.__rb.rec.start())
  await wheel(page, 14, 100)
  await sleep(1400)
  await wheel(page, 7, -100)
  await sleep(1400)
  const lag = analyseLag(await page.evaluate(() => window.__rb.rec.stop()))
  // Native wheel scrolling in a headless browser jumps per notch: few moving frames, each one counted.
  const ok = lag.moving >= 10 && lag.inFrame === lag.moving
  t.num(`lag ${when}: frames drawn in their own frame`, `${lag.inFrame}/${lag.moving}`, `worst ${lag.worstPx} px; ~${lag.rendersPerSecond} renders/s scrolling`)
  if (t.gateLag) push(`lag ${when}: every frame drawn while scrolling is drawn in that frame, at its scrollTop (0 frames late)`, ok, `${lag.inFrame}/${lag.moving} in frame, worst ${lag.worstPx} px${lag.late.length ? `, late: ${JSON.stringify(lag.late)}` : ''}`)
}

/** One scene page through load, lag, rest, reduced, destroy and (WebGL) lost. Returns [check, ok, detail] rows. */
async function sceneSequence(t, variant, webgl) {
  const out = []
  const push = (name, ok, detail = '') => out.push([name, ok, detail])
  const { page, errors } = await t.open(`scene.html?${VARIANTS[variant]}&canvas=${webgl ? 'webgl' : 'dom'}`)
  await waitReady(page, webgl)
  const g = await page.evaluate(() => window.__rb.geometry())
  const range = g.rangePx
  const want = (name) => !t.only || t.only.includes(name)

  if (want('load')) {
    const [ok, detail] = drawnAtTruth(await page.evaluate(() => window.__rb.log.drawn), range)
    push('load: the frames drawn on load are at the scene\'s progress', ok, detail)
    const mid = Math.round(g.top + range * 0.5)
    await jump(page, mid)
    await sleep(800)
    await page.reload()
    await waitReady(page, webgl)
    let y = await page.evaluate(() => scrollY)
    let how = 'reload'
    if (Math.abs(y - mid) >= 2) {
      // Playwright's WebKit reloads at the top: load with the position placed in the first commit instead.
      how = 'load with ?y'
      await page.goto(`${page.url().split('#')[0]}&y=${mid}`)
      await waitReady(page, webgl)
      y = await page.evaluate(() => scrollY)
    }
    const [ok2, detail2] = drawnAtTruth(await page.evaluate(() => window.__rb.log.drawn), range)
    push('load: a mid-page reload draws its position from the first frame (no sweep, no default pose)', ok2 && Math.abs(y - mid) < 2, `${how}: y=${y} of ${mid}; ${detail2}`)
  }

  if (want('lag')) await lagRun(t, page, g, push, 'on load')

  if (want('rest')) {
    await jump(page, Math.round(g.top + range * 0.4))
    await sleep(2000)
    const atRest = await rendersOver(page, 1000)
    push('rest: 0 renders/s at rest once settled', atRest === 0, `${atRest}/s`)
    await jump(page, Math.round(g.top + g.height + 900))
    await sleep(800)
    const asleep = await page.evaluate(() => !window.__rb.scene().awake)
    const offscreen = await rendersOver(page, 1000)
    push('rest: 0 renders/s off-screen (the scene asleep)', offscreen === 0 && asleep, `${offscreen}/s, asleep ${asleep}`)
    await jump(page, Math.round(g.top + range * 0.3))
    await sleep(1500)
    const back = await lastDrawn(page)
    push('rest: back in view, the last frame drawn is at the scroll position', back.errPx <= TOL_PX && back.sErrPx <= TOL_PX, `${r1(back.errPx)} px`)
    await page.evaluate(() => window.__rb.fakeHidden(true))
    await sleep(200)
    await jump(page, Math.round(g.top + range * 0.6))
    const hidden = await rendersOver(page, 1000)
    await page.evaluate(() => window.__rb.fakeHidden(false))
    await sleep(1500)
    const shown = await lastDrawn(page)
    push('rest: 0 renders/s while hidden, even as the scroll moves', hidden === 0, `${hidden}/s`)
    push('rest: shown again, the last frame drawn is at the scroll position', shown.errPx <= TOL_PX && shown.sErrPx <= TOL_PX, `${r1(shown.errPx)} px`)
  }

  if (want('reduced')) {
    await jump(page, Math.round(g.top + range * 0.6))
    await sleep(1500)
    const before = await renders(page)
    const rehydratesBefore = await page.evaluate(() => window.__rb.log.rehydrates.length)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await sleep(1200)
    const held = await page.evaluate(() => window.__rb.conductor())
    const heldRenders = (await renders(page)) - before
    const rehydrates = (await page.evaluate(() => window.__rb.log.rehydrates.length)) - rehydratesBefore
    push('reduced: a live switch holds (reduced, exact 0, settled)', held.reduced && held.exact === 0 && held.settled, JSON.stringify({ reduced: held.reduced, exact: held.exact, settled: held.settled }))
    push('reduced: it renders the hold once per rehydrate, no more', heldRenders >= 1 && heldRenders <= rehydrates + 1, `${heldRenders} renders, ${rehydrates} rehydrates`)
    const slot = await slotState(page)
    push('reduced: css/scene.css shows the poster in the canvas\'s place', posterVisible(slot) && !slot.slotShown, JSON.stringify(slot))
    const r0 = await renders(page)
    await wheel(page, 4, 100)
    await sleep(800)
    const scrolled = await page.evaluate(() => window.__rb.conductor())
    const scrolledRenders = (await renders(page)) - r0
    push('reduced: scroll is ignored (no input, no render)', scrolled.exact === 0 && scrolledRenders === 0, `exact ${scrolled.exact}, ${scrolledRenders} renders`)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await sleep(1800)
    const live = await page.evaluate(() => window.__rb.conductor())
    const drawn = await lastDrawn(page)
    const slotBack = await slotState(page)
    push('reduced: switched off, it rehydrates from scroll and draws there', !live.reduced && drawn.errPx <= TOL_PX && slotBack.slotShown, `exact ${live.exact.toFixed(4)}, drawn ${r1(drawn.errPx)} px off, slot shown ${slotBack.slotShown}`)
    // The authority restarts on the switch (Lenis is re-created, ScrollSmoother too): the bridge stays after it.
    if (want('lag')) await lagRun(t, page, g, push, 'after reduced motion on and off')
  }

  if (want('destroy')) {
    await jump(page, Math.round(g.top + range * 0.5))
    await sleep(800)
    const rehydrates = await page.evaluate(() => window.__rb.log.rehydrates.length)
    await page.evaluate(() => window.__rb.unmount())
    await sleep(800)
    const left = await page.evaluate(() => ({ listeners: { ...window.__rb.listeners }, ticker: window.__rb.ticker(), contexts: window.__rb.contexts() }))
    const r0 = await renders(page)
    await wheel(page, 5, 100)
    await sleep(600)
    await page.evaluate(() => window.__rb.routeChanged())
    await sleep(300)
    const after = await page.evaluate(() => window.__rb.log.rehydrates.length)
    const stray = (await renders(page)) - r0
    const clean =
      left.listeners.input === 0 &&
      left.listeners.tick === 0 &&
      left.ticker.live === left.ticker.baseline &&
      left.ticker.render === left.ticker.renderBaseline &&
      left.contexts.liveInDocument === 0 &&
      left.contexts.liveDetached === 0
    push('destroy: unmounted, no conductor listener, ticker callback, frame.render step or live context is left', clean, JSON.stringify(left))
    push('destroy: nothing renders or rehydrates after it (scroll, routeChanged)', stray === 0 && after === rehydrates, `${stray} renders, ${after - rehydrates} rehydrates`)
    await page.evaluate(() => window.__rb.remount())
    if (webgl) await page.waitForSelector('[data-scene-ready="true"]', { timeout: 20000 })
    await sleep(1500)
    const again = await lastDrawn(page)
    push('destroy: mounted again, the new bridge draws the scroll position', again.errPx <= TOL_PX && again.sErrPx <= TOL_PX, `${r1(again.errPx)} px`)
    // A remount adds the bridge's tick after the authority's driver has been running for a while.
    if (want('lag')) await lagRun(t, page, g, push, 'after a remount')
  }

  if (webgl && want('lost')) {
    await jump(page, Math.round(g.top + range * 0.4))
    await sleep(800)
    const lost = await page.evaluate(() => window.__rb.loseContext())
    await sleep(1200)
    await wheel(page, 3, 100)
    await sleep(600)
    const slot = await slotState(page)
    push('lost: WEBGL_lose_context leaves the poster (no canvas in the slot), nothing thrown', lost && posterVisible(slot) && !slot.canvas && slot.mode === 'poster' && errors.length === 0, JSON.stringify(slot))
  }

  push('no uncaught errors or console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  return out
}

async function noWebglSequence(t, engine) {
  const { page, errors } = await t.open(`scene.html?engine=${engine}&auth=native&nowebgl=1`)
  await waitReady(page, false)
  await sleep(2500)
  const slot = await slotState(page)
  const total = await renders(page)
  const idle = await rendersOver(page, 1000)
  return [
    ['nowebgl: no WebGL, SceneCanvas takes its poster path and the poster shows', posterVisible(slot) && !slot.canvas && slot.mode === 'poster', JSON.stringify(slot)],
    ['nowebgl: priming gives up (no canvas to tick the conductor): 0 renders/s after it', idle === 0, `${total} renders in all, ${idle}/s now`],
    ['nowebgl: no uncaught errors or console errors', errors.length === 0, errors.slice(0, 3).join(' | ')],
  ]
}

async function staticSequence(t) {
  const out = []
  {
    const { page } = await t.open('static.html')
    const s = await page.evaluate(() => {
      const pin = document.querySelector('[data-scene-pin]').getBoundingClientRect()
      const poster = document.querySelector('[data-scene-poster]')
      const slot = document.querySelector('[data-scene-canvas]')
      const same = (r) => Math.abs(r.top - pin.top) < 1 && Math.abs(r.height - pin.height) < 1 && Math.abs(r.width - pin.width) < 1
      return {
        fills: same(poster.getBoundingClientRect()) && same(slot.getBoundingClientRect()),
        posterFirst: !!(poster.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING),
        slotShown: getComputedStyle(slot).display !== 'none' && getComputedStyle(slot).visibility === 'visible',
      }
    })
    out.push(['css: the poster and the canvas slot both fill the pin, the slot over the poster', s.fills && s.posterFirst && s.slotShown, JSON.stringify(s)])
    const frame = () =>
      page.evaluate(() => {
        const box = (sel) => {
          const r = document.querySelector(`#stacked ${sel}`).getBoundingClientRect()
          return `${Math.round(r.width)}x${Math.round(r.height)}`
        }
        return { pin: box('[data-scene-pin]'), poster: box('[data-scene-poster]'), slot: box('[data-scene-canvas]') }
      })
    const framed = await frame()
    out.push(['css: acts stacked in the pin, the frame\'s poster and slot fill the pin', framed.poster === framed.pin && framed.slot === framed.pin, JSON.stringify(framed)])
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const reduced = await slotState(page)
    out.push(['css: reduced motion shows the poster (the slot hidden, kept in layout)', posterVisible(reduced) && !reduced.slotShown, JSON.stringify(reduced)])
    // 1000 px wide: a 16:9 frame is 1000x563 however tall the collapsed pin grows.
    const collapsed = await frame()
    out.push(['css: reduced motion, acts stacked in the pin: the poster and slot stay a 16:9 frame, not the grown pin', collapsed.poster === '1000x563' && collapsed.slot === '1000x563' && collapsed.pin !== collapsed.poster, JSON.stringify(collapsed)])
    await page.emulateMedia({ reducedMotion: 'no-preference', media: 'print' })
    const print = await page.evaluate(() => {
      const poster = document.querySelector('[data-scene-poster]')
      return {
        slot: getComputedStyle(document.querySelector('[data-scene-canvas]')).display,
        poster: getComputedStyle(poster).position,
        height: Math.round(poster.getBoundingClientRect().height),
      }
    })
    out.push(['css: print shows the poster in flow, no canvas', print.slot === 'none' && print.poster === 'static' && print.height > 0, JSON.stringify(print)])
  }
  {
    const { page } = await t.open('static.html', { javaScriptEnabled: false })
    const s = await slotState(page)
    out.push(['css: without JavaScript the poster shows (scripting: none)', posterVisible(s) && !s.slotShown, JSON.stringify(s)])
  }
  return out
}

async function routesSequence(t) {
  const out = []
  const { page, errors } = await t.open('routes.html')
  await page.waitForFunction(() => window.__rb?.ready, null, { timeout: 15000 })
  await page.waitForSelector('[data-scene-ready="true"]', { timeout: 20000 })
  await sleep(1200)
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.__rb.go('b'))
    await sleep(300)
    await page.evaluate(() => window.__rb.go('a'))
    await page.waitForSelector('[data-scene-ready="true"]', { timeout: 20000 })
    await sleep(300)
  }
  await sleep(1000)
  const contexts = await page.evaluate(() => window.__rb.contexts())
  out.push(['routes: 10 round trips leave one live context, none detached', contexts.live === 1 && contexts.liveDetached === 0 && contexts.canvases === 1, JSON.stringify(contexts)])
  const before = await page.evaluate(() => window.__rb.mounts())
  const released = before.slice(0, -1).every((m) => m.listeners.input === 0 && m.listeners.tick === 0)
  out.push(['routes: every mount left releases its conductor\'s listeners', before.length === 11 && released, `${before.length} mounts; last ${JSON.stringify(before.at(-1).listeners)}`])
  // A layout shift above the range, then routeChanged(), with no scroll: the bridge's route refresh re-derives.
  await page.evaluate(() => window.__rb.jump(1400))
  await sleep(1200)
  await page.evaluate(() => window.__rb.shiftAbove(300))
  await sleep(300)
  await page.evaluate(() => window.__rb.routeChanged())
  await sleep(800)
  const after = await page.evaluate(() => window.__rb.mounts())
  const answered = after.map((m, i) => m.rehydrates.filter((r) => r === 'route').length - before[i].rehydrates.filter((r) => r === 'route').length)
  const stale = after.slice(0, -1).some((m, i) => m.renders !== before[i].renders)
  out.push(['routes: only the shown mount answers routeChanged(); the ones left never render', answered.at(-1) === 1 && answered.slice(0, -1).every((n) => n === 0) && !stale, `route rehydrates per mount: ${answered.join(',')}`])
  const shifted = await page.evaluate(() => {
    const drawn = window.__rb.drawn()
    const last = drawn.at(-1)
    return { last, rangePx: window.__rb.rangePx() }
  })
  const truthNow = await page.evaluate(() => {
    const el = document.querySelector('[data-scene-root]').getBoundingClientRect()
    return Math.min(1, Math.max(0, -el.top / (el.height - innerHeight)))
  })
  const err = Math.abs(shifted.last.e - truthNow) * shifted.rangePx
  out.push(['routes: after a shift above the range and routeChanged(), the canvas draws the new position', err <= TOL_PX, `${r1(err)} px`])
  await page.evaluate(() => window.__rb.go('b'))
  await sleep(800)
  const gone = await page.evaluate(() => window.__rb.contexts())
  out.push(['routes: on the plain route no context is live', gone.live === 0, JSON.stringify(gone)])
  out.push(['routes: no uncaught errors or console errors', errors.length === 0, errors.slice(0, 3).join(' | ')])
  return out
}

// ── run ─────────────────────────────────────────────────────────────────

const open = { browser: null, server: null }
async function shutdown() {
  await open.browser?.close().catch(() => {})
  open.browser = null
  if (open.server) {
    open.server.httpServer.closeAllConnections?.()
    await new Promise((resolve) => open.server.httpServer.close(() => resolve()))
    open.server = null
  }
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await shutdown()
    process.exit(130)
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const deps = {}
  for (const [name, pin] of Object.entries(PINS)) {
    const found = folioPackage(name)
    if (!found || found.version !== pin) {
      console.error(`render-bridge: needs ${name} ${pin} in examples/folio/node_modules (found ${found?.version ?? 'none'}): run \`pnpm install\` in examples/folio`)
      return MISSING
    }
    deps[name] = found
  }
  // The fixture's TSX against the block's types and the pinned three/R3F/React types (tsconfig.json beside it).
  const tsc = spawnSync(process.execPath, [join(repo, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', join(fixtureRoot, 'tsconfig.json')], { encoding: 'utf8' })
  const typed = tsc.status === 0
  console.log(`${typed ? 'PASS' : 'FAIL'}  types     fixture           the fixture typechecks against the block and the pinned three/R3F types${typed ? '' : `  (${(tsc.stdout + tsc.stderr).trim().split('\n').slice(0, 3).join(' | ')})`}`)
  open.server = await serve(deps)
  const base = `http://127.0.0.1:${open.server.httpServer.address().port}`

  let failures = typed ? 0 : 1
  const counts = {}
  const line = (ok, browser, pageName, name, detail) => {
    counts[browser] ??= { pass: 0, fail: 0 }
    counts[browser][ok ? 'pass' : 'fail']++
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${browser.padEnd(8)}  ${pageName.padEnd(18)}  ${name}${detail ? `  (${detail})` : ''}`)
  }

  for (const browserName of args.browsers) {
    open.browser = await BROWSERS[browserName].launch(LAUNCH[browserName])
    const webgl = browserName === 'chromium'
    const runs = [
      ...Object.keys(VARIANTS).map((v) => [`${v}${webgl ? '' : '-dom'}`, (t) => sceneSequence(t, v, webgl)]),
      ...(webgl && (!args.only || args.only.includes('routes')) ? [['routes', routesSequence]] : []),
      ...['motion', 'gsap'].map((e) => [`nowebgl-${e}`, (t) => noWebglSequence(t, e)]),
      ['static', staticSequence],
    ]
    for (const [pageName, run] of runs) {
      const contexts = []
      const t = {
        only: args.only,
        // Lag is gated where the canvas is WebGL (the smoke); the dom stand-in's lag is reported.
        gateLag: webgl,
        num: (name, value, detail) => console.log(`NUM   ${browserName.padEnd(8)}  ${pageName.padEnd(18)}  ${name}: ${value}${detail ? `  (${detail})` : ''}`),
        async open(path, { javaScriptEnabled = true } = {}) {
          const context = await open.browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, javaScriptEnabled })
          contexts.push(context)
          const page = await context.newPage()
          const errors = []
          page.on('pageerror', (err) => errors.push(err.message.split('\n')[0]))
          page.on('console', (msg) => msg.type() === 'error' && !IGNORED.test(msg.text()) && errors.push(`console: ${msg.text().split('\n')[0]}`))
          await page.goto(`${base}/${path}`, { waitUntil: 'load' })
          return { page, context, errors }
        },
      }
      try {
        for (const [name, ok, detail] of await run(t)) line(ok, browserName, pageName, name, detail)
      } catch (err) {
        line(false, browserName, pageName, 'sequence', err.message.split('\n')[0])
      } finally {
        for (const context of contexts) await context.close().catch(() => {})
      }
    }
    await open.browser.close()
    open.browser = null
  }
  console.log(`\n${Object.entries(counts).map(([b, c]) => `${b}: ${c.pass} passed, ${c.fail} failed`).join(' · ')}`)
  return failures
}

const MISSING = Symbol('missing dependencies')
let failures = 1
try {
  failures = await main()
} catch (err) {
  console.error(err)
} finally {
  await shutdown()
}
if (failures === MISSING) process.exit(2)
console.log(failures ? `\n${failures} check(s) failed` : '\nall render-bridge checks passed')
process.exit(failures ? 1 : 0)
