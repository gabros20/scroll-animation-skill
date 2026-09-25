#!/usr/bin/env node
// scene-traces.mjs — the scene-trace parity baseline for the scrubbed video
// scene, in both engines. It records what a reader can observe (the mode the
// scene reports, where the playhead sits, whether the decoder runs) along a
// fixed set of scroll paths, so a refactor of the scene can be proven to
// preserve it.
//
//   node tests/scene-traces.mjs --record   write tests/baselines/v1-scene-traces.json
//   node tests/scene-traces.mjs --check    trace afresh and compare with that file;
//                                          exit 1 on any unexplained difference
//
// Options: --engines gsap,react   --browsers chromium[,webkit]
//          --out <file>           also write the fresh traces (with --check)
//          --force                let --record replace an existing baseline
//
// The baseline holds Chromium and WebKit traces (recorded with --browsers
// chromium,webkit on macOS). `npm run test:traces` checks Chromium only, the
// one browser CI installs; add --browsers chromium,webkit to check both.
//
// Fixtures: the GSAP smoke page (tests/smoke-gsap) and its React mirror
// (tests/fixtures/scenes/react), both built with Vite and served with
// `vite preview` the way tests/run-smoke.mjs does it, both on the same test
// clip (2 s, 30 fps, all-intra) with the same loops.
//
// Paths, at 1440x900 and 390x844:
//   forward   progress 0 -> 1 in steps of 0.05, settling at each step
//   backward  1 -> 0 the same way, continuing on the same page
//   jump      from a settled progress 0 straight to 0.95 in one scroll; the
//             mode after 1 frame, after 5 frames, and settled
//   reload    settle at 0.5, reload, record the settled state
//   resize    settle at 0.5, resize 1440x900 -> 1280x720 in place (the 1440x900
//             run only), record the settled state
//
// Every scroll targets a PROGRESS of the range wrapper, never a raw pixel
// offset, and is instant: animation.css sets `scroll-behavior: smooth`, which
// would otherwise turn the one-call jump into a many-frame glide.
//
// The scene is found by the v1 attribute or its planned v2 rename, so the same
// baseline checks the refactored scene: [data-scrub-stage] | [data-scene-root]
// for the range, [data-motion-state] | [data-scene-state] for the mode.

import { build, preview } from 'vite'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const testsDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(testsDir, '..')
const scratch = join(testsDir, '.scratch', 'scene-traces')
const BASELINE = join(testsDir, 'baselines', 'v1-scene-traces.json')

const FPS = 30
const STEPS = Array.from({ length: 21 }, (_, i) => i / 20)
const VIEWPORTS = ['1440x900', '390x844']
const JUMP = { from: 0, to: 0.95, reads: [1, 5] }
const MID = 0.5
const RESIZE = { from: '1440x900', to: '1280x720' }

// A step is settled once it has run minFrames frames and nothing observable
// has changed for stableFrames: the mode, whether the decoder runs, and (while
// it is paused) the frame. minFrames outlasts the loops' play watchdog, which
// re-issues play() about 31 frames after a loop mode is entered on a paused
// decoder; settling any sooner would record that transient pause. For the same
// reason a loop mode on a paused decoder only counts as settled once the pause
// has outlasted that watchdog (loopPauseFrames): WebKit's tail loop now and
// then overruns its wrap, reaches the clip's end and pauses there until the
// watchdog restarts it. A playing loop's span is read over the last spanFrames
// samples only (200 ms, more than one head cycle), clear of the frame or two
// it shows before its first wrap.
const SETTLE = { minFrames: 45, stableFrames: 20, loopPauseFrames: 40, spanFrames: 12, maxFrames: 600 }

// Comparison tolerances. A playing loop is compared by the span of frames seen
// while it settled, since its playhead never holds still.
const FRAME_TOL = 2
const P_TOL = 0.01

const FIXTURES = {
  gsap: { root: join(testsDir, 'smoke-gsap') },
  react: { root: join(testsDir, 'fixtures', 'scenes', 'react'), vite: { esbuild: { jsx: 'automatic' } }, ssr: 'server.tsx' }
}

