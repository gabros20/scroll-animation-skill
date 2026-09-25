#!/usr/bin/env node
// loop-video.mjs — LoopVideo v2 (assets/motion/LoopVideo.tsx, assets/gsap/loop-video.ts) in real
// browsers: IO-gated play/pause, the WCAG 2.2.2 pause control (sticky user-pause, aria-pressed),
// live reduced motion, live Save-Data, and a rejected play() with no retry loop. Builds
// tests/fixtures/loop-video with Vite, serves the build with `vite preview`, prints one PASS/FAIL
// line per check/engine/browser, and exits 1 on any FAIL. Needs the Playwright browsers and
// (for a first run with no cached clip) ffmpeg, so this is its own script, the way
// `test:foundation` and `test:smoke` are — not part of `npm test`.
//
//   node tests/loop-video.mjs [--browsers chromium,webkit] [--engines motion,gsap]

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

const ENGINES_BY_BROWSER = { chromium, webkit }
const PAGES = ['motion', 'gsap']
const VIEWPORT = { width: 800, height: 600 }
// Must be >= the source files' own WATCHDOG_INTERVAL_MS, so the rejected-play
// check spans at least one watchdog tick and can prove it did NOT retry.
const WATCHDOG_MS = 2000

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
async function waitAriaPressed(page, pressed, timeout = 3000) {
  // `video.paused` flips synchronously inside play()/pause(), but the play/pause EVENTS that drive
  // aria-pressed are queued tasks (fired a tick later) — polling the attribute itself, not `.paused`,
  // is what avoids racing that gap.
  await page.waitForFunction((want) => document.querySelector('button')?.getAttribute('aria-pressed') === want, pressed, { timeout })
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
    return { pressed: b.getAttribute('aria-pressed'), visible: b.getClientRects().length > 0 }
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

  async 'aria-pressed flips'(t) {
    const { page } = await t.open()
    await scrollToVideo(page)
    await waitAriaPressed(page, 'true')
    const whilePlaying = await toggleState(page)
    await page.click('button')
    await waitAriaPressed(page, 'false')
    const afterPause = await toggleState(page)
    await page.click('button')
    await waitAriaPressed(page, 'true')
    const afterResume = await toggleState(page)
    return [
      whilePlaying?.pressed === 'true' && afterPause?.pressed === 'false' && afterResume?.pressed === 'true',
      `aria-pressed: playing=${whilePlaying?.pressed} paused=${afterPause?.pressed} resumed=${afterResume?.pressed}`
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
      for (const [name, run] of Object.entries(CHECKS)) {
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
