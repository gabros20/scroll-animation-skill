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
// overflow checks live in the fluid-design skill's verify-matrix.mjs, not
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
    [--reveal] [--scenes] [--anchors]

Options:
  --out <dir>         output directory for report.json / screenshots (default: verify-motion-out)
  --viewports <list>  comma-separated WxH pairs (default: 1440x900,390x844).
                       A width <= 480 is emulated as touch/mobile.
  --reveal            step-scroll (scroll-behavior forced to auto) and check
                       every [data-stage-item] ends visible
  --scenes            for each [data-scrub-stage], scroll to progress
                       0/.25/.5/.75/1 and record data-motion-state + a screenshot
  --anchors           delegate to anchor-check.mjs (a REAL smooth scroll
                       through the page's own scroll-behavior/scroll well)
  -h, --help          print this message and exit

With none of --reveal/--scenes/--anchors given, all three run.

Exit codes: 0 = every requested check passed, 1 = at least one failed,
2 = usage/invocation error (including "playwright not found").`

function parseArgs(argv) {
  const out = {
    _: [],
    out: 'verify-motion-out',
    viewports: '1440x900,390x844',
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
    else if (a === '--reveal') out.reveal = true
    else if (a === '--scenes') out.scenes = true
    else if (a === '--anchors') out.anchors = true
    else if (a.startsWith('--')) { console.error(`[verify-motion] unknown flag ${a}`); process.exit(2) }
    else out._.push(a)
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

// Step-scroll to the bottom with rAF + 200ms per step -- a fast scroll
// outruns IntersectionObserver and gives false blanks. Then report every
// [data-stage-item] still under opacity 0.99. Moved wholesale from the
// fluid-design skill's verify-matrix.mjs (its --reveal), which never scanned
// scene state -- that half is `checkScenes` below.
async function checkReveal(page) {
  await page.evaluate(async () => {
    // Force instant scrolling for the duration of this stepping. A page
    // that sets `html { scroll-behavior: smooth }` (motion.css's
    // default) queues a smooth animation on every `scrollTo` below; the
    // NEXT step's `scrollTo` then cancels that animation before it arrives
    // -- same mechanism as scrollPull's `instant` writes cancelling an
    // anchor jump (references/scroll-scenes.md §8). The harness never
    // actually reaches the lower steps, so everything past wherever it
    // stalled reads as a reveal failure that has nothing to do with
    // IntersectionObserver. Measured: this made --reveal fail in every cell
    // (30/54 items hidden) on a page with smooth scrolling on.
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
      // Final settle: the entrance transition runs up to 1.3s
      // (references/attribute-contract.md §4), so a stage item triggered by
      // the last step may still be mid-transition at the 200ms mark. Give
      // it real room before reading opacity, or a perfectly working reveal
      // reads as a false failure.
      await new Promise((resolve) => setTimeout(resolve, 1500))
    } finally {
      root.style.scrollBehavior = previousScrollBehavior
    }
  })

  return page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-stage-item]')]
    const hidden = []
    items.forEach((el, i) => {
      const op = Number(getComputedStyle(el).opacity)
      if (op < 0.99) {
        hidden.push({
          index: i,
          opacity: op,
          selector: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '')
        })
      }
    })
    return { pass: hidden.length === 0, total: items.length, hidden }
  })
}

// ── --scenes ────────────────────────────────────────────────────────────

// Scroll to a scene's PROGRESS, never to a raw pixel offset -- pixel offsets
// rot the moment content above the scene changes height, while progress
// (0→1 across the scene's own measured range) stays meaningful regardless
// of what's above it. Maths from references/verification.md §1 / §2 (the
// three real bugs found this way).
async function checkScenes(page, opts) {
  const stages = await page.evaluate(() => document.querySelectorAll('[data-scrub-stage]').length)
  const scenes = []
  for (let i = 0; i < stages; i++) {
    const base = await page.evaluate((index) => {
      const s = document.querySelectorAll('[data-scrub-stage]')[index]
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

      const state = await page.evaluate((index) => {
        const s = document.querySelectorAll('[data-scrub-stage]')[index]
        const stateEl = s.querySelector('[data-motion-state]') ?? s
        return {
          motionState: stateEl.getAttribute('data-motion-state'),
          scrollY: window.scrollY
        }
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
  // Informational only: this heuristic records state, it does not itself
  // know what data-motion-state SHOULD be at a given progress (that is
  // scene-specific). A run only fails if a stage never wrote the attribute
  // at all, across every step -- a machine that never transitions is either
  // not wired up or has a broken threshold.
  const pass = scenes.every((s) => s.steps.some((st) => st.motionState != null))
  return { pass, total: stages, scenes }
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

function viewportPass(v) {
  return (v.checks.reveal ? v.checks.reveal.pass : true) && (v.checks.scenes ? v.checks.scenes.pass : true)
}

function printSummary(viewports) {
  console.log('width  height  mobile  reveal  scenes  overall')
  for (const v of viewports) {
    const c = v.checks
    const cell = (b) => (b === undefined ? '-' : b ? 'PASS' : 'FAIL')
    console.log(
      [
        String(v.width).padEnd(7),
        String(v.height).padEnd(8),
        (v.mobile ? 'yes' : 'no').padEnd(8),
        cell(c.reveal?.pass).padEnd(8),
        cell(c.scenes?.pass).padEnd(8),
        viewportPass(v) ? 'PASS' : 'FAIL'
      ].join('')
    )
  }
  console.log('')
  for (const v of viewports) {
    if (viewportPass(v)) continue
    console.log(`FAIL at ${v.width}x${v.height}${v.mobile ? ' (mobile)' : ''}:`)
    if (v.checks.reveal && !v.checks.reveal.pass) {
      for (const h of v.checks.reveal.hidden) console.log(`  reveal[${h.index}] ${h.selector}: opacity ${h.opacity}`)
    }
    if (v.checks.scenes && !v.checks.scenes.pass) {
      console.log('  scenes: at least one [data-scrub-stage] never wrote data-motion-state across any step')
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
    console.error('usage: node verify-motion.mjs <url> [--out dir] [--viewports W1xH1,W2xH2] [--reveal] [--scenes] [--anchors]')
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
  let results = []

  if (args.reveal || args.scenes) {
    let chromium
    try {
      ;({ chromium } = await resolvePlaywrightModule())
    } catch (err) {
      console.error(err.message)
      process.exit(2)
    }

    const browser = await chromium.launch()
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
    anyFail = anyFail || results.some((v) => !viewportPass(v))
  }

  if (args.anchors) {
    const status = runAnchors(url, args)
    if (status === 2) process.exit(2)
    anyFail = anyFail || status !== 0
  }

  console.log(anyFail ? 'FAIL' : 'PASS')
  process.exit(anyFail ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(2)
})
