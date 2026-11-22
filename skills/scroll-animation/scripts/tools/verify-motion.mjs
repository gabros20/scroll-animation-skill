#!/usr/bin/env node
// verify-motion.mjs — drive a real browser and check the motion things that
// fail silently: a triggered entrance stuck invisible after a reveal
// scroll (`--reveal`), a scroll-driven scene's mode/progress across its
// range (`--scenes`), and a same-page anchor actually landing where it
// should with smooth scrolling and any scroll well left ON (`--anchors`,
// delegated to `anchor-check.mjs`), and a navigation between two pages
// (`--nav`): a link clicked from a scrolled position, then back and forward.
//
// This is the scroll-animation half of Tier 1 (references/verification.md
// §1: "the browser harness" — drive a real page and read numbers out of it,
// because the bugs that matter are invisible in source). Layout/unit/
// overflow checks live in the fluid-design skill's `fluid verify` (scripts/tools/verify.mjs), not
// here.
//
// Usage:
//   node verify-motion.mjs <url> [--out dir] [--viewports 1440x900,390x844]
//     [--browser chromium|webkit|firefox] [--channel chrome] [--reveal] [--scenes] [--anchors]
//     [--nav [href]] [--nav-from px]
//   node verify-motion.mjs --help
//
// With none of --reveal/--scenes/--anchors/--nav given, the first three run.
// --nav is asked for by name: it needs a second page.
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
    [--browser chromium|webkit|firefox] [--channel chrome] [--reveal] [--scenes] [--anchors]
    [--nav [href]] [--nav-from px]

