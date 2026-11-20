#!/usr/bin/env node
// harness-selftest.mjs: tests/lib/harness.mjs in a real browser, on pages it writes itself (no server): settle
// returns the reading it settled on and waits for `when`; until resolves null on a timeout; snapshot reads in one
// evaluate; scrollToProgress lands on the range's progress over a pin's box; seekAnimations moves a CSS animation's own
// clock; pauseClock and runFor fire a timer exactly. Prints one PASS/FAIL line per check and browser, exits 1 on any
// FAIL.
//
//   node tests/harness-selftest.mjs [--browsers chromium,webkit,firefox]

import { chromium, firefox, webkit } from 'playwright'

import { launch, pauseClock, scrollToProgress, seekAnimations, settle, snapshot, until } from './lib/harness.mjs'

const BROWSERS = { chromium, webkit, firefox }

function parseArgs(argv) {
  const out = { browsers: Object.keys(BROWSERS) }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--browsers') out.browsers = argv[++i].split(',')
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  for (const b of out.browsers) if (!BROWSERS[b]) throw new Error(`unknown browser: ${b}`)
  return out
}

// A range wrapper 3000 px tall around a 100vh sticky pin, below a 500 px spacer: progress p is at 500 + p × 2400.
const RANGE = `<!doctype html><style>body { margin: 0 } #spacer { height: 500px } #root { height: 3000px }
  [data-scene-pin] { position: sticky; top: 0; height: 100vh } #tail { height: 1000px }</style>
  <div id="spacer"></div><div id="root" data-scene-root><div data-scene-pin></div></div><div id="tail"></div>`

const CHECKS = {
  async settle(page) {
    // A counter that climbs for 20 frames, then holds: settle returns the held value, not one on the way.
    await page.setContent('<p>x</p>')
    await page.evaluate(() => {
      window.n = 0
      const step = () => (++window.n < 20 ? requestAnimationFrame(step) : null)
      requestAnimationFrame(step)
    })
    const climbed = await settle(page, () => window.n)
    // `when`: a value that holds still before the change begins is not taken for the result.
    await page.evaluate(() => {
      window.late = 'before'
      setTimeout(() => (window.late = 'after'), 200)
    })
    const late = await settle(page, () => window.late, { when: (v) => v === 'after' })
    const never = await settle(page, () => performance.now(), { timeout: 200 })
    // From Node: the same result with no requestAnimationFrame call in the page.
    await page.evaluate(() => {
      window.m = 0
      window.rafs = 0
      const raf = window.requestAnimationFrame.bind(window)
      window.requestAnimationFrame = (cb) => (window.rafs++, raf(cb))
      const tick = () => (++window.m < 10 ? setTimeout(tick, 20) : null)
      tick()
    })
    const fromNode = await settle(page, () => window.m, { fromNode: true })
    const rafs = await page.evaluate(() => window.rafs)
    return [
      ['settle returns the reading it settled on, after the last change', climbed.settled && climbed.value === 20, JSON.stringify(climbed)],
      ["settle with `when` waits for the change to begin", late.settled && late.value === 'after', JSON.stringify(late)],
      ['settle on a value that never holds gives up at its timeout, settled false', !never.settled && typeof never.value === 'number', JSON.stringify(never)],
      ['settle fromNode settles the same way and calls no requestAnimationFrame in the page', fromNode.settled && fromNode.value === 10 && rafs === 0, `${JSON.stringify(fromNode)} · ${rafs} rAF`],
    ]
  },

  async until(page) {
    await page.setContent('<p>x</p>')
    await page.evaluate(() => setTimeout(() => (window.flag = true), 100))
    const ms = await until(page, () => window.flag === true)
    const timedOut = await until(page, () => window.never === true, null, { timeout: 150 })
    return [['until resolves the elapsed ms once true, null on a timeout', ms !== null && timedOut === null, `${ms} ms · timeout ${timedOut}`]]
  },

  async snapshot(page) {
    await page.setContent(RANGE)
    await page.evaluate(() => window.scrollTo(0, 777))
    const s = await snapshot(page, (id) => document.getElementById(id).getBoundingClientRect().top, 'root')
    return [['snapshot reads the scroll position and the value in one evaluate', s.scrollY === 777 && s.value === 500 - 777, JSON.stringify(s)]]
  },

  async scrollToProgress(page) {
    await page.setContent(RANGE)
    const h = await page.evaluate(() => innerHeight)
    const half = await scrollToProgress(page, '#root', 0.5)
    const y = await page.evaluate(() => scrollY)
    const want = Math.round(500 + 0.5 * (3000 - h))
    return [['scrollToProgress lands on the range over the pin box and waits for the end', half.y === want && y === want, `${JSON.stringify(half)} · scrollY ${y} (want ${want})`]]
  },

  async seekAnimations(page) {
    await page.setContent(`<style>@keyframes fs { to { opacity: 1 } } p { opacity: 0; animation: fs 0s 4s forwards }</style><p id="x">x</p>
      <script>window.ended = 0; document.addEventListener('animationend', () => window.ended++)</script>`)
    const moved = await seekAnimations(page, /^fs$/, 3000)
    const before = await page.evaluate(() => [getComputedStyle(document.getElementById('x')).opacity, window.ended])
    await seekAnimations(page, 'fs', 4000)
    const ms = await until(page, () => window.ended === 1, null, { timeout: 1000 })
    const after = await page.evaluate(() => getComputedStyle(document.getElementById('x')).opacity)
    return [
      [
        "seekAnimations moves a CSS animation's own clock: hidden 1 s short of its delay, ended at it",
        moved === 1 && before[0] === '0' && before[1] === 0 && ms !== null && after === '1',
        `moved ${moved} · at 3000 ms opacity ${before[0]}, ${before[1]} ended · at 4000 ms ended in ${ms} ms, opacity ${after}`,
      ],
    ]
  },

  async clock(page) {
    await page.clock.install()
    await page.setContent('<p>x</p>')
    await pauseClock(page)
    await page.evaluate(() => {
      window.fired = null
      const t0 = performance.now()
      setTimeout(() => (window.fired = performance.now() - t0), 300)
    })
    await page.clock.runFor(299)
    const early = await page.evaluate(() => window.fired)
    await page.clock.runFor(1)
    const fired = await page.evaluate(() => window.fired)
    return [['pauseClock then runFor fires a 300 ms timer at 300 ms exactly', early === null && fired === 300, `at 299: ${early} · at 300: ${fired}`]]
  },
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let failures = 0
  for (const name of args.browsers) {
    const browser = await launch(BROWSERS[name])
    try {
      for (const [id, check] of Object.entries(CHECKS)) {
        const context = await browser.newContext({ viewport: { width: 800, height: 600 } })
        const page = await context.newPage()
        try {
          for (const [what, ok, detail] of await check(page)) {
            if (!ok) failures++
            console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(8)}  ${id.padEnd(16)}  ${what}${detail ? `  (${detail})` : ''}`)
          }
        } catch (err) {
          failures++
          console.log(`FAIL  ${name.padEnd(8)}  ${id.padEnd(16)}  ran to completion  (${err.message.split('\n')[0]})`)
        } finally {
          await context.close()
        }
      }
    } finally {
      await browser.close()
    }
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nall harness checks passed')
  return failures
}

process.exit((await main()) ? 1 : 0)
