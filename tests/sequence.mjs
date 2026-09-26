#!/usr/bin/env node
// sequence.mjs — FrameSequence (assets/media/frame-sequence.ts and its React and GSAP adapters) in real browsers,
// Chromium and WebKit. Makes a 60-frame sequence with the CLI's own `media sequence` (a 960 px set and a 480 px
// mobile/ set) from an ffmpeg testsrc clip, builds tests/fixtures/sequence with Vite, serves the build with
// `vite preview`, prints one PASS/FAIL line per check and browser (INFO lines carry the measurements) and exits 1 on
// any FAIL. Without ffmpeg it prints SKIP and exits 0. Needs the Playwright browsers: `npm run test:sequence`.
//
//   node tests/sequence.mjs [--browsers chromium,webkit] [--only scrub,budget,…] [--fresh]
//
// Every page runs under an init script that keeps each bitmap the page receives (from createImageBitmap and from
// worker messages), so live decoded bytes are counted from OUTSIDE the core too: a closed ImageBitmap reports 0 × 0.
//
// Groups (800×450 unless noted):
//   scrub      ready draws frame 0 with the prefix in; data-frame lands on frameIndex(p) at p = 0/.25/.5/.75/1; frames
//              decode at the drawn size, in one worker; the canvas is painted; the whole sequence arrives while warm
//   retina     at 2× the backing store stops at the frames' own pixels (960×540, not 1600×900); dprCap 1 overrides
//   budget     a 6 MiB budget (4 frames): decoded + reserved bytes, and the live bitmaps counted outside, stay within
//              it over a wheel pass down and up, and the window evicts and closes as it moves
//   fallback   createImageBitmap ignoring the resize options: detected, full-size decodes, still scrubs, within budget;
//              a CSP that blocks the worker (csp.html): frames decode on the main thread and still scrub
//   offscreen  4 viewports down: nothing fetched or decoded; fetch without decode between the margins; decoded
//              memory released far past; destroy() before ready rejects `ready` with an AbortError
//   reduced    reduced motion: frame 0 by default (static, one fetch, one decode), -1 when asked; turning it off live
//              resumes the scrub; the React and GSAP adapters inherit the default
//   destroy    destroy() closes every bitmap (in-flight decodes on arrival) and stops fetching
//   variant    mobile: true picks mobile/ at 390×844 @1x (390 ≤ 480) and the 960 set at @2x (780 > 480)
//   list       a plain frame-URL list learns the frame size from the first decode
//   react      <FrameSequence> on useScroll: role/label, the five stops, an <Activity> hide destroys it, a show
//              rebuilds it, unmount closes everything
//   gsap       frameSequence() with its own trigger and with a polled getter: the five stops; reverting the
//              gsap.context destroys it and removes its ticker listener
//   scene      PinnedScene hands FrameSequence its band through the `pinned` render function: data-frame follows
//              the band, and after new holds plus a rehydrate (focus), with no scroll; reduced motion shows frame 0

import './unit/load-ts.mjs'

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, webkit } from 'playwright'
import { build, preview } from 'vite'

const testsDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(testsDir, '..')
const fixtures = join(testsDir, 'fixtures', 'sequence')
const scratch = join(testsDir, '.scratch', 'sequence')
const publicDir = join(scratch, 'public')
const outDir = join(scratch, 'dist')
const cli = join(repoRoot, 'skills', 'scroll-animation', 'bin', 'scroll-animation')
const { frameIndex, MIB } = await import('../skills/scroll-animation/assets/media/frame-sequence.ts')

const ENGINES = { chromium, webkit }
const PAGES = ['core', 'csp', 'react', 'gsap', 'scene']
const VIEWPORT = { width: 800, height: 450 }
const FRAMES = 60
const STOPS = [0, 0.25, 0.5, 0.75, 1]
const TRAVEL = 2360 // the range's scroll travel (tests/fixtures/sequence/src/page.css)

// ── args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { browsers: Object.keys(ENGINES), only: null, fresh: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--browsers') out.browsers = argv[++i].split(',')
    else if (a === '--only') out.only = argv[++i].split(',')
    else if (a === '--fresh') out.fresh = true
    else throw new Error(`unknown argument: ${a}`)
  }
  for (const b of out.browsers) if (!ENGINES[b]) throw new Error(`unknown browser: ${b}`)
  for (const g of out.only ?? []) if (!GROUPS[g]) throw new Error(`unknown group: ${g} (${Object.keys(GROUPS).join(', ')})`)
  return out
}

// ── media ───────────────────────────────────────────────────────────────

const hasFfmpeg = () => ['ffmpeg', 'ffprobe'].every((bin) => !spawnSync(bin, ['-version'], { stdio: 'ignore' }).error)