// Reviewed exceptions: the differences from the v1 baseline the current code
// is REQUIRED to show, each with the reason it changed. Every other difference
// fails the check, and so does an exception that no longer holds.
//
// The mode stepper used to advance at most one mode per progress event, so a
// jump from the head loop to p=0.95 parked in `scrub` (gliding to the tail's
// first frame, decoder paused) until the next scroll event. It now steps until
// stable, so the same jump lands in `tail` on the first event and the tail loop
// plays. Applies to every engine, browser and viewport.
const EXPECTED_DIFFS = [
  { case: 'jump', field: 'after1', was: 'scrub', now: 'tail' },
  { case: 'jump', field: 'after5', was: 'scrub', now: 'tail' },
  { case: 'jump', field: 'settled.mode', was: 'scrub', now: 'tail' },
  { case: 'jump', field: 'settled.paused', was: true, now: false },
  // The tail loop's frames: tailLoop.fromFrame (55) to the clip's last (59).
  { case: 'jump', field: 'settled.span', was: [55, 55], now: [55, 59] }
]

// ── args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { engines: Object.keys(FIXTURES), browsers: ['chromium'] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--record') out.mode = 'record'
    else if (a === '--check') out.mode = 'check'
    else if (a === '--force') out.force = true
    else if (a === '--engines') out.engines = argv[++i].split(',')
    else if (a === '--browsers') out.browsers = argv[++i].split(',')
    else if (a === '--out') out.out = argv[++i]
    else throw new Error(`unknown argument: ${a}`)
  }
  if (!out.mode) throw new Error('pass --record or --check')
  for (const e of out.engines) if (!FIXTURES[e]) throw new Error(`unknown engine: ${e}`)
  for (const b of out.browsers) if (!['chromium', 'webkit'].includes(b)) throw new Error(`unknown browser: ${b}`)
  return out
}

const size = (key) => {
  const [width, height] = key.split('x').map(Number)
  return { width, height }
}

// ── the clip ───────────────────────────────────────────────────────────

// The same clip `npm test`'s pretest makes (same ffmpeg arguments), generated
// here only when it is missing, so this script also runs on its own.
function ensureClip() {
  const clip = join(testsDir, '.scratch', 'clip.mp4')
  if (!existsSync(clip)) {
    mkdirSync(dirname(clip), { recursive: true })
    const args = ['-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=2', '-g', '1', '-pix_fmt', 'yuv420p', clip]
    const res = spawnSync('ffmpeg', args, { stdio: 'ignore' })
    if (res.status !== 0) {
      console.error('[scene-traces] tests/.scratch/clip.mp4 is missing and ffmpeg could not make it (run `npm run pretest`, or install ffmpeg)')
      process.exit(2)
    }
  }
  const publicDir = join(scratch, 'public')
  mkdirSync(publicDir, { recursive: true })
  copyFileSync(clip, join(publicDir, 'clip.mp4'))
  return publicDir
}

// ── build + serve ──────────────────────────────────────────────────────

function onwarn(warning, warn) {
  // ScrubStage.tsx and Motion open with 'use client', meaningless outside a
  // server-components bundler; Rollup also fails to map that warning through
  // esbuild's sourcemap and says so.
  if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
  if (warning.code === 'SOURCEMAP_ERROR' && /\.tsx? \(1:0\)/.test(warning.message)) return
  warn(warning)
}

async function serve(engine, publicDir) {
  const fixture = FIXTURES[engine]
  const outDir = join(scratch, `${engine}-dist`)
  const shared = { root: fixture.root, configFile: false, logLevel: 'warn', ...fixture.vite }
  await build({ ...shared, publicDir, build: { outDir, emptyOutDir: true, rollupOptions: { onwarn } } })

  // Server-render into the built page's #root (see the fixture's main.tsx).
  if (fixture.ssr) {
    const ssrDir = `${outDir}-ssr`
    await build({
      ...shared,
      publicDir: false,
      build: {
        ssr: join(fixture.root, fixture.ssr),
        outDir: ssrDir,
        emptyOutDir: true,
        rollupOptions: { onwarn, output: { entryFileNames: 'server.mjs' } }
      }
    })
    const { render } = await import(pathToFileURL(join(ssrDir, 'server.mjs')).href)
    const page = join(outDir, 'index.html')
    const html = readFileSync(page, 'utf8')
    if (!html.includes('<!--ssr-->')) throw new Error(`${relative(repoRoot, page)} has no <!--ssr--> placeholder`)
    writeFileSync(page, html.replace('<!--ssr-->', render()))
  }

  const server = await preview({
    root: fixture.root,
    configFile: false,
    logLevel: 'warn',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0, strictPort: false }
  })
  const addr = server.httpServer.address()
  return { server, url: `http://127.0.0.1:${addr.port}/index.html` }
}

