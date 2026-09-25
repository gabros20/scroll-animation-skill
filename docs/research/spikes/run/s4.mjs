// S4 — same tick. (a) GSAP ticker -> Lenis -> ScrollTrigger, (b) Motion frame
// loop -> Lenis -> useScroll/useSpring, (c) R3F advance() vs demand.
//
// Every row is one rendered frame, sampled after all rAF callbacks (see
// src/lib/rec.js). "Lag k" means the consumer shows the scroll offset the
// document had k frames earlier; 0 = same frame as the painted scroll.
//
// PARTS=a,b,c  ENGINES=chromium,webkit (c is Chromium only)  REPS=3
import { frameIntervals, newPage, r3, sleep, stats, wheel, withBrowser, withServer, writeResult } from './harness.mjs'

const PARTS = (process.env.PARTS ?? 'a,b,c').split(',')
const ENGINES = (process.env.ENGINES ?? 'chromium,webkit').split(',')
const REPS = Number(process.env.REPS ?? 3)
const VIEWPORT = { width: 1000, height: 600 }

async function drive(page, ns, { lenis }) {
  await page.evaluate((n) => {
    const s = window[n]
    s.lenis?.scrollTo(0, { immediate: true })
    window.scrollTo(0, 0)
  }, ns)
  await sleep(600)
  await page.evaluate((n) => window[n].rec.start(), ns)
  await wheel(page, { steps: 14, delta: 100, gap: 40 })
  await sleep(1400)
  await wheel(page, { steps: 7, delta: -100, gap: 40 })
  await sleep(1400)
  if (lenis) {
    await page.evaluate((n) => window[n].lenis.scrollTo(1500), ns)
    await sleep(1600)
  }
  return page.evaluate((n) => window[n].rec.stop(), ns)
}

const hist = (arr) => arr.reduce((h, k) => ((h[k] = (h[k] ?? 0) + 1), h), {})
const moving = (rows, n) => Math.abs(rows[n].y - rows[n - 1].y) > 0.5

/** lag of a value that should equal f(y): the k whose f(y[n-k]) is closest (within tol). */
function lagOf(rows, n, value, f, tol, maxK = 4) {
  let best = 'none'
  let bestErr = Infinity
  for (let k = 0; k <= Math.min(maxK, n); k++) {
    const e = Math.abs(value - f(rows[n - k].y))
    if (e < bestErr - 1e-9) (bestErr = e), (best = k)
  }
  return bestErr <= tol ? best : 'none'
}

// ---- (a) -------------------------------------------------------------------
function analyseA(rows, info) {
  const span = info.end - info.start
  const pe = (y) => Math.min(1, Math.max(0, (y - info.start) / span))
  const stLag = []
  const xLag = []
  const stErr = []
  const xErr = []
  const lenisGap = []
  for (let n = 1; n < rows.length; n++) {
    const r = rows[n]
    if (r.ly != null) lenisGap.push(Math.abs(r.ly - r.y))
    if (!moving(rows, n)) continue
    const p = pe(r.y)
    if (p <= 0 || p >= 1) continue
    stErr.push(Math.abs(r.stP - p) * span)
    xErr.push(Math.abs(r.x / 400 - p) * span)
    stLag.push(lagOf(rows, n, r.stP * span, (y) => pe(y) * span, 1.01))
    xLag.push(lagOf(rows, n, (r.x / 400) * span, (y) => pe(y) * span, 1.01))
  }
  return {
    frameInterval: frameIntervals(rows),
    movingSamples: stLag.length,
    stProgressLag: hist(stLag),
    transformLag: hist(xLag),
    stErrScrollPx: stats(stErr),
    transformErrScrollPx: stats(xErr),
    lenisVsScrollTopPx: stats(lenisGap).max ?? null
  }
}

// ---- (b) -------------------------------------------------------------------
function analyseB(rows) {
  const rawLag = []
  const springErr = []
  const mv = []
  for (let n = 1; n < rows.length; n++) {
    if (!moving(rows, n) || rows[n].raw == null) continue
    rawLag.push(lagOf(rows, n, rows[n].raw, (y) => y, 0.51))
    if (rows[n].spring != null) springErr.push(Math.abs(rows[n].spring - rows[n].y))
    mv.push(n)
  }
  // the spring is a filter, so report the delay that best explains it
  let bestK = 0
  let bestMean = Infinity
  const meanAt = {}
  for (let k = 0; k <= 30; k++) {
    let sum = 0
    let c = 0
    for (const n of mv) {
      if (n - k < 0 || rows[n].spring == null) continue
      sum += Math.abs(rows[n].spring - rows[n - k].y)
      c++
    }
    const mean = c ? sum / c : Infinity
    if (k <= 10 || k % 5 === 0) meanAt[k] = r3(mean)
    if (mean < bestMean) (bestMean = mean), (bestK = k)
  }
  const deltas = mv.map((n) => Math.abs(rows[n].y - rows[n - 1].y))
  return {
    frameInterval: frameIntervals(rows),
    movingSamples: mv.length,
    scrollPxPerMovingFrame: stats(deltas).median,
    rawLag: hist(rawLag),
    springVsScrollTopPx: stats(springErr),
    springBestFitDelayFrames: bestK,
    springBestFitMeanErrPx: r3(bestMean),
    springMeanErrByDelay: meanAt
  }
}

