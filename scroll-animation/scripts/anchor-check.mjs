#!/usr/bin/env node
// anchor-check.mjs — click every same-page anchor (or the first N) with
// smooth scrolling left ON, and assert the browser actually lands where the
// page's own CSS says it should. This is the one check in this skill that
// exercises a REAL smooth scroll through the page's scroll-behavior/scroll
// well setup end to end: `verify-motion.mjs --reveal` forces
// `scroll-behavior: auto` while it step-scrolls (the right call for a fast,
// deterministic harness — see references/verification.md), so it never
// proves an anchor jump actually arrives. A scroll well sitting between the
// click and the target cancels a smooth jump one rAF at a time unless it
// suspends itself (references/scroll-scenes.md §8); this is the check that
// catches a regression there. Called directly, or delegated to from
// `verify-motion.mjs --anchors`.
//
// For each matching same-page anchor (href starts with "#", or its pathname
// and search match the current page's and it carries a hash), up to
// --viewports x --limit of them:
//   1. click it — page-wide scroll-behavior: smooth stays on, that's the point
//   2. wait for `scrollend`, or for `window.scrollY` to sit unchanged for
//      300ms, whichever comes first (10s cap so a broken page can't hang)
//   3. read the target's rect.top, its own scroll-margin-top, the root's
//      scroll-padding-top, and --header-h (or --header-var)
//   4. PASS if the landed rect.top is within `--tolerance` px (default 2) of
//      EITHER offset mechanism the page might be using: scroll-margin-top +
//      scroll-padding-top, or the --header-h custom property — whichever a
//      given anchor's target actually relies on, accounting for the page
//      bottom clamping the scroll short of the full offset.
//
// Usage:
//   node anchor-check.mjs <url> [--selector 'a[href^="#"]']
//     [--viewports 1440x900,390x844] [--limit 5] [--header-var --header-h]
//     [--tolerance 2]
//   node anchor-check.mjs --help
//
// Exit codes: 0 = every anchor in every viewport landed within tolerance,
// 1 = at least one did not (or a target/anchor was missing), 2 = usage
// error or playwright could not be resolved.

import { join } from 'node:path'

const USAGE = `anchor-check.mjs — click same-page anchors with smooth scrolling on and
assert the browser lands where scroll-margin-top/--header-h say it should.

Usage:
  node anchor-check.mjs <url> [--selector 'a[href^="#"]']
    [--viewports 1440x900,390x844] [--limit 5] [--header-var --header-h]
    [--tolerance 2]

Options:
  --selector <css>    anchors to check (default: a[href^="#"])
  --viewports <list>  comma-separated WxH pairs (default: 1440x900,390x844).
                       A width <= 480 is emulated as touch/mobile.
  --limit <n>         check at most the first n matching anchors per
                       viewport (default: 5; 0 = no limit)
  --header-var <name> the custom property read as the fallback landing
                       offset when scroll-margin-top/scroll-padding-top are
                       both 0 (default: --header-h)
  --tolerance <px>    allowed drift between landed and expected top (default: 2)
  -h, --help          print this message and exit

Exit codes: 0 pass, 1 at least one anchor failed, 2 usage/invocation error.`

function parseArgs(argv) {
  const out = {
    _: [],
    selector: 'a[href^="#"]',
    viewports: '1440x900,390x844',
    limit: 5,
    headerVar: '--header-h',
    tolerance: 2,
    help: false
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') out.help = true
    else if (a === '--selector') out.selector = argv[++i]
    else if (a === '--viewports') out.viewports = argv[++i]
    else if (a === '--limit') out.limit = Number(argv[++i])
    else if (a === '--header-var') out.headerVar = argv[++i]
    else if (a === '--tolerance') out.tolerance = Number(argv[++i])
    else if (a.startsWith('--')) { console.error(`[anchor-check] unknown flag ${a}`); process.exit(2) }
    else out._.push(a)
  }
  return out
}

function parseViewports(spec) {
  return spec.split(',').map((pair) => {
    const m = pair.trim().match(/^(\d+)x(\d+)$/)
    if (!m) { console.error(`[anchor-check] bad --viewports entry: ${pair}`); process.exit(2) }
    const width = Number(m[1])
    const height = Number(m[2])
    const mobile = width <= 480
    return { width, height, isMobile: mobile, hasTouch: mobile }
  })
}

