// S1 — Lenis + CSS scroll/view timelines (Chromium, WebKit).
//
// Two readouts per frame:
//  1. JS, end of frame: each box's timing progress and computed style vs the
//     progress expected from scrollTop in that same frame.
//  2. Painted: screencast frames. Each view() box is self-checking (its painted
//     x must equal 400 * (vh - top) / (vh + h) for its own painted top), and the
//     fixed scroll(root) boxes are checked against the scroll offset implied by
//     a fully visible view box in the same image.
// Errors are in "scroll px": how far the scroll position would have to move to
// explain the discrepancy. A one-frame lag shows up as ~one frame's scroll delta.
import { decode, boxes } from './pixels.mjs'
import { newPage, r3, sleep, stats, wheel, withBrowser, withServer, writeResult, frameIntervals } from './harness.mjs'

const REPS = Number(process.env.REPS ?? 3)
const CAST_REPS = Number(process.env.CAST_REPS ?? 2)
const ENGINES = (process.env.ENGINES ?? 'chromium,webkit').split(',')
const MODES = (process.env.MODES ?? 'native,lenis').split(',')
const TRAVEL = 400

const phase = (page, name) => page.evaluate((n) => (window.__phase = n), name)

async function drive(page, mode) {
  await page.evaluate(() => {
    window.__phase = 'reset'
    window.__s1.lenis?.scrollTo(0, { immediate: true })
    window.scrollTo(0, 0)
  })
  await sleep(500)
  await page.evaluate(() => window.__s1.rec.start())
  await phase(page, 'wheel-down')
  await wheel(page, { steps: Number(process.env.WHEEL_DOWN ?? 14), delta: 100, gap: 40 })
  await sleep(1400)
  await phase(page, 'wheel-up')
  await wheel(page, { steps: Number(process.env.WHEEL_UP ?? 7), delta: -100, gap: 40 })
  await sleep(1400)
  await phase(page, 'jump')
  for (const y of [2000, 1100, 2600, 1500]) {
    await page.evaluate((v) => window.scrollTo(0, v), y)
    await sleep(250)
  }
  if (mode === 'lenis') {
    await phase(page, 'lenis-scrollTo')
    await page.evaluate(() => window.__s1.lenis.scrollTo(2400))
    await sleep(1800)
  }
  return page.evaluate(() => window.__s1.rec.stop())
}

// ---- JS readout analysis -------------------------------------------------
function analyseJs(rows, L) {
  const series = {}
  const outliers = []
  let ctx = null
  const add = (key, moving, e0, e1, e2) => {
    const s = (series[key] ??= { moving: [], still: [], lag: [0, 0, 0], signed: [] })
    if (moving) {
      s.moving.push(Math.abs(e0))
      s.signed.push(e0)
      const a = [Math.abs(e0), Math.abs(e1), Math.abs(e2)]
      const lag = a.indexOf(Math.min(...a))
      s.lag[lag]++
      if (lag > 0 && outliers.length < 12) outliers.push({ series: key, lag, errPx: r3(e0), ...ctx })
    } else s.still.push(Math.abs(e0))
  }
  const viewExp = ([top, h], y) => Math.min(1, Math.max(0, (y + L.vh - top) / (L.vh + h)))
  // scroll(root) boxes: expected unwrapped iterations; one iteration = maxScroll / iters scroll px
  const iters = L.rootIters
  const rootExp = (y) => iters * Math.min(1, Math.max(0, y / L.maxScroll))
  const unwrap = (frac, near) => {
    const n = Math.round(near - frac)
    return n + frac
  }
  let lenisGap = 0
  for (let n = 2; n < rows.length; n++) {
    const r = rows[n]
    const y0 = r.y
    const y1 = rows[n - 1].y
    const y2 = rows[n - 2].y
    const moving = Math.abs(y0 - y1) > 0.5
    ctx = { frame: n, phase: r.ph, y: y0, prevY: y1 }
    if (r.ly != null) lenisGap = Math.max(lenisGap, Math.abs(r.ly - r.y))
    const each = (name, list, measured, toP) => {
      if (!measured) return
      list.forEach((box, k) => {
        const e = [y0, y1, y2].map((y) => viewExp(box, y))
        if (!(e[0] > 0.002 && e[0] < 0.998)) return
        const p = toP(measured[k])
        const scale = L.vh + box[1]
        add(name, moving, (p - e[0]) * scale, (p - e[1]) * scale, (p - e[2]) * scale)
      })
    }
    each('view.transform.timing', L.red, r.pr, (v) => v)
    each('view.transform.style', L.red, r.xr, (v) => v / TRAVEL)
    each('view.left.timing', L.green, r.pg, (v) => v)
    each('view.left.style', L.green, r.xg, (v) => v / TRAVEL)
    const root = (name, measured, toP) => {
      if (measured == null) return
      const e = [y0, y1, y2].map(rootExp)
      if (!(e[0] > 0.02 && e[0] < iters - 0.02)) return
      const p = toP(measured, e[0])
      const s = L.maxScroll / iters
      add(name, moving, (p - e[0]) * s, (p - e[1]) * s, (p - e[2]) * s)
    }
    root('root.transform.timing', r.pb, (v) => v)
    root('root.transform.style', r.xb, (v, near) => unwrap(v / TRAVEL, near))
    root('root.left.timing', r.py, (v) => v)
    root('root.left.style', r.xy, (v, near) => unwrap(v / TRAVEL, near))
  }
  const out = {}
  for (const [k, s] of Object.entries(series)) {
    out[k] = {
      movingSamples: s.moving.length,
      errMoving: stats(s.moving),
      signedMean: stats(s.signed).mean,
      errStill: stats(s.still).max ?? null,
      bestLagFrames: { 0: s.lag[0], 1: s.lag[1], 2: s.lag[2] }
    }
  }
  const deltas = []
  for (let n = 1; n < rows.length; n++) deltas.push(Math.abs(rows[n].y - rows[n - 1].y))
  return {
    frames: rows.length,
    movingFrames: deltas.filter((d) => d > 0.5).length,
    scrollDeltaPerMovingFrame: stats(deltas.filter((d) => d > 0.5)),
    frameInterval: frameIntervals(rows),
    lenisAnimatedVsScrollTop: r3(lenisGap),
    series: out,
    outliers
  }
}

