#!/usr/bin/env node
// verify-motion.mjs — drive a real browser and check the motion things that
// fail silently: a triggered entrance stuck invisible after a reveal
// scroll (`--reveal`), a scroll-driven scene's mode/progress across its
// range (`--scenes`), and a same-page anchor actually landing where it
// should with smooth scrolling and any scroll well left ON (`--anchors`,
// delegated to `anchor-check.mjs`).
//
// This is the scroll-animation half of Tier 1 (references/verification.md
// §1: "the browser harness" — drive a real page and read numbers out of it,
// because the bugs that matter are invisible in source). Layout/unit/
// overflow checks live in the fluid-design skill's `fluid verify` (scripts/tools/verify.mjs), not
// here.
//
// Usage:
//   node verify-motion.mjs <url> [--out dir] [--viewports 1440x900,390x844]
//     [--reveal] [--scenes] [--anchors]
//   node verify-motion.mjs --help
//
// With none of --reveal/--scenes/--anchors given, all three run.
//
// Exit codes: 0 = every requested check passed, 1 = at least one failed,
// 2 = usage/invocation error (including "playwright not found").

import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname_ = dirname(fileURLToPath(import.meta.url))

// ── CLI ─────────────────────────────────────────────────────────────────

const USAGE = `verify-motion.mjs — drive a real browser and check reveal state, scroll-driven
scene state and anchor landings.

Usage:
  node verify-motion.mjs <url> [--out dir] [--viewports 1440x900,390x844]
    [--browser chromium|webkit|firefox] [--reveal] [--scenes] [--anchors]

Options:
  --out <dir>         output directory for report.json / screenshots (default: verify-motion-out)
  --viewports <list>  comma-separated WxH pairs (default: 1440x900,390x844).
                       A width <= 480 is emulated as touch/mobile.
  --browser <name>    the Playwright engine for --reveal/--scenes (default chromium)
  --reveal            step-scroll (scroll-behavior forced to auto) and check every
                       [data-reveal-item] reaches data-reveal-state="shown" and ends opaque;
                       an item of a data-reveal-replay group has to be shown once (it
                       resets out of view)
  --scenes            for each scene ([data-scene-root]), scroll to progress
                       0/.25/.5/.75/1, record its data-scene-state + a screenshot, and
                       check the states run head > scrub > tail in order, never step
                       back, and have left head by progress 1
  --anchors           delegate to anchor-check.mjs (a REAL smooth scroll
                       through the page's own scroll-behavior/scroll well)
  -h, --help          print this message and exit

With none of --reveal/--scenes/--anchors given, all three run.

A check with nothing to look at (no reveal items, no scenes) reports SKIP, never PASS.

Exit codes: 0 = no requested check failed (PASS, or SKIP when nothing was found),
1 = at least one failed, 2 = usage/invocation error (including "playwright not found").`

function parseArgs(argv) {
  const out = {
    _: [],
    out: 'verify-motion-out',
    viewports: '1440x900,390x844',
    browser: 'chromium',
    reveal: false,
    scenes: false,
    anchors: false,
    help: false
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') out.help = true
    else if (a === '--out') out.out = argv[++i]
    else if (a === '--viewports') out.viewports = argv[++i]
    else if (a === '--browser') out.browser = argv[++i]
    else if (a === '--reveal') out.reveal = true
    else if (a === '--scenes') out.scenes = true
    else if (a === '--anchors') out.anchors = true
    else if (a.startsWith('--')) { console.error(`[verify-motion] unknown flag ${a}`); process.exit(2) }
    else out._.push(a)
  }
  if (!['chromium', 'webkit', 'firefox'].includes(out.browser)) {
    console.error(`[verify-motion] --browser must be chromium, webkit or firefox (got ${out.browser})`)
    process.exit(2)
  }
  if (!out.reveal && !out.scenes && !out.anchors) {
    out.reveal = true
    out.scenes = true
    out.anchors = true
  }
  return out
}

function parseViewports(spec) {
  return spec.split(',').filter(Boolean).map((pair) => {
    const m = pair.trim().match(/^(\d+)x(\d+)$/)
    if (!m) { console.error(`[verify-motion] bad --viewports entry: ${pair}`); process.exit(2) }
    const width = Number(m[1])
    const height = Number(m[2])
    const mobile = width <= 480
    return { width, height, isMobile: mobile, hasTouch: mobile }
  })
}

