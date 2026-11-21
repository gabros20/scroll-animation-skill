#!/usr/bin/env node
// hero.mjs: the busy hero (tests/fixtures/hero): a load entrance publishing the entrance signal (entrance-signal.ts),
// a stub live canvas that waits on it, a nav with backdrop-filter and a loop strip held until the entrance settles.
// One page per publisher: css (css/split.css + trackEntrance), motion (Reveal `entrance`), gsap and agnostic
// (reveal()/mountReveals() with `{ entrance: true }`). Builds with Vite, serves with `vite preview`, prints one
// PASS/FAIL line per check/page/browser and exits 1 on any FAIL.
//
//   node tests/hero.mjs [--browsers chromium,webkit,firefox] [--pages css,motion,gsap,agnostic] [--only entrance,…]
//
// Groups (each in fresh browser contexts; every page and browser ends with a check for uncaught page errors):
//   entrance  the phases arrive in order (pending in the HTML, then running, tail, settled), each event after its
//             attribute; settled only once the entrance has landed; while it plays the group carries
//             data-reveal-playing and its moving items take will-change: transform; after settled no marker and no
//             will-change anywhere; the stub scene prepares before the entrance, reveals at tail or later and runs at
//             settled, never on its timeout; the strip is held until settled; the blurred nav never moves
//   late      the stub scene arrives mid-entrance: it prepares only once settled
//   reduced   reduced motion: settled at once, nothing else published, the strip runs from the start
//   failsafe  the engine boots after the failsafe fired: settled at once (the reveal pages; css has no failsafe; the
//             Motion page renders on the client, with no item for it to fire on, so it sets the latch itself)

import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium, firefox, webkit } from 'playwright'
import { build, preview } from 'vite'

import { frames, isFaviconMiss, launch, until } from './lib/harness.mjs'

const testsDir = dirname(fileURLToPath(import.meta.url))
const fixtureRoot = join(testsDir, 'fixtures', 'hero')
const outDir = join(testsDir, '.scratch', 'hero-dist')
const assets = join(testsDir, '..', 'skills', 'scroll-animation', 'assets')
const { GATE_SCRIPT, MOTION } = await import(pathToFileURL(join(assets, 'config.ts')).href)
const { splitWordsHTML } = await import(pathToFileURL(join(assets, 'split-words.ts')).href)
const { HEADLINE, ITEMS, markup } = await import(pathToFileURL(join(fixtureRoot, 'src', 'page.ts')).href)

const BROWSERS = { chromium, webkit, firefox }
const PAGES = ['css', 'motion', 'gsap', 'agnostic']
const REVEAL_PAGES = ['motion', 'gsap', 'agnostic']
const VIEWPORT = { width: 1000, height: 700 }
const ORDER = ['pending', 'running', 'tail', 'settled']
const MOVING = ITEMS.filter((item) => item.effect === 'rise').map((item) => item.id)
// "At once" under reduced motion or the failsafe: well inside the entrance it replaces.
const AT_ONCE_MS = (MOTION.entrance.duration * 1000) / 2

// ── args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { browsers: Object.keys(BROWSERS), pages: PAGES, only: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--browsers') out.browsers = argv[++i].split(',')
    else if (a === '--pages') out.pages = argv[++i].split(',')
    else if (a === '--only') out.only = argv[++i].split(',')
    else throw new Error(`unknown argument: ${a}`)
  }
  for (const b of out.browsers) if (!BROWSERS[b]) throw new Error(`unknown browser: ${b}`)
  for (const p of out.pages) if (!PAGES.includes(p)) throw new Error(`unknown page: ${p} (${PAGES.join(', ')})`)
  for (const g of out.only ?? []) if (!CHECKS[g]) throw new Error(`unknown group: ${g} (${Object.keys(CHECKS).join(', ')})`)
  return out
}

// ── build + serve ──────────────────────────────────────────────────────

function onwarn(warning, warn) {
  // Motion and the React blocks open with 'use client', meaningless outside a server-components bundler.
  if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
  if (warning.code === 'SOURCEMAP_ERROR' && /\.tsx? \(1:0\)/.test(warning.message)) return
  warn(warning)
}