// ── in-page helpers ────────────────────────────────────────────────────

// Installed before any page script runs, on every navigation (reload too).
function installSceneTrace({ fps }) {
  const STATE_ATTRS = ['data-scene-state', 'data-motion-state']
  const STATE_SEL = STATE_ATTRS.map((a) => `[${a}]`).join(', ')
  const ROOT_SEL = '[data-scene-root], [data-scrub-stage]'
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
  const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d

  const t = {
    root: () => document.querySelector(ROOT_SEL),
    stateEl() {
      const root = t.root()
      if (!root) return null
      return root.matches(STATE_SEL) ? root : root.querySelector(STATE_SEL)
    },
    mode() {
      const el = t.stateEl()
      if (!el) return null
      for (const a of STATE_ATTRS) if (el.hasAttribute(a)) return el.getAttribute(a)
      return null
    },
    video: () => t.root()?.querySelector('video') ?? null,
    ready() {
      const v = t.video()
      return t.mode() !== null && !!v && v.readyState >= 1
    },
    progress() {
      const rect = t.root().getBoundingClientRect()
      const total = rect.height - window.innerHeight
      if (total <= 0) return 0
      return Math.min(1, Math.max(0, -rect.top / total))
    },
    scrollToProgress(p) {
      const rect = t.root().getBoundingClientRect()
      const top = rect.top + window.scrollY + p * (rect.height - window.innerHeight)
      window.scrollTo({ top, behavior: 'instant' })
    },
    snapshot() {
      const v = t.video()
      return { mode: t.mode(), paused: v.paused, seeking: v.seeking, frame: Math.round(v.currentTime * fps), p: t.progress() }
    },
    async settle({ minFrames, stableFrames, loopPauseFrames, spanFrames, maxFrames }) {
      let last = null
      let run = []
      for (let n = 1; ; n++) {
        await nextFrame()
        const s = t.snapshot()
        const same =
          last !== null &&
          s.mode === last.mode &&
          s.paused === last.paused &&
          (!s.paused || (s.frame === last.frame && !s.seeking))
        run = same ? [...run, s.frame] : [s.frame]
        last = s
        const stable = run.length - 1
        const need = s.paused && s.mode !== 'scrub' ? loopPauseFrames : stableFrames
        if ((n >= minFrames && stable >= need) || n >= maxFrames) {
          const tail = run.slice(-spanFrames)
          return {
            p: round(s.p, 4),
            mode: s.mode,
            paused: s.paused,
            time: round(s.frame / fps, 4),
            span: [Math.min(...tail), Math.max(...tail)],
            ...(stable < need ? { unsettled: true } : {})
          }
        }
      }
    },
    // Scroll straight to `to` in one call and read the mode after the given
    // numbers of frames. "After N frames" is read at the start of frame N+1's
    // animation callbacks, so whatever frame N queued (a React commit, say)
    // has landed. `changes` logs every mode write as [frame, mode].
    async jump({ to, reads }) {
      let n = 0
      const changes = []
      const observer = new MutationObserver(() => changes.push([n, t.mode()]))
      observer.observe(t.stateEl(), { attributes: true, attributeFilter: STATE_ATTRS })
      const out = { before: t.mode() }
      t.scrollToProgress(to)
      for (let i = 1; i <= Math.max(...reads) + 1; i++) {
        await nextFrame()
        n = i
        if (reads.includes(i - 1)) out[`after${i - 1}`] = t.mode()
      }
      observer.disconnect()
      out.changes = changes
      return out
    }
  }
  Object.defineProperty(window, '__sceneTrace', { value: t })
}

// ── cases ──────────────────────────────────────────────────────────────

// A fresh context and page, loaded and settled at progress 0: where every case
// starts (JUMP.from included).
async function openScene(browser, url, viewport) {
  const context = await browser.newContext({ viewport: size(viewport), deviceScaleFactor: 1, reducedMotion: 'no-preference' })
  await context.addInitScript(installSceneTrace, { fps: FPS })
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'load' })
  await waitReady(page)
  await stepTo(page, 0)
  return { context, page }
}