/** The fixture's frames, made by the CLI itself: every frame of a 2 s, 30 fps testsrc clip. */
function makeMedia(fresh) {
  const manifest = join(publicDir, 'seq', 'manifest.json')
  const mobile = join(publicDir, 'seq', 'mobile', 'manifest.json')
  const ok = (p) => existsSync(p) && JSON.parse(readFileSync(p, 'utf8')).count === FRAMES
  if (!fresh && ok(manifest) && ok(mobile)) return
  rmSync(join(publicDir, 'seq'), { recursive: true, force: true })
  mkdirSync(publicDir, { recursive: true }) // a fresh checkout (CI) has no scratch directory yet
  const clip = join(scratch, 'clip.mp4')
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=2', '-pix_fmt', 'yuv420p', clip])
  execFileSync(process.execPath, [cli, 'media', 'sequence', clip, '--out', join(publicDir, 'seq'), '--frames', String(FRAMES), '--width', '960', '--mobile-width', '480'], { stdio: 'inherit' })
}

// ── shared helpers ──────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const mib = (bytes) => `${(bytes / MIB).toFixed(2)} MiB`
const round = (n) => Math.round(n * 10) / 10

/** Runs in the page before any script: keeps every bitmap the page receives, from createImageBitmap on the main
 * thread and from worker messages (the core decodes in a worker). `ignoreResize` makes it behave like a browser
 * without the resize options: it drops them on the way in, so the bitmap comes back full size. */
function bitmapHarness(ignoreResize) {
  const made = []
  const keep = (bitmap) => {
    made.push(bitmap)
    return bitmap
  }
  const original = window.createImageBitmap.bind(window)
  window.createImageBitmap = (...args) => {
    if (ignoreResize && args.length === 2) args = [args[0]]
    return original(...args).then(keep)
  }
  const NativeWorker = window.Worker
  window.__workers = 0
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args)
      window.__workers++
      // registered before the page's own handler, so it sees each bitmap first
      this.addEventListener('message', (e) => e.data?.bitmap instanceof ImageBitmap && keep(e.data.bitmap))
    }
    postMessage(message, ...rest) {
      if (ignoreResize && message?.options) message = { ...message, options: undefined }
      return super.postMessage(message, ...rest)
    }
  }
  window.__bitmaps = {
    created: () => made.length,
    live: () => made.filter((b) => b.width > 0).length,
    liveBytes: () => made.reduce((n, b) => n + b.width * b.height * 4, 0),
  }
}

const stats = (page) => page.evaluate(() => window.__fx.stats())
const until = (page, fn, arg, timeout = 5000) => page.waitForFunction(fn, arg, { timeout, polling: 'raf' })

async function whenReady(page) {
  await until(page, () => window.__fx?.stats?.())
  const t0 = Date.now()
  const result = await page.evaluate(() => window.__fx.ready())
  return { result, ms: Date.now() - t0, at: await page.evaluate(() => performance.now()) }
}

/** Scrolls to progress `p` and waits (in the page, per frame) for data-frame to show frameIndex(progress). */
function jump(page, p) {
  return page.evaluate(async (p) => {
    const fx = window.__fx
    const t0 = performance.now()
    fx.scrollToProgress(p)
    const drawn = []
    let last = null
    while (performance.now() - t0 < 5000) {
      await new Promise(requestAnimationFrame)
      const s = fx.stats()
      const frame = fx.frame()
      if (frame !== last) drawn.push(frame)
      last = frame
      if (!s) continue
      const progress = fx.progress()
      // frameIndex's formula, restated so the page can wait on it; the runner checks it against the real one
      const want = progress >= 1 ? s.count - 1 : progress > 0 ? Math.round(progress * (s.count - 1)) : 0
      if (Math.abs(progress - p) < 1e-6 && frame === String(want)) return { ok: true, progress, want, frame, drawn, ms: performance.now() - t0 }
    }
    return { ok: false, progress: fx.progress(), frame: fx.frame(), drawn, stats: fx.stats() }
  }, p)
}

async function stops(t, page, label) {
  const results = []
  for (const p of STOPS) results.push({ p, ...(await jump(page, p)) })
  t.check(`${label}: data-frame lands on frameIndex(p) at p = ${STOPS.join(' / ')}`, () => [
    results.every((r) => r.ok && Number(r.frame) === frameIndex(r.progress, FRAMES)),
    results.map((r) => (r.ok ? `${r.p}→${r.frame} in ${round(r.ms)} ms` : `${r.p}: stuck at ${r.frame} (progress ${r.progress})`)).join(', '),
  ])
  return results
}

