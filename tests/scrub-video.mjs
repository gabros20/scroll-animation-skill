#!/usr/bin/env node
// scrub-video.mjs — ScrubVideo's Save-Data tier, its WCAG 2.2.2 loop cap and its reduced-motion byte budget (none),
// in both engines (the logic lives in assets/media/video-controller.ts; the adapters size the frame from the tier).
// Builds tests/fixtures/scrub-video with Vite, serves the build with `vite preview`, prints one PASS/FAIL line per
// check/engine/browser, and exits 1 on any FAIL. Needs the Playwright browsers and (for a first run with no cached
// clip) ffmpeg, so it is its own script, like `test:loop-video` — not part of `npm test`.
//
// Video bytes are counted at the server, as written to the socket: range requests and aborted media fetches report
// unevenly through browser APIs. Every page carries its own run id in the video URLs, so one page's bytes never mix
// with another's.
//
//   node tests/scrub-video.mjs [--browsers chromium,webkit] [--engines motion,gsap] [--only saveData,reducedMotion,…]
//
// Save-Data is stubbed with an init script (an EventTarget as navigator.connection): WebKit has no Network
// Information API, and Chromium's real `connection` is a getter-only accessor.

import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { chromium, webkit } from 'playwright'
import { build, preview } from 'vite'

const execFileAsync = promisify(execFile)

const testsDir = dirname(fileURLToPath(import.meta.url))
const fixtureRoot = join(testsDir, 'fixtures', 'scrub-video')
const outDir = join(testsDir, '.scratch', 'scrub-video-dist')
const publicDir = join(testsDir, '.scratch', 'scrub-video-public')
const scratchClip = join(testsDir, '.scratch', 'clip.mp4')

const BROWSERS = { chromium, webkit }
const PAGES = ['motion', 'gsap']
const VIEWPORT = { width: 1440, height: 900 }
const FPS = 30
// The fixture's loops: head 0-4 (match 5), tail 55-58 (match 59, the clip's last frame).
const HEAD_HOLD_FRAME = 4
const TAIL_HOLD_FRAME = 55
const CYCLE_MS = (5 / FPS) * 1000
const BUDGET_MS = 5000
// rAF sampling, a late frame callback and the hold's own seek.
const SLACK_MS = 150
// Box widths at 1440x900: desktop frameSize 160 svh, mobile 60 svh.
const WIDTH = { desktop: 1440, mobile: 540 }

// ── args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { browsers: Object.keys(BROWSERS), pages: PAGES, only: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--browsers') out.browsers = argv[++i].split(',')
    else if (a === '--engines') out.pages = argv[++i].split(',')
    else if (a === '--only') out.only = argv[++i].split(',')
    else throw new Error(`unknown argument: ${a}`)
  }
  for (const b of out.browsers) if (!BROWSERS[b]) throw new Error(`unknown browser: ${b}`)
  for (const p of out.pages) if (!PAGES.includes(p)) throw new Error(`unknown engine: ${p} (${PAGES.join(', ')})`)
  return out
}

// ── the test clip ──────────────────────────────────────────────────────

/** Reuses `pretest`'s clip if it already ran; else makes the same one; else skips (ffmpeg missing). */
async function ensureClip() {
  const clip = join(publicDir, 'clip.mp4')
  if (existsSync(clip)) return true
  await mkdir(publicDir, { recursive: true })
  // Faststart, like every `media scrub` encode: with the index at the end, an engine fetches the tail to read it
  // (measured: Chromium on CI requested 229376- and 65536- after the first full request), which the byte checks
  // would read as a second download.
  const faststart = ['-movflags', '+faststart']
  try {
    if (existsSync(scratchClip)) await execFileAsync('ffmpeg', ['-y', '-i', scratchClip, '-c', 'copy', ...faststart, clip])
    else await execFileAsync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `testsrc=size=640x360:rate=${FPS}:duration=2`, '-g', '1', '-pix_fmt', 'yuv420p', ...faststart, clip])
    return true
  } catch {
    if (!existsSync(scratchClip)) return false
    await copyFile(scratchClip, clip)
    return true
  }
}

// ── build + serve ──────────────────────────────────────────────────────

