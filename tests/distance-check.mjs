#!/usr/bin/env node
// distance-check.mjs <url> — the scaled-travel check (scenes.md §12).
// For each viewport: scroll past the end of #travel, then read how far
// #travel-var (CSS multiplies --scene-p) and #travel-fn (GSAP fluidValue)
// moved, and compare with 240 × the resolved --fluid. Also resizes in place
// (no reload) to prove the distance follows a resize, which is the whole
// point of function values + invalidateOnRefresh and of the CSS pattern.
import { chromium } from 'playwright'

const url = process.argv[2]
const DRAWN = 240
const TOL = 0.75 // px

async function read(page) {
  return page.evaluate((drawn) => {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;width:calc(1000 * var(--fluid, 1px));height:0;visibility:hidden'
    document.body.appendChild(probe)
    const unit = probe.getBoundingClientRect().width / 1000
    probe.remove()
    const left = (id) => document.getElementById(id).getBoundingClientRect().left
    const base = document.getElementById('travel').getBoundingClientRect().left
    return { unit, expected: drawn * unit, varMoved: left('travel-var') - base, fnMoved: left('travel-fn') - base }
  }, DRAWN)
}

// ScrollTrigger refreshes on a debounced resize and scrub applies on the
// next tick, so a single early read catches the old geometry. Poll until
// both elements are within tolerance, or 5s pass (then report what's there).
// ScrollTrigger's debounced resize refresh RESTORES the scroll position it
// saved, so a scroll issued right after a resize can be undone ~200ms later.
// Re-apply the scroll on every poll until the reading settles.
async function measure(page) {
  const scrollPastEnd = () =>
    page.evaluate(() => {
      const t = document.getElementById('travel')
      window.scrollTo(0, t.getBoundingClientRect().top + window.scrollY + t.offsetHeight * 0.9)
    })
  let m
  for (let i = 0; i < 25; i++) {
    await scrollPastEnd()
    await page.waitForTimeout(200)
    m = await read(page)
    if (Math.abs(m.varMoved - m.expected) <= TOL && Math.abs(m.fnMoved - m.expected) <= TOL) break
  }
  return m
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(url, { waitUntil: 'networkidle' })
let fail = 0
const steps = [
  { width: 1440, height: 900 },
  { width: 2560, height: 1440 },
  { width: 1280, height: 700 },
  { width: 390, height: 844 }
]
for (const vp of steps) {
  await page.setViewportSize(vp) // resize in place: no reload
  const m = await measure(page)
  const ok = (v) => Math.abs(v - m.expected) <= TOL
  const pass = ok(m.varMoved) && ok(m.fnMoved)
  if (!pass) fail++
  console.log(
    `${vp.width}x${vp.height}  --fluid ${m.unit.toFixed(4)}  expected ${m.expected.toFixed(2)}  ` +
      `css-var ${m.varMoved.toFixed(2)}  gsap-fn ${m.fnMoved.toFixed(2)}  ${pass ? 'PASS' : 'FAIL'}`
  )
}
const folded = await page.evaluate(() => document.getElementById('fold-canary').style.translate === 'none')
console.log(`gsap folds CSS translate into its transform (documented behaviour): ${folded ? 'yes, as documented' : 'NO: update motion-architecture.md §7 and scenes.md §12'}`)
if (!folded) fail++

// fluidPx's `el` param (scenes.md §12): main.ts read #fluid-el-scope's
// literal --_fluid-m-ui (500px/1000) through `el`, which must win over
// whatever the page's own `ui` unit resolves to at this viewport.
const scoped = await page.evaluate(() => window.__fluidPxScoped)
const scopedPass = Math.abs(scoped - 24) <= TOL
console.log(`fluidPx(48, 'ui', el) reads the element's own mirror: ${scoped} ${scopedPass ? 'PASS' : 'FAIL (expected 24)'}`)
if (!scopedPass) fail++

await browser.close()
console.log(fail ? 'distance-check FAIL' : 'distance-check PASS')
process.exit(fail ? 1 : 0)