/** Scene page: scrolls the scene to progress `p` and waits for data-frame to show frameIndex(the scene's band). */
function followBand(page, p) {
  return page.evaluate(async (p) => {
    const fx = window.__fx
    const t0 = performance.now()
    if (p !== null) fx.scrollToProgress(p)
    while (performance.now() - t0 < 5000) {
      await new Promise(requestAnimationFrame)
      const s = fx.stats()
      const scene = fx.scene()
      if (!s || !scene || (p !== null && Math.abs(scene.p - p) > 1e-6)) continue
      // frameIndex's formula, restated so the page can wait on it; the runner checks it against the real one
      const want = scene.band >= 1 ? s.count - 1 : scene.band > 0 ? Math.round(scene.band * (s.count - 1)) : 0
      if (fx.frame() === String(want)) return { ok: true, ...scene, frame: fx.frame(), ms: performance.now() - t0 }
    }
    return { ok: false, ...fx.scene(), frame: fx.frame() }
  }, p)
}

async function wheelPass(page) {
  await page.mouse.move(400, 225)
  for (const delta of [100, -100]) {
    for (let i = 0; i < 30; i++) {
      await page.mouse.wheel(0, delta)
      await sleep(40)
    }
    await sleep(400)
  }
}

/** Waits for in-flight decodes to land (a destroyed sequence closes them on arrival). */
const settled = (page) => until(page, () => (window.__fx.stats()?.inflight.decode ?? 0) === 0 && true)

// ── groups ──────────────────────────────────────────────────────────────

