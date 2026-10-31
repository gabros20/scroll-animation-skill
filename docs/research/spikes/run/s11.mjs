// S11 — the render seam: the 3d skill's conductor and SceneCanvas (vendored, src/s11/vendor-3d) fed through OUR
// pinned scene and authority (skills/scroll-animation/assets). Pages: pages/s11-seam.html, pages/s11-routes.html.
//
//   Q1  one measurement or two: our scene's p (→ conductor A) against the 3d adapters (B: engine adapter, C: native
//       adapter) and the rect truth, over a wheel run, jumps, a resize, a shift above + routeChanged(), a reload.
//   Q2  the tick: the frame the canvas rendered with, per frameloop / advance() source, and renders per second.
//   Q3  lifecycle through our pin: off-screen, hidden, reduced motion live, reload / pageshow, context loss.
//   Q4  routes: context release, <Activity>, the bridge after routeChanged(), a view transition's old snapshot.
//
// PARTS=q1,q2,q3,q4  Q2='engine auth params;…' (a subset)  S11_OUT=name (results/<name>.json)  ENGINES=chromium,webkit (Q1 only; Q2–Q4 are Chromium + SwiftShader)  REPS=2
import { PNG } from 'pngjs'
import { frameIntervals, newPage, r3, sleep, stats, wheel, withBrowser, withServer, writeResult } from './harness.mjs'

const PARTS = (process.env.PARTS ?? 'q1,q2,q3,q4').split(',')
const ENGINES = (process.env.ENGINES ?? 'chromium,webkit').split(',')
const REPS = Number(process.env.REPS ?? 2)
const VIEWPORT = { width: 1000, height: 600 }
const TOL = 0.001 // agreement threshold, in progress

const hist = (arr) => arr.reduce((h, k) => ((h[k] = (h[k] ?? 0) + 1), h), {})
const moving = (rows, n) => n > 0 && Math.abs(rows[n].y - rows[n - 1].y) > 0.5
const max = (a) => (a.length ? Math.max(...a) : null)

/** k such that `value` equals rows[n-k][key] within tolPx (px of the range); 'none' otherwise. */
function lagOf(rows, n, value, key, range, tolPx = 1.01, maxK = 4) {
  let best = 'none'
  let bestErr = Infinity
  for (let k = 0; k <= Math.min(maxK, n); k++) {
    const e = Math.abs(value - rows[n - k][key]) * range
    if (e < bestErr - 1e-9) (bestErr = e), (best = k)
  }
  return bestErr <= tolPx ? best : 'none'
}

async function open(browser, base, page, params) {
  const p = await newPage(browser, VIEWPORT)
  const warnings = []
  p.on('console', (m) => {
    if (/too many active webgl|context lost/i.test(m.text())) warnings.push(m.text())
  })
  await p.goto(`${base}/pages/${page}.html?${params}`)
  await p.waitForFunction(() => window.__s11?.ready || window.__s11r?.ready)
  await sleep(1200)
  return { page: p, warnings }
}

const now = (page) => page.evaluate(() => performance.now())
const geometry = (page) => page.evaluate(() => window.__s11.geometry())
const jump = (page, y) => page.evaluate((v) => window.__s11.jump(v), y)

// ---- Q1 ----------------------------------------------------------------------------------------------------
const SOURCES = ['sp', 'a', 'b', 'c']

function agreement(rows, range, keep = () => true) {
  const out = {}
  const rs = rows.filter((r) => r.truth != null && keep(r))
  for (const k of SOURCES) {
    const e = rs.map((r) => Math.abs(r[k] - r.truth))
    out[k] = { maxPx: r3(max(e) * range), framesOff: e.filter((x) => x > TOL).length }
  }
  out.aVsB = r3(max(rs.map((r) => Math.abs(r.a - r.b))))
  out.aVsC = r3(max(rs.map((r) => Math.abs(r.a - r.c))))
  out.truthVsLvhPx = r3(max(rs.map((r) => Math.abs(r.truth - r.truthLvh))) * range)
  out.frames = rs.length
  return out
}

