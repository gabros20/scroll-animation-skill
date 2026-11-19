#!/usr/bin/env node
// scrub-video.mjs — ScrubVideo's Save-Data tier, its WCAG 2.2.2 loop cap, its reduced-motion byte budget (none) and,
// on a scene of holds (the fixture's `?holds`, Folio's orbit), how the band follows the scroll, in both engines (the
// logic lives in assets/media/video-controller.ts; the adapters size the frame from the tier).
// Builds tests/fixtures/scrub-video with Vite, serves the build with `vite preview`, prints one PASS/FAIL line per
// check/engine/browser, and exits 1 on any FAIL. Needs the Playwright browsers and (for a first run with no cached
// clip) ffmpeg, so it is its own script, like `test:loop-video` — not part of `npm test`.
//
// Video bytes are counted at the server, as written to the socket: range requests and aborted media fetches report
// unevenly through browser APIs. Every page carries its own run id in the video URLs, so one page's bytes never mix
// with another's.
//
//   node tests/scrub-video.mjs [--browsers chromium,webkit] [--engines motion,gsap] [--only saveData,holds,tracking,…]
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
const VIEWPORT_CENTRE = { x: 720, y: 450 }
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
  const holds = new URLSearchParams(location.search).has('holds')
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
    video,
    ready: () => !!root()?.getAttribute('data-scene-state') && (video()?.readyState ?? 0) >= 2,
    /** The scene is up without any video data: its state is written and the controller has set the poster. */
    painted: () =>
      !!root()?.getAttribute('data-scene-state') &&
      !!(root()?.querySelector('[data-scene-poster]')?.getAttribute('src') || video()?.getAttribute('poster')),
    still() {
      const v = video()
      return { mode: root().getAttribute('data-scene-state'), src: v.getAttribute('src'), readyState: v.readyState, paused: v.paused }
    },
    /** What the scene should show at the current scroll: with loops, the default holds (12 / 320 px) and band frames
     * 5 to 55; with `?holds`, 400 px holds and band frames 0 to 59. The mode is the absolute one (no hysteresis). */
    expected() {
      const r = root().getBoundingClientRect()
      const range = Math.max(1, r.height - innerHeight)
      const p = Math.min(1, Math.max(0, -r.top / range))
      const [headPx, tailPx, from, to] = holds ? [400, 400, 0, 59] : [12, 320, 5, 55]
      const headExit = Math.min(headPx, range / 4) / range
      const tailEnter = 1 - Math.min(tailPx, range / 4) / range
      const mode = p <= headExit ? 'head' : p >= tailEnter ? 'tail' : 'scrub'
      const band = Math.min(1, Math.max(0, (p - headExit) / (tailEnter - headExit)))
      return { p: Math.round(p * 1000) / 1000, mode, frame: Math.round((from + band * (to - from)) * 10) / 10 }
    },
    /** The frame on screen: the one whose span holds the playhead (a band seek lands a quarter frame into it). */
    shown: () => Math.floor(video().currentTime * fps + 1e-6),
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
    /** Scrolls to `p` in one step and counts the frames until the band's frame is on screen (null past 60). */
    framesTo(p) {
      return new Promise((resolve) => {
        const v = video()
        window.__t.to(p)
        let n = 0
        const step = () => {
          n++
          if (!v.seeking && Math.abs(window.__t.shown() - window.__t.expected().frame) <= 1) return resolve(n)
          if (n > 60) return resolve(null)
          requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      })
    },
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

/**
 * iOS in Low Power Mode, modelled strictly: play() is granted only when called synchronously inside a trusted
 * gesture event (a tap's touchend or click, a key), never from a timer, a promise or a pointerup; a refusal settles
 * late (100 ms here; on the device some never did), after the rest of the tap's events; a never-played video loads
 * metadata only (`readyState` held at 1); a play() or a load() inside the gesture unlocks the element (WebKit's
 * removeBehaviorRestrictionsAfterFirstUserGesture). Whether a later load() outside a gesture (iOS dropping a sleeping
 * clip's data) forgets the unlock, WebKit's source doesn't say it does: `loadForgets` runs both, and the block must
 * work either way. A touch that moved more than 10 px between touchstart and touchend was a pan, which is no gesture.
 * `stuck`: a refused play() leaves the element claiming to play, `paused` false with no frame, until a load() or an
 * honoured play (WebKit's playInternal unpauses before the media session admits the play, and an interrupted
 * session's pauseInternal returns early, so the page's own pause() can't undo it). Inferred from WebKit's source and
 * the iPhone readout after a refresh in view (no tap ever primed again); `paused` was not on that readout.
 * Takes `loadForgets` alone, or `{ loadForgets, stuck }`.
 */
function lowPowerInit(options) {
  const { loadForgets = false, stuck = false } = typeof options === 'object' && options ? options : { loadForgets: !!options }
  window.__plays = { refused: 0, allowed: 0, dropped: 0, calls: 0 }
  const unlocked = new WeakSet()
  // A short lock (WebKit, read in its source; see references/video.md): the data stays, seeks land, currentTime and
  // frame callbacks follow them, and the layer on screen keeps the frame it had until the element plays (a `playing`
  // event) or reloads. Page code can't see it; only the reveal sampler reads it, through `__layer`.
  const stale = new WeakMap()
  window.__layer = (el) => (stale.has(el) ? stale.get(el) : null)
  document.addEventListener('playing', (event) => stale.delete(event.target), true)
  // The lock's media interruption ending after the wake: a play() issued before it ends is dropped, never settling
  // and never playing. `interruption` is 'frame' (it ends one animation frame after the return) or 'first' (the
  // first play() after the return is dropped, whenever it comes).
  let interrupted = null
  let touchFrom = null
  window.addEventListener('touchstart', (e) => (touchFrom = e.touches[0] ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null), true)
  const panned = (e) => {
    const t = e.changedTouches?.[0]
    return !!touchFrom && !!t && Math.hypot(t.clientX - touchFrom.x, t.clientY - touchFrom.y) > 10
  }
  const gesture = () => {
    const e = window.event
    return !!e && e.isTrusted && ((e.type === 'touchend' && !panned(e)) || e.type === 'click' || e.type === 'keydown')
  }
  const claims = new WeakSet()
  const pausedDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'paused')
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get() {
      return claims.has(this) ? false : pausedDesc.get.call(this)
    }
  })
  const ready = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState')
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
    configurable: true,
    get() {
      const r = ready.get.call(this)
      return unlocked.has(this) ? r : Math.min(r, 1)
    }
  })
  const play = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...args) {
    window.__plays.calls++
    if (interrupted) {
      window.__plays.dropped++
      if (interrupted === 'first') interrupted = null
      return new Promise(() => {})
    }
    if (!unlocked.has(this) && !gesture()) {
      window.__plays.refused++
      if (stuck) claims.add(this)
      return new Promise((resolve, reject) => setTimeout(() => reject(new DOMException('refused', 'NotAllowedError')), 100))
    }
    window.__plays.allowed++
    unlocked.add(this)
    claims.delete(this)
    return play.apply(this, args)
  }
  // Nothing is presented before the unlock (desktop engines decode a first frame unasked; iOS doesn't): frame callbacks
  // wait for it.
  const rvfc = HTMLVideoElement.prototype.requestVideoFrameCallback
  if (rvfc) {
    HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
      const el = this
      const wrapped = (now, meta) => (unlocked.has(el) ? callback(now, meta) : rvfc.call(el, wrapped))
      return rvfc.call(this, wrapped)
    }
  }
  const load = HTMLMediaElement.prototype.load
  HTMLMediaElement.prototype.load = function (...args) {
    stale.delete(this)
    claims.delete(this)
    if (gesture()) unlocked.add(this)
    else if (loadForgets) unlocked.delete(this)
    return load.apply(this, args)
  }

  // Lock and wake (the phone locked with the page open): the page goes hidden, iOS pauses the video, may drop its
  // data (`evict`, a load() outside any gesture, which forgets the unlock when `loadForgets`) and may leave a seek
  // pending across the lock (`hang`: the element reports `seeking` until a new seek or play is issued). Wake shows the
  // page again, with a bfcache-style pageshow.
  let hidden = false
  let hung = null
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => hidden })
  const seekingDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'seeking')
  Object.defineProperty(HTMLMediaElement.prototype, 'seeking', {
    configurable: true,
    get() {
      return hung === this || seekingDesc.get.call(this)
    }
  })
  const time = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
    configurable: true,
    get() {
      return time.get.call(this)
    },
    set(value) {
      if (hung === this) hung = null
      time.set.call(this, value)
    }
  })
  const playGate = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...args) {
    if (hung === this) hung = null
    return playGate.apply(this, args)
  }
  // `staleLayer`: the short lock, data kept and the layer frozen on the frame showing; `forget` drops the unlock too.
  let interruption = null
  window.__lock = ({ evict = true, hang = false, staleLayer = false, forget = false, interrupt = null } = {}) => {
    const v = document.querySelector('[data-scene-root] video')
    hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    v.pause()
    if (evict) load.call(v)
    if (evict && loadForgets) unlocked.delete(v)
    if (forget) unlocked.delete(v)
    if (staleLayer) stale.set(v, Math.floor(v.currentTime * 30 + 1e-6))
    if (hang) hung = v
    interruption = interrupt
  }
  window.__wake = () => {
    interrupted = interruption
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    if (interrupted === 'frame') requestAnimationFrame(() => (interrupted = null))
  }
}