// ---- Painted readout analysis ----------------------------------------------
// For each screencast frame: the painted scroll offset comes from a fully
// visible view box's painted top; each box's painted x is inverted to the
// scroll offset its animation was sampled at. Both are then located in the
// per-frame JS rows (one row per rendered frame), so the lag is counted in
// frames: 0 = the animation used the scroll of the frame being painted.
function analysePixels(frames, rows, L) {
  const series = {
    'view.transform': [],
    'view.left': [],
    'root.transform': [],
    'root.left': [],
    'control.view.js': [],
    'control.root.js': []
  }
  const rowT = rows.map((r) => L.timeOrigin + r.t)
  const findRow = (scroll, ts) => {
    let best = -1
    let bestDt = Infinity
    for (let i = 0; i < rows.length; i++) {
      if (Math.abs(rows[i].y - scroll) > 1.01) continue
      const dt = Math.abs(rowT[i] - ts)
      if (dt < bestDt) (bestDt = dt), (best = i)
    }
    return bestDt < 250 ? best : -1
  }
  let used = 0
  for (const f of frames) {
    const img = decode(f.data)
    const sx = img.width / L.vw
    const { boxes: bs } = boxes(img, ['red', 'green', 'blue', 'yellow', 'magenta', 'cyan'])
    const paints = []
    const anims = []
    for (const b of bs) {
      if (b.c !== 'red' && b.c !== 'green' && b.c !== 'magenta') continue
      if (b.minY <= 1 || b.maxY >= img.height - 2) continue // clipped by the viewport
      const top = b.minY / sx
      const h = b.h / sx
      const list = b.c === 'red' ? L.red : b.c === 'green' ? L.green : L.magenta
      const k = list.findIndex(([, bh]) => Math.abs(bh - h) <= 3)
      if (k < 0) continue
      const [docTop, bh] = list[k]
      paints.push(docTop - top)
      const exp = (L.vh - top) / (L.vh + bh)
      if (!(exp > 0.01 && exp < 0.99)) continue
      const p = (b.minX / sx - 20) / TRAVEL
      const name = { red: 'view.transform', green: 'view.left', magenta: 'control.view.js' }[b.c]
      anims.push({ name, s: p * (L.vh + bh) + docTop - L.vh })
    }
    if (!paints.length) continue
    const sPaint = paints.reduce((a, b) => a + b, 0) / paints.length
    const iters = L.rootIters
    const rootExp = iters * Math.min(1, Math.max(0, sPaint / L.maxScroll))
    if (rootExp > 0.02 && rootExp < iters - 0.02) {
      for (const b of bs) {
        if (b.c !== 'blue' && b.c !== 'yellow' && b.c !== 'cyan') continue
        const frac = (b.minX / sx - 520) / TRAVEL
        const p = Math.round(rootExp - frac) + frac
        const name = { blue: 'root.transform', yellow: 'root.left', cyan: 'control.root.js' }[b.c]
        anims.push({ name, s: (p / iters) * L.maxScroll })
      }
    }
    const n = findRow(sPaint, f.ts)
    if (n < 1) continue
    used++
    const delta = Math.abs(rows[n].y - rows[n - 1].y)
    const moving = delta > 0.5
    for (const a of anims) {
      const err = a.s - sPaint
      // which recent frame's scroll does the painted animation match?
      let lag = null
      if (moving && delta < 4) lag = 'small-delta'
      else if (moving) {
        let best = Infinity
        for (let m = n; m >= Math.max(0, n - 4); m--) {
          const d = Math.abs(rows[m].y - a.s)
          if (d < best - 0.5) (best = d), (lag = n - m)
        }
        if (best > Math.max(2.5, 0.35 * delta)) lag = 'none'
      }
      series[a.name].push({ err, moving, delta, lag })
    }
  }
  const sum = (arr) => {
    const mv = arr.filter((a) => a.moving)
    const lags = {}
    for (const a of mv) lags[a.lag] = (lags[a.lag] ?? 0) + 1
    return {
      samples: arr.length,
      movingSamples: mv.length,
      errMoving: stats(mv.map((a) => Math.abs(a.err))),
      signedMeanMoving: stats(mv.map((a) => a.err)).mean,
      errStill: stats(arr.filter((a) => !a.moving).map((a) => Math.abs(a.err))).max ?? null,
      lagFrames: lags
    }
  }
  return {
    frames: frames.length,
    framesMatchedToRows: used,
    ...Object.fromEntries(Object.entries(series).map(([k, v]) => [k, sum(v)]))
  }
}

