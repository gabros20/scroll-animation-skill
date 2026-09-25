// S3 — Motion 13.4 accelerated scroll over a sticky pin (Chromium, WebKit).
//
// Per variant:
//  - what Motion attached to #bound (getAnimations: timeline, range, keyframes)
//  - a stepped scan down the page and back up: at each position, after the
//    frame settles, the MotionValue (JS truth), #bound's computed opacity, the
//    hand-written #manual's opacity, and both boxes' PAINTED opacity read from
//    a screenshot (black box over a known background)
//  - continuous wheel scrolling with the per-frame recorder
import { PNG } from 'pngjs'
import { newPage, r3, sleep, stats, wheel, withBrowser, withServer, writeResult } from './harness.mjs'

const ENGINES = (process.env.ENGINES ?? 'chromium,webkit').split(',')
const CASES = [
  ['brief', 'motion'],
  ['brief', 'm'],
  ['brief-padded', 'motion'],
  ['cover', 'motion'],
  ['v1', 'motion'],
  ['v1', 'm'],
  ['v1-tall', 'motion'],
  ['no-target', 'motion']
]
const VIEWPORT = { width: 1280, height: 720 }
const SCAN_STEPS = Number(process.env.SCAN_STEPS ?? 40)

const frames = (page, n = 3) =>
  page.evaluate(
    (k) =>
      new Promise((res) => {
        const step = () => (--k <= 0 ? res() : requestAnimationFrame(step))
        requestAnimationFrame(step)
      }),
    n
  )

async function paintedOpacity(page) {
  const png = PNG.sync.read(await page.screenshot())
  const at = (x, y) => {
    const i = (Math.round(y) * png.width + Math.round(x)) * 4
    return (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3
  }
  const rects = await page.evaluate(() =>
    ['bound', 'manual'].map((id) => {
      const r = document.getElementById(id).getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, bgx: r.left - 12, visible: r.top > 0 && r.bottom < innerHeight }
    })
  )
  return rects.map((r) => {
    if (!r.visible) return null
    const bg = at(r.bgx, r.y)
    return bg > 5 ? r3(1 - at(r.x, r.y) / bg) : null
  })
}

async function scan(page, info) {
  const ys = []
  for (let i = 0; i <= SCAN_STEPS; i++) ys.push(Math.round((info.maxScroll * i) / SCAN_STEPS))
  const out = []
  for (const [dir, list] of [
    ['down', ys],
    ['up', [...ys].reverse()]
  ]) {
    for (const y of list) {
      await page.evaluate((v) => window.scrollTo(0, v), y)
      await frames(page, 4)
      const r = await page.evaluate(() => window.__s3.read())
      const [pb, pm] = await paintedOpacity(page)
      out.push({ dir, ...r, paintedBound: pb, paintedManual: pm })
    }
  }
  return out
}

function zoneOf(p, spec) {
  const lo = Math.min(...spec.input.filter((v) => v > 0 && v < 1), 1)
  const hi = Math.max(...spec.input.filter((v) => v > 0 && v < 1), 0)
  if (p <= 0) return 'p=0 (before range)'
  if (p < lo) return `0<p<${lo}`
  if (p <= hi) return `${lo}<=p<=${hi}`
  if (p < 1) return `${hi}<p<1`
  return 'p=1 (past range end)'
}