/**
 * Samples every animation frame from now: the poster's opacity, the video's last presented frame (its frame
 * callbacks) and the band's frame. `window.__reveal.stop()` returns the rows.
 */
function startRevealSampler(fps) {
  const root = document.querySelector('[data-scene-root]')
  const video = root.querySelector('video')
  const poster = root.querySelector('[data-scene-poster]')
  const rows = []
  const presented = []
  let last = null
  let on = true
  const onFrame = (_now, meta) => {
    last = Math.floor(meta.mediaTime * fps + 1e-6)
    presented.push(last)
    if (on) video.requestVideoFrameCallback(onFrame)
  }
  video.requestVideoFrameCallback(onFrame)
  const step = () => {
    if (!on) return
    // The frame on screen: the last presented one where frame callbacks fire for a paused seek, else the settled
    // playhead (readyState goes through the model's gate).
    const settled = video.readyState >= 2 && !video.seeking ? Math.floor(video.currentTime * fps + 1e-6) : null
    // A frozen layer (the Low Power model's short lock) shows its old frame whatever the element reports.
    const frozen = window.__layer?.(video) ?? null
    rows.push({ poster: Number(getComputedStyle(poster).opacity), presented: frozen ?? (presented.length ? last : settled), want: Math.round(window.__t.expected().frame), media: video.getAttribute('data-scene-media') })
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
  window.__reveal = {
    stop() {
      on = false
      return { rows, presented }
    }
  }
}

/** One Low Power run (see lowPowerInit), with a later load() forgetting the unlock or keeping it. */
async function lowPowerRun(t, loadForgets) {
  // No frame until a gesture's play, so the page is ready once the scene is painted, not once video data is in.
  const { page } = await t.open([[lowPowerInit, loadForgets]], { holds: true, painted: true })
  const modes = []
  for (const p of [0, 0.5, 1]) {
    await page.evaluate((at) => window.__t.to(at), p)
    await page.waitForTimeout(400)
    modes.push(await page.evaluate(() => window.__t.read().mode))
  }
  const readyState = () => page.evaluate(() => window.__t.video().readyState)
  const settle = () => page.waitForFunction(() => window.__t.video().readyState >= 2, null, { timeout: 4000 }).catch(() => {})
  const before = await readyState()
  await page.evaluate(() => window.__t.to(0.5))
  await page.mouse.click(VIEWPORT_CENTRE.x, VIEWPORT_CENTRE.y)
  await settle()
  await page.waitForTimeout(500)
  const after = await page.evaluate(() => ({ ...window.__t.read(), shown: window.__t.shown(), want: window.__t.expected(), readyState: window.__t.video().readyState }))
  // The clip's data dropped (as iOS does to a sleeping clip). If the unlock survived, it recovers on its own; if not,
  // the poster covers again and the next click unlocks it.
  await page.evaluate(() => window.__t.video().load())
  await page.waitForTimeout(800)
  const dropped = await readyState()
  if (!loadForgets) await settle()
  const recovered = await readyState()
  if (loadForgets) {
    await page.mouse.click(VIEWPORT_CENTRE.x, VIEWPORT_CENTRE.y)
    await settle()
  }
  const again = await readyState()
  const plays = await page.evaluate(() => window.__plays)
  return [
    [
      `Low Power Mode (load() ${loadForgets ? 'forgets' : 'keeps'} the unlock): the scene runs on the poster with play() refused, and a click unlocks the clip where the reader is`,
      modes.join() === 'head,scrub,tail' && before <= 1 && after.readyState >= 2 && after.mode === 'scrub' && Math.abs(after.shown - after.want.frame) <= 1,
      `modes ${modes.join(' > ')} · readyState ${before} before the click · after ${JSON.stringify(after)} · plays ${JSON.stringify(plays)}`
    ],
    [
      `Low Power Mode (load() ${loadForgets ? 'forgets' : 'keeps'} the unlock): a clip whose data was dropped is primed again, and the next click unlocks it if it has to`,
      loadForgets ? dropped <= 1 && again >= 2 : recovered >= 2,
      `readyState ${dropped} after the drop, ${recovered} with no click, ${again} at the end · plays ${JSON.stringify(plays)}`
    ]
  ]
}

const CHECKS = {
  // Found on the device pass (iPhone, Low Power Mode): every prime refused, taps included (`primes 3 refused 3`). A tap
  // fires pointerup before the click that carries the gesture, and a listener spent on the pointerup missed it; and a
  // clip that lost its data was never primed again. The scene runs on the poster, a click unlocks the clip where the
  // reader is, and after the clip's data is dropped the next click unlocks it again.
  async lowPower(t) {
    const out = []
    for (const loadForgets of [false, true]) out.push(...(await lowPowerRun(t, loadForgets)))
    return out
  },

  // Found on the device pass (iPhone, Low Power Mode): lock the phone, wake it, and scrolling no longer moved the frame.
  // Modelled with the clip's data dropped and a seek left pending across the lock, the unlock surviving or not: the
  // scene recovers by itself when it survives, on the next tap when it doesn't, with no uncovered frame off the band.
  async lockWake(t) {
    const out = []
    for (const loadForgets of [false, true]) {
      const { page } = await t.open([[lowPowerInit, loadForgets]], { holds: true, painted: true })
      await page.evaluate(() => window.__t.to(0.5))
      await page.waitForTimeout(400)
      await page.mouse.click(VIEWPORT_CENTRE.x, VIEWPORT_CENTRE.y)
      await page.waitForFunction(() => window.__t.video().getAttribute('data-scene-media') === 'live', null, { timeout: 5000 }).catch(() => {})
      const before = await page.evaluate(() => window.__t.video().getAttribute('data-scene-media'))
      await page.waitForTimeout(400) // the first reveal's fade is over
      await page.evaluate(startRevealSampler, FPS)
      await page.evaluate(() => window.__lock({ evict: true, hang: true }))
      await page.waitForTimeout(500)
      await page.evaluate(() => window.__wake())
      await page.waitForTimeout(1500)
      const woke = await page.evaluate(() => ({ media: window.__t.video().getAttribute('data-scene-media'), readyState: window.__t.video().readyState }))
      if (loadForgets) {
        await page.mouse.click(VIEWPORT_CENTRE.x, VIEWPORT_CENTRE.y)
        await page.waitForTimeout(1500)
      }
      // Before scrolling on: past this, the playhead trails a moving band by a seek, which is the scrub, not a flash.
      const { rows } = await page.evaluate(() => window.__reveal.stop())
      // Scrolling moves the frame again.
      await page.evaluate(() => window.__t.to(0.7))
      await page.waitForTimeout(800)
      const moved = await page.evaluate(() => ({ ...window.__t.read(), shown: window.__t.shown(), want: window.__t.expected(), media: window.__t.video().getAttribute('data-scene-media') }))
      const wrong = rows.filter((r) => r.poster < 0.999 && (r.presented === null || Math.abs(r.presented - r.want) > 1))
      out.push([
        `lock and wake (data dropped, a seek left pending; the unlock ${loadForgets ? 'lost' : 'kept'}): the scene ${loadForgets ? 'reads blocked, then recovers on the next tap' : 'recovers by itself'}, never uncovering a wrong frame`,
        before === 'live' &&
          (loadForgets ? woke.media === 'blocked' : woke.media === 'live' && woke.readyState >= 2) &&
          moved.media === 'live' &&
          Math.abs(moved.shown - moved.want.frame) <= 1 &&
          wrong.length === 0,
        `before ${before} · after wake ${JSON.stringify(woke)} · after scrolling ${JSON.stringify(moved)} · ${wrong.length} wrong ${JSON.stringify(wrong.slice(0, 3))}`
      ])
      await page.context().close()
    }
    return out
  },

  // Found on the device pass (iPhone, Low Power Mode, after 0f6fe7c): a 1-2 s lock, and scrolling no longer moved the
  // picture while the readout said healthy (readyState 4, currentTime following the scroll, frame callbacks firing).
  // WebKit leaves the layer stale until the element plays, and a play() issued while the lock's interruption is still
  // ending is dropped. Modelled with the data kept, the layer frozen and that interruption: the scene kicks behind
  // the poster on the return, never uncovers the frozen frame, scrolls on with no play(), and with the unlock lost
  // reads blocked until the next tap.
  async staleLayer(t) {
    const out = []
    const cases = [
      { interrupt: 'frame', forget: false, says: 'the interruption ends a frame after the return: one kick' },
      { interrupt: 'first', forget: false, says: 'the first play after the return is dropped: the retry recovers' },
      { interrupt: null, forget: true, says: 'the unlock lost: blocked, then the next tap' }
    ]
    for (const c of cases) {
      const { page } = await t.open([[lowPowerInit, false]], { holds: true, painted: true })
      await page.evaluate(() => window.__t.to(0.5))
      await page.waitForTimeout(400)
      await page.mouse.click(VIEWPORT_CENTRE.x, VIEWPORT_CENTRE.y)
      await page.waitForFunction(() => window.__t.video().getAttribute('data-scene-media') === 'live', null, { timeout: 5000 }).catch(() => {})
      const before = await page.evaluate(() => window.__t.video().getAttribute('data-scene-media'))
      await page.waitForTimeout(400) // the first reveal's fade is over
      await page.evaluate(startRevealSampler, FPS)
      await page.evaluate(({ interrupt, forget }) => window.__lock({ evict: false, staleLayer: true, interrupt, forget }), c)
      await page.waitForTimeout(1200)
      await page.evaluate(() => window.__wake())
      await page.evaluate(() => window.__t.to(0.56))
      await page.waitForTimeout(1500)
      const woke = await page.evaluate(() => window.__t.video().getAttribute('data-scene-media'))
      if (c.forget) {
        await page.mouse.click(VIEWPORT_CENTRE.x, VIEWPORT_CENTRE.y)
        await page.waitForTimeout(1500)
      }
      // Before scrolling on: past this, the picture trails a moving band by a seek, which is the scrub, not a flash.
      const { rows } = await page.evaluate(() => window.__reveal.stop())
      const end = rows[rows.length - 1]
      const wrong = rows.filter((r) => r.poster < 0.999 && (r.presented === null || Math.abs(r.presented - r.want) > 1))
      // Then a scrub: seeks only, and the picture on screen follows it.
      const calls = await page.evaluate(() => window.__plays.calls)
      for (const p of [0.6, 0.64, 0.68, 0.72]) {
        await page.evaluate((at) => window.__t.to(at), p)
        await page.waitForTimeout(250)
      }
      await page.waitForTimeout(400)
      const after = await page.evaluate(() => {
        const v = window.__t.video()
        return { calls: window.__plays.calls, plays: { ...window.__plays }, layer: window.__layer(v) ?? window.__t.shown(), want: Math.round(window.__t.expected().frame), media: v.getAttribute('data-scene-media') }
      })
      out.push([
        `a short lock, the layer stale until a play (${c.says}): ${c.forget ? 'blocked until the tap' : 'the kick recovers it behind the poster'}, no frozen frame uncovered, no play() mid-scrub`,
        before === 'live' &&
          (c.forget ? woke === 'blocked' : woke === 'live') &&
          end.media === 'live' &&
          end.poster === 0 &&
          Math.abs(end.presented - end.want) <= 1 &&
          wrong.length === 0 &&
          after.calls === calls &&
          after.media === 'live' &&
          Math.abs(after.layer - after.want) <= 1,
        `before ${before} · after wake ${woke} · end ${JSON.stringify(end)} · ${wrong.length} wrong ${JSON.stringify(wrong.slice(0, 3))} · scrubbed on: layer ${after.layer} want ${after.want} ${after.media}, play() mid-scrub ${after.calls - calls} · plays ${JSON.stringify(after.plays)}`
      ])
      await page.context().close()
    }
    return out
  },

  // Refreshed in view under Low Power Mode: the first refused prime reads blocked at once (the tap hint's hook).
  async refreshInView(t) {
    const { page } = await t.open([[lowPowerInit, false]], { holds: true, painted: true })
    await page.evaluate(() => window.__t.to(0.5))
    await page.waitForTimeout(400)
    await page.reload({ waitUntil: 'load' })
    const t0 = Date.now()
    // Playwright's WebKit doesn't always restore the scroll on reload: put the reader back where they were.
    await page.evaluate(() => scrollY < 10 && window.__t.to(0.5))
    const ok = await page
      .waitForFunction(() => window.__t.video()?.getAttribute('data-scene-media') === 'blocked', null, { timeout: 3000 })
      .then(() => true, () => false)
    const ms = Date.now() - t0
    const state = await page.evaluate(() => ({ y: Math.round(scrollY), want: window.__t.expected(), plays: { ...window.__plays } }))
    return [
      [
        'refreshed in view under Low Power Mode: blocked on the first refusal, within 1.5 s of load',
        ok && ms <= 1500 && state.want.mode === 'scrub',
        `${ok ? `blocked after ${ms} ms` : 'never blocked'} · ${JSON.stringify(state)}`
      ]
    ]
  },

  // Found on the device pass (iPhone, Low Power Mode, after 351f08a): refreshed with the scene in view, the scene ran
  // on its poster and no tap unlocked it (`primes 2 refused 2`, `unlocked -`, `loads 0`: no tap ever reached the
  // retry). Modelled as WebKit can leave it (`stuck`: the refused element reads `paused` false) and as the plain
  // refusal, with a touch tap that fires no click (WebKit on a non-clickable target): the tap unlocks the scene where
  // the reader is, behind the poster, and the scrub follows with no play().
  async refreshTap(t) {
    const out = []
    for (const stuck of [false, true]) {
      const { page } = await t.open([[lowPowerInit, { loadForgets: false, stuck }]], { holds: true, painted: true, touch: true })
      await page.evaluate(() => window.__t.to(0.5))
      await page.waitForTimeout(400)
      await page.reload({ waitUntil: 'load' })
      // Playwright's WebKit doesn't always restore the scroll on reload: put the reader back where they were.
      await page.evaluate(() => scrollY < 10 && window.__t.to(0.5))
      await page.waitForFunction(() => window.__t.video()?.getAttribute('data-scene-media') === 'blocked', null, { timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(400)
      const before = await page.evaluate(() => ({ media: window.__t.video().getAttribute('data-scene-media'), paused: window.__t.video().paused, readyState: window.__t.video().readyState }))
      await page.evaluate(startRevealSampler, FPS)
      await page.touchscreen.tap(VIEWPORT_CENTRE.x, VIEWPORT_CENTRE.y)
      await page.waitForFunction(() => window.__t.video().getAttribute('data-scene-media') === 'live', null, { timeout: 4000 }).catch(() => {})
      await page.waitForTimeout(400)
      const { rows } = await page.evaluate(() => window.__reveal.stop())
      const end = rows[rows.length - 1]
      const wrong = rows.filter((r) => r.poster < 0.999 && (r.presented === null || Math.abs(r.presented - r.want) > 1))
      const calls = await page.evaluate(() => window.__plays.calls)
      for (const p of [0.55, 0.6, 0.65]) {
        await page.evaluate((at) => window.__t.to(at), p)
        await page.waitForTimeout(250)
      }
      await page.waitForTimeout(400)
      const after = await page.evaluate(() => ({ calls: window.__plays.calls, plays: { ...window.__plays }, loads: window.__mediaCalls.load, shown: window.__t.shown(), want: Math.round(window.__t.expected().frame), media: window.__t.video().getAttribute('data-scene-media') }))
      out.push([
        `refreshed in view under Low Power Mode${stuck ? ', the refused element claiming to play' : ''}: a touch tap unlocks it where the reader is, behind the poster, and the scrub follows with no play()`,
        before.media === 'blocked' &&
          end.media === 'live' &&
          end.poster === 0 &&
          Math.abs(end.presented - end.want) <= 1 &&
          wrong.length === 0 &&
          after.calls === calls &&
          after.media === 'live' &&
          Math.abs(after.shown - after.want) <= 1,
        `before ${JSON.stringify(before)} · end ${JSON.stringify(end)} · ${wrong.length} wrong ${JSON.stringify(wrong.slice(0, 3))} · scrubbed on: shown ${after.shown} want ${after.want} ${after.media}, play() mid-scrub ${after.calls - calls}, load() ${after.loads} · plays ${JSON.stringify(after.plays)}`
      ])
      await page.context().close()
    }
    return out
  },

  // The tap's reveal: the poster stays over the video until it presents the band's frame, so a reader never sees a
  // blank or frame 0 between them, whatever the clip decodes first.
  async flashFree(t) {
    const { page } = await t.open([[lowPowerInit, false]], { holds: true, painted: true })
    await page.evaluate(() => window.__t.to(0.5))
    await page.waitForTimeout(600)
    await page.evaluate(startRevealSampler, FPS)
    await page.mouse.click(VIEWPORT_CENTRE.x, VIEWPORT_CENTRE.y)
    await page.waitForTimeout(1500)
    const { rows, presented } = await page.evaluate(() => window.__reveal.stop())
    const uncovered = rows.filter((r) => r.poster < 0.999)
    const wrong = uncovered.filter((r) => r.presented === null || Math.abs(r.presented - r.want) > 1)
    const end = rows[rows.length - 1]
    return [
      [
        'the reveal: the poster covers until the video presents the band frame, never a blank or frame 0 in between',
        uncovered.length > 0 && wrong.length === 0 && end.poster === 0 && end.media === 'live',
        `${rows.length} frames, ${uncovered.length} uncovered, ${wrong.length} wrong ${JSON.stringify(wrong.slice(0, 3))} · presented ${[...new Set(presented)].join(',')} · end ${JSON.stringify(end)}`
      ]
    ]
  },

  // A tap anywhere before the scene runs (here: with the scene asleep, after its load-time prime was refused) unlocks
  // it through load() inside the gesture, so it plays when the reader arrives with no second tap.
  async earlierTap(t) {
    const { page } = await t.open([[lowPowerInit, false]], { holds: true, painted: true })
    await page.waitForTimeout(400)
    const blocked = await page.evaluate(() => window.__t.video().getAttribute('data-scene-media'))
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
    await page.waitForTimeout(800)
    await page.mouse.click(VIEWPORT_CENTRE.x, VIEWPORT_CENTRE.y)
    await page.waitForTimeout(300)
    await page.evaluate(() => window.__t.to(0.5))
    await page.waitForFunction(() => window.__t.video().readyState >= 2, null, { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(600)
    const after = await page.evaluate(() => ({ ...window.__t.read(), readyState: window.__t.video().readyState, media: window.__t.video().getAttribute('data-scene-media'), plays: { ...window.__plays } }))
    return [
      [
        'a tap away from the scene, before it runs, unlocks it: it plays on arrival with no second tap',
        blocked === 'blocked' && after.readyState >= 2 && after.media === 'live',
        `before: data-scene-media=${blocked} · on arrival ${JSON.stringify(after)}`
      ]
    ]
  },

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

  // Found on the device pass 2 (iPhone, Folio's orbit, holds): scrolling back up, the rotation started 280 px late and
  // then spun to catch up; the glide rested half a frame short of the last frame.
  async holds(t) {
    const { page } = await t.open([], { holds: true })
    await page.evaluate(() => window.__t.to(1))
    await page.waitForTimeout(800)
    const rest = await page.evaluate(() => ({ ...window.__t.read(), shown: window.__t.shown() }))
    // Back up into the tail's hysteresis gap: the band has left its end, and the scene still reads `tail`.
    await page.evaluate(() => window.__t.to(0.7))
    await page.waitForTimeout(500)
    const want = await page.evaluate(() => window.__t.expected())
    const back = await page.evaluate(() => ({ ...window.__t.read(), shown: window.__t.shown() }))
    return [
      ['holds: the tail rests on the clip last frame', rest.mode === 'tail' && rest.shown === 59, JSON.stringify(rest)],
      [
        "holds: on the way back the playhead leaves the tail with the band, not after the mode's hysteresis",
        back.mode === 'tail' && back.paused && Math.abs(back.shown - want.frame) <= 1,
        `want ${JSON.stringify(want)} · got ${JSON.stringify(back)}`
      ]
    ]
  },

  // The band tracks the scroll frame for frame: the smoothing is the scroll's (Lenis, native momentum). The glide it
  // replaced took about 16 frames to bring this step within a frame, and trailed a fast skim by an eighth of the clip.
  async tracking(t) {
    const { page } = await t.open([], { holds: true })
    await page.evaluate(() => window.__t.to(0.35))
    await page.waitForTimeout(800)
    const frames = await page.evaluate(() => window.__t.framesTo(0.6))
    const got = await page.evaluate(() => ({ ...window.__t.read(), shown: window.__t.shown(), want: window.__t.expected() }))
    return [
      [
        'a step in the band is on screen within 6 frames (one seek), and on its frame',
        frames !== null && frames <= 6 && got.mode === 'scrub',
        `${frames} frame(s) · ${JSON.stringify(got)}`
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
           * (or with `painted`) the scene painted (state written, poster set); `holds` opens the scene of holds. Returns the tiers
           * requested and the video bytes served.
           */
          async open(initScripts = [], { reducedMotion = 'no-preference', holds = false, painted = false, touch = false } = {}) {
            const context = await open.browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion, hasTouch: touch })
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
            await page.goto(`${base}/${engine}.html?run=${runId}${holds ? '&holds' : ''}`, { waitUntil: 'load' })
            const ready = reducedMotion === 'reduce' || painted ? () => window.__t.painted() : () => window.__t.ready()
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