// ---- (c) -------------------------------------------------------------------
function analyseC(rows) {
  const lag = []
  let noRender = 0
  let renderedThisFrame = 0
  for (let n = 1; n < rows.length; n++) {
    if (!moving(rows, n)) continue
    const r = rows[n]
    if (r.rt === r.t) renderedThisFrame++
    else noRender++
    lag.push(r.used == null ? 'none' : lagOf(rows, n, r.used, (y) => y, 0.51))
  }
  return {
    frameInterval: frameIntervals(rows),
    movingSamples: lag.length,
    renderedInTheSameFrame: renderedThisFrame,
    noRenderThisFrame: noRender,
    lag: hist(lag),
    renders: rows.length ? rows[rows.length - 1].rn - rows[0].rn : 0
  }
}

const merge = (list) => {
  // sum histograms, keep worst stats
  const out = {}
  for (const r of list)
    for (const [k, v] of Object.entries(r)) {
      if (v && typeof v === 'object' && !('max' in v) && !('n' in v)) {
        out[k] ??= {}
        for (const [hk, hv] of Object.entries(v)) out[k][hk] = (out[k][hk] ?? 0) + hv
      } else if (typeof v === 'number') out[k] = (out[k] ?? 0) + v
      else if (v && typeof v === 'object') {
        out[k] ??= { max: -Infinity, p95: -Infinity, median: [] }
        out[k].max = Math.max(out[k].max, v.max ?? -Infinity)
        out[k].p95 = Math.max(out[k].p95, v.p95 ?? -Infinity)
        out[k].median.push(v.median)
      }
    }
  return out
}

const out = { spike: 'S4', versions: {}, a: [], b: [], c: [] }
const PAGES = {
  a: { page: 's4a', ns: '__s4a', modes: ['ticker', 'autoraf', 'autoraf-on', 'native'], analyse: analyseA },
  b: { page: 's4b', ns: '__s4b', modes: ['frame-update', 'autoraf', 'frame-setup', 'native'], analyse: analyseB },
  c: { page: 's4c', ns: '__s4c', modes: ['advance', 'demand', 'always', 'demand-autoraf'], analyse: analyseC }
}

await withServer('s4', async (base) => {
  for (const engine of ENGINES) {
    await withBrowser(engine, async (browser) => {
      out.versions[engine] = browser.version()
      for (const part of PARTS) {
        if (part === 'c' && engine !== 'chromium') continue
        const P = PAGES[part]
        for (const mode of P.modes) {
          const page = await newPage(browser, VIEWPORT)
          await page.goto(`${base}/pages/${P.page}.html?mode=${mode}`)
          await page.waitForFunction((n) => window[n]?.rec && (n !== '__s4c' || window[n].ready), P.ns)
          await sleep(500)
          const info = part === 'a' ? await page.evaluate(() => window.__s4a.info()) : null
          const webgl = part === 'c' ? await page.evaluate(() => window.__s4c.webgl()) : null
          const runs = []
          for (let rep = 0; rep < REPS; rep++) {
            const rows = await drive(page, P.ns, { lenis: mode !== 'native' })
            runs.push(P.analyse(rows, info))
          }
          out[part].push({ engine, mode, webgl, runs, merged: merge(runs) })
          await page.context().close()
        }
      }
    })
  }
})

const file = writeResult('s4', out)
const brief = {}
for (const part of PARTS)
  for (const r of out[part]) {
    const m = r.merged
    const key = `${part} ${r.engine} ${r.mode}`
    if (part === 'a')
      brief[key] = { moving: m.movingSamples, stLag: m.stProgressLag, transformLag: m.transformLag, stErrMaxPx: m.stErrScrollPx.max, frameMs: m.frameInterval.median }
    if (part === 'b')
      brief[key] = {
        moving: m.movingSamples,
        rawLag: m.rawLag,
        springDelayFrames: r.runs.map((x) => x.springBestFitDelayFrames),
        springErrMaxPx: m.springVsScrollTopPx.max,
        springErrMedianPx: m.springVsScrollTopPx.median
      }
    if (part === 'c')
      brief[key] = { moving: m.movingSamples, sameFrameRender: m.renderedInTheSameFrame, noRender: m.noRenderThisFrame, lag: m.lag, webgl: r.webgl?.renderer ?? null }
  }
console.log(JSON.stringify({ spike: 'S4', versions: out.versions, summary: brief, raw: file }, null, 1))