const out = { spike: 'S1', versions: {}, runs: [] }
await withServer('s1', async (base) => {
  for (const engine of ENGINES) {
    await withBrowser(engine, async (browser) => {
      out.versions[engine] = browser.version()
      for (const mode of MODES) {
        const page = await newPage(browser)
        await page.goto(`${base}/pages/s1.html?mode=${mode}&read=all`)
        await page.waitForFunction(() => window.__s1)
        await sleep(300)
        const L = await page.evaluate(() => window.__s1.layout())
        for (let rep = 0; rep < REPS; rep++) {
          const rows = await drive(page, mode)
          out.runs.push({ engine, mode, read: 'all', rep, layout: L, js: analyseJs(rows, L) })
        }
        for (let rep = 0; rep < CAST_REPS; rep++) {
          const frames = []
          await page.screencast.start({
            size: { width: L.vw, height: L.vh },
            quality: 100,
            onFrame: (f) => frames.push({ ts: f.timestamp, data: f.data })
          })
          const rows = await drive(page, mode)
          await page.screencast.stop()
          out.runs.push({ engine, mode, read: 'all+screencast', rep, js: analyseJs(rows, L), painted: analysePixels(frames, rows, L) })
        }
        await page.context().close()
        // single-read runs: does reading one quantity perturb the other?
        for (const read of process.env.SINGLE_READ === '0' ? [] : ['timing', 'style']) {
          const p2 = await newPage(browser)
          await p2.goto(`${base}/pages/s1.html?mode=${mode}&read=${read}`)
          await p2.waitForFunction(() => window.__s1)
          await sleep(300)
          const rows = await drive(p2, mode)
          out.runs.push({ engine, mode, read, rep: 0, js: analyseJs(rows, L) })
          await p2.context().close()
        }
      }
    })
  }
})

// ---- summary -------------------------------------------------------------
const summary = {}
for (const r of out.runs) {
  const key = `${r.engine}/${r.mode}/read=${r.read.replace('+screencast', '')}`
  const s = (summary[key] ??= { js: {}, painted: {}, frameInterval: r.js.frameInterval, scrollDelta: r.js.scrollDeltaPerMovingFrame })
  for (const [name, v] of Object.entries(r.js.series)) {
    const t = (s.js[name] ??= { runs: 0, maxErr: [], p95Err: [], lag0: 0, lag1: 0, lag2: 0, stillMax: 0 })
    t.runs++
    t.maxErr.push(v.errMoving.max)
    t.p95Err.push(v.errMoving.p95)
    t.lag0 += v.bestLagFrames[0]
    t.lag1 += v.bestLagFrames[1]
    t.lag2 += v.bestLagFrames[2]
    t.stillMax = Math.max(t.stillMax, v.errStill ?? 0)
  }
  if (r.painted) {
    for (const name of ['view.transform', 'view.left', 'root.transform', 'root.left', 'control.view.js', 'control.root.js']) {
      const v = r.painted[name]
      const t = (s.painted[name] ??= { runs: 0, samples: 0, maxErr: [], p95Err: [], signedMean: [], lagFrames: {} })
      t.runs++
      t.samples += v.movingSamples
      t.maxErr.push(v.errMoving.max)
      t.p95Err.push(v.errMoving.p95)
      t.signedMean.push(v.signedMeanMoving)
      for (const [lag, c] of Object.entries(v.lagFrames)) t.lagFrames[lag] = (t.lagFrames[lag] ?? 0) + c
    }
  }
}
out.summary = summary
const file = writeResult(`s1${process.env.OUT_SUFFIX ?? ''}`, out)
// compact: worst run for errors, summed frame-lag histograms
const compact = {}
for (const [key, s] of Object.entries(summary)) {
  const c = (compact[key] = { frameMs: s.frameInterval.median, scrollPxPerMovingFrame: s.scrollDelta.median })
  for (const [name, t] of Object.entries(s.js)) {
    c[`js ${name}`] = { maxErrPx: Math.max(...t.maxErr), p95ErrPx: Math.max(...t.p95Err), lagFrames: { 0: t.lag0, 1: t.lag1, 2: t.lag2 } }
  }
  for (const [name, t] of Object.entries(s.painted)) {
    c[`painted ${name}`] = { samples: t.samples, maxErrPx: Math.max(...t.maxErr), p95ErrPx: Math.max(...t.p95Err), lagFrames: t.lagFrames }
  }
}
console.log(JSON.stringify({ spike: 'S1', versions: out.versions, summary: compact, raw: file }, null, 1))