// Resolution order matches anchor-check.mjs: the target project's own
// node_modules first (resolved from process.cwd()), then a bare specifier
// from the skill's own location. Copied here (not imported) so this skill
// stays self-contained -- see anchor-check.mjs's own copy for the same
// rationale, matching the fluid-design skill's convention.
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

// ── --reveal ────────────────────────────────────────────────────────────

// How long the last entrances get to land once the page is stepped through: MOTION.entrance (1.3 s) after its place
// in a batch's stagger (MOTION.lineStagger, 0.067 s per item). Every engine marks an item shown when its reveal lands,
// so a passing page ends the wait as soon as its last item is shown.
const REVEAL_SETTLE_MS = 6000

// Step-scroll to the bottom with rAF + 200ms per step -- a fast scroll
// outruns IntersectionObserver and gives false blanks. Every
// [data-reveal-item] must then reach data-reveal-state="shown" (every engine
// writes it when a reveal lands: reveal.ts, gsap/reveal.ts, motion/Reveal.tsx)
// and end opaque. Opacity alone can't tell: a `clip` item rests hidden
// behind its clip-path at full opacity. An item of a data-reveal-replay group
// resets once it is out of view, so it only has to have been shown once.
// Moved from the fluid-design skill's `fluid verify`
// (scripts/tools/verify.mjs), which never scanned scene state -- that half is
// `checkScenes` below.
async function checkReveal(page) {
  await page.evaluate(async () => {
    // Every item seen shown on the way down (a replay group hides its items again once they are out of view).
    const seen = new Set()
    const note = (el) => el.getAttribute('data-reveal-state') === 'shown' && seen.add(el)
    document.querySelectorAll('[data-reveal-item]').forEach(note)
    const observer = new MutationObserver((records) => records.forEach((r) => note(r.target)))
    observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-reveal-state'] })
    window.__verifyReveal = { seen, observer }

    // Force instant scrolling for the duration of this stepping. A page
    // that sets `html { scroll-behavior: smooth }` queues a smooth animation
    // on every `scrollTo` below; the NEXT step's `scrollTo` then cancels that
    // animation before it arrives -- the same mechanism as a scroll well's
    // `instant` writes cancelling an anchor jump (references/scenes.md, the
    // scroll well). The harness never actually reaches the lower steps, so
    // everything past wherever it stalled reads as a reveal failure that has
    // nothing to do with IntersectionObserver. Measured: this made --reveal
    // fail in every cell (30/54 items hidden) on a page with smooth
    // scrolling on.
    const root = document.documentElement
    const previousScrollBehavior = root.style.scrollBehavior
    root.style.scrollBehavior = 'auto'
    try {
      const step = () => new Promise((resolve) => {
        requestAnimationFrame(() => setTimeout(resolve, 200))
      })
      const max = document.documentElement.scrollHeight - innerHeight
      const increment = Math.max(200, Math.round(innerHeight * 0.8))
      for (let y = 0; y <= max; y += increment) {
        window.scrollTo(0, y)
        await step()
      }
      window.scrollTo(0, max)
    } finally {
      root.style.scrollBehavior = previousScrollBehavior
    }
  })

  const read = () =>
    page.evaluate(() => {
      const { seen } = window.__verifyReveal
      const items = [...document.querySelectorAll('[data-reveal-item]')]
      const hidden = []
      items.forEach((el, i) => {
        const group = el.closest('[data-reveal]')
        const replay = !!group?.hasAttribute('data-reveal-replay')
        const state = el.getAttribute('data-reveal-state')
        const opacity = Number(getComputedStyle(el).opacity)
        const reason = replay
          ? (seen.has(el) ? null : 'never shown (replay group)')
          : state !== 'shown'
            ? (seen.has(el) ? 'shown, then reset' : 'never shown')
            : opacity < 0.99
              ? `shown, opacity ${opacity}`
              : null
        if (!reason) return
        hidden.push({
          index: i,
          opacity,
          state,
          reason,
          group: group ? group.getAttribute('data-reveal') || 'view' : null,
          selector: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '')
        })
      })
      // No items is a SKIP: a page with nothing to reveal must never read as a passed reveal check.
      return { verdict: items.length === 0 ? 'skip' : hidden.length === 0 ? 'pass' : 'fail', total: items.length, hidden }
    })

  // The last reveals land within the settle time; stop waiting once they have.
  const started = Date.now()
  let result = await read()
  while (result.verdict === 'fail' && Date.now() - started < REVEAL_SETTLE_MS) {
    await page.waitForTimeout(250)
    result = await read()
  }
  await page.evaluate(() => window.__verifyReveal.observer.disconnect())
  return result
}