function lags(rows, range) {
  const out = Object.fromEntries(SOURCES.map((k) => [k, []]))
  for (let n = 1; n < rows.length; n++) {
    if (!moving(rows, n) || rows[n].truth <= 0 || rows[n].truth >= 1) continue
    for (const k of SOURCES) out[k].push(lagOf(rows, n, rows[n][k], 'truth', range))
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, hist(v)]))
}

/** transient = within `ms` after an event; settled = the rest */
const near = (events, ms) => (r) => events.some((t) => r.t >= t && r.t < t + ms)

async function q1Run(browser, base, engine, auth, extra = '') {
  const { page } = await open(browser, base, 's11-seam', `engine=${engine}&auth=${auth}&canvas=0${extra}`)
  const g = await geometry(page)
  const range = g.rangePx
  const res = { engine, auth, extra, geometry: g }

  // wheel run
  const wheelRuns = []
  for (let rep = 0; rep < REPS; rep++) {
    await jump(page, 0)
    await sleep(500)
    await page.evaluate(() => window.__s11.rec.start())
    await wheel(page, { steps: 14, delta: 100, gap: 40 })
    await sleep(1400)
    await wheel(page, { steps: 7, delta: -100, gap: 40 })
    await sleep(1400)
    const rows = await page.evaluate(() => window.__s11.rec.stop())
    wheelRuns.push({ frameInterval: frameIntervals(rows), agreement: agreement(rows, range), lag: lags(rows, range) })
  }
  res.wheel = wheelRuns

  // jumps (the authority's scrollTo, immediate)
  await page.evaluate(() => window.__s11.rec.start())
  const ev = []
  for (const f of [0.6, 0.2, 0.95, 0.5]) {
    ev.push(await now(page))
    await jump(page, Math.round(g.top + range * f))
    await sleep(700)
  }
  let rows = await page.evaluate(() => window.__s11.rec.stop())
  res.jump = { transient3f: agreement(rows, range, near(ev, 60)), settled: agreement(rows, range, (r) => !near(ev, 300)(r)) }

  // resize (and back), mid-scene
  await jump(page, Math.round(g.top + range * 0.5))
  await sleep(500)
  await page.evaluate(() => window.__s11.rec.start())
  const rv = [await now(page)]
  await page.setViewportSize({ width: 1280, height: 720 })
  await sleep(900)
  rv.push(await now(page))
  await page.setViewportSize(VIEWPORT)
  await sleep(900)
  rows = await page.evaluate(() => window.__s11.rec.stop())
  res.resize = {
    transient300ms: agreement(rows, range, near(rv, 300)),
    settled: agreement(rows, range, (r) => !near(rv, 500)(r)),
    // range per row, to see which measures follow the new viewport (the rect truth uses the live viewport)
    rangeAfter: await geometry(page)
  }

  // 300 px inserted above the wrapper (no scroll anchoring, no window resize), then routeChanged()
  await jump(page, Math.round(g.top + range * 0.5))
  await sleep(500)
  await page.evaluate(() => window.__s11.rec.start())
  const t0 = await now(page)
  await page.evaluate(() => window.__s11.shiftAbove(300))
  await sleep(80)
  const t1 = await now(page)
  await page.evaluate(() => window.__s11.routeChanged())
  await sleep(1000)
  const t2 = await now(page)
  // and a scroll afterwards: who catches up on the next scroll event?
  await wheel(page, { steps: 2, delta: 100, gap: 40 })
  await sleep(800)
  rows = await page.evaluate(() => window.__s11.rec.stop())
  const rangeShift = (await geometry(page)).rangePx
  res.shiftThenRouteChanged = {
    beforeRouteChanged80ms: agreement(rows, rangeShift, (r) => r.t >= t0 + 34 && r.t < t1),
    afterRouteChanged: agreement(rows, rangeShift, (r) => r.t >= t1 + 50 && r.t < t2),
    afterNextScroll: agreement(rows, rangeShift, (r) => r.t >= t2 + 600)
  }
  await page.evaluate(() => window.__s11.shiftAbove(0))
  await page.evaluate(() => window.__s11.routeChanged())
  await sleep(500)

  // reload mid-scene: the recorder runs from boot
  await jump(page, Math.round(g.top + range * 0.45))
  await sleep(600)
  await page.reload()
  await page.waitForFunction(() => window.__s11?.ready)
  await sleep(1500)
  rows = await page.evaluate(() => window.__s11.rec.stop())
  const withRoot = rows.filter((r) => r.truth != null)
  const firstRight = Object.fromEntries(
    SOURCES.map((k) => {
      const i = withRoot.findIndex((r) => Math.abs(r[k] - r.truth) <= TOL)
      return [k, i === -1 ? 'never' : i]
    })
  )
  res.reload = {
    y: withRoot.at(-1)?.y,
    framesWithRoot: withRoot.length,
    firstFrameRight: firstRight,
    settled: agreement(withRoot.slice(10), range)
  }
  await page.context().close()
  return res
}

