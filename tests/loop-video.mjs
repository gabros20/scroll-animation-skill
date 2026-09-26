#!/usr/bin/env node
// loop-video.mjs — LoopVideo v2 (assets/motion/LoopVideo.tsx, assets/gsap/loop-video.ts) in real
// browsers: IO-gated play/pause, the WCAG 2.2.2 pause control (sticky user-pause, a name that
// follows the state, no aria-pressed), the `alt` text alternative,
// live reduced motion, live Save-Data, a rejected play() with no retry loop, and (motion-seam/
// gsap-seam) the rVFC seam wrap — no ended/pause event and frame-accurate across 3+ loop cycles.
// Builds tests/fixtures/loop-video with Vite, serves the build with `vite preview`, prints one
// PASS/FAIL line per check/engine/browser, and exits 1 on any FAIL. Needs the Playwright browsers
// and (for a first run with no cached clip) ffmpeg, so this is its own script, the way
// `test:foundation` and `test:smoke` are — not part of `npm test`.
//
//   node tests/loop-video.mjs [--browsers chromium,webkit] [--engines motion,gsap,motion-seam,gsap-seam]

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { chromium, webkit } from 'playwright'
import { build, preview } from 'vite'

const execFileAsync = promisify(execFile)

const testsDir = dirname(fileURLToPath(import.meta.url))
const fixtureRoot = join(testsDir, 'fixtures', 'loop-video')
const outDir = join(testsDir, '.scratch', 'loop-video-dist')
const scratchClip = join(testsDir, '.scratch', 'clip.mp4')
const fixtureClip = join(fixtureRoot, 'public', 'clip.mp4')
// The seam pages play the shared clip plus one spare clone of its last frame, as `media loop --loop-from` makes it:
// LoopVideo's early wrap only ever skips the spare.
const seamClip = join(fixtureRoot, 'public', 'clip-seam.mp4')

const ENGINES_BY_BROWSER = { chromium, webkit }
const PAGES = ['motion', 'gsap', 'motion-seam', 'gsap-seam']
const VIEWPORT = { width: 800, height: 600 }
// Must be >= the source files' own WATCHDOG_INTERVAL_MS, so the rejected-play
// check spans at least one watchdog tick and can prove it did NOT retry.
const WATCHDOG_MS = 2000
// The *-seam pages' fixed seam config (data-loop-from-frame/fps and
// loopFromFrame/fps — see gsap-seam-entry.ts): loop body = frames 45-59 of
// the shared 60-frame/30fps clip, 0.5s/cycle. Not a measured pixel match —
// these checks assert frame INDICES and event timing, never seamlessness.
const SEAM_FROM_FRAME = 45
// How long to observe after scrolling a *-seam page's video into view: the
// ~2s intro plus >=3 loop cycles (1.5s) at 1x, with slack for IO/seek
// latency and — pre-fix — the OLD pause+seek+replay overhead at every wrap.
// Kept close to the minimum the brief asks for (3+) rather than generous:
// each extra cycle observed is also extra exposure to rVFC scheduling
// jitter under system load (see task-21-notes.md).
const SEAM_WINDOW_MS = 5000
const SEAM_MIN_SEAMS = 3
const SEAM_FRAME_TOLERANCE = 1

// ── args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { browsers: Object.keys(ENGINES_BY_BROWSER), pages: PAGES }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--browsers') out.browsers = argv[++i].split(',')
    else if (a === '--engines') out.pages = argv[++i].split(',')
    else throw new Error(`unknown argument: ${a}`)
  }
  for (const b of out.browsers) if (!ENGINES_BY_BROWSER[b]) throw new Error(`unknown browser: ${b}`)
  for (const p of out.pages) if (!PAGES.includes(p)) throw new Error(`unknown engine: ${p} (${PAGES.join(', ')})`)
  return out
}

// ── the test clip ──────────────────────────────────────────────────────

/** Reuses `pretest`'s clip if it already ran; else makes the same one; else skips (ffmpeg missing). */
async function ensureClip() {
  if (!(await ensurePlainClip())) return false
  if (existsSync(seamClip)) return true
  try {
    await execFileAsync('ffmpeg', ['-y', '-i', fixtureClip, '-vf', 'tpad=stop_mode=clone:stop=1', '-g', '1', '-pix_fmt', 'yuv420p', seamClip])
    return true
  } catch {
    return false
  }
}