// ── --scenes ────────────────────────────────────────────────────────────

// Scroll to a scene's PROGRESS, never to a raw pixel offset -- pixel offsets
// rot the moment content above the scene changes height, while progress
// (0→1 across the scene's own measured range) stays meaningful regardless
// of what's above it. Maths from references/verification.md §1 / §2 (the
// three real bugs found this way).
async function checkScenes(page, opts) {
  const stages = await page.evaluate(() => document.querySelectorAll('[data-scene-root]').length)
  const scenes = []
  for (let i = 0; i < stages; i++) {
    const base = await page.evaluate((index) => {
      const s = document.querySelectorAll('[data-scene-root]')[index]
      return { top: s.getBoundingClientRect().top + scrollY, range: s.offsetHeight - innerHeight }
    }, i)

    const steps = []
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const y = base.top + base.range * progress
      await page.evaluate((y) => window.scrollTo(0, y), y)
      // Let any glide/spring settle (references/verification.md §1) before
      // reading state or taking the screenshot -- a value still gliding
      // toward its target would otherwise be read mid-flight.
      await page.waitForTimeout(2500)

      // The scene's mode (data-scene-state on its root), reported as `motionState`.
      const state = await page.evaluate((index) => {
        const s = document.querySelectorAll('[data-scene-root]')[index]
        return { motionState: s.getAttribute('data-scene-state'), scrollY: window.scrollY }
      }, i)

      let screenshot
      if (opts.out) {
        mkdirSync(opts.out, { recursive: true })
        screenshot = `scene-${i}-progress-${progress}.png`
        await page.screenshot({ path: join(opts.out, screenshot) })
      }

      steps.push({ progress, ...state, screenshot })
    }
    scenes.push({ index: i, base, steps })
  }
  // Where a mode flips is scene-specific (holds, lead-ins), but the order isn't: scrolling forward, every step has a
  // state, the states only ever move head > scrub > tail, and the scene has left head by progress 1. A machine that
  // never transitions, runs backwards or skips writing is miswired. No scenes is a SKIP, never a pass.
  const RANK = { head: 0, scrub: 1, tail: 2 }
  for (const scene of scenes) {
    const ranks = scene.steps.map((st) => RANK[st.motionState])
    scene.sequence = scene.steps.map((st) => st.motionState ?? '(none)').join(' > ')
    if (ranks.some((r) => r === undefined)) scene.problem = 'a step has no head/scrub/tail state'
    else if (ranks.some((r, k) => k > 0 && r < ranks[k - 1])) scene.problem = 'the state steps backwards while scrolling forward'
    else if (ranks[ranks.length - 1] === 0) scene.problem = 'still in head at progress 1'
  }
  const verdict = stages === 0 ? 'skip' : scenes.some((s) => s.problem) ? 'fail' : 'pass'
  return { verdict, total: stages, scenes }
}

// ── one viewport ────────────────────────────────────────────────────────

async function runViewport(browser, url, opts, vp) {
  const { isMobile, hasTouch, ...viewport } = vp
  const context = await browser.newContext({ viewport, isMobile, hasTouch })
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300) // let fonts/CSS settle

  const result = { width: viewport.width, height: viewport.height, mobile: isMobile, checks: {} }
  const outDir = opts.out ? join(opts.out, `${viewport.width}x${viewport.height}${isMobile ? '-mobile' : ''}`) : undefined

  if (opts.reveal) result.checks.reveal = await checkReveal(page)
  if (opts.scenes) result.checks.scenes = await checkScenes(page, { out: outDir })

  await context.close()
  return result
}

/** 'fail' if any check failed, 'skip' if every check found nothing to look at, else 'pass'. */
function viewportVerdict(v) {
  const verdicts = Object.values(v.checks).map((c) => c.verdict)
  if (verdicts.includes('fail')) return 'fail'
  return verdicts.length && verdicts.every((x) => x === 'skip') ? 'skip' : 'pass'
}