// ---- Q2 ----------------------------------------------------------------------------------------------------
const Q2 = (process.env.Q2 ? process.env.Q2.split(';').map((v) => v.split(' ')) : null) ?? [
  ['gsap', 'native', 'loop=demand'],
  ['gsap', 'native', 'loop=always'],
  ['gsap', 'native', 'loop=advance&tick=gsap'],
  ['gsap', 'native', 'loop=advance&tick=raf'],
  ['gsap', 'native', 'loop=advance&tick=scroll'],
  ['gsap', 'native', 'loop=advance&tick=gsap&dirty=1'],
  ['gsap', 'lenis-gsap', 'loop=demand'],
  ['gsap', 'lenis-gsap', 'loop=always'],
  ['gsap', 'lenis-gsap', 'loop=advance&tick=gsap'],
  ['gsap', 'lenis-gsap', 'loop=advance&tick=gsap&dirty=1'],
  ['motion', 'native', 'loop=demand'],
  ['motion', 'native', 'loop=always'],
  ['motion', 'native', 'loop=advance&tick=raf'],
  ['motion', 'native', 'loop=advance&tick=scroll'],
  ['motion', 'native', 'loop=advance&tick=motion-render'],
  ['motion', 'native', 'loop=advance&tick=motion-render&dirty=1'],
  ['motion', 'lenis-motion', 'loop=demand'],
  ['motion', 'lenis-motion', 'loop=always'],
  ['motion', 'lenis-motion', 'loop=advance&tick=motion-update'],
  ['motion', 'lenis-motion', 'loop=advance&tick=motion-render'],
  ['motion', 'lenis-motion', 'loop=advance&tick=motion-postrender'],
  ['motion', 'lenis-motion', 'loop=advance&tick=motion-render&dirty=1']
]