const GROUPS = {
  async scrub(t) {
    const { page } = await t.open('core.html')
    const ready = await whenReady(page)
    const s = await stats(page)
    const alpha = await page.evaluate(() => window.__fx.alpha())
    const boot = await page.evaluate(() => window.__fx.boot())
    t.check('ready: frame 0 drawn, the prefix in memory', () => [
      ready.result === 'ready' && s.frame === 0 && s.fetched >= 12 && alpha === 255,
      `${ready.result} after ${ready.ms} ms (page time ${round(ready.at)} ms), frame ${s.frame}, ${s.fetched} fetched, centre alpha ${alpha}` +
        (s.frame === 0 ? '' : `; first progress read: ${JSON.stringify(boot)}`),
    ])
    t.check('frames decode at the drawn size, the backing store at CSS × dpr', () => [
      s.resize === 'yes' && s.decodeSize.width === 800 && s.decodeSize.height === 450 && s.canvas.width === 800 && s.canvas.height === 450,
      `resize ${s.resize}, decode ${s.decodeSize.width}×${s.decodeSize.height}, canvas ${s.canvas.width}×${s.canvas.height}`,
    ])
    const w = await page.evaluate(() => ({ workers: window.__workers, received: window.__bitmaps.created(), s: window.__fx.stats() }))
    t.check('frames decode in one worker, and arrive as its messages', () => [
      w.s.decoder === 'worker' && w.workers === 1 && w.received === w.s.decodes,
      `decoder ${w.s.decoder}, ${w.workers} worker(s), ${w.received} bitmaps received for ${w.s.decodes} decodes`,
    ])
    const jumps = await stops(t, page, 'core')
    await until(page, (n) => window.__fx.stats().fetched === n, FRAMES).catch(() => {})
    const end = await stats(page)
    t.check('the whole sequence arrives while the canvas is warm', () => [
      end.fetched === FRAMES && end.failed === 0,
      `${end.fetched}/${FRAMES} fetched (${mib(end.fetchedBytes)} compressed), ${end.failed} failed`,
    ])
    t.info(
      `ready ${ready.ms} ms · decode avg ${round(end.decodeMs.avg)} ms, max ${round(end.decodeMs.max)} ms over ${end.decodes} decodes · ` +
        `exact frame after a jump ${jumps.map((j) => round(j.ms ?? NaN)).join('/')} ms · peak ${mib(end.peakDecodedBytes)} of ${mib(end.budgetBytes)} ` +
        `(${end.capacity} frames at ${end.decodeSize.width}×${end.decodeSize.height})`,
    )
  },

  async retina(t) {
    // 800×450 CSS at 2× with 960×540 frames: the backing store stops at the frames' own pixels, not 1600×900
    const { page } = await t.open('core.html', { deviceScaleFactor: 2 })
    const ready = await whenReady(page)
    const s = await stats(page)
    t.check('a 2× screen never gets a canvas finer than its frames', () => [
      ready.result === 'ready' && s.canvas.width === 960 && s.canvas.height === 540 && s.decodeSize.width === 960 && s.decodeSize.height === 540,
      `${ready.result}, canvas ${s.canvas.width}×${s.canvas.height} for a 1600×900 device-px box, decode ${s.decodeSize.width}×${s.decodeSize.height}`,
    ])
    await stops(t, page, 'retina')
    const capped = await t.open('core.html?dprCap=1', { deviceScaleFactor: 2 })
    await whenReady(capped.page)
    const c = await stats(capped.page)
    t.check('dprCap overrides below that: dprCap 1 gives the CSS size', () => [
      c.canvas.width === 800 && c.canvas.height === 450 && c.decodeSize.width === 800 && c.decodeSize.height === 450,
      `canvas ${c.canvas.width}×${c.canvas.height}, decode ${c.decodeSize.width}×${c.decodeSize.height}`,
    ])
  },

  async budget(t) {
    const { page } = await t.open('core.html?budget=6')
    await whenReady(page)
    await page.evaluate(() => window.__fx.startSampling())
    await wheelPass(page)
    const peak = await page.evaluate(() => window.__fx.stopSampling())
    const s = await stats(page)
    const budget = 6 * MIB
    t.check('decoded + reserved bytes stay within the budget over a wheel pass', () => [
      s.budgetBytes === budget && s.capacity === 4 && peak.heldPlusReserved <= budget && s.peakDecodedBytes <= budget && peak.frames > 60,
      `peak ${mib(peak.heldPlusReserved)} (stats peak ${mib(s.peakDecodedBytes)}) of ${mib(s.budgetBytes)}, capacity ${s.capacity}, ${peak.frames} frames sampled`,
    ])
    t.check('live bitmaps counted outside the core stay within it too', () => [
      peak.live <= budget && peak.live > 0,
      `peak live ${mib(peak.live)}`,
    ])
    t.check('the window evicts and closes as it moves', () => [
      s.closed > 0 && s.decodes > s.capacity && s.decodes - s.closed === s.decoded,
      `${s.decodes} decodes, ${s.closed} closed, ${s.decoded} live`,
    ])
    const rest = await until(page, () => {
      const x = window.__fx.stats()
      return x.frame === x.target && x.frame === 0
    }).then(() => true, () => false)
    const atRest = await stats(page)
    t.check('at rest the exact frame lands', () => [rest, `frame ${atRest.frame}, target ${atRest.target}`])
  },

  async fallback(t) {
    const { page } = await t.open('core.html?budget=6', {}, { ignoreResize: true })
    await whenReady(page)
    const s = await stats(page)
    t.check('a browser that ignores the resize options is detected: full-size frames', () => [
      s.resize === 'no' && s.decodeSize.width === 960 && s.decodeSize.height === 540 && s.capacity === 3,
      `resize ${s.resize}, decode ${s.decodeSize.width}×${s.decodeSize.height}, capacity ${s.capacity}`,
    ])
    await stops(t, page, 'full-size')
    await page.evaluate(() => window.__fx.scrollToProgress(0))
    await page.evaluate(() => window.__fx.startSampling())
    await wheelPass(page)
    const peak = await page.evaluate(() => window.__fx.stopSampling())
    t.check('and stays within the budget', () => [
      peak.heldPlusReserved <= 6 * MIB && peak.live <= 6 * MIB,
      `peak ${mib(peak.heldPlusReserved)}, live ${mib(peak.live)} of ${mib(6 * MIB)}`,
    ])

    // A CSP without `worker-src blob:` blocks the decode worker: frames decode on the main thread instead.
    const csp = await t.open('csp.html')
    const cspReady = await whenReady(csp.page)
    const c = await stats(csp.page)
    t.check('a CSP that blocks the worker: decoded on the main thread instead', () => [
      cspReady.result === 'ready' && c.decoder === 'main' && c.frame === 0,
      `${cspReady.result} after ${cspReady.ms} ms, decoder ${c.decoder}, frame ${c.frame}`,
    ])
    await stops(t, csp.page, 'main thread')
  },

  async offscreen(t) {
    const { page } = await t.open('core.html?lead=4')
    await until(page, () => window.__fx?.stats?.())
    await sleep(1000)
    const idle = await stats(page)
    const attr = await page.evaluate(() => window.__fx.frame())
    t.check('4 viewports down: nothing fetched, decoded or drawn', () => [
      idle.state === 'idle' && idle.fetched === 0 && idle.decodes === 0 && attr === null && !idle.warm,
      `state ${idle.state}, ${idle.fetched} fetched, ${idle.decodes} decodes, data-frame ${attr}`,
    ])
    const vh = VIEWPORT.height
    await page.evaluate((y) => scrollTo(0, y), 2 * vh) // the canvas's top one viewport below the fold
    await until(page, () => window.__fx.stats().fetched > 0).catch(() => {})
    await sleep(500)
    const between = await stats(page)
    t.check('between the margins (1 viewport below): fetching, not decoding', () => [
      between.warm && !between.awake && between.fetched > 0 && between.decodes === 0,
      `warm ${between.warm}, awake ${between.awake}, ${between.fetched} fetched, ${between.decodes} decodes`,
    ])
    await page.evaluate((y) => scrollTo(0, y), 4 * vh)
    const drawn = await until(page, () => window.__fx.frame() === '0').then(() => true, () => false)
    const inView = await stats(page)
    t.check('in view: decoded and drawn', () => [drawn, `data-frame ${inView.frame}, ${inView.decodes} decodes`])
    const rangeBottom = 4 * vh + vh + TRAVEL
    await page.evaluate((y) => scrollTo(0, y), rangeBottom + 2.5 * vh)
    const released = await until(page, () => !window.__fx.stats().warm && window.__fx.stats().decodedBytes === 0).then(() => true, () => false)
    const far = await stats(page)
    t.check('far past: the decoded frames are released, the blobs kept', () => [
      released && far.fetched > 0,
      `warm ${far.warm}, ${far.decoded} bitmaps (${mib(far.decodedBytes)}), ${far.fetched} blobs, ${far.closed} closed`,
    ])

    const second = await t.open('core.html?lead=4')
    await until(second.page, () => window.__fx?.stats?.())
    const early = await second.page.evaluate(() => {
      const r = window.__fx.ready()
      window.__fx.destroy()
      return r
    })
    t.check('destroy() before ready rejects `ready` with an AbortError', () => [early.startsWith('rejected: AbortError'), early])
  },

  async reduced(t) {
    const { page } = await t.open('core.html', { reducedMotion: 'reduce' })
    const ready = await whenReady(page)
    const s = await stats(page)
    t.check('reduced motion: frame 0 by default (the head a pinned scene holds), one fetch, one decode', () => [
      ready.result === 'ready' && s.reduced && s.frame === 0 && s.fetched === 1 && s.decodes === 1,
      `${ready.result}, frame ${s.frame}, ${s.fetched} fetched, ${s.decodes} decodes`,
    ])
    await page.evaluate(() => window.__fx.scrollToProgress(0.5))
    await sleep(400)
    const still = await stats(page)
    t.check('scrolling does not scrub it', () => [
      still.frame === 0 && still.target === frameIndex(0.5, FRAMES) && still.fetched === 1,
      `frame ${still.frame} with target ${still.target}, ${still.fetched} fetched`,
    ])
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const resumed = await until(page, (want) => window.__fx.frame() === String(want), frameIndex(0.5, FRAMES)).then(() => true, () => false)
    const after = await stats(page)
    t.check('turning reduced motion off resumes the scrub, live', () => [
      resumed && !after.reduced && after.fetched > 1,
      `frame ${after.frame}, reduced ${after.reduced}, ${after.fetched} fetched`,
    ])

    const last = await t.open('core.html?still=-1', { reducedMotion: 'reduce' })
    await whenReady(last.page)
    const l = await stats(last.page)
    t.check('an explicit reducedMotionFrame still wins: -1 shows the last frame', () => [
      l.reduced && l.frame === FRAMES - 1 && l.fetched === 1,
      `frame ${l.frame}, ${l.fetched} fetched`,
    ])

    // The adapters pass the core's default through: frame 0.
    for (const path of ['react.html', 'gsap.html?mode=trigger']) {
      const adapter = await t.open(path, { reducedMotion: 'reduce' })
      const r = await whenReady(adapter.page)
      await adapter.page.evaluate(() => window.__fx.scrollToProgress(0.75))
      await sleep(400)
      const a = await stats(adapter.page)
      t.check(`${path.split(/[.?]/)[0]} adapter: frame 0 under reduced motion by default, scroll or not`, () => [
        r.result === 'ready' && a.reduced && a.frame === 0 && a.fetched === 1,
        `${r.result}, frame ${a.frame} with target ${a.target}, ${a.fetched} fetched`,
      ])
    }
  },

  async destroy(t) {
    const { page } = await t.open('core.html')
    await whenReady(page)
    await jump(page, 0.5)
    const requests = []
    page.on('request', (r) => r.url().includes('/seq/') && requests.push(r.url()))
    // mid-flight: jump, then destroy before the decodes land
    const inflight = await page.evaluate(() => {
      window.__fx.scrollToProgress(0.9)
      return new Promise((resolve) =>
        requestAnimationFrame(() => {
          const s = window.__fx.stats()
          window.__fx.destroy()
          resolve(s.inflight)
        }),
      )
    })
    const frameAtDestroy = await page.evaluate(() => window.__fx.frame())
    const requestsAtDestroy = requests.length
    await settled(page)
    await sleep(300)
    const s = await stats(page)
    const live = await page.evaluate(() => [window.__bitmaps.created(), window.__bitmaps.live()])
    t.check('destroy() closes every bitmap, including decodes in flight', () => [
      s.state === 'destroyed' && s.decoded === 0 && s.decodedBytes === 0 && s.decodes === s.closed && live[1] === 0 && live[0] === s.decodes,
      `${live[0]} created, ${live[1]} live after destroy (in flight at destroy: ${inflight.decode} decodes, ${inflight.fetch} fetches); stats ${s.decodes} decodes / ${s.closed} closed`,
    ])
    await page.evaluate(() => window.__fx.scrollToProgress(0.2))
    await sleep(500)
    const frameAfter = await page.evaluate(() => window.__fx.frame())
    t.check('and stops: no fetches, the canvas keeps its last frame', () => [
      requests.length === requestsAtDestroy && frameAfter === frameAtDestroy,
      `${requests.length - requestsAtDestroy} requests after destroy, data-frame ${frameAtDestroy} → ${frameAfter}`,
    ])
  },

  async variant(t) {
    const phone = { viewport: { width: 390, height: 844 } }
    for (const [dpr, want, decode] of [
      [1, '/seq/mobile/manifest.json', '480×270'],
      [2, '/seq/manifest.json', '960×540'],
    ]) {
      const { page } = await t.open('core.html?mobile=1', { ...phone, deviceScaleFactor: dpr })
      const frames = []
      page.on('request', (r) => /\.(webp|png|jpe?g|avif)$/.test(r.url()) && frames.push(new URL(r.url()).pathname))
      await whenReady(page)
      const s = await stats(page)
      const dir = dirname(want)
      t.check(`390×844 @${dpr}x (needs ${390 * dpr} px): ${dir}/`, () => [
        s.variant.endsWith(want) && frames.length > 0 && frames.every((f) => dirname(f) === dir) && `${s.decodeSize.width}×${s.decodeSize.height}` === decode,
        `variant ${s.variant.replace(/^https?:\/\/[^/]+/, '')}, ${frames.length} frames all from ${[...new Set(frames.map(dirname))].join(', ')}, ` +
          `decode ${s.decodeSize.width}×${s.decodeSize.height} on a ${s.canvas.width}×${s.canvas.height} canvas`,
      ])
    }
  },

  async list(t) {
    const { page } = await t.open('core.html?list=1')
    const ready = await whenReady(page)
    const s = await stats(page)
    t.check('a frame-URL list learns the frame size from its first decode', () => [
      ready.result === 'ready' && s.variant === 'list' && s.decodeSize.width === 800 && s.decodeSize.height === 450,
      `${ready.result}, variant ${s.variant}, decode ${s.decodeSize.width}×${s.decodeSize.height}`,
    ])
    await stops(t, page, 'list')

    // Frame 30 (p = .5) 404s: the canvas settles on a neighbour, and the core warns once.
    const broken = await t.open('core.html?list=1&missing=30', {}, { expectWarning: /frame 30 .* failed and is skipped/ })
    await whenReady(broken.page)
    await broken.page.evaluate(() => window.__fx.scrollToProgress(0.5))
    const settledOn = await until(broken.page, () => {
      const x = window.__fx.stats()
      return x.target === 30 && x.failed === 1 && (x.frame === 29 || x.frame === 31) && x.frame
    }).then((h) => h.jsonValue(), () => null)
    const b = await stats(broken.page)
    t.check('a frame that 404s is skipped: the canvas holds its nearest decoded neighbour, one warning', () => [
      settledOn !== null && b.failed === 1 && b.state === 'ready' && t.expectedWarnings.length === 1,
      `target ${b.target}, drawn ${b.frame}, ${b.failed} failed, state ${b.state}, warned: ${t.expectedWarnings[0] ?? 'nothing'}`,
    ])
  },

  async scene(t) {
    const { page } = await t.open('scene.html')
    const ready = await whenReady(page)
    const rows = []
    for (const p of [0, 0.3, 0.5, 0.7, 1]) rows.push({ at: p, ...(await followBand(page, p)) })
    t.check('PinnedScene pinned={({ band }) => <FrameSequence progress={band} />}: data-frame follows the band', () => [
      ready.result === 'ready' && rows.every((r) => r.ok && Number(r.frame) === frameIndex(r.band, FRAMES)),
      rows.map((r) => (r.ok ? `p ${r.at} band ${r.band.toFixed(3)}→${r.frame}` : `p ${r.at}: stuck at ${r.frame} (band ${r.band})`)).join(', '),
    ])

    // New holds move the band while scroll stays put: nothing may redraw until a rehydrate (here: focus) re-derives it.
    const before = await followBand(page, 0.5)
    await page.evaluate(() => window.__fx.setHolds({ headHoldPx: 500 }))
    await sleep(300)
    const idle = await page.evaluate(() => ({ frame: window.__fx.frame(), band: window.__fx.scene().band }))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    const after = await followBand(page, null)
    t.check('…and after a rehydrate: new holds, then focus, and the frame follows the new band with no scroll', () => [
      before.ok && idle.frame === before.frame && after.ok && after.band < before.band - 0.05 &&
        Number(after.frame) === frameIndex(after.band, FRAMES) && Math.abs(after.p - 0.5) < 1e-6,
      `band ${before.band.toFixed(3)} (frame ${before.frame}) → holds changed: frame ${idle.frame} → focus: band ` +
        `${after.band?.toFixed(3)} (frame ${after.frame}) at p ${after.p}`,
    ])

    const reduced = await t.open('scene.html', { reducedMotion: 'reduce' })
    const r = await whenReady(reduced.page)
    await reduced.page.evaluate(() => window.__fx.scrollToProgress(0.5))
    await sleep(400)
    const s = await stats(reduced.page)
    const scene = await reduced.page.evaluate(() => window.__fx.scene())
    t.check('reduced motion: the scene holds its head and the sequence shows frame 0 by default', () => [
      r.result === 'ready' && scene.reduced && scene.band === 0 && s.frame === 0 && s.fetched === 1,
      `${r.result}, scene band ${scene.band} (reduced ${scene.reduced}), frame ${s.frame}, ${s.fetched} fetched`,
    ])

    // Hand markup on usePinnedScene: the scene itself keeps data-scene-state on its root, per transition and after a
    // rehydrate. PinnedScene no longer renders the attribute, so its root reads the same writer.
    const hookStateAt = async (p) => {
      await page.evaluate((p) => {
        const el = document.getElementById('hook-range')
        const top = el.getBoundingClientRect().top + window.scrollY
        window.scrollTo(0, top + (el.offsetHeight - window.innerHeight) * p)
      }, p)
      await sleep(400)
      return page.evaluate(() => document.getElementById('hook-range').getAttribute('data-scene-state'))
    }
    const hookStates = []
    for (const p of [0, 0.5, 1]) hookStates.push(await hookStateAt(p))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await sleep(300)
    const hookAfter = await page.evaluate(() => document.getElementById('hook-range').getAttribute('data-scene-state'))
    const pinnedRoot = await page.evaluate(() => document.getElementById('range').getAttribute('data-scene-state'))
    t.check('usePinnedScene on hand markup writes data-scene-state: head > scrub > tail, and after a rehydrate', () => [
      hookStates.join(' > ') === 'head > scrub > tail' && hookAfter === 'tail' && pinnedRoot === 'tail',
      `${hookStates.join(' > ')} · after focus: ${hookAfter} · PinnedScene root (scrolled past): ${pinnedRoot}`,
    ])
  },

  async react(t) {
    const { page } = await t.open('react.html')
    const ready = await whenReady(page)
    const a11y = await page.evaluate(() => {
      const c = document.getElementById('seq')
      return { role: c.getAttribute('role'), label: c.getAttribute('aria-label'), display: getComputedStyle(c).display }
    })
    t.check('<FrameSequence>: a role="img" canvas with its label, filling its box', () => [
      ready.result === 'ready' && a11y.role === 'img' && a11y.label === 'Test pattern' && a11y.display === 'block',
      `${ready.result}, role ${a11y.role}, aria-label "${a11y.label}", display ${a11y.display}`,
    ])
    await stops(t, page, 'react (useScroll)')
    await jump(page, 0.5)
    const frameBefore = await page.evaluate(() => window.__fx.frame())
    await page.evaluate(() => window.__fx.hide(true))
    await sleep(300)
    const hidden = await page.evaluate(() => ({ live: window.__bitmaps.live(), first: window.__fx.handleStats(0), frame: window.__fx.frame() }))
    t.check('an <Activity> hide destroys it: every bitmap closed, the canvas keeps its frame', () => [
      hidden.first.state === 'destroyed' && hidden.live === 0 && hidden.frame === frameBefore,
      `state ${hidden.first.state}, ${hidden.live} live bitmaps, data-frame ${hidden.frame}`,
    ])
    await page.evaluate(() => window.__fx.hide(false))
    const shown = await jump(page, 0.75)
    const handles = await page.evaluate(() => window.__fx.handles())
    t.check('showing it again builds a new sequence that scrubs', () => [shown.ok && handles === 2, `${handles} handles, 0.75→${shown.frame}`])
    await page.evaluate(() => window.__fx.unmount())
    await sleep(300)
    const live = await page.evaluate(() => window.__bitmaps.live())
    t.check('unmount closes everything', () => [live === 0, `${live} live bitmaps`])
  },

  async gsap(t) {
    for (const mode of ['trigger', 'getter']) {
      const { page } = await t.open(`gsap.html?mode=${mode}`)
      const ready = await whenReady(page)
      t.check(`gsap (${mode}): ready`, () => [ready.result === 'ready', ready.result])
      await stops(t, page, `gsap (${mode})`)
      const before = await page.evaluate(() => ({ triggers: window.__fx.triggers(), ticker: window.__fx.tickerListeners() }))
      await page.evaluate(() => window.__fx.revert())
      await sleep(300)
      const after = await page.evaluate(() => ({
        s: window.__fx.stats(),
        live: window.__bitmaps.live(),
        triggers: window.__fx.triggers(),
        ticker: window.__fx.tickerListeners(),
      }))
      t.check(`gsap (${mode}): reverting the context destroys it and removes its listeners`, () => [
        after.s.state === 'destroyed' && after.live === 0 && after.triggers === 0 && after.ticker.now === after.ticker.before,
        `state ${after.s.state}, ${after.live} live bitmaps, triggers ${before.triggers}→${after.triggers}, ` +
          `ticker listeners ${before.ticker.now}→${after.ticker.now} (${after.ticker.before} before it)`,
      ])
    }
  },
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

function onwarn(warning, warn) {
  // Motion and the React blocks open with 'use client', meaningless outside a server-components bundler.
  if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
  if (warning.code === 'SOURCEMAP_ERROR' && /\.tsx? \(1:0\)/.test(warning.message)) return
  warn(warning)
}

async function serve() {
  await build({
    root: fixtures,
    configFile: false,
    logLevel: 'warn',
    publicDir,
    esbuild: { jsx: 'automatic' },
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      rollupOptions: { input: Object.fromEntries(PAGES.map((p) => [p, join(fixtures, `${p}.html`)])), onwarn },
    },
  })
  return preview({
    root: fixtures,
    configFile: false,
    logLevel: 'warn',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0, strictPort: false },
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!hasFfmpeg()) {
    console.log('SKIP  sequence: ffmpeg/ffprobe not on PATH (the fixture frames come from `media sequence`)')
    return 0
  }
  makeMedia(args.fresh)
  const groups = args.only ?? Object.keys(GROUPS)
  open.server = await serve()
  const base = `http://127.0.0.1:${open.server.httpServer.address().port}`

  let failures = 0
  const line = (ok, browser, group, name, detail) => {
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${browser.padEnd(8)}  ${group.padEnd(9)}  ${name}${detail ? `  (${detail})` : ''}`)
  }

  for (const name of args.browsers) {
    open.browser = await ENGINES[name].launch()
    for (const group of groups) {
      const contexts = []
      const errors = []
      const warnings = []
      const t = {
        expectedWarnings: [],
        async open(path, options = {}, { ignoreResize = false, expectWarning = null } = {}) {
          const context = await open.browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: 'no-preference', ...options })
          contexts.push(context)
          await context.addInitScript(bitmapHarness, ignoreResize)
          const page = await context.newPage()
          page.on('pageerror', (e) => errors.push(`${path}: ${e.message}`))
          page.on('console', (m) => {
            if (m.type() !== 'warning' || !m.text().includes('[scroll-animation]')) return
            if (expectWarning?.test(m.text())) t.expectedWarnings.push(m.text())
            else warnings.push(`${path}: ${m.text()}`)
          })
          await page.goto(`${base}/${path}`, { waitUntil: 'load' })
          return { page }
        },
        check(checkName, verdict) {
          let ok = false
          let detail
          try {
            ;[ok, detail] = verdict()
          } catch (err) {
            detail = err.message
          }
          line(ok, name, group, checkName, detail)
        },
        info(text) {
          console.log(`INFO  ${name.padEnd(8)}  ${group.padEnd(9)}  ${text}`)
        },
      }
      try {
        await GROUPS[group](t)
      } catch (err) {
        line(false, name, group, 'ran to completion', err.message.split('\n')[0])
      } finally {
        for (const context of contexts) await context.close().catch(() => {})
      }
      const problems = [...new Set([...errors, ...warnings])]
      line(problems.length === 0, name, group, 'no uncaught errors or frame-sequence warnings', problems.slice(0, 3).join(' | '))
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
console.log(failures ? `\n${failures} check(s) failed` : '\nall sequence checks passed')
process.exit(failures ? 1 : 0)