async function ensurePlainClip() {
  if (existsSync(fixtureClip)) return true
  await mkdir(dirname(fixtureClip), { recursive: true })
  if (existsSync(scratchClip)) {
    await copyFile(scratchClip, fixtureClip)
    return true
  }
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=640x360:rate=30:duration=2',
      '-g',
      '1',
      '-pix_fmt',
      'yuv420p',
      fixtureClip
    ])
    return true
  } catch {
    return false
  }
}

// ── build + serve ──────────────────────────────────────────────────────

function onwarn(warning, warn) {
  // LoopVideo.tsx opens with 'use client', meaningless outside a server-components bundler.
  if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
  if (warning.code === 'SOURCEMAP_ERROR' && /\.tsx? \(1:0\)/.test(warning.message)) return
  warn(warning)
}

async function serve() {
  await build({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'warn',
    esbuild: { jsx: 'automatic' },
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      rollupOptions: { input: Object.fromEntries(PAGES.map((p) => [p, join(fixtureRoot, `${p}.html`)])), onwarn }
    }
  })
  return preview({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'warn',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0, strictPort: false }
  })
}

// ── page helpers ────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function scrollToVideo(page) {
  await page.evaluate(() => document.querySelector('video')?.scrollIntoView({ block: 'center' }))
}
async function scrollAway(page) {
  await page.evaluate(() => window.scrollTo(0, 0))
}
async function waitPaused(page, paused, timeout = 3000) {
  await page.waitForFunction((want) => document.querySelector('video')?.paused === want, paused, { timeout })
}
async function waitToggleName(page, pattern, timeout = 3000) {
  // `video.paused` flips synchronously inside play()/pause(), but the play/pause EVENTS that drive
  // the button's name are queued tasks (fired a tick later) — polling the name itself, not `.paused`,
  // is what avoids racing that gap. The name is aria-label when set (a supplied GSAP button), else the text.
  await page.waitForFunction(
    (source) => {
      const b = document.querySelector('button')
      return new RegExp(source, 'i').test((b?.getAttribute('aria-label') ?? b?.textContent ?? '').trim())
    },
    pattern.source,
    { timeout }
  )
}
function videoState(page) {
  return page.evaluate(() => {
    const v = document.querySelector('video')
    return v && { paused: v.paused, poster: v.getAttribute('poster'), preload: v.preload }
  })
}
function toggleState(page) {
  return page.evaluate(() => {
    const b = document.querySelector('button')
    if (!b) return null
    return {
      name: (b.getAttribute('aria-label') ?? b.textContent ?? '').trim(),
      pressed: b.getAttribute('aria-pressed'),
      visible: b.getClientRects().length > 0
    }
  })
}

/** Stubs `navigator.connection.saveData` — WebKit has no real Network Information API, so every
 *  engine needs this to exercise the Save-Data path at all. `Object.defineProperty` because
 *  Chromium's real `connection` is a getter-only accessor; a plain assignment silently no-ops. */
function saveDataInit() {
  Object.defineProperty(window.navigator, 'connection', {
    configurable: true,
    value: { saveData: true, addEventListener() {}, removeEventListener() {} }
  })
}

/** Makes every play() reject and counts calls, so the "no retry loop" half of the rejected-play
 *  check is a real assertion, not a guess from watching the video stay paused. */
function rejectPlayInit() {
  window.__playCalls = 0
  Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: function play() {
      window.__playCalls++
      return Promise.reject(new DOMException('rejected for test', 'NotAllowedError'))
    }
  })
}

// ── checks ──────────────────────────────────────────────────────────────
// Each takes a `t` bound to one browser + one engine page and returns [ok, detail].