// Resolution order matches verify-motion.mjs: the target project's own
// node_modules first (resolved from process.cwd()), then a bare specifier
// from the skill's own location. Kept duplicated rather than shared through
// a lib file, matching the fluid-design skill's own convention.
async function resolvePlaywrightModule() {
  const { createRequire } = await import('node:module')
  const { pathToFileURL } = await import('node:url')

  const attempts = []
  try {
    const cwdRequire = createRequire(pathToFileURL(join(process.cwd(), 'package.json')))
    const resolved = cwdRequire.resolve('playwright')
    attempts.push(`cwd (${process.cwd()}): ${resolved}`)
    const mod = await import(pathToFileURL(resolved).href)
    return mod.chromium ? mod : mod.default
  } catch (err) {
    attempts.push(`cwd (${process.cwd()}): not found (${err.code ?? err.message})`)
  }
  try {
    const here = createRequire(import.meta.url)
    const resolved = here.resolve('playwright')
    attempts.push(`skill-local: ${resolved}`)
    const mod = await import(pathToFileURL(resolved).href)
    return mod.chromium ? mod : mod.default
  } catch (err) {
    attempts.push(`skill-local: not found (${err.code ?? err.message})`)
  }

  throw new Error(
    [
      '[scroll-animation] could not resolve "playwright" from either the current project or the skill itself.',
      '',
      'Tried:',
      ...attempts.map((a) => `  - ${a}`),
      '',
      'Fix: run this from the target project directory after installing playwright there',
      '  (npm i -D playwright && npx playwright install chromium)',
      'or install it globally for the skill to fall back on',
      '  (npm i -g playwright && playwright install chromium).'
    ].join('\n')
  )
}

// Collects up to `limit` same-page anchors matching `selector`, each with
// its resolved target element's id, in document order. Runs inside the page.
async function collectAnchors(page, selector, limit) {
  return page.evaluate(
    ({ selector, limit }) => {
      const anchors = [...document.querySelectorAll(selector)]
      const out = []
      for (const a of anchors) {
        const href = a.getAttribute('href') ?? ''
        const isHashOnly = href.startsWith('#')
        const isSamePathHash =
          a.hash && a.pathname === location.pathname && a.search === location.search
        if (!isHashOnly && !isSamePathHash) continue
        const id = a.hash.slice(1)
        if (!id) continue
        const target = document.getElementById(id) ?? document.getElementsByName(id)[0]
        if (!target) continue
        out.push({ hash: a.hash, id })
        if (limit > 0 && out.length >= limit) break
      }
      return out
    },
    { selector, limit }
  )
}