Options:
  --out <dir>         output directory for report.json / screenshots (default: verify-motion-out)
  --viewports <list>  comma-separated WxH pairs (default: 1440x900,390x844).
                       A width <= 480 is emulated as touch/mobile.
  --browser <name>    the Playwright engine for --reveal/--scenes (default chromium)
  --channel <name>    with chromium, a branded build instead of Playwright's own (chrome, msedge):
                       before Playwright 1.57 (1.63 on Linux arm64) the bundled Chromium decodes
                       no H.264, so a scrub never paints there
  --reveal            step-scroll (scroll-behavior forced to auto) and check every
                       [data-reveal-item] reaches data-reveal-state="shown" and ends opaque;
                       an item of a data-reveal-replay group has to be shown once (it
                       resets out of view)
  --scenes            for each scene ([data-scene-root]), scroll to progress
                       0/.25/.5/.75/1, record its data-scene-state + a screenshot, and
                       check the states run head > scrub > tail in order, never step
                       back, and have left head by progress 1; a video in the scene
                       that never decodes a frame (unless still preload="none"), or
                       one that moves elsewhere but holds still through every scrub
                       step, fails it. Also samples the two
                       slides (the pin 3/4 on screen entering and leaving), where a
                       held clip shows a still sliding past
  --anchors           delegate to anchor-check.mjs (a REAL smooth scroll
                       through the page's own scroll-behavior/scroll well)
  --nav [href]        a navigation between two pages, which a fresh load never tests: scroll
                       the page down, click a link (the first visible same-site link to
                       another path, or the one whose href is given), then go back and
                       forward. Checks: the link lands at the top (or its hash target)
                       and back/forward where the reader was, with no glide (the
                       position, and a smoother's content, are there within two frames);
                       no reveal starts with its item off screen; nothing on the new
                       first screen enters while a view transition still covers it; and
                       the first screen ends visible
  --nav-from <px>     where to scroll before the click (default: 1.5 viewports, or the
                       page's end)
  -h, --help          print this message and exit

With none of --reveal/--scenes/--anchors/--nav given, the first three run.

A check with nothing to look at (no reveal items, no scenes) reports SKIP, never PASS.

Exit codes: 0 = no requested check failed (PASS, or SKIP when nothing was found),
1 = at least one failed, 2 = usage/invocation error (including "playwright not found").`

function parseArgs(argv) {
  const out = {
    _: [],
    out: 'verify-motion-out',
    viewports: '1440x900,390x844',
    browser: 'chromium',
    channel: null,
    reveal: false,
    scenes: false,
    anchors: false,
    nav: false,
    navHref: null,
    navFrom: null,
    help: false
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') out.help = true
    else if (a === '--out') out.out = argv[++i]
    else if (a === '--viewports') out.viewports = argv[++i]
    else if (a === '--browser') out.browser = argv[++i]
    else if (a === '--channel') out.channel = argv[++i]
    else if (a === '--reveal') out.reveal = true
    else if (a === '--scenes') out.scenes = true
    else if (a === '--anchors') out.anchors = true
    else if (a === '--nav') {
      out.nav = true
      if (argv[i + 1] && !argv[i + 1].startsWith('--') && out._.length) out.navHref = argv[++i]
    } else if (a === '--nav-from') out.navFrom = Number(argv[++i])
    else if (a.startsWith('--')) { console.error(`[verify-motion] unknown flag ${a}`); process.exit(2) }
    else out._.push(a)
  }
  if (!['chromium', 'webkit', 'firefox'].includes(out.browser)) {
    console.error(`[verify-motion] --browser must be chromium, webkit or firefox (got ${out.browser})`)
    process.exit(2)
  }
  if (out.channel && out.browser !== 'chromium') {
    console.error(`[verify-motion] --channel needs --browser chromium (got ${out.browser})`)
    process.exit(2)
  }
  if (!out.reveal && !out.scenes && !out.anchors && !out.nav) {
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
      return { top: s.getBoundingClientRect().top + scrollY, range: s.offsetHeight - innerHeight, vh: innerHeight }
    }, i)

    const steps = []
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const y = base.top + base.range * progress
      await page.evaluate((y) => window.scrollTo(0, y), y)
      // Let any glide/spring settle (references/verification.md §1) before
      // reading state or taking the screenshot -- a value still gliding
      // toward its target would otherwise be read mid-flight.
      await page.waitForTimeout(2500)

      const state = await readScene(page, i)

      let screenshot
      if (opts.out) {
        mkdirSync(opts.out, { recursive: true })
        screenshot = `scene-${i}-progress-${progress}.png`
        await page.screenshot({ path: join(opts.out, screenshot) })
      }

      steps.push({ progress, ...state, screenshot })
    }

    // The slides: a sticky pin is on screen for a viewport before progress leaves 0 and after it reaches 1. A clip
    // held there (no head or tail loop) is a still sliding in and out of a scene the reader was scrubbing: recorded,
    // with a screenshot, so the contact sheet shows it (references/video.md §14). Informational, not a verdict.
    const slides = []
    for (const [at, y] of [
      ['enter', base.top - 0.25 * base.vh],
      ['leave', base.top + base.range + 0.25 * base.vh]
    ]) {
      await page.evaluate((y) => window.scrollTo(0, Math.max(0, y)), y)
      await page.waitForTimeout(1500)
      const state = await readScene(page, i)
      let screenshot
      if (opts.out) {
        screenshot = `scene-${i}-${at}.png`
        await page.screenshot({ path: join(opts.out, screenshot) })
      }
      slides.push({ at, ...state, screenshot })
    }
    scenes.push({ index: i, base, steps, slides })
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
    // A video with a source that never had a frame to show across the sweep: the reader saw the poster all along.
    // A missing file, a server without 206, or a codec this browser lacks (Playwright's own Chromium before 1.57, or
    // 1.63 on Linux arm64, has no H.264): --channel chrome. A video still preload="none" was never asked to load
    // (decoration the page doesn't drive; the controller sets preload="auto" at its warm margin): skipped.
    // A frozen clip: one that decodes, but whose playhead never moves across the scrub steps.
    else {
      // One run per video, indexed by step; a video missing at any step is left out of both checks.
      const videos = scene.steps[0].videos
        .map((_, k) => scene.steps.map((st) => st.videos[k]))
        .map((runs) => (runs.every(Boolean) ? runs : null))
      const dead = videos.findIndex(
        (runs) => runs && runs.some((v) => v.src) && runs.at(-1).preload !== 'none' && runs.every((v) => v.readyState < 2)
      )
      // Frozen only if something drives it: its time moved somewhere in the sweep (a head loop, the tail), never
      // through the scrub. An undriven decorative video that never moves is not this check's business.
      const scrubbing = scene.steps.map((st, k) => (st.motionState === 'scrub' ? k : -1)).filter((k) => k >= 0)
      const frozen =
        scrubbing.length >= 2
          ? videos.findIndex(
              (runs) =>
                runs &&
                runs.every((v) => v.readyState >= 2) &&
                new Set(runs.map((v) => v.time)).size > 1 &&
                new Set(scrubbing.map((k) => runs[k].time)).size === 1
            )
          : -1
      if (dead >= 0) {
        scene.problem =
          `video ${dead} never decoded a frame (readyState ${videos[dead].at(-1).readyState}): a missing file, no 206 ` +
          'from the server, or a codec this browser lacks (try --channel chrome or --browser webkit)'
      } else if (frozen >= 0) {
        scene.problem = `video ${frozen} is frozen: its playhead sat at ${videos[frozen][scrubbing[0]].time}s through every scrub step`
      }
    }
  }
  const verdict = stages === 0 ? 'skip' : scenes.some((s) => s.problem) ? 'fail' : 'pass'
  return { verdict, total: stages, scenes }
}

/** One scene's mode (data-scene-state on its root, as `motionState`) and each of its videos' decode state. */
function readScene(page, index) {
  return page.evaluate((index) => {
    const s = document.querySelectorAll('[data-scene-root]')[index]
    const videos = [...s.querySelectorAll('video')].map((v) => ({
      src: !!v.currentSrc,
      preload: v.preload,
      readyState: v.readyState,
      time: Math.round(v.currentTime * 1000) / 1000
    }))
    return { motionState: s.getAttribute('data-scene-state'), scrollY: window.scrollY, videos }
  }, index)
}

// ── --nav ───────────────────────────────────────────────────────────────

const NAV_PX = 2
/** Selectors of what enters on a first screen: reveals, server-split words, a page's own CSS entrance. */
const NAV_ENTRANCES = '[data-reveal-item], [data-split-word], [data-enter]'

/** Installed before the page's scripts: a frame log, and where each reveal item was when its entrance started. */
function navProbe(entrances) {
  const onScreen = (r) => r.bottom > 0 && r.top < window.innerHeight
  const vtActive = () => {
    try {
      return document.documentElement.matches(':active-view-transition')
    } catch {
      return false
    }
  }
  const state = { frames: null, starts: [], under: new Set() }
  const started = new WeakSet()
  new MutationObserver((records) => {
    if (!state.frames) return
    for (const { target: el } of records) {
      if (!(el instanceof HTMLElement) || !el.hasAttribute('data-reveal-item') || started.has(el)) continue
      if (!el.style.length && !el.hasAttribute('data-reveal-transition') && el.getAttribute('data-reveal-state') !== 'shown') continue
      started.add(el)
      const r = el.getBoundingClientRect()
      if (r.width || r.height) state.starts.push({ id: el.id || el.tagName.toLowerCase(), top: Math.round(r.top), on: onScreen(r), path: location.pathname })
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['style', 'data-reveal-state', 'data-reveal-transition'] })
  const frame = () => {
    if (!state.frames) return
    const content = document.getElementById('smooth-content')
    const vt = vtActive()
    state.frames.push({ p: location.pathname, y: window.scrollY, c: content ? -content.getBoundingClientRect().top : null, vt })
    if (vt) {
      // Showing beneath the transition: its fade would be over before the reader sees the page.
      for (const el of document.querySelectorAll(entrances)) {
        const r = el.getBoundingClientRect()
        // Part-way through its fade (a GSAP or Motion entrance has no WAAPI animation to ask).
        const opacity = Number(getComputedStyle(el).opacity)
        if (onScreen(r) && opacity > 0.05 && opacity < 0.99) {
          state.under.add(el.id || (el.hasAttribute('data-split-word') ? 'split word' : el.tagName.toLowerCase()))
        }
      }
    }
    requestAnimationFrame(frame)
  }
  window.__verifyNav = {
    record() {
      state.frames = []
      state.starts = []
      state.under = new Set()
      requestAnimationFrame(frame)
    },
    stop() {
      const out = { frames: state.frames ?? [], starts: state.starts, under: [...state.under], sawVT: (state.frames ?? []).some((f) => f.vt) }
      state.frames = null
      return out
    },
    firstScreen() {
      const hidden = []
      for (const el of document.querySelectorAll(entrances)) {
        const r = el.getBoundingClientRect()
        if (!(r.width || r.height) || !onScreen(r)) continue
        if (Number(getComputedStyle(el).opacity) < 0.99) hidden.push(el.id || el.textContent.trim().slice(0, 24) || el.tagName.toLowerCase())
      }
      return hidden
    },
  }
}

/** Resolves once the path shows, no view transition runs and scrollY has held still for 20 frames. */
async function navSettle(page, path) {
  await page.waitForFunction((p) => location.pathname === p, path, { timeout: 10000 }).catch(() => {})
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let last = -1
        let still = 0
        const end = performance.now() + 8000
        const step = () => {
          const y = window.scrollY
          let vt = false
          try {
            vt = document.documentElement.matches(':active-view-transition')
          } catch {
            // no selector: no transition to wait for
          }
          still = y === last && !vt ? still + 1 : 0
          last = y
          if (still >= 20 || performance.now() > end) resolve(true)
          else requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }),
  )
}

/**
 * The frames of `rec` on `path`. A placement shows two positions, where the page was and where it landed; a frame at
 * a third is a glide. And once landed (two frames' grace: a placement's `scroll` event reaches the page a frame
 * later), a smoother's content sits on the scroll position.
 */
function navGlide(rec, path, from, landing) {
  const after = rec.frames.slice(rec.frames.findIndex((f) => f.p === path))
  const moving = after.filter((f) => Math.abs(f.y - landing) > NAV_PX && Math.abs(f.y - from) > NAV_PX)
  const landed = after.slice(after.findIndex((f) => Math.abs(f.y - landing) <= NAV_PX)).slice(2)
  const trailing = landed.filter((f) => f.c !== null && Math.abs(f.c - f.y) > NAV_PX)
  const worst = Math.max(0, ...moving.map((f) => Math.abs(f.y - landing)), ...trailing.map((f) => Math.abs(f.c - f.y)))
  return { frames: after.length, moving: moving.length, trailing: trailing.length, worst: Math.round(worst) }
}

async function checkNav(browser, url, opts, vp) {
  const { isMobile, hasTouch, ...viewport } = vp
  const context = await browser.newContext({ viewport, isMobile, hasTouch })
  await context.addInitScript(navProbe, NAV_ENTRANCES)
  const page = await context.newPage()
  const problems = []
  const steps = []
  try {
    await page.goto(url, { waitUntil: 'networkidle' })
    const from = new URL(page.url()).pathname
    const link = await page.evaluate((href) => {
      const links = Array.from(document.querySelectorAll('a[href]')).filter((a) => {
        if (a.origin !== location.origin || a.target === '_blank' || a.hasAttribute('download')) return false
        return href ? a.getAttribute('href') === href || a.pathname === href : a.pathname !== location.pathname
      })
      const pick = links.find((a) => a.getClientRects().length > 0) ?? links[0]
      if (!pick) return null
      pick.setAttribute('data-verify-nav', '')
      return { path: pick.pathname, hash: pick.hash, href: pick.getAttribute('href') }
    }, opts.navHref)
    if (!link) return { verdict: 'skip', problems: [], steps: [], reason: opts.navHref ? `no link to ${opts.navHref}` : 'no link to another page' }

    const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
    const y1 = Math.max(0, Math.min(max, Number.isFinite(opts.navFrom) && opts.navFrom !== null ? opts.navFrom : Math.round(viewport.height * 1.5)))
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y1)
    await navSettle(page, from)
    const at1 = await page.evaluate(() => window.scrollY)

    const step = async (name, path, act, landing) => {
      const before = await page.evaluate(() => window.scrollY)
      await page.evaluate(() => window.__verifyNav.record())
      await act()
      await navSettle(page, path)
      const rec = await page.evaluate(() => window.__verifyNav.stop())
      const y = await page.evaluate(() => window.scrollY)
      const expected = landing(y)
      const glide = navGlide(rec, path, before, y)
      const off = rec.starts.filter((s) => s.path === path && !s.on)
      const entry = { name, path, scrollY: Math.round(y), expected, glide, startedOffScreen: off, sawViewTransition: rec.sawVT, underTransition: rec.under }
      steps.push(entry)
      if (expected !== null && Math.abs(y - expected) > NAV_PX) problems.push(`${name}: landed at ${Math.round(y)}, expected ${expected}`)
      if (glide.moving) problems.push(`${name}: ${glide.moving} frames at a position between the old one and the landing (up to ${glide.worst} px off): a glide, not a placement`)
      else if (glide.trailing) problems.push(`${name}: the smoothed content trailed the scroll position for ${glide.trailing} frames (up to ${glide.worst} px)`)
      if (off.length) problems.push(`${name}: ${off.length} reveal(s) started off screen (${off.slice(0, 3).map((s) => `${s.id} at ${s.top}`).join(', ')})`)
      if (rec.under.length) problems.push(`${name}: entering under the view transition: ${rec.under.slice(0, 3).join(', ')}`)
      return entry
    }

    // The link: the top, or its hash target (wherever the page put it: only the glide is judged then).
    await step(`link to ${link.href}`, link.path, () => page.evaluate(() => document.querySelector('[data-verify-nav]').click()), () => (link.hash ? null : 0))
    // An entrance has time to end, then the first screen must be readable.
    await page.waitForTimeout(2000)
    const hidden = await page.evaluate(() => window.__verifyNav.firstScreen())
    if (hidden.length) problems.push(`link to ${link.href}: on the first screen, still hidden 2 s after arriving: ${hidden.slice(0, 4).join(', ')}`)

    const max2 = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
    const y2 = Math.max(0, Math.min(max2, Math.round(viewport.height * 0.8)))
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y2)
    await navSettle(page, link.path)
    const at2 = await page.evaluate(() => window.scrollY)

    await step('back', from, () => page.evaluate(() => history.back()), () => Math.round(at1))
    await step('forward', link.path, () => page.evaluate(() => history.forward()), () => Math.round(at2))
  } finally {
    await context.close()
  }
  return { verdict: problems.length ? 'fail' : 'pass', problems, steps }
}

// ── one viewport ────────────────────────────────────────────────────────

async function runViewport(browser, url, opts, vp) {
  const { isMobile, hasTouch, ...viewport } = vp
  const context = await browser.newContext({ viewport, isMobile, hasTouch })
  const page = await context.newPage()
  if (opts.reveal || opts.scenes) {
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForTimeout(300) // let fonts/CSS settle
  }

  const result = { width: viewport.width, height: viewport.height, mobile: isMobile, checks: {} }
  const outDir = opts.out ? join(opts.out, `${viewport.width}x${viewport.height}${isMobile ? '-mobile' : ''}`) : undefined

  if (opts.reveal) result.checks.reveal = await checkReveal(page)
  if (opts.scenes) result.checks.scenes = await checkScenes(page, { out: outDir })

  await context.close()
  if (opts.nav) result.checks.nav = await checkNav(browser, url, opts, vp)
  return result
}

/** 'fail' if any check failed, 'skip' if every check found nothing to look at, else 'pass'. */
function viewportVerdict(v) {
  const verdicts = Object.values(v.checks).map((c) => c.verdict)
  if (verdicts.includes('fail')) return 'fail'
  return verdicts.length && verdicts.every((x) => x === 'skip') ? 'skip' : 'pass'
}

function printSummary(viewports) {
  console.log('width  height  mobile  reveal  scenes  nav     overall')
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
        cell(c.nav?.verdict).padEnd(8),
        cell(viewportVerdict(v))
      ].join('')
    )
  }
  console.log('')
  for (const v of viewports) {
    const at = `${v.width}x${v.height}${v.mobile ? ' (mobile)' : ''}`
    for (const [name, c] of Object.entries(v.checks)) {
      if (c.verdict === 'skip') {
        const nothing = name === 'reveal' ? 'no [data-reveal-item]' : name === 'nav' ? c.reason : 'no [data-scene-root]'
        console.log(`SKIP ${name} at ${at}: nothing to check (${nothing})`)
      }
    }
    for (const step of v.checks.nav?.steps ?? []) {
      console.log(`nav at ${at}: ${step.name} → scrollY ${step.scrollY}${step.expected === null ? '' : ` (expected ${step.expected})`}, ${step.glide.frames} frames watched${step.sawViewTransition ? ', view transition' : ''}`)
    }
    if (v.checks.scenes) {
      for (const s of v.checks.scenes.scenes) {
        console.log(`scene ${s.index} at ${at}: ${s.sequence}${s.problem ? `  FAIL: ${s.problem}` : ''}`)
        const slide = (sl) => `${sl.at} ${sl.motionState ?? '(none)'}${sl.videos.length ? ` t=${sl.videos.map((x) => x.time).join('/')}` : ''}`
        console.log(`  slides: ${s.slides.map(slide).join(' · ')}`)
      }
    }
    if (viewportVerdict(v) !== 'fail') continue
    console.log(`FAIL at ${at}:`)
    if (v.checks.reveal?.verdict === 'fail') {
      for (const h of v.checks.reveal.hidden) {
        console.log(`  reveal[${h.index}] ${h.selector} (${h.group ? `data-reveal="${h.group}"` : 'no group'}): ${h.reason}`)
      }
    }
    for (const problem of v.checks.nav?.problems ?? []) console.log(`  nav: ${problem}`)
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
    console.error('usage: node verify-motion.mjs <url> [--out dir] [--viewports W1xH1,W2xH2] [--browser chromium|webkit|firefox] [--channel chrome] [--reveal] [--scenes] [--anchors] [--nav [href]]')
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

  if (args.reveal || args.scenes || args.nav) {
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
    console.log(`[verify-motion] browser: ${args.browser}${args.channel ? ` (${args.channel})` : ''}`)

    const browser = await engine.launch(args.channel ? { channel: args.channel } : {})
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