function onwarn(warning, warn) {
  // The React blocks open with 'use client', meaningless outside a server-components bundler.
  if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
  if (warning.code === 'SOURCEMAP_ERROR' && /\.tsx? \(1:0\)/.test(warning.message)) return
  warn(warning)
}

/** Video bytes written per `${run}:${tier}`. */
const served = new Map()
// Every clip request per run: its Range header and the bytes served for it, so a check can tell the controller's own
// fetches from an engine's (WebKit on Linux plays through GStreamer, which requests the file again for itself).
const requested = new Map()

function countVideoBytes() {
  return {
    name: 'count-video-bytes',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, 'http://x')
        if (!url.pathname.endsWith('/clip.mp4')) return next()
        const key = `${url.searchParams.get('run')}:${url.searchParams.get('tier')}`
        const entry = { tier: url.searchParams.get('tier'), range: req.headers.range ?? null, bytes: 0 }
        const run = url.searchParams.get('run')
        requested.set(run, [...(requested.get(run) ?? []), entry])
        const add = (chunk) => {
          if (!chunk || typeof chunk === 'function') return
          served.set(key, (served.get(key) ?? 0) + Buffer.byteLength(chunk))
          entry.bytes += Buffer.byteLength(chunk)
        }
        const write = res.write.bind(res)
        const end = res.end.bind(res)
        res.write = (chunk, ...rest) => (add(chunk), write(chunk, ...rest))
        res.end = (chunk, ...rest) => (add(chunk), end(chunk, ...rest))
        next()
      })
    }
  }
}

async function serve() {
  await build({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'warn',
    publicDir,
    esbuild: { jsx: 'automatic' },
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: { input: Object.fromEntries(PAGES.map((p) => [p, join(fixtureRoot, `${p}.html`)])), onwarn }
    }
  })
  return preview({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'warn',
    plugins: [countVideoBytes()],
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0, strictPort: false }
  })
}

// ── in-page helpers ────────────────────────────────────────────────────

/** A stand-in NetworkInformation: `saveData` plus the `change` event the controller listens for. */
function connectionInit(saveData) {
  const connection = new EventTarget()
  connection.saveData = saveData
  Object.defineProperty(window.navigator, 'connection', { configurable: true, value: connection })
}

/** Installed before any page script, on every page. */
/** Counts what page code does to a video: `src` assignments and `load()` calls, the controller's own fetch decisions. */
function mediaCallsInit() {
  const calls = (window.__mediaCalls = { src: 0, load: 0 })
  const load = HTMLMediaElement.prototype.load
  HTMLMediaElement.prototype.load = function (...args) {
    calls.load++
    return load.apply(this, args)
  }
  const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')
  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    ...src,
    set(value) {
      calls.src++
      src.set.call(this, value)
    }
  })
}