function analyseQ2(rows, range, restFrom) {
  const lag = []
  const sceneLag = []
  const errPx = []
  let same = 0
  let none = 0
  let movingRenders = 0
  let movingFrames = 0
  for (let n = 1; n < rows.length; n++) {
    const r = rows[n]
    if (!moving(rows, n) || r.truth <= 0 || r.truth >= 1) continue
    movingFrames++
    movingRenders += r.rn - rows[n - 1].rn
    if (r.rf === r.f) same++
    else none++
    lag.push(r.ue == null ? 'none' : lagOf(rows, n, r.ue, 'truth', range))
    sceneLag.push(lagOf(rows, n, r.sp, 'truth', range))
    if (r.ue != null) errPx.push(Math.abs(r.ue - r.truth) * range)
  }
  // smooth (A's damped value, what visuals read): best-fit delay against the truth, in frames
  let bestK = 0
  let bestMean = Infinity
  const mv = rows.map((_, n) => n).filter((n) => moving(rows, n))
  for (let k = 0; k <= 40; k++) {
    let s = 0
    let c = 0
    for (const n of mv) if (n - k >= 0 && rows[n].us != null) (s += Math.abs(rows[n].us - rows[n - k].truth)), c++
    const m = c ? s / c : Infinity
    if (m < bestMean) (bestMean = m), (bestK = k)
  }
  const rest = rows.filter((r) => r.t >= restFrom)
  const restSec = rest.length > 1 ? (rest.at(-1).t - rest[0].t) / 1000 : 0
  const fi = frameIntervals(rows)
  return {
    frameInterval: fi,
    movingFrames,
    renderedInTheFrame: same,
    notRenderedInTheFrame: none,
    lag: hist(lag),
    sceneLag: hist(sceneLag),
    exactErrScrollPx: stats(errPx),
    smoothBestFitDelayFrames: bestK,
    smoothBestFitMeanErrPx: r3(bestMean * range),
    rendersPerMovingFrame: r3(movingRenders / Math.max(1, movingFrames)),
    rendersPerSecondScrolling: r3((movingRenders / Math.max(1, movingFrames)) * (1000 / (fi.median || 16.7))),
    rendersPerSecondAtRest: restSec ? r3((rest.at(-1).rn - rest[0].rn) / restSec) : null
  }
}

async function q2Run(browser, base, [engine, auth, loop]) {
  const { page } = await open(browser, base, 's11-seam', `engine=${engine}&auth=${auth}&${loop}`)
  await page.waitForFunction(() => document.querySelector('[data-scene-ready="true"]'), null, { timeout: 15000 })
  const g = await geometry(page)
  const webgl = await page.evaluate(() => window.__s11.webgl())
  const runs = []
  for (let rep = 0; rep < REPS; rep++) {
    await jump(page, 0)
    await sleep(800)
    await page.evaluate(() => window.__s11.rec.start())
    await wheel(page, { steps: 14, delta: 100, gap: 40 })
    await sleep(1400)
    await wheel(page, { steps: 7, delta: -100, gap: 40 })
    await sleep(1400)
    await jump(page, Math.round(g.top + g.rangePx * 0.5))
    await sleep(1500)
    const restFrom = await now(page)
    await sleep(1500)
    const rows = await page.evaluate(() => window.__s11.rec.stop())
    runs.push(analyseQ2(rows, g.rangePx, restFrom))
  }
  const params = await page.evaluate(() => window.__s11.params)
  await page.context().close()
  return { engine, auth, loop, damping: params.damping, webgl: webgl?.renderer ?? null, runs }
}

// ---- Q3 ----------------------------------------------------------------------------------------------------
const Q3 = [
  ['motion', 'lenis-motion', 'loop=demand'],
  ['motion', 'native', 'loop=demand'],
  ['gsap', 'lenis-gsap', 'loop=advance&tick=gsap'],
  ['gsap', 'lenis-gsap', 'loop=advance&tick=gsap&gate=1&dirty=1&mountRender=0'],
  ['gsap', 'lenis-gsap', 'loop=advance&tick=gsap&gate=1&dirty=1'],
  ['motion', 'lenis-motion', 'loop=advance&tick=motion-render&gate=1&dirty=1']
]

const snap = (page) =>
  page.evaluate(() => {
    const s = window.__s11
    const root = s.S.root()
    return {
      y: scrollY,
      rn: s.R.n,
      glFrames: s.R.gl?.info.render.frame ?? null,
      frameloop: s.R.frameloop,
      sceneMode: document.querySelector('[data-scene-mode]')?.getAttribute('data-scene-mode') ?? null,
      sceneReady: document.querySelector('[data-scene-ready]')?.getAttribute('data-scene-ready') ?? null,
      canvasInDom: !!document.querySelector('canvas'),
      awake: s.S.awake(),
      sceneReduced: s.S.reduced(),
      p: s.S.progress(),
      band: s.S.band(),
      a: s.A.state.exact,
      aSmooth: s.A.state.smooth,
      aReduced: s.A.state.reduced,
      aIndex: s.A.state.index,
      wrapperHeight: root?.getBoundingClientRect().height,
      contexts: s.contexts()
    }
  })