const CHECKS = {
  async 'plays in view'(t) {
    const { page } = await t.open()
    await scrollToVideo(page)
    await waitPaused(page, false)
    const s = await videoState(page)
    return [s.paused === false, `paused=${s.paused}`]
  },

  async 'pauses off-screen'(t) {
    const { page } = await t.open()
    await scrollToVideo(page)
    await waitPaused(page, false)
    await scrollAway(page)
    await waitPaused(page, true)
    const s = await videoState(page)
    return [s.paused === true, `paused=${s.paused}`]
  },

  async 'the toggle pauses and stays paused through scroll-out/in'(t) {
    const { page } = await t.open()
    await scrollToVideo(page)
    await waitPaused(page, false)
    await page.click('button')
    await waitPaused(page, true)
    await scrollAway(page)
    await sleep(300)
    await scrollToVideo(page)
    await sleep(500) // a user pause must not be auto-resumed by IO re-entering
    const s = await videoState(page)
    return [s.paused === true, `paused=${s.paused} after scroll-out/in following a manual pause`]
  },

  async 'the toggle names its action (Pause while playing, Play while paused), no aria-pressed'(t) {
    const { page } = await t.open()
    await scrollToVideo(page)
    await waitToggleName(page, /pause/)
    const whilePlaying = await toggleState(page)
    await page.click('button')
    await waitToggleName(page, /play/)
    const afterPause = await toggleState(page)
    await page.click('button')
    await waitToggleName(page, /pause/)
    const afterResume = await toggleState(page)
    const states = [whilePlaying, afterPause, afterResume]
    return [
      /pause/i.test(whilePlaying?.name) && /play/i.test(afterPause?.name) && /pause/i.test(afterResume?.name) &&
        states.every((s) => s?.pressed === null),
      `name: playing="${whilePlaying?.name}" paused="${afterPause?.name}" resumed="${afterResume?.name}"; ` +
        `aria-pressed ${states.every((s) => s?.pressed === null) ? 'absent' : 'present'}`
    ]
  },

  async 'alt: the text alternative is in the accessibility tree, the video stays aria-hidden'(t) {
    const { page } = await t.open()
    const tree = await page.locator('body').ariaSnapshot()
    const probe = await page.evaluate(() => {
      const v = document.querySelector('video')
      const alt = [...document.querySelectorAll('span')].find((s) => s.textContent === 'A test pattern, looping')
      const box = alt?.getBoundingClientRect()
      return { videoHidden: v?.getAttribute('aria-hidden'), altBox: box ? Math.max(box.width, box.height) : null }
    })
    return [
      tree.includes('A test pattern, looping') && probe.videoHidden === 'true' && probe.altBox !== null && probe.altBox <= 1,
      `in tree=${tree.includes('A test pattern, looping')} video aria-hidden=${probe.videoHidden} alt box=${probe.altBox}px`
    ]
  },

  async 'reduced motion does not autoplay'(t) {
    const { page } = await t.open({ reducedMotion: 'reduce' })
    await scrollToVideo(page)
    await sleep(800)
    const s1 = await videoState(page)
    await page.click('button') // the control can still play it
    await waitPaused(page, false)
    const s2 = await videoState(page)
    return [s1.paused === true && s2.paused === false, `no autoplay: paused=${s1.paused}; after control click: paused=${s2.paused}`]
  },

  async 'saveData shows the poster'(t) {
    const { page } = await t.open({}, [saveDataInit])
    await scrollToVideo(page)
    await sleep(800)
    const s1 = await videoState(page)
    await page.click('button') // the control can still play it
    await waitPaused(page, false)
    const s2 = await videoState(page)
    return [
      s1.paused === true && s1.preload !== 'auto' && !!s1.poster && s2.paused === false,
      `saveData: paused=${s1.paused} preload=${s1.preload} poster=${!!s1.poster}; after control click: paused=${s2.paused}`
    ]
  },

  async 'a rejected play() shows the poster and the control, no retry loop'(t) {
    const { page } = await t.open({}, [rejectPlayInit])
    await scrollToVideo(page)
    await sleep(WATCHDOG_MS + 800) // span at least one watchdog tick
    const s = await videoState(page)
    const btn = await toggleState(page)
    const calls = await page.evaluate(() => window.__playCalls)
    return [
      s.paused === true && !!s.poster && !!btn?.visible && calls === 1,
      `paused=${s.paused} poster=${!!s.poster} controlVisible=${btn?.visible} play() calls=${calls}`
    ]
  }
}

// ── seam-wrap checks (task 21) ─────────────────────────────────────────
// The *-seam pages instrument a SEPARATE rVFC subscription and log
// ended/pause/play/seeking/seeked events (see gsap-seam-entry.ts /
// motion-seam-entry.tsx's __fx). Scrolling the video into view starts the
// intro; by SEAM_WINDOW_MS later it should have wrapped at least
// SEAM_MIN_SEAMS times.

async function seamLog(page, windowMs = SEAM_WINDOW_MS) {
  await page.evaluate(() => window.__fx?.reset())
  await scrollToVideo(page)
  await sleep(windowMs)
  return page.evaluate(() => ({
    fps: window.__fx.fps,
    duration: window.__fx.duration(),
    events: window.__fx.events(),
    frames: window.__fx.frames()
  }))
}