function helpersInit(fps) {
  const root = () => document.querySelector('[data-scene-root]')
  const video = () => root()?.querySelector('video')
  // Media events don't bubble, but they do pass through the capture phase: every start of playback, from page start.
  const playing = []
  document.addEventListener('playing', (event) => event.target === video() && playing.push(performance.now()), true)
  const frames = (n) =>
    new Promise((resolve) => {
      let i = 0
      const step = () => (++i >= n ? resolve() : requestAnimationFrame(step))
      requestAnimationFrame(step)
    })
  window.__t = {
    ready: () => !!root()?.getAttribute('data-scene-state') && (video()?.readyState ?? 0) >= 2,
    /** The scene is up without any video data: its state is written and the controller has set the poster. */
    painted: () => !!root()?.getAttribute('data-scene-state') && !!video()?.getAttribute('poster'),
    still() {
      const v = video()
      return { mode: root().getAttribute('data-scene-state'), src: v.getAttribute('src'), readyState: v.readyState, paused: v.paused }
    },
    /** What the scene should show at the current scroll: the fixture's holds (12 / 320 px), band frames 5 to 55. */
    expected() {
      const r = root().getBoundingClientRect()
      const range = Math.max(1, r.height - innerHeight)
      const p = Math.min(1, Math.max(0, -r.top / range))
      const headExit = Math.min(12, range / 4) / range
      const tailEnter = 1 - Math.min(320, range / 4) / range
      const mode = p <= headExit ? 'head' : p >= tailEnter ? 'tail' : 'scrub'
      const band = Math.min(1, Math.max(0, (p - headExit) / (tailEnter - headExit)))
      return { p: Math.round(p * 1000) / 1000, mode, frame: Math.round((5 + band * 50) * 10) / 10 }
    },
    read() {
      const v = video()
      return {
        mode: root().getAttribute('data-scene-state'),
        paused: v.paused,
        frame: Math.round(v.currentTime * fps),
        src: new URL(v.currentSrc || v.src, location.href).searchParams.get('tier'),
        width: v.offsetWidth
      }
    },
    to(p) {
      const r = root().getBoundingClientRect()
      window.scrollTo({ top: r.top + scrollY + p * (r.height - innerHeight), behavior: 'instant' })
    },
    frames,
    /**
     * From the first start of playback at or after `since` to a hold: resolves once the video has stayed paused for
     * 20 frames after playing, with how long it ran and where it held (or with `timeout`).
     */
    watchHold(timeoutMs, since = 0) {
      return new Promise((resolve) => {
        const v = video()
        const t0 = performance.now()
        let playedAt = null
        let pausedAt = null
        let pausedFrames = 0
        const tick = (now) => {
          if (!v.paused) {
            playedAt ??= playing.find((at) => at >= since) ?? now
            pausedAt = null
            pausedFrames = 0
          } else if (playedAt !== null) {
            pausedAt ??= now
            if (++pausedFrames >= 20) {
              resolve({ ran: Math.round(pausedAt - playedAt), frame: Math.round(v.currentTime * fps), mode: root().getAttribute('data-scene-state') })
              return
            }
          }
          if (now - t0 > timeoutMs) {
            resolve({ timeout: true, played: playedAt !== null, frame: Math.round(v.currentTime * fps), paused: v.paused })
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
    }
  }
}

/** One download of the clip: WebKit adds a 2-byte range probe; a restarted download costs up to twice. */
let clipBytes = 0
const once = (n) => n >= clipBytes && n < clipBytes * 1.05

const withinBudget = (ran) => ran >= BUDGET_MS - SLACK_MS / 3 && ran <= BUDGET_MS + CYCLE_MS + SLACK_MS

// ── checks ──────────────────────────────────────────────────────────────
// Each takes a `t` bound to one browser + one engine page and returns [[name, ok, detail], ...].

const CHECKS = {
  async saveData(t) {
    const out = []
    {
      const { page, tiers } = await t.open([[connectionInit, true]])
      await page.waitForTimeout(600)
      const s = await page.evaluate(() => window.__t.read())
      out.push([
        'Save-Data: only the small tier is fetched, at a desktop width, and the frame takes its size',
        tiers.size === 1 && tiers.has('mobile') && s.src === 'mobile' && s.width === WIDTH.mobile,
        `fetched ${[...tiers].join(',')} · on screen ${s.src} · box ${s.width}px`
      ])
    }
    {
      const { page, tiers } = await t.open([[connectionInit, false]])
      await page.waitForTimeout(600)
      const s = await page.evaluate(() => window.__t.read())
      out.push([
        'no Save-Data: the desktop tier, as before',
        tiers.size === 1 && tiers.has('desktop') && s.src === 'desktop' && s.width === WIDTH.desktop,
        `fetched ${[...tiers].join(',')} · on screen ${s.src} · box ${s.width}px`
      ])
      await page.evaluate(() => {
        navigator.connection.saveData = true
        navigator.connection.dispatchEvent(new Event('change'))
      })
      await page.waitForFunction(() => window.__t.ready() && window.__t.read().src === 'mobile', null, { timeout: 5000 }).catch(() => {})
      const live = await page.evaluate(() => window.__t.read())
      out.push([
        'Save-Data turned on mid-visit: followed live on `change`',
        tiers.has('mobile') && live.src === 'mobile' && live.width === WIDTH.mobile,
        `fetched ${[...tiers].join(',')} · on screen ${live.src} · box ${live.width}px`
      ])
    }
    return out
  },

  async headLoop(t) {
    const { page } = await t.open()
    const first = await page.evaluate(() => window.__t.watchHold(9000))
    const out = [
      [
        `a head loop holds on its last frame after 5 s + at most one cycle (${Math.round(CYCLE_MS)} ms)`,
        !first.timeout && withinBudget(first.ran) && first.frame === HEAD_HOLD_FRAME && first.mode === 'head',
        JSON.stringify(first)
      ]
    ]
    // Leave for the band, come back: a new visit, a new 5 s.
    await page.evaluate(() => window.__t.to(0.4))
    await page.waitForFunction(() => window.__t.read().mode === 'scrub', null, { timeout: 3000 })
    await page.waitForTimeout(300)
    const again = await page.evaluate(() => {
      const since = performance.now()
      window.__t.to(0)
      return window.__t.watchHold(9000, since)
    })
    out.push([
      'leaving the head and coming back starts a new 5 s',
      !again.timeout && withinBudget(again.ran) && again.frame === HEAD_HOLD_FRAME,
      JSON.stringify(again)
    ])
    return out
  },

  async tailLoop(t) {
    const { page } = await t.open()
    const held = await page.evaluate(() => {
      const since = performance.now()
      window.__t.to(1)
      return window.__t.watchHold(9000, since)
    })
    // The band takes over from the held frame: p = 0.5 is frame 35.2 on this geometry (as in the parity traces).
    await page.evaluate(() => window.__t.to(0.5))
    await page.waitForTimeout(1200)
    const band = await page.evaluate(() => window.__t.read())
    return [
      [
        'a tail loop holds on its first frame after 5 s + at most one cycle',
        !held.timeout && withinBudget(held.ran) && held.frame === TAIL_HOLD_FRAME && held.mode === 'tail',
        JSON.stringify(held)
      ],
      [
        'the scrub takes over from the held frame',
        band.mode === 'scrub' && band.paused && Math.abs(band.frame - 35) <= 1,
        JSON.stringify(band)
      ]
    ]
  },

  async reducedMotion(t) {
    const { page, bytes } = await t.open([], { reducedMotion: 'reduce' })
    // Through the whole scene and past it: warm margin, wake, every rehydrate on the way.
    for (const p of [0, 0.25, 0.5, 0.75, 1, 1.4]) {
      await page.evaluate((at) => window.__t.to(at), p)
      await page.waitForTimeout(300)
    }
    await page.waitForTimeout(800)
    const still = await page.evaluate(() => window.__t.still())
    const none = bytes()
    const out = [
      [
        'reduced motion: no video bytes through the whole scene (the poster is the scene)',
        none.total === 0 && !still.src && still.readyState === 0 && still.mode === 'head',
        `${none.total} B · ${JSON.stringify(still)}`
      ]
    ]
    // Mid-scene, reduced motion lifts: the tier loads and the scene runs from where the reader is.
    await page.evaluate(() => window.__t.to(0.5))
    await page.waitForTimeout(300)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.waitForFunction(() => window.__t.ready(), null, { timeout: 10000 })
    await page.waitForTimeout(1200)
    const want = await page.evaluate(() => window.__t.expected())
    const got = await page.evaluate(() => window.__t.read())
    const loaded = bytes()
    const onFrame = want.mode !== 'scrub' || (got.paused && Math.abs(got.frame - want.frame) <= 1)
    out.push([
      'reduced motion lifted mid-visit: the tier loads and the scene runs from where the reader is',
      once(loaded.desktop) && loaded.mobile === 0 && got.src === 'desktop' && got.mode === want.mode && onFrame,
      `${loaded.desktop} B desktop, ${loaded.mobile} B mobile · want ${JSON.stringify(want)} · got ${JSON.stringify(got)}`
    ])
    return out
  },

  async reducedMotionOn(t) {
    const { page, bytes } = await t.open()
    await page.evaluate(() => window.__t.to(0.5))
    await page.waitForTimeout(600)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForTimeout(600)
    const still = await page.evaluate(() => window.__t.still())
    const at = bytes().total
    await page.evaluate(() => window.__t.to(1))
    await page.waitForTimeout(800)
    const later = bytes().total
    return [
      [
        'reduced motion turned on mid-visit: the source goes (its download stops) and the poster is the scene',
        !still.src && still.readyState === 0 && still.mode === 'head' && later === at,
        `${JSON.stringify(still)} · ${at} B at the switch, ${later} B after scrolling on`
      ]
    ]
  },

  async bytesWithMotion(t) {
    const { page, bytes, requests } = await t.open()
    for (const p of [0, 0.5, 1]) {
      await page.evaluate((at) => window.__t.to(at), p)
      await page.waitForTimeout(300)
    }
    const b = bytes()
    const calls = await page.evaluate(() => window.__mediaCalls)
    const reqs = requests()
    // The controller's share is one source and no load() (an extra load() restarted the first download: 1.76x the
    // clip in Chromium). WebKit on Linux plays through GStreamer, which requests the file again by itself, so there the
    // bytes can't be bounded by the page; everywhere else the engine fetches once.
    const engineRefetches = t.browser === 'webkit' && process.platform === 'linux'
    const ok =
      calls.src === 1 && calls.load === 0 && b.mobile === 0 && b.desktop >= clipBytes && (engineRefetches || once(b.desktop))
    const pattern = reqs.map((r) => `${r.range ?? 'no Range'}: ${r.bytes} B`).join(', ')
    return [
      [
        'with motion: the desktop tier, one source and no load() from the controller, fetched once where the engine allows',
        ok,
        `${b.desktop} B desktop, ${b.mobile} B mobile (clip ${clipBytes} B) in ${reqs.length} request(s) [${pattern}] · ` +
          `src set ${calls.src}x, load() ${calls.load}x${engineRefetches ? ' · GStreamer refetch allowed' : ''}`
      ]
    ]
  }
}

// ── run ─────────────────────────────────────────────────────────────────

const open = { browser: null, server: null }
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
  if (!(await ensureClip())) {
    console.log('[scrub-video] ffmpeg unavailable and no cached clip at tests/.scratch/clip.mp4: skipping')
    return 0
  }
  clipBytes = statSync(join(publicDir, 'clip.mp4')).size

  open.server = await serve()
  const base = `http://127.0.0.1:${open.server.httpServer.address().port}`

  let failures = 0
  let runs = 0
  const line = (ok, browser, engine, name, detail) => {
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${browser.padEnd(8)}  ${engine.padEnd(6)}  ${name}${detail ? `  (${detail})` : ''}`)
  }

  for (const browserName of args.browsers) {
    open.browser = await BROWSERS[browserName].launch()
    for (const engine of args.pages) {
      for (const [id, run] of Object.entries(CHECKS).filter(([id]) => !args.only || args.only.includes(id))) {
        const contexts = []
        const t = {
          browser: browserName,
          /**
           * A fresh context on this engine's page with its own run id, ready: video data in, or under reduced motion
           * the scene painted (state written, poster set). Returns the tiers requested and the video bytes served.
           */
          async open(initScripts = [], { reducedMotion = 'no-preference' } = {}) {
            const context = await open.browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion })
            contexts.push(context)
            for (const [script, arg] of initScripts) await context.addInitScript(script, arg)
            await context.addInitScript(mediaCallsInit)
            await context.addInitScript(helpersInit, FPS)
            const page = await context.newPage()
            const runId = `${browserName}-${engine}-${++runs}`
            const tiers = new Set()
            page.on('request', (request) => {
              const url = new URL(request.url())
              if (url.pathname.endsWith('/clip.mp4')) tiers.add(url.searchParams.get('tier'))
            })
            await page.goto(`${base}/${engine}.html?run=${runId}`, { waitUntil: 'load' })
            const ready = reducedMotion === 'reduce' ? () => window.__t.painted() : () => window.__t.ready()
            await page.waitForFunction(ready, null, { timeout: 20000 })
            const bytes = () => {
              const desktop = served.get(`${runId}:desktop`) ?? 0
              const mobile = served.get(`${runId}:mobile`) ?? 0
              return { desktop, mobile, total: desktop + mobile }
            }
            return { page, tiers, bytes, requests: () => requested.get(runId) ?? [] }
          }
        }
        try {
          for (const [name, ok, detail] of await run(t)) line(ok, browserName, engine, name, detail)
        } catch (err) {
          line(false, browserName, engine, id, err.message.split('\n')[0])
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
console.log(failures ? `\n${failures} check(s) failed` : '\nall scrub-video checks passed')
process.exit(failures ? 1 : 0)