async function waitReady(page) {
  try {
    await page.waitForFunction(() => window.__sceneTrace.ready(), null, { timeout: 20000, polling: 100 })
  } catch (err) {
    const why = await page.evaluate(() => {
      const t = window.__sceneTrace
      const v = t.video()
      return { mode: t.mode(), readyState: v?.readyState, error: v?.error?.code, h264: v?.canPlayType('video/mp4; codecs="avc1.42E01E"') }
    })
    throw new Error(`the scene never became ready (a mode attribute and video metadata): ${JSON.stringify(why)}`, { cause: err })
  }
}

const settle = (page) => page.evaluate((opts) => window.__sceneTrace.settle(opts), SETTLE)

async function stepTo(page, at) {
  await page.evaluate((p) => window.__sceneTrace.scrollToProgress(p), at)
  return { at, ...(await settle(page)) }
}

async function traceViewport(browser, url, viewport) {
  const out = {}

  {
    const { context, page } = await openScene(browser, url, viewport)
    out.forward = []
    for (const at of STEPS) out.forward.push(await stepTo(page, at))
    out.backward = []
    for (const at of [...STEPS].reverse()) out.backward.push(await stepTo(page, at))
    await context.close()
  }

  {
    const { context, page } = await openScene(browser, url, viewport)
    const reads = await page.evaluate((j) => window.__sceneTrace.jump(j), JUMP)
    const settled = await settle(page)
    out.jump = { from: JUMP.from, to: JUMP.to, before: reads.before, after1: reads.after1, after5: reads.after5, changes: reads.changes, settled }
    await context.close()
  }

  {
    const { context, page } = await openScene(browser, url, viewport)
    await stepTo(page, MID)
    await page.reload({ waitUntil: 'load' })
    await waitReady(page)
    out.reload = { at: MID, settled: await settle(page) }
    await context.close()
  }

  if (viewport === RESIZE.from) {
    const { context, page } = await openScene(browser, url, viewport)
    await stepTo(page, MID)
    await page.setViewportSize(size(RESIZE.to))
    out.resize = { at: MID, from: RESIZE.from, to: RESIZE.to, settled: await settle(page) }
    await context.close()
  }

  return out
}

async function traceAll(args) {
  const playwright = await import('playwright')
  const publicDir = ensureClip()
  const traces = {}
  const browsers = {}
  for (const engine of args.engines) {
    const { server, url } = await serve(engine, publicDir)
    try {
      traces[engine] = {}
      for (const name of args.browsers) {
        let browser
        try {
          browser = await playwright[name].launch()
        } catch (err) {
          console.error(`[scene-traces] cannot launch ${name} (npx playwright install ${name}): ${err.message.split('\n')[0]}`)
          process.exit(2)
        }
        browsers[name] = browser.version()
        try {
          traces[engine][name] = {}
          for (const viewport of VIEWPORTS) {
            const started = Date.now()
            traces[engine][name][viewport] = await traceViewport(browser, url, viewport)
            console.log(`[scene-traces] ${engine} ${name} ${viewport} traced in ${((Date.now() - started) / 1000).toFixed(1)}s`)
          }
        } finally {
          await browser.close()
        }
      }
    } finally {
      await new Promise((resolve) => server.httpServer.close(resolve))
    }
  }
  const { version } = createRequire(import.meta.url)('playwright/package.json')
  return {
    meta: { recorded: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, playwright: version, browsers },
    config: { fps: FPS, steps: STEPS.length, jump: JUMP, mid: MID, resize: RESIZE, settle: SETTLE, frameTol: FRAME_TOL, progressTol: P_TOL },
    traces
  }
}

// ── compare ────────────────────────────────────────────────────────────

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// One settled sample against its baseline. Returns [field, want, got] triples.
function compareSample(want, got) {
  const diffs = []
  if (Math.abs(want.p - got.p) > P_TOL) diffs.push(['p', want.p, got.p])
  if (want.mode !== got.mode) diffs.push(['mode', want.mode, got.mode])
  if (want.paused !== got.paused) diffs.push(['paused', want.paused, got.paused])
  else if (got.paused) {
    if (Math.abs(want.span[0] - got.span[0]) > FRAME_TOL) diffs.push(['time', want.time, got.time])
  } else if (got.span[0] < want.span[0] - FRAME_TOL || got.span[1] > want.span[1] + FRAME_TOL) {
    diffs.push(['span', want.span, got.span])
  }
  if (got.unsettled && !want.unsettled) diffs.push(['unsettled', false, true])
  return diffs
}