function printSummary(viewports) {
  console.log('width  height  mobile  reveal  scenes  overall')
  for (const v of viewports) {
    const c = v.checks
    const cell = (verdict) => (verdict ? verdict.toUpperCase() : '-')
    console.log(
      [
        String(v.width).padEnd(7),
        String(v.height).padEnd(8),
        (v.mobile ? 'yes' : 'no').padEnd(8),
        cell(c.reveal?.verdict).padEnd(8),
        cell(c.scenes?.verdict).padEnd(8),
        cell(viewportVerdict(v))
      ].join('')
    )
  }
  console.log('')
  for (const v of viewports) {
    const at = `${v.width}x${v.height}${v.mobile ? ' (mobile)' : ''}`
    for (const [name, c] of Object.entries(v.checks)) {
      if (c.verdict === 'skip') console.log(`SKIP ${name} at ${at}: nothing to check (${name === 'reveal' ? 'no [data-reveal-item]' : 'no [data-scene-root]'})`)
    }
    if (v.checks.scenes) for (const s of v.checks.scenes.scenes) console.log(`scene ${s.index} at ${at}: ${s.sequence}${s.problem ? `  FAIL: ${s.problem}` : ''}`)
    if (viewportVerdict(v) !== 'fail') continue
    console.log(`FAIL at ${at}:`)
    if (v.checks.reveal?.verdict === 'fail') {
      for (const h of v.checks.reveal.hidden) {
        console.log(`  reveal[${h.index}] ${h.selector} (${h.group ? `data-reveal="${h.group}"` : 'no group'}): ${h.reason}`)
      }
    }
    console.log('')
  }
}

// ── --anchors delegation ───────────────────────────────────────────────

function runAnchors(url, opts) {
  const script = join(__dirname_, 'anchor-check.mjs')
  const args = [script, url, '--viewports', opts.viewports]
  console.log(`[verify-motion] --anchors: delegating to anchor-check.mjs ${args.slice(1).join(' ')}`)
  const res = spawnSync(process.execPath, args, { stdio: 'inherit' })
  if (res.error) {
    console.error(`[verify-motion] failed to run anchor-check.mjs: ${res.error.message}`)
    return 2
  }
  return res.status ?? 2
}

// ── main ────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    process.exit(0)
  }
  const url = args._[0]
  if (!url) {
    console.error('usage: node verify-motion.mjs <url> [--out dir] [--viewports W1xH1,W2xH2] [--browser chromium|webkit|firefox] [--reveal] [--scenes] [--anchors]')
    console.error('       node verify-motion.mjs --help')
    process.exit(2)
  }

  let viewports
  try {
    viewports = parseViewports(args.viewports)
  } catch (err) {
    console.error(`[verify-motion] ${err.message}`)
    process.exit(2)
  }

  let anyFail = false
  let allSkipped = false
  let results = []

  if (args.reveal || args.scenes) {
    let engine
    try {
      engine = (await resolvePlaywrightModule())[args.browser]
    } catch (err) {
      console.error(err.message)
      process.exit(2)
    }
    if (!engine) {
      console.error(`[verify-motion] this playwright has no ${args.browser}`)
      process.exit(2)
    }
    console.log(`[verify-motion] browser: ${args.browser}`)

    const browser = await engine.launch()
    try {
      for (const vp of viewports) {
        results.push(await runViewport(browser, url, args, vp))
      }
    } finally {
      await browser.close()
    }

    mkdirSync(args.out, { recursive: true })
    const report = { url, generatedAt: new Date().toISOString(), viewports: results }
    writeFileSync(join(args.out, 'report.json'), JSON.stringify(report, null, 2))

    printSummary(results)
    console.log(`report: ${join(args.out, 'report.json')}`)
    anyFail = anyFail || results.some((v) => viewportVerdict(v) === 'fail')
    allSkipped = results.every((v) => viewportVerdict(v) === 'skip')
  }

  if (args.anchors) {
    const status = runAnchors(url, args)
    if (status === 2) process.exit(2)
    anyFail = anyFail || status !== 0
  }

  console.log(anyFail ? 'FAIL' : allSkipped && !args.anchors ? 'SKIP (nothing to check)' : 'PASS')
  process.exit(anyFail ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(2)
})