/** A wrap is any backward step in the presented frame index — forward playback never decreases it. */
function findSeams(log) {
  const idx = log.frames.map((f) => Math.round(f.mediaTime * log.fps))
  const seams = []
  for (let i = 1; i < idx.length; i++) {
    if (idx[i] < idx[i - 1]) seams.push({ before: idx[i - 1], after: idx[i] })
  }
  return seams
}

function analyzeSeamLog(log) {
  // The seam clip ends on a spare clone: the early wrap fires on the last content frame or on the clone, never earlier,
  // so no content frame is skipped. After it, the seam frame (+1 only when a callback was missed).
  const lastFrame = Math.round(log.duration * log.fps) - 1
  const lastContent = lastFrame - 1
  const seams = findSeams(log)
  const badEvents = log.events.filter((e) => e.type === 'ended' || e.type === 'pause')
  const beforeOk = seams.every((s) => s.before === lastContent || s.before === lastFrame)
  const afterOk = seams.every((s) => s.after >= SEAM_FROM_FRAME && s.after <= SEAM_FROM_FRAME + SEAM_FRAME_TOLERANCE)
  const enoughSeams = seams.length >= SEAM_MIN_SEAMS
  return {
    ok: enoughSeams && badEvents.length === 0 && beforeOk && afterOk,
    lastFrame,
    seams,
    badEvents,
    enoughSeams,
    beforeOk,
    afterOk
  }
}

function seamDetail(r) {
  const badList = r.badEvents.map((e) => e.type).join(',') || 'none'
  const seamList = r.seams.map((s) => `${s.before}→${s.after}`).join(', ') || 'none'
  return `seams=${r.seams.length} (want >=${SEAM_MIN_SEAMS}) expected before=${r.lastFrame - 1}|${r.lastFrame} (content|spare) after=${SEAM_FROM_FRAME}(+1) badEvents=[${badList}] transitions=[${seamList}]`
}

const SEAM_CHECKS = {
  async 'seam wrap on rVFC: no ended/pause, and frame-accurate, across 3+ seams'(t) {
    const { page } = await t.open()
    const log = await seamLog(page)
    const r = analyzeSeamLog(log)
    return [r.ok, seamDetail(r)]
  }
}

const CHECK_GROUPS = {
  motion: CHECKS,
  gsap: CHECKS,
  'motion-seam': SEAM_CHECKS,
  'gsap-seam': SEAM_CHECKS
}

// ── main ────────────────────────────────────────────────────────────────

const open = { server: null, browser: null }
async function shutdown() {
  await open.browser?.close().catch(() => {})
  open.browser = null
  if (open.server) {
    open.server.httpServer.closeAllConnections?.()
    await new Promise((resolve) => open.server.httpServer.close(() => resolve()))
    open.server = null
  }
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await shutdown()
    process.exit(130)
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const hasClip = await ensureClip()
  if (!hasClip) {
    console.log('[loop-video] ffmpeg unavailable and no cached clip at tests/.scratch/clip.mp4 — skipping')
    return 0
  }

  open.server = await serve()
  const base = `http://127.0.0.1:${open.server.httpServer.address().port}`

  let failures = 0
  const line = (ok, browser, engine, name, detail) => {
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${browser.padEnd(8)}  ${engine.padEnd(6)}  ${name}${detail ? `  (${detail})` : ''}`)
  }

  for (const browserName of args.browsers) {
    open.browser = await ENGINES_BY_BROWSER[browserName].launch()
    for (const engine of args.pages) {
      for (const [name, run] of Object.entries(CHECK_GROUPS[engine])) {
        const contexts = []
        const t = {
          async open(contextOptions = {}, initScripts = []) {
            const context = await open.browser.newContext({
              viewport: VIEWPORT,
              deviceScaleFactor: 1,
              reducedMotion: 'no-preference',
              ...contextOptions
            })
            contexts.push(context)
            for (const script of initScripts) await context.addInitScript(script)
            const page = await context.newPage()
            await page.goto(`${base}/${engine}.html`, { waitUntil: 'load' })
            return { page }
          }
        }
        try {
          const [ok, detail] = await run(t)
          line(ok, browserName, engine, name, detail)
        } catch (err) {
          line(false, browserName, engine, name, err.message.split('\n')[0])
        } finally {
          for (const context of contexts) await context.close().catch(() => {})
        }
      }
    }
    await open.browser.close()
    open.browser = null
  }

  return failures
}

let failures = 1
try {
  failures = await main()
} catch (err) {
  console.error(err)
} finally {
  await shutdown()
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall loop-video checks passed')
process.exit(failures ? 1 : 0)