async function serve() {
  const split = splitWordsHTML(HEADLINE)
  await build({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'warn',
    publicDir: false,
    esbuild: { jsx: 'automatic' },
    plugins: [
      {
        name: 'hero-fixture',
        transformIndexHtml: {
          order: 'pre',
          handler: (html, ctx) => {
            const engine = PAGES.find((p) => ctx.filename.endsWith(`${p}.html`))
            return html
              .replace('<!--gate-script-->', () => `<script>${GATE_SCRIPT}</script>`)
              .replace('<!--hero-->', () => markup(engine, split))
          },
        },
      },
    ],
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      rollupOptions: { input: Object.fromEntries(PAGES.map((p) => [p, join(fixtureRoot, `${p}.html`)])), onwarn },
    },
  })
  return preview({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'warn',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0, strictPort: false },
  })
}

// ── in-page recorder ───────────────────────────────────────────────────

/**
 * Installed before any page script: every entrance:phase event (its phase, the attribute when it arrived, the time)
 * and, once per animation frame, what the checks read across the entrance.
 */
function recorderInit() {
  const rec = { events: [], frames: [] }
  window.__rec = rec
  document.addEventListener(
    'entrance:phase',
    (e) => rec.events.push({ phase: e.detail.phase, attr: e.target.getAttribute('data-entrance'), t: performance.now() }),
    true,
  )
  const tick = () => {
    const items = [...document.querySelectorAll('[data-reveal-item]')]
    const nav = document.getElementById('nav')
    const strip = document.getElementById('strip')
    rec.frames.push({
      t: performance.now(),
      phase: document.documentElement.getAttribute('data-entrance'),
      playing: document.querySelectorAll('[data-reveal-playing]').length,
      layered: items.filter((el) => getComputedStyle(el).willChange.includes('transform')).map((el) => el.id),
      nav: nav ? getComputedStyle(nav).transform : null,
      strip: strip?.getAnimations()[0]?.playState ?? null,
    })
    if (rec.frames.length < 3000) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  /** Every element whose computed will-change isn't auto. */
  rec.willChange = () =>
    [...document.querySelectorAll('*')].filter((el) => getComputedStyle(el).willChange !== 'auto').map((el) => el.id || el.tagName)
  /** The hero at settled: the items' state and transform, the split words still animating. */
  rec.landed = () => ({
    items: [...document.querySelectorAll('[data-reveal-item]')].map((el) => ({
      id: el.id,
      state: el.getAttribute('data-reveal-state'),
      transform: getComputedStyle(el).transform,
      opacity: getComputedStyle(el).opacity,
    })),
    words: [...document.querySelectorAll('[data-split-word]')].flatMap((el) => el.getAnimations().filter((a) => a.playState === 'running')).length,
  })
}

// ── checks ──────────────────────────────────────────────────────────────

const phaseIs = (phase) => document.documentElement.getAttribute('data-entrance') === phase
const sceneAt = (stage) => document.getElementById('scene').getAttribute('data-scene-stage') === stage

/** Waits for settled and the stub's run, two frames more, then reads the recorder, the landing and the stub's log. */
async function afterSettled(page) {
  const settled = await until(page, phaseIs, 'settled', { timeout: 8000 })
  if (settled === null) throw new Error(`never settled (data-entrance=${await page.evaluate(() => document.documentElement.getAttribute('data-entrance'))})`)
  const landed = await page.evaluate(() => window.__rec.landed())
  await until(page, sceneAt, 'run', { timeout: 4000 })
  // Frames well past settled: the demotion, the strip's start and the stub's run all happen within two.
  await until(page, () => {
    const settledAt = window.__rec.events.find((e) => e.phase === 'settled')?.t ?? Infinity
    return window.__rec.frames.filter((f) => f.t > settledAt + 50).length >= 6
  })
  await frames(page, 1)
  return page.evaluate((l) => ({ ...window.__rec, willChange: window.__rec.willChange(), landed: l, fx: window.__fx, frames: window.__rec.frames }), landed)
}

const phases = (events) => events.map((e) => e.phase).join('→')

/** pending in the HTML, then running, tail and settled in order, each event after its attribute. */
function orderVerdict(events) {
  const ranks = events.map((e) => ORDER.indexOf(e.phase))
  const increasing = ranks.every((r, i) => r > 0 && (i === 0 || r > ranks[i - 1]))
  const attrs = events.every((e) => e.attr === e.phase)
  const full = phases(events) === 'running→tail→settled'
  return [increasing && attrs && full, phases(events)]
}

/** The stub's stages against the phases: prepare outside the entrance, reveal at tail or later, run at settled. */
function stagesVerdict(scene, { late = false } = {}) {
  const names = (scene ?? []).map((s) => s.stage).join('→')
  if (names !== 'prepare→reveal→run') return [false, `stages ${names || 'none'}`]
  const [prepare, reveal, run] = scene
  const ok =
    (late ? prepare.phase === 'settled' : prepare.phase === 'pending') &&
    ['tail', 'settled'].includes(reveal.phase) &&
    run.phase === 'settled' &&
    scene.every((s) => s.wait !== 'timeout')
  return [ok, scene.map((s) => `${s.stage}@${s.phase}/${s.wait}`).join(' ')]
}

const CHECKS = {
  async entrance(t) {
    const { page } = await t.open()
    const r = await afterSettled(page)
    const out = []
    const [orderOk, orderDetail] = orderVerdict(r.events)
    out.push(['entrance: phases in order, pending → running → tail → settled, attribute before event', orderOk, orderDetail])
    const settledAt = r.events.find((e) => e.phase === 'settled')?.t ?? Infinity
    const tailAt = r.events.find((e) => e.phase === 'tail')?.t ?? Infinity
    out.push(['entrance: tail comes before settled', tailAt < settledAt, `tail ${Math.round(tailAt)} ms, settled ${Math.round(settledAt)} ms`])
    const landedOk =
      t.page === 'css'
        ? r.landed.words === 0
        : r.landed.items.every((i) => i.state === 'shown' && i.transform === 'none' && i.opacity === '1')
    out.push(['entrance: settled only once the entrance has landed', landedOk, JSON.stringify(t.page === 'css' ? { running: r.landed.words } : r.landed.items.map((i) => `${i.id}:${i.state}/${i.transform}`))])
    const during = r.frames.filter((f) => f.phase === 'running' || f.phase === 'tail')
    if (REVEAL_PAGES.includes(t.page)) {
      const playingFrames = during.filter((f) => f.playing > 0).length
      const layered = new Set(during.flatMap((f) => f.layered))
      const onlyMoving = [...layered].every((id) => MOVING.includes(id))
      out.push([
        'promotion: the group is data-reveal-playing while it plays, and only its moving items take will-change',
        playingFrames > 0 && MOVING.every((id) => layered.has(id)) && onlyMoving,
        `${playingFrames}/${during.length} frames playing, layered ${[...layered].join(',') || 'none'}`,
      ])
    }
    const after = r.frames.filter((f) => f.t > settledAt + 50)
    out.push([
      'promotion: after settled, no data-reveal-playing and no will-change anywhere',
      after.every((f) => f.playing === 0) && r.willChange.length === 0,
      `playing ${Math.max(0, ...after.map((f) => f.playing))}, will-change on ${r.willChange.join(',') || 'nothing'}`,
    ])
    const [stagesOk, stagesDetail] = stagesVerdict(r.fx.scene)
    out.push(['stub scene: prepares before the entrance, reveals at tail or later, runs at settled, no timeout', stagesOk, stagesDetail])
    const before = r.frames.filter((f) => f.phase !== 'settled')
    out.push([
      'start queue: the loop strip is held until settled, then runs',
      before.length > 0 && before.every((f) => f.strip === 'paused') && after.length > 0 && after.every((f) => f.strip === 'running'),
      `${before.filter((f) => f.strip === 'paused').length}/${before.length} held, ${after.filter((f) => f.strip === 'running').length}/${after.length} running after`,
    ])
    out.push(['blurred nav: never moves (it fades in place)', r.frames.every((f) => f.nav === 'none'), [...new Set(r.frames.map((f) => f.nav))].join(',')])
    return out
  },

  async late(t) {
    const { page } = await t.open('?stub=late')
    const r = await afterSettled(page)
    const [ok, detail] = stagesVerdict(r.fx.scene, { late: true })
    return [['late stub scene: arriving mid-entrance, it prepares only once settled', ok, detail]]
  },

  async reduced(t) {
    const { page } = await t.open('', { reducedMotion: 'reduce' })
    const r = await afterSettled(page)
    const settled = r.events[0]
    const since = settled && r.fx.bootedAt !== null ? settled.t - r.fx.bootedAt : Infinity
    return [
      ['reduced motion: settled at once, nothing else published', phases(r.events) === 'settled' && since < AT_ONCE_MS, `${phases(r.events)} ${Math.round(since)} ms after boot`],
      ['reduced motion: the strip is never held', r.frames.filter((f) => f.phase === 'settled').every((f) => f.strip === null || f.strip === 'running'), [...new Set(r.frames.map((f) => f.strip))].join(',')],
    ]
  },

  async failsafe(t) {
    if (!REVEAL_PAGES.includes(t.page)) return []
    // The real failsafe at 4 s on the static pages; Motion renders on the client, so its page sets the latch.
    const { page } = await t.open(t.page === 'motion' ? '?boot=100&failsafe=latch' : '?boot=4600')
    const fired = await until(page, () => 'animationFailsafe' in document.documentElement.dataset, null, { timeout: 8000 })
    if (fired === null) throw new Error('the failsafe never fired')
    const r = await afterSettled(page)
    const settled = r.events[0]
    const since = settled && r.fx.bootedAt !== null ? settled.t - r.fx.bootedAt : Infinity
    return [['failsafe fired before boot: settled at once, nothing else published', phases(r.events) === 'settled' && since < AT_ONCE_MS, `${phases(r.events)} ${Math.round(since)} ms after boot`]]
  },
}

// ── main ───────────────────────────────────────────────────────────────

const open = { server: null, browser: null }

async function shutdown() {
  await open.browser?.close().catch(() => {})
  await new Promise((resolve) => (open.server ? open.server.httpServer.close(resolve) : resolve()))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let failures = 0
  const line = (ok, browser, page, name, detail) => {
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${browser.padEnd(8)}  ${page.padEnd(8)}  ${name}${detail ? `  (${detail})` : ''}`)
  }

  open.server = await serve()
  const base = `http://127.0.0.1:${open.server.httpServer.address().port}`
  const groups = args.only ?? Object.keys(CHECKS)

  for (const browserName of args.browsers) {
    open.browser = await launch(BROWSERS[browserName])
    for (const pageName of args.pages) {
      const errors = []
      for (const group of groups) {
        const contexts = []
        const t = {
          page: pageName,
          async open(query = '', contextOptions = {}) {
            const context = await open.browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: 'no-preference', ...contextOptions })
            contexts.push(context)
            await context.addInitScript(recorderInit)
            const page = await context.newPage()
            page.on('pageerror', (e) => errors.push(`${group}: ${e.message}`))
            page.on('console', (msg) => {
              if (msg.type() === 'error' && !isFaviconMiss(msg)) errors.push(`${group}: console: ${msg.text()}`)
            })
            await page.goto(`${base}/${pageName}.html${query}`, { waitUntil: 'load' })
            return { page }
          },
        }
        try {
          for (const [name, ok, detail] of await CHECKS[group](t)) line(ok, browserName, pageName, name, detail)
        } catch (err) {
          line(false, browserName, pageName, `${group}: ran to completion`, err.message.split('\n')[0])
        } finally {
          for (const context of contexts) await context.close().catch(() => {})
        }
      }
      const unique = [...new Set(errors)]
      line(unique.length === 0, browserName, pageName, 'no uncaught errors in the page', unique.length ? `${errors.length}x: ${unique.slice(0, 3).join(' | ')}` : '')
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
console.log(failures ? `\n${failures} check(s) failed` : '\nall hero checks passed')
process.exit(failures ? 1 : 0)