async function rendersOver(page, ms) {
  const a = await page.evaluate(() => window.__s11.R.n)
  await sleep(ms)
  return (await page.evaluate(() => window.__s11.R.n)) - a
}

async function q3Run(browser, base, [engine, auth, loop]) {
  const { page, warnings } = await open(browser, base, 's11-seam', `engine=${engine}&auth=${auth}&${loop}`)
  await page.waitForFunction(() => document.querySelector('[data-scene-ready="true"]'), null, { timeout: 15000 })
  const g = await geometry(page)
  const out = { engine, auth, loop }

  // (a) off-screen: the wrapper's bottom edge leaves the 200 px margins. Scan down across it in 20 px steps.
  const edge = g.top + g.height // document y of the wrapper's bottom
  const scan = []
  for (let y = edge - 100; y <= edge + 400; y += 20) {
    await jump(page, y)
    await sleep(120)
    const s = await snap(page)
    scan.push({ yPastWrapperBottom: y - edge, awake: s.awake, frameloop: s.frameloop })
  }
  const flip = (key, val) => scan.find((s) => s[key] === val)?.yPastWrapperBottom ?? 'never'
  await jump(page, edge + 1500)
  await sleep(800)
  out.offscreen = {
    ourAwakeFalseFromPx: flip('awake', false),
    canvasNeverFromPx: flip('frameloop', 'never'),
    rendersPerSecondOffscreen: await rendersOver(page, 1000),
    wheelOffscreenRenders: await (async () => {
      const a = await page.evaluate(() => window.__s11.R.n)
      await wheel(page, { steps: 6, delta: -100, gap: 40 })
      await sleep(300)
      return (await page.evaluate(() => window.__s11.R.n)) - a
    })(),
    state: await snap(page)
  }

  // (b) hidden (simulated: headless pages are never hidden)
  await jump(page, Math.round(g.top + g.rangePx * 0.4))
  await sleep(800)
  await page.evaluate(() => window.__s11.fakeHidden(true))
  await sleep(200)
  out.hidden = {
    rendersPerSecondHidden: await rendersOver(page, 1000),
    frameloop: (await snap(page)).frameloop
  }
  await page.evaluate(() => window.__s11.fakeHidden(false))
  await sleep(300)
  out.hidden.rendersPerSecondAfterShow = await rendersOver(page, 1000)

  // (c) reduced motion, live
  await jump(page, Math.round(g.top + g.rangePx * 0.4))
  await sleep(1200)
  const before = await snap(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await sleep(1200)
  const after = await snap(page)
  const rendersAfterSwitch = await rendersOver(page, 1000)
  await wheel(page, { steps: 3, delta: 100, gap: 40 })
  await sleep(1000)
  const afterScroll = await snap(page)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await sleep(1500)
  const back = await snap(page)
  // the composed state: the conductor's nearest chapter bound, from where it was before the switch
  const nearestBound = Math.round(before.a * 3) / 3
  out.reducedLive = { before, after, rendersPerSecondAfterSwitch: rendersAfterSwitch, afterScroll, back, nearestBound: r3(nearestBound) }

  // (d) reload mid-scene: every render from boot
  await jump(page, Math.round(g.top + g.rangePx * 0.45))
  await sleep(800)
  await page.reload()
  await page.waitForFunction(() => window.__s11?.ready)
  await page.waitForFunction(() => document.querySelector('[data-scene-ready="true"]'), null, { timeout: 15000 })
  await sleep(1000)
  const boot = await page.evaluate(() => window.__s11.R.boot.filter((r) => r.truth != null))
  const sweep = boot.map((r) => Math.abs(r.smooth - r.truth))
  out.reload = {
    // the canvas's top-left corner after the poster faded: the clear colour (32,48,64) if anything rendered
    cornerPixel: await pixel(page, 990, 590),
    y: await page.evaluate(() => scrollY),
    firstRender: boot[0] ?? null,
    rendersLogged: boot.length,
    smoothOffByMoreThan001: sweep.filter((e) => e > 0.01).length,
    maxSmoothErr: r3(max(sweep))
  }
  // synthetic bfcache return: scroll moved while "away" (no scroll events reach the page's listeners)
  await page.evaluate(() => {
    window.__s11.R.boot = []
  })
  const yBack = Math.round(g.top + g.rangePx * 0.7)
  await page.evaluate((y) => {
    // move the scroll without letting listeners see it, then fire the pageshow the browser would
    const stop = (e) => e.stopImmediatePropagation()
    window.addEventListener('scroll', stop, { capture: true })
    window.__s11.handle.scrollTo(y, { immediate: true })
    setTimeout(() => {
      window.removeEventListener('scroll', stop, { capture: true })
      window.__s11.fakePageShow()
    }, 50)
  }, yBack)
  await sleep(1200)
  const bf = await page.evaluate(() => window.__s11.R.boot.filter((r) => r.truth != null))
  out.pageshowSynthetic = {
    firstRender: bf[0] ?? null,
    renders: bf.length,
    smoothOffByMoreThan001: bf.filter((r) => Math.abs(r.smooth - r.truth) > 0.01).length,
    final: await snap(page)
  }

  // (e) context loss and restore
  await jump(page, Math.round(g.top + g.rangePx * 0.4))
  await sleep(800)
  const beforeLoss = await snap(page)
  await page.evaluate(() => window.__s11.loseContext())
  await sleep(800)
  const lost = await snap(page)
  const rendersLost = await rendersOver(page, 1000)
  await page.evaluate(() => window.__s11.restoreContext())
  await sleep(1000)
  await wheel(page, { steps: 3, delta: 100, gap: 40 })
  await sleep(800)
  const restored = await snap(page)
  out.contextLoss = { beforeLoss, lost, rendersPerSecondLost: rendersLost, restored, warnings }
  await page.context().close()
  return out
}

// ---- Q4 ----------------------------------------------------------------------------------------------------
const Q4 = [
  'keep=unmount&loop=demand',
  'keep=activity&loop=demand',
  'keep=activity&loop=always',
  'keep=activity&loop=advance',
  'keep=activity&loop=demand&bridgeRefresh=1',
  'keep=unmount&loop=demand&vt=1'
]

async function pixel(page, x, y) {
  const buf = await page.screenshot({ clip: { x, y, width: 1, height: 1 } })
  const png = PNG.sync.read(buf)
  return [png.data[0], png.data[1], png.data[2]]
}

const rState = (page) => page.evaluate(() => window.__s11r.state())
async function rRenders(page, ms) {
  const read = () => page.evaluate(() => [window.__s11r.L.renders, window.__s11r.L.gl?.info.render.frame ?? 0])
  const a = await read()
  await sleep(ms)
  const b = await read()
  return { useFrame: b[0] - a[0], glRender: b[1] - a[1] }
}

async function q4Run(browser, base, params) {
  const { page, warnings } = await open(browser, base, 's11-routes', params)
  await page.waitForFunction(() => document.querySelector('[data-scene-ready="true"]'), null, { timeout: 15000 })
  const out = { params }
  await page.evaluate(() => window.scrollTo(0, 1500))
  await sleep(1200)
  out.onA = await rState(page)
  const vt = params.includes('vt=1')
  if (vt) {
    out.vt = { canvasCorner: await pixel(page, 950, 560), canvasCentre: await pixel(page, 500, 300) }
    await page.evaluate(() => window.__s11r.go('b'))
    await sleep(300)
    out.vt.oldSnapshotCorner = await pixel(page, 950, 560)
    out.vt.oldSnapshotCentre = await pixel(page, 500, 300)
    out.vt.stateDuringTransition = await rState(page)
    await sleep(4200)
    out.vt.afterCorner = await pixel(page, 950, 560)
  } else {
    await page.evaluate(() => window.__s11r.go('b'))
    await sleep(1000)
  }
  out.onB = await rState(page)
  out.onB.rendersPerSecond = await rRenders(page, 1000)
  await wheel(page, { steps: 5, delta: 100, gap: 40 })
  out.onB.rendersWhileScrollingB = await rRenders(page, 600)
  // back to A at its saved position (the router's restore), then routeChanged() from <RouteChange>
  const navBack = await page.evaluate(() => window.__s11r.L.nav + 1)
  await page.evaluate(() => window.__s11r.go('a', { restore: true }))
  await sleep(vt ? 5500 : 1500)
  out.backOnA = await rState(page)
  const log = await page.evaluate((n) => window.__s11r.L.afterNav.filter((r) => r.nav === n && r.visible), navBack)
  out.backOnA.firstRender = log[0] ?? null
  out.backOnA.rendersLogged = log.length
  out.backOnA.smoothOffByMoreThan001 = log.filter((r) => r.truth != null && Math.abs(r.smooth - r.truth) > 0.01).length
  out.backOnA.rehydrates = await page.evaluate((n) => window.__s11r.L.rehydrates.filter((r) => r.nav === n), navBack)
  // 20 round trips
  if (!vt) {
    for (let i = 0; i < 20; i++) {
      await page.evaluate(() => window.__s11r.go('b'))
      await sleep(150)
      await page.evaluate(() => window.__s11r.go('a', { restore: true }))
      await sleep(400)
    }
    await sleep(1000)
    out.after20 = await rState(page)
    out.after20.rendersPerSecond = await rRenders(page, 1000)
  }
  out.warnings = warnings
  await page.context().close()
  return out
}

// ---- run ---------------------------------------------------------------------------------------------------
const out = { spike: 'S11', versions: {}, q1: [], q2: [], q3: [], q4: [] }

await withServer('s11', async (base) => {
  for (const engine of ENGINES) {
    await withBrowser(engine, async (browser) => {
      out.versions[engine] = browser.version()
      if (PARTS.includes('q1'))
        for (const [e, a, x] of [
          ['motion', 'native'],
          ['motion', 'lenis-motion'],
          ['gsap', 'native'],
          ['gsap', 'lenis-gsap'],
          // the bridge registers scene.rehydrate() through onRouteRefresh (Motion routes register no refresh)
          ['motion', 'native', '&bridgeRefresh=1']
        ]) {
          console.error(`q1 ${engine} ${e} ${a} ${x ?? ''}`)
          out.q1.push({ browser: engine, ...(await q1Run(browser, base, e, a, x)) })
        }
      if (engine !== 'chromium') return
      if (PARTS.includes('q2'))
        for (const v of Q2) {
          console.error(`q2 ${v.join(' ')}`)
          out.q2.push(await q2Run(browser, base, v))
        }
      if (PARTS.includes('q3'))
        for (const v of Q3) {
          console.error(`q3 ${v.join(' ')}`)
          out.q3.push(await q3Run(browser, base, v))
        }
      if (PARTS.includes('q4'))
        for (const v of Q4) {
          console.error(`q4 ${v}`)
          out.q4.push(await q4Run(browser, base, v))
        }
    })
  }
})

const file = writeResult(process.env.S11_OUT ?? 's11', out)
console.log(JSON.stringify({ spike: 'S11', versions: out.versions, raw: file }, null, 1))