// Applies EXPECTED_DIFFS to a copy of one viewport's baseline, so the compare
// below holds the fresh run to the reviewed new values. An exception whose
// `was` no longer matches the baseline is reported instead of applied.
function expectedBaseline(base, where, stale) {
  const want = structuredClone(base)
  for (const e of EXPECTED_DIFFS) {
    const holder = want[e.case]
    if (!holder) continue
    const keys = e.field.split('.')
    const parent = keys.slice(0, -1).reduce((o, k) => o?.[k], holder)
    const key = keys.at(-1)
    if (!parent || !same(parent[key], e.was)) {
      stale.push(`${where} ${e.case}.${e.field}: exception expects the baseline to hold ${JSON.stringify(e.was)}, it holds ${JSON.stringify(parent?.[key])}`)
      continue
    }
    parent[key] = e.now
  }
  return want
}

function compareViewport(base, fresh, where, stale) {
  const want = expectedBaseline(base, where, stale)
  const diffs = []
  const push = (label, field, w, g) => {
    const exception = EXPECTED_DIFFS.find((e) => label.endsWith(e.case) && (e.field === field || e.field === `settled.${field}`))
    diffs.push({ where, label, field, want: w, got: g, exception: !!exception })
  }
  for (const dir of ['forward', 'backward']) {
    const w = want[dir] ?? []
    const g = fresh[dir] ?? []
    if (w.length !== g.length) push(dir, 'steps', w.length, g.length)
    for (let i = 0; i < Math.min(w.length, g.length); i++) {
      for (const [field, a, b] of compareSample(w[i], g[i])) push(`${dir} @${w[i].at.toFixed(2)}`, field, a, b)
    }
  }
  for (const c of ['jump', 'reload', 'resize']) {
    if (!want[c] && !fresh[c]) continue
    if (!want[c] || !fresh[c]) {
      push(c, 'case', !!want[c], !!fresh[c])
      continue
    }
    if (c === 'jump') {
      for (const field of ['after1', 'after5']) {
        if (want.jump[field] !== fresh.jump[field]) push('jump', field, want.jump[field], fresh.jump[field])
      }
    }
    for (const [field, a, b] of compareSample(want[c].settled, fresh[c].settled)) push(c, field, a, b)
  }
  return diffs
}

function check(baseline, fresh) {
  const diffs = []
  const stale = []
  const missing = []
  for (const [engine, byBrowser] of Object.entries(fresh.traces)) {
    for (const [browser, byViewport] of Object.entries(byBrowser)) {
      for (const [viewport, trace] of Object.entries(byViewport)) {
        const base = baseline.traces[engine]?.[browser]?.[viewport]
        const where = `${engine}/${browser}/${viewport}`
        if (!base) {
          missing.push(where)
          continue
        }
        diffs.push(...compareViewport(base, trace, where, stale))
      }
    }
  }
  return { diffs, stale, missing }
}

// ── report ─────────────────────────────────────────────────────────────

const LETTER = { head: 'H', scrub: 'S', tail: 'T' }
const letters = (steps) => steps.map((s) => LETTER[s.mode] ?? '?').join('')
const state = (s) => `${s.mode} ${s.paused ? 'paused' : 'playing'} ${s.paused ? `@${s.span[0]}` : `${s.span[0]}-${s.span[1]}`} p=${s.p}`

function summarise(result) {
  console.log('\nmodes per step (H head, S scrub, T tail; forward 0 -> 1, backward 1 -> 0, step 0.05)')
  for (const [engine, byBrowser] of Object.entries(result.traces)) {
    for (const [browser, byViewport] of Object.entries(byBrowser)) {
      for (const [viewport, t] of Object.entries(byViewport)) {
        console.log(`  ${`${engine} ${browser} ${viewport}`.padEnd(26)} forward ${letters(t.forward)}  backward ${letters(t.backward)}`)
        console.log(`  ${''.padEnd(26)} jump 0 -> ${t.jump.to}: after 1 frame ${t.jump.after1}, after 5 ${t.jump.after5}, settled ${state(t.jump.settled)}`)
        console.log(`  ${''.padEnd(26)} reload @${t.reload.at}: ${state(t.reload.settled)}`)
        if (t.resize) console.log(`  ${''.padEnd(26)} resize @${t.resize.at} ${t.resize.from} -> ${t.resize.to}: ${state(t.resize.settled)}`)
      }
    }
  }
}

