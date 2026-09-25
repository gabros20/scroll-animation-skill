// S5 — ScrollTrigger progress on a CSS sticky range wrapper vs v1's rect maths
// (Chromium, desktop). Reports max |st.progress - clamp01(-rect.top / (rect.height - innerHeight))|
// in progress units and in px of the range, per condition.
import { newPage, r3, sleep, stats, wheel, withBrowser, withServer, writeResult } from './harness.mjs'

const MODES = (process.env.MODES ?? 'native,lenis').split(',')

const frames = (page, n = 2) =>
  page.evaluate(
    (k) =>
      new Promise((res) => {
        const step = () => (--k <= 0 ? res() : requestAnimationFrame(step))
        requestAnimationFrame(step)
      }),
    n
  )

// End-of-frame read: resolve from the recorder's next row.
const readFrame = (page) =>
  page.evaluate(
    () =>
      new Promise((res) => {
        const rec = window.__s5.rec
        rec.start()
        const poll = () => (rec.rows.length ? res(rec.stop()[0]) : requestAnimationFrame(poll))
        requestAnimationFrame(poll)
      })
  )

const diff = (r) => ({ p: Math.abs(r.st - r.rect), px: Math.abs(r.st - r.rect) * r.range })
const summarise = (rows) => {
  const d = rows.map(diff)
  return { n: rows.length, maxProgress: r3(Math.max(0, ...d.map((x) => x.p)) * 1000) / 1000, maxPx: r3(Math.max(0, ...d.map((x) => x.px))), p95Px: stats(d.map((x) => x.px)).p95 ?? 0 }
}

async function scan(page, steps = 30) {
  const max = await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight)
  const rows = []
  for (let i = 0; i <= steps; i++) {
    const y = Math.round((max * i) / steps)
    await page.evaluate((v) => {
      window.__s5.lenis?.scrollTo(v, { immediate: true })
      window.scrollTo(0, v)
    }, y)
    await frames(page, 2)
    rows.push(await readFrame(page))
  }
  return summarise(rows)
}

async function wheelRun(page) {
  await page.evaluate(() => {
    window.__s5.lenis?.scrollTo(0, { immediate: true })
    window.scrollTo(0, 0)
  })
  await frames(page, 4)
  await page.evaluate(() => window.__s5.rec.start())
  const max = await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight)
  const notches = Math.ceil(max / 100) + 2
  await wheel(page, { steps: notches, delta: 100, gap: 35 })
  await sleep(1200)
  await wheel(page, { steps: Math.ceil(notches / 2), delta: -100, gap: 35 })
  await sleep(1200)
  return summarise(await page.evaluate(() => window.__s5.rec.stop()))
}

// Programmatic jump, read in the SAME callback (before any scroll event).
async function sameCallback(page) {
  const out = []
  for (const frac of [0.25, 0.5, 0.75]) {
    const r = await page.evaluate((f) => {
      const max = document.scrollingElement.scrollHeight - innerHeight
      window.scrollTo(0, Math.round(max * f))
      return window.__s5.read()
    }, frac)
    out.push(r)
    await frames(page, 3)
  }
  return summarise(out)
}

async function waitRefresh(page, before, timeout = 3000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const n = await page.evaluate(() => window.__s5.refreshes.length)
    if (n > before) return Date.now() - t0
    await sleep(20)
  }
  return null
}

const out = { spike: 'S5', runs: [] }
await withServer('s5', async (base) => {
  await withBrowser('chromium', async (browser) => {
    out.version = browser.version()
    for (const mode of MODES) {
      const page = await newPage(browser, { width: 1440, height: 900 })
      await page.goto(`${base}/pages/s5.html?mode=${mode}`)
      await page.waitForFunction(() => window.__s5)
      await sleep(500)
      const run = { mode, viewports: {} }
      // 1440x900 baseline
      run.viewports['1440x900'] = { scan: await scan(page), wheel: await wheelRun(page), sameCallbackJump: await sameCallback(page) }
      // viewport changes: stale window before ScrollTrigger's debounced resize refresh, then after
      for (const vp of [
        { width: 1280, height: 720 },
        { width: 390, height: 844 }
      ]) {
        await page.evaluate(() => {
          window.__s5.lenis?.scrollTo(0, { immediate: true })
          window.scrollTo(0, Math.round((document.scrollingElement.scrollHeight - innerHeight) * 0.4))
        })
        await frames(page, 3)
        const before = await page.evaluate(() => window.__s5.refreshes.length)
        await page.setViewportSize(vp)
        const staleRows = []
        for (let i = 0; i < 5; i++) staleRows.push(await readFrame(page))
        const refreshMs = await waitRefresh(page, before)
        await frames(page, 3)
        run.viewports[`${vp.width}x${vp.height}`] = {
          beforeRefresh: summarise(staleRows),
          refreshAfterMs: refreshMs,
          scan: await scan(page),
          wheel: await wheelRun(page)
        }
      }
      // content above the wrapper grows: stale until ScrollTrigger.refresh()
      const b0 = await page.evaluate(() => window.__s5.refreshes.length)
      await page.setViewportSize({ width: 1440, height: 900 })
      await waitRefresh(page, b0)
      await sleep(400)
      await page.evaluate(() => {
        window.__s5.lenis?.scrollTo(0, { immediate: true })
        window.scrollTo(0, 1500)
      })
      await frames(page, 3)
      const before = await page.evaluate(() => window.__s5.refreshes.length)
      await page.evaluate(() => (document.getElementById('above').style.height = '900px'))
      await frames(page, 3)
      const stale = await scan(page, 20)
      const autoRefreshed = (await page.evaluate(() => window.__s5.refreshes.length)) > before
      await page.evaluate(() => window.__s5.refresh())
      await frames(page, 3)
      run.contentAbove = { grewBy: 300, beforeRefresh: stale, autoRefreshed, afterRefresh: await scan(page, 20) }
      out.runs.push(run)
      await page.context().close()
    }
  })
})

const file = writeResult('s5', out)
console.log(JSON.stringify({ spike: 'S5', version: out.version, runs: out.runs, raw: file }, null, 1))