function analyseScan(rows, spec) {
  const zones = {}
  for (const r of rows) {
    const z = (zones[`${zoneOf(r.p, spec)} ${r.dir}`] ??= { n: 0, boundErr: 0, manualErr: 0, paintedBoundErr: 0, paintedManualErr: 0, worst: null })
    z.n++
    const be = Math.abs(r.bound - r.mv)
    if (be > z.boundErr) (z.boundErr = r3(be)), (z.worst = { y: r.y, p: r3(r.p), mv: r3(r.mv), bound: r3(r.bound) })
    z.manualErr = Math.max(z.manualErr, r3(Math.abs(r.manual - r.mv)))
    if (r.paintedBound != null) z.paintedBoundErr = Math.max(z.paintedBoundErr, r3(Math.abs(r.paintedBound - r.mv)))
    if (r.paintedManual != null) z.paintedManualErr = Math.max(z.paintedManualErr, r3(Math.abs(r.paintedManual - r.mv)))
  }
  return {
    maxBoundErr: r3(Math.max(...rows.map((r) => Math.abs(r.bound - r.mv)))),
    maxManualErr: r3(Math.max(...rows.map((r) => Math.abs(r.manual - r.mv)))),
    maxPaintedBoundErr: r3(Math.max(0, ...rows.filter((r) => r.paintedBound != null).map((r) => Math.abs(r.paintedBound - r.mv)))),
    maxPaintedManualErr: r3(Math.max(0, ...rows.filter((r) => r.paintedManual != null).map((r) => Math.abs(r.paintedManual - r.mv)))),
    zones
  }
}

async function wheelRun(page, info) {
  await page.evaluate(() => window.scrollTo(0, 0))
  await frames(page, 6)
  await page.evaluate(() => window.__s3.rec.start())
  const notches = Math.ceil(info.maxScroll / 100) + 2
  await wheel(page, { steps: notches, delta: 100, gap: 35 })
  await sleep(400)
  await wheel(page, { steps: notches, delta: -100, gap: 35 })
  await sleep(400)
  const rows = await page.evaluate(() => window.__s3.rec.stop())
  return {
    frames: rows.length,
    boundVsMv: stats(rows.map((r) => Math.abs(r.bound - r.mv))),
    manualVsMv: stats(rows.map((r) => Math.abs(r.manual - r.mv))),
    // 1-frame skew is expected while moving (native scroll events); a wrong
    // curve shows up as a large error that persists at rest
    boundVsMvWhenP1: stats(rows.filter((r) => r.p >= 1).map((r) => Math.abs(r.bound - r.mv)))
  }
}

const out = { spike: 'S3', versions: {}, cases: [] }
await withServer('s3', async (base) => {
  for (const engine of ENGINES) {
    await withBrowser(engine, async (browser) => {
      out.versions[engine] = browser.version()
      for (const [v, comp] of CASES) {
        const page = await newPage(browser, VIEWPORT)
        await page.goto(`${base}/pages/s3.html?v=${v}&comp=${comp}`)
        await page.waitForFunction(() => window.__s3?.mv && document.getElementById('bound'))
        await sleep(400)
        const info = await page.evaluate(() => window.__s3.info())
        const rows = await scan(page, info)
        const wheelRes = await wheelRun(page, info)
        out.cases.push({ engine, variant: v, comp, info, scan: analyseScan(rows, info.spec), wheel: wheelRes, scanRows: rows })
        await page.context().close()
      }
    })
  }
})

const file = writeResult('s3', out)
console.log(
  JSON.stringify(
    {
      spike: 'S3',
      versions: out.versions,
      cases: out.cases.map((c) => ({
        engine: c.engine,
        variant: c.variant,
        comp: c.comp,
        promoted: c.info.anims.map((a) => `${a.type} on ${a.timeline} [${a.rangeStart} .. ${a.rangeEnd}] kf ${a.keyframes.map((k) => `${k.offset}:${k.opacity}`).join(' ')} fill ${a.fill}`),
        inlineOpacity: c.info.inlineOpacity,
        scanMaxErr: { bound: c.scan.maxBoundErr, manual: c.scan.maxManualErr, paintedBound: c.scan.maxPaintedBoundErr, paintedManual: c.scan.maxPaintedManualErr },
        worstZones: Object.fromEntries(
          Object.entries(c.scan.zones)
            .filter(([, z]) => z.boundErr > 0.02)
            .map(([k, z]) => [k, { n: z.n, boundErr: z.boundErr, paintedBoundErr: z.paintedBoundErr, worst: z.worst }])
        ),
        wheelMaxErr: { bound: c.wheel.boundVsMv.max, manual: c.wheel.manualVsMv.max, boundWhenP1: c.wheel.boundVsMvWhenP1.max ?? null }
      })),
      raw: file
    },
    null,
    1
  )
)