// Clicks the anchor for `hash`, waits for the scroll to settle, and returns
// the landing measurement. Runs the settle-wait and the final read inside
// one page.evaluate pair so the trace is exact.
async function checkOneAnchor(page, hash, headerVar, tolerance) {
  const before = await page.evaluate(() => ({
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    y: window.scrollY
  }))

  const clicked = await page.evaluate((hash) => {
    const a = [...document.querySelectorAll('a[href]')].find((el) => el.hash === hash)
    if (!a) return false
    a.click()
    return true
  }, hash)
  if (!clicked) return { hash, ok: false, error: 'anchor disappeared before click' }

  // Settle: scrollY unchanged for 300ms, 10s cap — matches the tolerance
  // this skill uses elsewhere for "has this stopped moving" (see
  // verify-motion.mjs's reveal step and the fluid-design skill's probe.mjs).
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let last = -1
        let since = performance.now()
        const t0 = performance.now()
        const poll = () => {
          const y = window.scrollY
          if (y !== last) {
            last = y
            since = performance.now()
          }
          if (performance.now() - since > 300 || performance.now() - t0 > 10000) resolve()
          else requestAnimationFrame(poll)
        }
        poll()
      })
  )

  const r = await page.evaluate(
    ({ hash, headerVar }) => {
      const id = hash.slice(1)
      const el = document.getElementById(id) ?? document.getElementsByName(id)[0]
      if (!el) return null
      const cs = getComputedStyle(el)
      const root = getComputedStyle(document.documentElement)
      const probe = document.createElement('div')
      probe.style.cssText = `height:var(${headerVar}, 0px);position:fixed;visibility:hidden;`
      document.body.appendChild(probe)
      const headerH = probe.getBoundingClientRect().height
      probe.remove()
      const marginTop = parseFloat(cs.scrollMarginTop) || 0
      const paddingTop = parseFloat(root.scrollPaddingTop) || 0
      const top = el.getBoundingClientRect().top
      const y = window.scrollY
      const maxY = document.documentElement.scrollHeight - innerHeight
      return { top, y, maxY, marginTop, paddingTop, headerH, hash: location.hash }
    },
    { hash, headerVar }
  )
  if (!r) return { hash, ok: false, error: 'target disappeared before measurement' }

  // Two candidate offset mechanisms — scroll-margin/padding (the CSS-native
  // way) or a --header-h custom property a page reads in JS instead. Accept
  // whichever the landed position is actually closer to, since a given
  // anchor only ever uses one. If the page bottom clamps the scroll short of
  // the full offset (a target near the end of the document), the achievable
  // top is `maxY`-limited rather than the nominal offset — compute that
  // clamp against BOTH candidates the same way `window.scrollTo` itself
  // would clamp.
  const docTop = r.top + r.y
  const candidates = [r.marginTop + r.paddingTop, r.headerH].map((offset) => {
    const wantY = Math.min(r.maxY, Math.max(0, docTop - offset))
    const expectedTop = docTop - wantY
    return { offset, expectedTop, delta: Math.abs(r.top - expectedTop) }
  })
  const best = candidates.reduce((a, b) => (b.delta < a.delta ? b : a))
  const ok = best.delta <= tolerance

  return {
    hash: r.hash,
    ok,
    landedTop: r.top,
    expectedTop: best.expectedTop,
    delta: best.delta,
    offsetUsed: best.offset === r.headerH && r.headerH !== r.marginTop + r.paddingTop ? 'header-var' : 'scroll-margin/padding',
    scrollBehavior: before.scrollBehavior
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    process.exit(0)
  }
  const url = args._[0]
  if (!url) {
    console.error('[anchor-check] missing <url>')
    console.error(USAGE)
    process.exit(2)
  }
  const viewports = parseViewports(args.viewports)

  let chromium
  try {
    ;({ chromium } = await resolvePlaywrightModule())
  } catch (err) {
    console.error(err.message)
    process.exit(2)
  }

  const browser = await chromium.launch()
  let failed = 0
  let checked = 0
  try {
    for (const vp of viewports) {
      const { isMobile, hasTouch, ...viewport } = vp
      const ctx = await browser.newContext({ viewport, isMobile, hasTouch })
      const page = await ctx.newPage()
      await page.goto(url, { waitUntil: 'networkidle' })
      await page.waitForTimeout(300) // let fonts/CSS settle

      const anchors = await collectAnchors(page, args.selector, args.limit)
      if (anchors.length === 0) {
        console.log(`${vp.width}x${vp.height}  no matching same-page anchors (selector: ${args.selector})`)
      }
      for (const { hash } of anchors) {
        // Always start from the top so every anchor is a real jump, not a
        // no-op on whatever the previous anchor left scrolled to.
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
        await page.waitForTimeout(50)

        const r = await checkOneAnchor(page, hash, args.headerVar, args.tolerance)
        checked++
        if (!r.ok) failed++
        if (r.error) {
          console.log(`${vp.width}x${vp.height}  ${hash}  FAIL: ${r.error}`)
          continue
        }
        console.log(
          `${vp.width}x${vp.height}  ${hash}  scroll-behavior=${r.scrollBehavior}  ` +
            `landed top=${r.landedTop.toFixed(1)} expected=${r.expectedTop.toFixed(1)} ` +
            `(via ${r.offsetUsed}) delta=${r.delta.toFixed(1)}px  ${r.ok ? 'PASS' : 'FAIL'}`
        )
      }
      await ctx.close()
    }
  } finally {
    await browser.close()
  }

  console.log('')
  console.log(`anchor-check: ${checked - failed}/${checked} passed.`)
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(2)
})