// Stable, reviewable JSON: one line per step.
function format(value, indent = '') {
  const prim = (v) => v === null || typeof v !== 'object'
  const shallow = (v) => prim(v) || (Array.isArray(v) && v.every((x) => prim(x) || (Array.isArray(x) && x.every(prim))))
  const flat = Array.isArray(value) ? value.every(shallow) : Object.values(value).every(shallow)
  if (prim(value) || flat) return JSON.stringify(value)
  const inner = indent + '  '
  if (Array.isArray(value)) return `[\n${value.map((v) => inner + format(v, inner)).join(',\n')}\n${indent}]`
  return `{\n${Object.entries(value).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${format(v, inner)}`).join(',\n')}\n${indent}}`
}

// ── main ───────────────────────────────────────────────────────────────

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`[scene-traces] ${err.message}`)
    console.error('usage: node tests/scene-traces.mjs --record|--check [--engines gsap,react] [--browsers chromium,webkit] [--out file] [--force]')
    process.exit(2)
  }

  if (args.mode === 'record' && existsSync(BASELINE) && !args.force) {
    console.error(`[scene-traces] ${relative(repoRoot, BASELINE)} exists. It is the v1 record; a change in behaviour belongs in EXPECTED_DIFFS, not a re-record. Pass --force to replace it anyway.`)
    process.exit(2)
  }
  if (args.mode === 'check' && !existsSync(BASELINE)) {
    console.error(`[scene-traces] no baseline at ${relative(repoRoot, BASELINE)}; record one with --record`)
    process.exit(2)
  }

  const started = Date.now()
  const result = await traceAll(args)
  summarise(result)
  console.log(`\n[scene-traces] traced in ${((Date.now() - started) / 1000).toFixed(0)}s`)

  if (args.mode === 'record') {
    mkdirSync(dirname(BASELINE), { recursive: true })
    writeFileSync(BASELINE, `${format(result)}\n`)
    console.log(`[scene-traces] wrote ${relative(repoRoot, BASELINE)}`)
    return 0
  }

  if (args.out) writeFileSync(args.out, `${format(result)}\n`)
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
  const { diffs, stale, missing } = check(baseline, result)
  const unexpected = diffs.filter((d) => !d.exception)
  const regressed = diffs.filter((d) => d.exception)

  const unchecked = [...new Set(Object.values(baseline.traces).flatMap((b) => Object.keys(b)))].filter((b) => !args.browsers.includes(b))
  if (unchecked.length) console.log(`[scene-traces] the baseline also holds ${unchecked.join(', ')} traces, not checked this run (--browsers ${[...args.browsers, ...unchecked].join(',')})`)
  for (const where of missing) console.log(`MISSING  ${where}: no baseline for it`)
  for (const line of stale) console.log(`STALE    ${line}`)
  for (const d of regressed) {
    console.log(`EXPECTED ${d.where} ${d.label} ${d.field}: reviewed exception wants ${JSON.stringify(d.want)}, got ${JSON.stringify(d.got)}`)
  }
  for (const d of unexpected) {
    console.log(`DIFF     ${d.where} ${d.label} ${d.field}: baseline ${JSON.stringify(d.want)}, got ${JSON.stringify(d.got)}`)
  }
  const fail = diffs.length + stale.length + missing.length
  console.log(
    fail
      ? `\nscene traces FAIL: ${unexpected.length} unexpected difference(s), ${regressed.length} reviewed exception(s) not met, ${stale.length} stale exception(s), ${missing.length} run(s) without a baseline`
      : `\nscene traces PASS: matches ${relative(repoRoot, BASELINE)} (with ${EXPECTED_DIFFS.length} reviewed exceptions per jump case)`
  )
  return fail ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err)
    process.exit(2)
  })
