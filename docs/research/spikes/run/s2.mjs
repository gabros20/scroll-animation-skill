// S2 — what breaks under ScrollSmoother (Chromium). Quick and factual:
// each probe is checked against the element's VISUAL position (its
// getBoundingClientRect, which includes #smooth-content's transform), with the
// same page and no ScrollSmoother as the baseline.
import { frameIntervals, newPage, r3, sleep, stats, wheel, withBrowser, withServer, writeResult } from './harness.mjs'

const REPS = Number(process.env.REPS ?? 2)
const VIEWPORT = { width: 1280, height: 720 }
const clamp01 = (v) => Math.min(1, Math.max(0, v))

async function drive(page) {
  await page.evaluate(() => {
    const s = window.__s2
    s.smoother ? s.smoother.scrollTop(0) : window.scrollTo(0, 0)
    s.events.length = 0
  })
  await sleep(1500)
  await page.evaluate(() => window.__s2.rec.start())
  await wheel(page, { steps: 45, delta: 100, gap: 40 })
  await sleep(1800)
  await wheel(page, { steps: 18, delta: -100, gap: 40 })
  await sleep(1800)
  await page.evaluate(() => window.scrollTo(0, 3000))
  await sleep(1800)
  const rows = await page.evaluate(() => window.__s2.rec.stop())
  const events = await page.evaluate(() => window.__s2.events.slice())
  return { rows, events }
}

function analyse({ rows, events }, info) {
  const vh = info.vh
  const { H } = info
  // (a) sticky: inside its travel zone a working sticky element reads top = 0.
  const zone = rows.filter((r) => r.rangeTop < -5 && r.rangeTop + H.range - H.sticky > 5)
  const sticky = {
    framesInZone: zone.length,
    maxAbsStickyTop: r3(Math.max(0, ...zone.map((r) => Math.abs(r.stickyTop)))),
    maxAbsStickyTopMinusRangeTop: r3(Math.max(0, ...zone.map((r) => Math.abs(r.stickyTop - r.rangeTop)))),
    sticks: zone.length > 0 && zone.every((r) => Math.abs(r.stickyTop) < 1)
  }
  // (b) view(): compare with the progress the VISUAL position implies.
  const vis = rows.map((r) => clamp01((vh - r.viewTop) / (vh + H.view)))
  const active = rows.map((r, i) => [r, vis[i]]).filter(([, v]) => v > 0.01 && v < 0.99)
  const view = {
    progressRange: [r3(Math.min(...rows.map((r) => r.viewP ?? NaN))), r3(Math.max(...rows.map((r) => r.viewP ?? NaN)))],
    visualRange: [r3(Math.min(...vis)), r3(Math.max(...vis))],
    maxAbsErrVsVisual: r3(Math.max(0, ...active.map(([r, v]) => Math.abs((r.viewP ?? 0) - v))))
  }
  // (c) Motion useScroll vs ScrollTrigger vs visual vs unsmoothed layout.
  const span = vh + H.target
  const c = rows.map((r) => ({
    m: r.mP,
    st: r.stP,
    vis: clamp01((vh - r.tTop) / span),
    raw: clamp01((r.y + vh - info.targetDocTop) / span),
    moving: false
  }))
  for (let i = 1; i < rows.length; i++) c[i].moving = Math.abs(rows[i].tTop - rows[i - 1].tTop) > 0.5
  const inRange = c.filter((x) => x.vis > 0.005 && x.vis < 0.995)
  const px = (d) => r3(d * span) // progress diff -> px of visual travel
  const motion = {
    samples: inRange.length,
    motionVsScrollTrigger: stats(inRange.map((x) => Math.abs(x.m - x.st) * span)),
    motionVsVisual: stats(inRange.map((x) => Math.abs(x.m - x.vis) * span)),
    motionVsUnsmoothedLayout: stats(inRange.map((x) => Math.abs(x.m - x.raw) * span)),
    scrollTriggerVsVisual: stats(inRange.map((x) => Math.abs(x.st - x.vis) * span)),
    atRestMotionVsScrollTriggerPx: px(Math.max(0, ...inRange.filter((x) => !x.moving).map((x) => Math.abs(x.m - x.st)))),
    unit: 'px of the target range (progress diff x (vh + target height))'
  }
  // (d) IntersectionObserver / whileInView vs the visual entry.
  const firstVisual = rows.find((r) => r.ioTop < vh)
  const firstLayout = rows.find((r) => r.y + vh > info.targetDocTop + H.target + H.gap2)
  const ev = (kind) => events.find((e) => e.kind === kind)
  const at = (e) =>
    e && firstVisual
      ? { rectTopAtFire: r3(e.rectTop), framesAfterVisualEntry: r3((e.t - firstVisual.t) / 16.667), scrollYAtFire: e.y }
      : null
  const io = {
    visualEntry: firstVisual ? { t: r3(firstVisual.t), ioTop: r3(firstVisual.ioTop), scrollY: firstVisual.y } : null,
    unsmoothedLayoutEntry: firstLayout ? { t: r3(firstLayout.t), scrollY: firstLayout.y } : null,
    ioEnter: at(ev('io-enter')),
    motionEnter: at(ev('motion-enter')),
    ioLeave: ev('io-leave') ? { rectTopAtFire: r3(ev('io-leave').rectTop) } : null,
    events: events.map((e) => e.kind)
  }
  const lag = rows.filter((r) => r.sm != null).map((r) => Math.abs(r.y - r.sm))
  return { frameInterval: frameIntervals(rows), smoothLagPx: stats(lag), sticky, view, motion, io }
}

const out = { spike: 'S2', runs: [] }
await withServer('s2', async (base) => {
  await withBrowser('chromium', async (browser) => {
    out.version = browser.version()
    for (const mode of ['native', 'smoother']) {
      const page = await newPage(browser, VIEWPORT)
      await page.goto(`${base}/pages/s2.html?mode=${mode}`)
      await page.waitForFunction(() => window.__s2?.rec && window.__s2.st)
      await sleep(500)
      const info = await page.evaluate(() => window.__s2.info())
      for (let rep = 0; rep < REPS; rep++) out.runs.push({ mode, rep, info, ...analyse(await drive(page), info) })
      await page.context().close()
    }
  })
})

const file = writeResult('s2', out)
const pick = (r) => ({
  mode: r.mode,
  rep: r.rep,
  smoothLagPxMax: r.smoothLagPx.max ?? 0,
  a_sticky: r.sticky,
  b_view: r.view,
  c_motion: {
    motionVsScrollTriggerPx: r.motion.motionVsScrollTrigger.max,
    motionVsVisualPx: r.motion.motionVsVisual.max,
    motionVsUnsmoothedPx: r.motion.motionVsUnsmoothedLayout.max,
    scrollTriggerVsVisualPx: r.motion.scrollTriggerVsVisual.max,
    atRestMotionVsScrollTriggerPx: r.motion.atRestMotionVsScrollTriggerPx
  },
  d_io: r.io,
  wrapper: r.info.wrapperStyle,
  viewTimelineOnTarget: r.info.viewTimelineOnTarget
})
console.log(JSON.stringify({ spike: 'S2', version: out.version, runs: out.runs.map(pick), raw: file }, null, 1))
