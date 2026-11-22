#!/usr/bin/env node
// route-hygiene.mjs: spike S9 as a test. How Next's App Router treats Lenis, ScrollTrigger and the scroll position across
// client navigations, with and without Cache Components (Activity keeps hidden routes) and a React <ViewTransition>,
// in Chromium, WebKit and Firefox. The app is tests/fixtures/route-hygiene: Home (`/`, Lenis on GSAP's ticker, a
// ScrollTrigger pin with spacing and three triggers below it) and Journal (`/journal`, native, two triggers, shorter
// than Home); the same two under /vt inside <ViewTransition>. It is copied to tests/.scratch/route-hygiene/<variant>
// with the blocks it uses (copy-and-own, like a project), linked to examples/folio's node_modules for Next 16.3.6, and
// built and served once per variant (`next build`, `next start`). Prints one PASS/FAIL line per check and exits 1 on
// any FAIL, 2 when examples/folio has no node_modules (`pnpm install` there first). `npm run test:route-hygiene`.
//
//   node tests/route-hygiene.mjs [--browsers chromium,webkit,firefox] [--variants plain,cache]
//                                [--prefixes /,/vt] [--contract on,off] [--only sequence,arrival] [--folio]
//
// Variants: `plain` (no cacheComponents: the left route unmounts) and `cache` (cacheComponents: true, Activity).
// Prefixes: `/` and `/vt` (the routes inside <ViewTransition>). Contract `on` runs the route hygiene the fixture
// wires (smooth/route.ts); `off` turns it off through sessionStorage and prints the same checks as INFO lines,
// never failing: the measured behaviour without it, which docs/research/spikes-2026-09.md §S9 records.
// --folio runs a shorter sequence on a copy of examples/folio instead (built in tests/.scratch, so Folio's own .next
// is untouched): Home → scroll → link to Journal → scroll → back → forward → link to Home. Folio's triggers carry no
// ids, so they are compared in page order, and its Lenis isn't reachable, so `scroll` reads scrollY alone.
//
// The sequence, on one page per (browser, variant, prefix, contract):
//   load Home → scroll to Y1 → link to Journal → scroll to Y2 → back → forward → link to Home#after → link to
//   Journal#notes → link to Home → link to More (Lenis lives on) → back → a flick of the wheel, and while Lenis still
//   glides: link to More, back to Home, link to Journal. Then, outside /vt: link to Home → link to Streamed (loading.tsx
//   commits first, then the page, then a section inside it streams in) → link to /streamed?long=1 → link to /streamed
//   (search-param navigations: the pathname holds), and a fresh load of Streamed whose HTML arrives in one piece
//   (React then reveals the streamed content after `load`, past ScrollTrigger's own refresh, in Chromium). After each
//   step, once the step's content has landed:
//   authority   exactly one `data-scroll-authority` stamp, the route's; one live Lenis on Home, none and no
//               html.lenis on Journal
//   triggers    ScrollTrigger.getAll() holds the shown route's triggers only (hidden routes' killed or disabled), as
//               many as a fresh load of that route, each with a fresh load's start and end (±1 px; on Streamed, the
//               fresh load once its streamed section shows, refreshed: the numbers its content gives)
//   scroll      a link lands at the top (or the hash target under --header-h); back and forward restore the position
//               the route had; on Home, Lenis's animated and target scroll agree with scrollY and a wheel notch
//               carries on from there
//   transition  every refresh logged during the navigation saw the trigger's own route alone (no half-swapped DOM),
//               and Lenis never smoothed the jump (no frame with isScrolling 'smooth')
//   limit       on Streamed, Lenis's limit is the page's scroll height less the viewport, as streamed
//
// Arrival (F2), outside /vt with the contract on, each on a fresh page: load Home, scroll it to 1900, 2400 or Y1, link
// to Reveals (native: gsap/reveal.ts items, gsap/split-reveal.ts headings) or Smoothed (the same under ScrollSmoother,
// smooth/smoother.ts). The page's useGSAP creates the triggers before Next places the scroll, at Home's scrollY. Every
// item's start (GSAP's first inline write on it) is recorded with its rectangle at that moment; a heading is read by
// its handle's `done`, once an entrance has had time to end.
//   arrival     no item started outside the viewport; the first screen's item played; nothing below the fold
//               started, and no heading below it finished
//   scrolled    scrolled down 400 px at a time to the end: every item and heading played, each item on screen as it
//               started

import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium, firefox, webkit } from 'playwright'

import { hold as sleep, launch } from './lib/harness.mjs'

const testsDir = dirname(fileURLToPath(import.meta.url))
const repo = join(testsDir, '..')
const fixture = join(testsDir, 'fixtures', 'route-hygiene')
const scratch = join(testsDir, '.scratch', 'route-hygiene')
const assets = join(repo, 'skills', 'scroll-animation', 'assets')
// RH_MODULES: another install to build the fixture on (a second Next version), with RH_TURBO_ROOT a directory that
// holds both it and this repository (Turbopack reads no file outside its root).
const folioModules = process.env.RH_MODULES ?? join(repo, 'examples', 'folio', 'node_modules')
const turboRoot = process.env.RH_TURBO_ROOT ?? repo
// The blocks the fixture imports, copied to <app>/animation the way `scroll-animation add` copies them.
const BLOCKS = [
  'config.ts',
  'entrance-signal.ts',
  'css/animation.css',
  'css/reveal.css',
  'smooth/authority.ts',
  'smooth/lenis.ts',
  'smooth/smoother.ts',
  'smooth/SmoothScroll.tsx',
  'smooth/route.ts',
  'page.ts',
  'react/PageLifecycle.tsx',
  'reveal.ts',
  'css/split.css',
  'motion/SplitWords.tsx',
  'motion/Reveal.tsx',
  'motion/MotionProvider.tsx',
  'motion/useReducedMotionLive.ts',
  'gsap/setup.ts',
  'gsap/reveal.ts',
  'gsap/split-reveal.ts',
  'split-words.ts',
]

const BROWSERS = { chromium, webkit, firefox }
// `before`: the plain app on 2.1.2's blocks (git show), for what F3 to F5 measured before the lifecycle.
const VARIANTS = { plain: '0', cache: '1', before: '0' }
const BEFORE_REF = 'v2.1.2'
const BEFORE_BLOCKS = [
  'smooth/authority.ts',
  'smooth/lenis.ts',
  'smooth/smoother.ts',
  'gsap/reveal.ts',
  'gsap/split-reveal.ts',
  'reveal.ts',
  'motion/Reveal.tsx',
  'css/split.css',
  'css/animation.css',
]
const VIEWPORT = { width: 1280, height: 800 }
const HEADER_H = 64
const Y1 = 3000
const Y2 = 900
// F2: where Home is scrolled before the link to a page of reveals.
const ARRIVE_FROM = [1900, 2400, Y1]
const ARRIVE_STEP = 400


// ── args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    browsers: Object.keys(BROWSERS),
    variants: ['plain', 'cache'],
    prefixes: ['', '/vt'],
    contract: ['on', 'legacy', 'off'],
    only: ['sequence', 'arrival', 'lifecycle'],
    folio: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--browsers') out.browsers = argv[++i].split(',')
    else if (a === '--variants') out.variants = argv[++i].split(',')
    else if (a === '--prefixes') out.prefixes = argv[++i].split(',').map((p) => (p === '/' ? '' : p))
    else if (a === '--contract') out.contract = argv[++i].split(',')
    else if (a === '--only') out.only = argv[++i].split(',')
    else if (a === '--folio') out.folio = true
    else throw new Error(`unknown argument: ${a}`)
  }
  for (const b of out.browsers) if (!BROWSERS[b]) throw new Error(`unknown browser: ${b}`)
  for (const v of out.variants) if (!VARIANTS[v]) throw new Error(`unknown variant: ${v} (${Object.keys(VARIANTS).join(', ')})`)
  for (const c of out.contract) if (!['on', 'legacy', 'off'].includes(c)) throw new Error(`unknown contract mode: ${c} (on, legacy, off)`)
  for (const o of out.only) if (!['sequence', 'arrival', 'lifecycle'].includes(o)) throw new Error(`unknown group: ${o} (sequence, arrival, lifecycle)`)
  if (out.folio) {
    out.variants = ['folio']
    out.prefixes = ['']
    out.contract = ['on']
  }
  return out
}

// ── build + serve ──────────────────────────────────────────────────────

function prepare(variant) {
  const app = join(scratch, variant)
  rmSync(app, { recursive: true, force: true })
  mkdirSync(app, { recursive: true })
  cpSync(fixture, app, { recursive: true })
  for (const file of BLOCKS) cpSync(join(assets, file), join(app, 'animation', file))
  if (variant === 'before') {
    // RH_BEFORE narrows it to some blocks, to find which one a difference comes from.
    for (const file of process.env.RH_BEFORE?.split(',') ?? BEFORE_BLOCKS) {
      const show = spawnSync('git', ['show', `${BEFORE_REF}:skills/scroll-animation/assets/${file}`], { cwd: repo, encoding: 'utf8' })
      if (show.status !== 0) throw new Error(`git show ${BEFORE_REF}:${file} failed (the 'before' variant needs the tag): ${show.stderr}`)
      writeFileSync(join(app, 'animation', file), show.stdout)
    }
  }
  symlinkSync(folioModules, join(app, 'node_modules'), 'dir')
  return app
}

// Folio as it is, with one change to its (empty) config: the build root, for the linked node_modules.
function prepareFolio() {
  const folio = join(repo, 'examples', 'folio')
  const app = join(scratch, 'folio')
  rmSync(app, { recursive: true, force: true })
  mkdirSync(app, { recursive: true })
  for (const entry of ['src', 'public', 'package.json', 'tsconfig.json', 'postcss.config.mjs', 'next-env.d.ts']) {
    cpSync(join(folio, entry), join(app, entry), { recursive: true })
  }
  writeFileSync(
    join(app, 'next.config.mjs'),
    'export default { turbopack: { root: process.env.RH_ROOT }, outputFileTracingRoot: process.env.RH_ROOT }\n',
  )
  symlinkSync(folioModules, join(app, 'node_modules'), 'dir')
  return app
}

const envFor = (variant) => ({ ...process.env, RH_ROOT: turboRoot, RH_CACHE_COMPONENTS: VARIANTS[variant] ?? '0', NEXT_TELEMETRY_DISABLED: '1' })
const nextBin = (app) => join(app, 'node_modules', 'next', 'dist', 'bin', 'next')

function build(variant) {
  const app = variant === 'folio' ? prepareFolio() : prepare(variant)
  const run = spawnSync(process.execPath, [nextBin(app), 'build'], { cwd: app, env: envFor(variant), encoding: 'utf8' })
  if (run.status !== 0) throw new Error(`next build (${variant}) exited with ${run.status}:\n${run.stdout}\n${run.stderr}`)
  return app
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

// Its own process group, so stopping it also stops anything it spawned.
async function start(app, variant) {
  const port = await freePort()
  const child = spawn(process.execPath, [nextBin(app), 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: app,
    env: envFor(variant),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  let log = ''
  child.stdout.on('data', (d) => (log += d))
  child.stderr.on('data', (d) => (log += d))
  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 30000
  for (;;) {
    if (child.exitCode !== null) throw new Error(`next start exited with ${child.exitCode}:\n${log}`)
    try {
      if ((await fetch(base)).ok) return { child, base }
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      await stop(child)
      throw new Error(`next start did not answer within 30 s:\n${log}`)
    }
    // fixed-wait: the poll interval of a condition loop (the server answering), not a guess
    await sleep(200)
  }
}

function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    child.once('exit', () => resolve())
    const kill = (signal) => {
      try {
        process.kill(-child.pid, signal)
      } catch {
        // already gone
      }
    }
    kill('SIGTERM')
    setTimeout(() => kill('SIGKILL'), 5000).unref()
  })
}

// ── in the page ─────────────────────────────────────────────────────────

/** Installed before any page script, on every document. */
function probes({ contract, place }) {
  try {
    sessionStorage.setItem('rh:contract', contract)
    sessionStorage.setItem('rh:place', place)
  } catch {
    // storage blocked: the contract stays on
  }
  // Live Lenis instances, counted from outside: each adds one non-passive `wheel` listener on window (Folio's
  // check-authority does the same).
  const live = new Set()
  const add = EventTarget.prototype.addEventListener
  const remove = EventTarget.prototype.removeEventListener
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (this === window && type === 'wheel' && options?.passive === false) live.add(listener)
    return add.call(this, type, listener, options)
  }
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    if (this === window && type === 'wheel') live.delete(listener)
    return remove.call(this, type, listener, options)
  }
  // ScrollTrigger itself, for a page that doesn't hand it over (Folio): the first instance to set this own property
  // has the class as its constructor.
  Object.defineProperty(Object.prototype, '_startClamp', {
    configurable: true,
    set(value) {
      Object.defineProperty(this, '_startClamp', { value, writable: true, configurable: true, enumerable: true })
      if (!window.__rhST && typeof this.constructor?.getAll === 'function') window.__rhST = this.constructor
    },
  })
  // F2: each reveal item's rectangle when its entrance started, GSAP's first inline write on it.
  window.__rhStarts = []
  const started = new WeakSet()
  new MutationObserver((records) => {
    for (const { target: el } of records) {
      if (!(el instanceof HTMLElement) || !el.hasAttribute('data-reveal-item') || started.has(el) || !el.style.length) continue
      started.add(el)
      const r = el.getBoundingClientRect()
      window.__rhStarts.push({ id: el.id, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight, y: window.scrollY })
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['style'] })
  window.__rhLog = []
  window.__rhVT = false
  window.__rhVTCount = 0
  if (typeof document.startViewTransition === 'function') {
    const startViewTransition = document.startViewTransition.bind(document)
    document.startViewTransition = (arg) => {
      const transition = startViewTransition(arg)
      window.__rhVT = true
      window.__rhVTCount++
      window.__rhLog.push({ kind: 'vt-start', t: performance.now(), y: window.scrollY })
      transition.finished.finally(() => {
        window.__rhVT = false
        window.__rhLog.push({ kind: 'vt-end', t: performance.now(), y: window.scrollY })
      })
      return transition
    }
  }
  const visibleRoutes = () =>
    Array.from(document.querySelectorAll('[data-route]'))
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => el.dataset.route)
  // The lifecycle's phases, as the page publishes them.
  window.__rhPhases = []
  document.addEventListener('entrance:phase', (e) => window.__rhPhases.push({ ...e.detail, t: performance.now() }))
  // F3: when each watched element first showed (opacity above 0, or moved off where it was first seen).
  const watched = {}
  const sample = (selectors) => {
    for (const selector of selectors) {
      const el = document.querySelector(selector)
      if (!el || !el.getClientRects().length) continue
      const style = getComputedStyle(el)
      const ty = style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42
      const entry = (watched[selector] ??= { ty, seen: performance.now(), started: null, opaque: null })
      if (entry.opaque === null && Number(style.opacity) >= 0.99) entry.opaque = performance.now()
      if (entry.started === null && (Number(style.opacity) > 0.01 || Math.abs(ty - entry.ty) > 0.5)) entry.started = performance.now()
    }
  }
  let frames = null
  let watching = []
  const frame = () => {
    if (!frames) return
    const lenis = window.__rhLenis
    // Under ScrollSmoother the page is a transformed element: where it sits against where the scroll is.
    const content = document.getElementById('smooth-content')
    frames.push({
      p: location.pathname,
      y: window.scrollY,
      ly: lenis ? lenis.animatedScroll : null,
      s: lenis ? lenis.isScrolling : null,
      c: content ? -content.getBoundingClientRect().top : null,
      vt: window.__rhVT,
    })
    sample(watching)
    requestAnimationFrame(frame)
  }
  window.__rh = {
    liveLenis: () => live.size,
    record(selectors = []) {
      frames = []
      watching = selectors
      for (const key of Object.keys(watched)) delete watched[key]
      window.__rhLog.length = 0
      window.__rhPhases.length = 0
      requestAnimationFrame(frame)
    },
    stopRecord() {
      const out = { frames: frames ?? [], log: window.__rhLog.slice(), phases: window.__rhPhases.slice(), watched: { ...watched } }
      frames = null
      return out
    },
    click(key) {
      const selector = key.startsWith('/') ? `a[href="${key}"]` : `[data-nav="${key}"]`
      const links = Array.from(document.querySelectorAll(selector)).filter((a) => a.getClientRects().length > 0)
      if (!links.length || (links.length > 1 && !key.startsWith('/'))) throw new Error(`${links.length} visible ${selector} links`)
      links[0].click()
    },
    state() {
      const html = document.documentElement
      const ST = window.__rhST ?? null
      const routes = visibleRoutes()
      const triggers = (ST ? ST.getAll() : []).map((t, i) => {
        const el = t.trigger ?? null
        const route = el?.closest?.('[data-route]') ?? null
        return {
          id: t.vars.id ?? `#${i}`,
          start: t.start,
          end: t.end,
          enabled: t.enabled !== false,
          shown: el ? el.getClientRects().length > 0 && (!route || routes.includes(route.dataset.route)) : true,
        }
      })
      const lenis = window.__rhLenis ?? null
      const target = (id) => {
        const el = document.getElementById(id)
        return el ? Math.round(el.getBoundingClientRect().top) : null
      }
      return {
        path: location.pathname,
        hash: location.hash,
        stamp: html.dataset.scrollAuthority ?? null,
        stamps: document.querySelectorAll('[data-scroll-authority]').length,
        lenisClass: html.classList.contains('lenis'),
        live: live.size,
        routes,
        triggers,
        y: window.scrollY,
        max: document.documentElement.scrollHeight - window.innerHeight,
        lenis: lenis ? { animated: lenis.animatedScroll, target: lenis.targetScroll, limit: lenis.limit, scrolling: lenis.isScrolling } : null,
        hashTop: location.hash ? target(decodeURIComponent(location.hash.slice(1))) : null,
        restoration: history.scrollRestoration,
        vtCount: window.__rhVTCount,
        hasVT: typeof document.startViewTransition === 'function',
      }
    },
  }
}

/** Resolves once the path shows, no view transition runs and scrollY has held still for 20 frames. */
async function settle(page, path) {
  await page.waitForFunction((p) => location.pathname === p, path, { timeout: 10000 }).catch(() => {})
  await page
    .waitForFunction(
      () =>
        new Promise((resolve) => {
          let last = -1
          let still = 0
          const step = () => {
            const y = window.scrollY
            still = y === last && !window.__rhVT ? still + 1 : 0
            last = y
            if (still >= 20) resolve(true)
            else requestAnimationFrame(step)
          }
          requestAnimationFrame(step)
        }),
      null,
      { timeout: 10000 },
    )
    .catch(() => {})
  // ScrollTrigger's queued refresh after a pin (the next frame) and anything a late refresh moves.
  // fixed-wait: a late refresh is debounced inside GSAP, with no signal the page can read
  await sleep(250)
  return page.evaluate(() => window.__rh.state())
}

async function wheel(page, notches, delta = 100) {
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2)
  for (let i = 0; i < notches; i++) {
    await page.mouse.wheel(0, delta)
    // fixed-wait: wheel notches paced like a hand
    await sleep(40)
  }
}

// ── checks ──────────────────────────────────────────────────────────────

const near = (a, b, tolerance = 1) => a !== null && b !== null && Math.abs(a - b) <= tolerance

function authorityOf(s, route) {
  const ok =
    s.stamps === 1 &&
    (route === 'journal' ? s.stamp === 'native' && !s.lenisClass && s.live === 0 : s.stamp === 'lenis' && s.lenisClass && s.live === 1)
  return [ok, `stamp=${s.stamp} (${s.stamps}) html.lenis=${s.lenisClass} live Lenis=${s.live}`]
}

function triggersOf(s, fresh) {
  const shown = s.triggers.filter((t) => t.enabled && t.shown)
  const stray = s.triggers.filter((t) => t.enabled && !t.shown)
  const moved = []
  fresh.forEach((f, i) => {
    const t = shown.find((x) => x.id === f.id) ?? (f.id.startsWith('#') ? shown[i] : undefined)
    if (!t || !near(t.start, f.start) || !near(t.end, f.end)) {
      moved.push(`${f.id} ${t ? `${Math.round(t.start)}–${Math.round(t.end)}` : 'missing'} vs ${Math.round(f.start)}–${Math.round(f.end)}`)
    }
  })
  const ok = s.triggers.length === fresh.length && stray.length === 0 && moved.length === 0
  return [
    ok,
    `${s.triggers.length} live (fresh load ${fresh.length}), ${stray.length} on a hidden route` +
      (moved.length ? ` · off a fresh load: ${moved.join(', ')}` : ''),
  ]
}

function scrollOf(s, expect) {
  let ok
  let detail
  if (expect.hash) {
    ok = near(s.hashTop, HEADER_H)
    detail = `${s.hash} top at ${s.hashTop} px (header ${HEADER_H})`
  } else {
    ok = near(s.y, expect.y)
    detail = `scrollY ${s.y} (expected ${expect.y})`
  }
  if (s.lenis) {
    const agrees = near(s.lenis.animated, s.y) && near(s.lenis.target, s.y)
    ok = ok && agrees
    detail += ` · Lenis animated ${Math.round(s.lenis.animated)} target ${Math.round(s.lenis.target)}`
  }
  return [ok, `${detail} · scrollRestoration ${s.restoration}`]
}

/**
 * `kind` is 'link' (a push: one view transition under /vt where the browser has them) or 'traverse' (back/forward:
 * React runs none, measured). `from` is scrollY before the step; a traversal reaches its position in one step, with
 * no frame showing a third position (a clamped restore). `momentum` steps start while Lenis is still smoothing, so
 * only the frames after the route changed count.
 */
function transitionOf(rec, s, { expectVT, kind, from, momentum }) {
  const refreshes = rec.log.filter((e) => e.kind === 'refresh')
  // A route's trigger ids start with the route; the layout's (layout-progress) belongs to every route.
  const owner = (id) => ['home', 'more', 'journal', 'streamed'].find((r) => String(id).startsWith(`${r}-`)) ?? null
  const swapped = refreshes.filter((e) => e.routes.length !== 1 || (owner(e.id) && e.routes[0] !== owner(e.id)))
  const frames = momentum ? rec.frames.slice(rec.frames.findIndex((f) => f.p === s.path)) : rec.frames
  const smooth = frames.filter((f) => f.s === 'smooth').length
  const vts = rec.log.filter((e) => e.kind === 'vt-start').length
  const vtOk = !expectVT || !s.hasVT || vts === (kind === 'link' ? 1 : 0)
  const ys = [...new Set(frames.map((f) => f.y))]
  const third = kind === 'traverse' ? ys.filter((y) => !near(y, from) && !near(y, s.y)) : []
  const ok = swapped.length === 0 && smooth === 0 && vtOk && third.length === 0
  const sample = swapped[0] ? ` (${swapped[0].id} saw [${swapped[0].routes.join(',')}]${swapped[0].vt ? ' mid-transition' : ''})` : ''
  return [
    ok,
    `${refreshes.length} refreshes, ${swapped.length} on a half-swapped DOM${sample} · ${smooth}/${frames.length} frames smoothing` +
      (kind === 'traverse' ? ` · scrollY ${from} → ${s.y}${third.length ? `, also showed ${third.slice(0, 4).join(', ')}` : ' in one step'}` : '') +
      (expectVT ? ` · view transitions ${s.hasVT ? vts : 'unsupported'}, ${refreshes.filter((e) => e.vt).length} refreshes inside one` : ''),
  ]
}

// A fresh load's triggers, per browser and app: the contract changes navigations, never a fresh load's numbers. A
// streamed route's are read once its section shows and after one refresh: what its content measures, whether or not
// this load's own refresh came after the reveal (the 'fresh load' step checks that).
const freshCache = new Map()
async function freshTriggers(context, base, prefix) {
  const key = `${context.browser().browserType().name()} ${base}${prefix}`
  if (freshCache.has(key)) return freshCache.get(key)
  const out = {}
  for (const [route, url] of [
    ['home', prefix || '/'],
    ['more', `${prefix}/more`],
    ['journal', `${prefix}/journal`],
    ...(prefix ? [] : [
      ['streamed', '/streamed'],
      ['streamed-long', '/streamed?long=1'],
    ]),
  ]) {
    const page = await context.newPage()
    await page.goto(`${base}${url}`, { waitUntil: 'load' })
    if (route.startsWith('streamed')) {
      await page.waitForSelector('[data-streamed-section]', { state: 'visible', timeout: 10000 })
      await settle(page, '/streamed')
      await page.evaluate(() => window.__rhST.refresh())
    }
    const s = await settle(page, url.split('?')[0])
    out[route] = s.triggers.map(({ id, start, end }) => ({ id, start, end }))
    await page.close()
  }
  freshCache.set(key, out)
  return out
}

async function sequence({ browser, base, prefix, contract, line }) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: 'no-preference' })
  await context.addInitScript(probes, { contract, place: contract === 'legacy' ? 'around' : 'before' })
  const errors = []
  try {
    const fresh = await freshTriggers(context, base, prefix)
    const page = await context.newPage()
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => {
      if (m.text().includes('scroll authority')) errors.push(`${m.type()}: ${m.text()}`)
    })
    const home = prefix || '/'
    const more = `${prefix}/more`
    const journal = `${prefix}/journal`
    const expectVT = prefix === '/vt'
    const at = (path) => (path === journal ? 'journal' : path === more ? 'more' : path === '/streamed' ? 'streamed' : 'home')

    // `ready`: a selector the step's content shows once it has landed (a streamed route); `route`: the fresh load to
    // compare with, when the pathname alone doesn't say (a search-param navigation).
    const step = async (name, path, act, expect, kind = 'link', momentum = false, { ready, route = at(path) } = {}) => {
      const from = await page.evaluate(() => window.scrollY)
      await page.evaluate(() => window.__rh.record())
      await act()
      if (ready) await page.waitForSelector(ready, { state: 'attached', timeout: 10000 })
      const s = await settle(page, path)
      const rec = await page.evaluate(() => window.__rh.stopRecord())
      line(...authorityOf(s, route), `${name}: authority`)
      line(...triggersOf(s, fresh[route]), `${name}: triggers`)
      if (expect) line(...scrollOf(s, expect), `${name}: scroll`)
      if (ready && s.lenis) {
        line(near(s.lenis.limit, s.max), `Lenis limit ${Math.round(s.lenis.limit)}, page ${s.max}`, `${name}: limit`)
      }
      if (act !== noop) line(...transitionOf(rec, s, { expectVT, kind, from, momentum }), `${name}: transition`)
      return s
    }
    const noop = async () => {}
    const to = (key) => () => page.evaluate((k) => window.__rh.click(k), key)
    const scrollTo = async (y, path) => {
      await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y)
      await settle(page, path)
    }
    // A reader who clicks (or goes back, with no key) while Lenis is still gliding from a flick of the wheel.
    const flickThen = (key) => async () => {
      await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2)
      for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 250)
      await page.evaluate((k) => (k ? window.__rh.click(k) : history.back()), key)
    }

    await page.goto(`${base}${home}`, { waitUntil: 'load' })
    await step('load Home', home, noop, null)
    await scrollTo(Y1, home)

    await step('link to Journal', journal, to('journal'), { y: 0 })
    await scrollTo(Y2, journal)

    const back = await step('back to Home', home, () => page.evaluate(() => history.back()), { y: Y1 }, 'traverse')
    await wheel(page, 2)
    const wheeled = await settle(page, home)
    line(
      wheeled.y > back.y && wheeled.y <= back.y + 400 && (!wheeled.lenis || near(wheeled.lenis.animated, wheeled.y)),
      `scrollY ${back.y} → ${wheeled.y} after 2 notches of 100`,
      'back to Home: a wheel carries on from the restored position',
    )
    await scrollTo(Y1, home)

    await step('forward to Journal', journal, () => page.evaluate(() => history.forward()), { y: Y2 }, 'traverse')
    await step('link to Home#after', home, to('home-hash'), { hash: true })
    await step('link to Journal#notes', journal, to('journal-hash'), { hash: true })
    await step('link to Home', home, to('home'), { y: 0 })

    await scrollTo(Y1, home)
    await step('link to More (Lenis lives on)', more, to('more'), { y: 0 })
    await step('back to Home (Lenis lives on)', home, () => page.evaluate(() => history.back()), { y: Y1 }, 'traverse')
    await step('flick, then link to More', more, flickThen('more'), { y: 0 }, 'link', true)
    await step('link to Home from More', home, to('home'), { y: 0 })
    await scrollTo(Y1, home)
    await step('link to More again', more, to('more'), { y: 0 })
    await step('flick, then back to Home', home, flickThen(null), { y: Y1 }, 'traverse', true)
    await step('flick, then link to Journal', journal, flickThen('journal'), { y: 0 }, 'link', true)

    if (!prefix) {
      const streamed = '/streamed'
      const landed = (kind) => `[data-streamed="${kind}"] [data-streamed-section]`
      await step('link to Home (for Streamed)', home, to('home'), { y: 0 })
      await step('link to Streamed (loading.tsx, then a streamed section)', streamed, to('streamed'), { y: 0 }, 'link', false, {
        ready: landed('short'),
      })
      await step('search params: link to /streamed?long=1', streamed, to('streamed-long'), null, 'link', false, {
        ready: landed('long'),
        route: 'streamed-long',
      })
      await step('search params: link to /streamed', streamed, to('streamed-short'), null, 'link', false, { ready: landed('short') })

      // A fresh load, its HTML held back and delivered in one piece: React reveals the page and its section in one
      // batch ~300 ms later, often after `load` and ScrollTrigger's own refresh (Chromium; WebKit and Firefox hydrate
      // after the reveal). What layout-progress held at the reveal says whether this load raced; up to 4 loads.
      const freshLate = async () => {
        const late = await context.newPage()
        late.on('pageerror', (e) => errors.push(e.message))
        await late.addInitScript(() => {
          new MutationObserver((_, mo) => {
            const section = document.querySelector('[data-streamed-section]')
            if (!section || !section.getClientRects().length) return
            mo.disconnect()
            const t = window.__rhST?.getById('layout-progress')
            window.__rhReveal = { end: t ? Math.round(t.end) : null, max: document.documentElement.scrollHeight - innerHeight }
          }).observe(document, { subtree: true, childList: true, attributes: true })
        })
        await late.route(`${base}${streamed}`, async (r) => {
          const res = await r.fetch()
          await r.fulfill({ response: res, body: await res.body() })
        })
        await late.goto(`${base}${streamed}`, { waitUntil: 'load' })
        await late.waitForSelector(landed('short'), { state: 'visible', timeout: 10000 })
        const s = await settle(late, streamed)
        const reveal = await late.evaluate(() => window.__rhReveal ?? null)
        await late.close()
        return { s, reveal, raced: reveal?.end != null && reveal.end < reveal.max - 1 }
      }
      let late
      let loads = 0
      do {
        late = await freshLate()
        loads++
      } while (!late.raced && loads < 4)
      const [ok, detail] = triggersOf(late.s, fresh.streamed)
      const raced = late.raced
        ? `layout-progress 0–${late.reveal.end} at the reveal (page 0–${late.reveal.max})`
        : `revealed before the first refresh in ${loads} load(s): not raced here`
      line(ok, `${raced} · ${detail}`, 'fresh load of Streamed, revealed after load: triggers')
    }
  } finally {
    await context.close()
  }
  const unique = [...new Set(errors)]
  line(unique.length === 0, unique.slice(0, 3).join(' | '), 'no uncaught errors or scroll-authority warnings')
}

/** Resolves once the route's reveal items have held still for 10 frames (ScrollSmoother's catch-up included). */
async function still(page, route) {
  await page
    .waitForFunction(
      (r) =>
        new Promise((resolve) => {
          const first = document.querySelector(`[data-route="${r}"] [data-reveal-item]`)
          let last = null
          let held = 0
          const step = () => {
            const top = first ? first.getBoundingClientRect().top : 0
            held = top === last ? held + 1 : 0
            last = top
            if (held >= 10) resolve(true)
            else requestAnimationFrame(step)
          }
          requestAnimationFrame(step)
        }),
      route,
      { timeout: 10000 },
    )
    .catch(() => {})
  // fixed-wait: ScrollTrigger.batch calls back after its interval (0.1 s), with no signal the page can read
  await sleep(200)
}

/** The reveal items of the shown route: where each is now, whether it started and whether it landed. */
function readReveals(route) {
  const starts = window.__rhStarts.slice()
  const items = Array.from(document.querySelectorAll(`[data-route="${route}"] [data-reveal-item]`)).map((el) => {
    const r = el.getBoundingClientRect()
    return {
      id: el.id,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      started: starts.some((s) => s.id === el.id),
      shown: el.getAttribute('data-reveal-state') === 'shown',
    }
  })
  const splits = (window.__rhSplits ?? []).map((handle) => {
    const r = handle.el.getBoundingClientRect()
    return { id: handle.el.id, top: Math.round(r.top), done: handle.done }
  })
  return { starts, items, splits, vh: window.innerHeight, y: window.scrollY, max: document.documentElement.scrollHeight - window.innerHeight }
}

const offScreen = (s) => !(s.bottom > 0 && s.top < s.vh)

/** F2: a link from a scrolled page to a page of GSAP reveals, native and under ScrollSmoother. */
async function arrivalSequence({ browser, base, line }) {
  for (const [route, path] of [
    ['reveals', '/reveals'],
    ['smoothed', '/smoothed'],
  ]) {
    for (const from of ARRIVE_FROM) {
      const name = `link from Home at ${from} to ${path}`
      const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: 'no-preference' })
      await context.addInitScript(probes, { contract: 'on', place: 'before' })
      const errors = []
      try {
        const page = await context.newPage()
        page.on('pageerror', (e) => errors.push(e.message))
        await page.goto(`${base}/`, { waitUntil: 'load' })
        await settle(page, '/')
        await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), from)
        const at = (await settle(page, '/')).y
        await page.evaluate((k) => window.__rh.click(k), route)
        await settle(page, path)
        await still(page, route)
        // fixed-wait: a heading's entrance (MOTION.entrance, 1.3 s) ends before `done` can say it played
        await sleep(1600)

        const atBuild = await page.evaluate(() => window.__rhAuthorityAtBuild)
        const owner = route === 'smoothed' ? 'smoother' : 'native'
        line(atBuild === owner, `data-scroll-authority read ${atBuild} as the page's blocks built`, `${name}: the ${owner} authority exists before the page's blocks build`)
        const arrived = await page.evaluate(readReveals, route)
        const early = arrived.starts.filter(offScreen)
        line(
          early.length === 0,
          `Home at ${at} · ${arrived.starts.length} started` +
            (early.length ? `, off screen: ${early.map((s) => `${s.id} at ${s.top}–${s.bottom} (viewport 0–${s.vh})`).join(', ')}` : ''),
          `${name}: no entrance started off screen`,
        )
        const below = [
          ...arrived.items.filter((item) => item.top >= arrived.vh && (item.started || item.shown)),
          ...arrived.splits.filter((split) => split.top >= arrived.vh && split.done),
        ]
        const first = arrived.items.filter((item) => item.bottom > 0 && item.top < arrived.vh)
        line(
          below.length === 0 && first.length > 0 && first.every((item) => item.started),
          `scrollY ${arrived.y} · first screen ${first.map((i) => `${i.id}${i.started ? '' : ' (waiting)'}`).join(', ') || 'none'}` +
            (below.length ? ` · below the fold, already played: ${below.map((i) => `${i.id} at ${i.top}`).join(', ')}` : ''),
          `${name}: on arrival the first screen played, nothing below the fold`,
        )

        for (let y = ARRIVE_STEP; y < arrived.max + ARRIVE_STEP; y += ARRIVE_STEP) {
          await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), Math.min(y, arrived.max))
          await still(page, route)
        }
        await page
          .waitForFunction(
            (r) =>
              Array.from(document.querySelectorAll(`[data-route="${r}"] [data-reveal-item]`)).every(
                (el) => el.getAttribute('data-reveal-state') === 'shown',
              ) && (window.__rhSplits ?? []).every((split) => split.done),
            route,
            { timeout: 5000 },
          )
          .catch(() => {})
        const end = await page.evaluate(readReveals, route)
        const waiting = [...end.items.filter((item) => !item.shown), ...end.splits.filter((split) => !split.done)]
        const off = end.starts.filter(offScreen)
        line(
          waiting.length === 0 && off.length === 0,
          `${end.items.length + end.splits.length - waiting.length}/${end.items.length + end.splits.length} played` +
            (waiting.length ? `, never: ${waiting.map((i) => i.id).join(', ')}` : '') +
            (off.length ? ` · off screen as they started: ${off.map((s) => `${s.id} at ${s.top}`).join(', ')}` : ''),
          `${name}: scrolled through, every item played on screen`,
        )
      } finally {
        await context.close()
      }
      const unique = [...new Set(errors)]
      line(unique.length === 0, unique.slice(0, 3).join(' | '), `${name}: no uncaught errors`)
    }
  }
}


// ── the lifecycle: F3, F4, F5 ───────────────────────────────────────────

const F3_WATCH = ['[data-route="enter"] [data-split-word]', '#e-gsap-mount', '#e-gsap-view', '#e-free', '#e-motion']
const GLIDE_PX = 2

/** Resolves once the smoothed content (if the page has one) has held still for 10 frames. */
async function contentStill(page) {
  await page
    .waitForFunction(
      () =>
        new Promise((resolve) => {
          let last = null
          let held = 0
          const step = () => {
            const top = document.getElementById('smooth-content')?.getBoundingClientRect().top ?? 0
            held = top === last ? held + 1 : 0
            last = top
            if (held >= 10) resolve(true)
            else requestAnimationFrame(step)
          }
          requestAnimationFrame(step)
        }),
      null,
      { timeout: 10000 },
    )
    .catch(() => {})
}

/** A fresh page on `path` with the contract and its place set, scrolled to `y` and settled. */
async function openAt(browser, base, { contract, place }, path, y, errors) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: 'no-preference' })
  await context.addInitScript(probes, { contract, place })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}${path}`, { waitUntil: 'load' })
  await settle(page, path)
  if (y) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y)
    await settle(page, path)
    await contentStill(page)
  }
  return { context, page }
}

/**
 * Frames after the route changed in which the smoothed content sat more than GLIDE_PX from the scroll position. The
 * first frame of the new route is not counted: the placement's `scroll` event reaches the page at the next frame.
 */
function glideOf(rec, path) {
  const after = rec.frames.slice(rec.frames.findIndex((f) => f.p === path)).filter((f) => f.c !== null)
  const gaps = after.slice(1).map((f) => Math.abs(f.c - f.y))
  const off = gaps.filter((gap) => gap > GLIDE_PX)
  return { frames: after.length, off: off.length, worst: Math.round(Math.max(0, ...gaps)) }
}

/**
 * F3: no entrance starts under the route transition. F4: the route contract placed before, after and around the
 * page lands the same. F5: back and forward land without a glide, under ScrollSmoother (Lenis and native are the
 * sequence's own traverse steps). `contract` is `on` (the lifecycle) or `legacy` (2.1's <RouteChange>), whose lines
 * are INFO: what the lifecycle replaced.
 */
async function lifecycleSequence({ browser, base, contract, line }) {
  const errors = []
  const run = async (name, fn) => {
    try {
      await fn()
    } catch (err) {
      line(false, err.message.split('\n')[0], `${name}: ran to completion`)
    }
  }

  await run('F3', async () => {
    const { context, page } = await openAt(browser, base, { contract, place: contract === 'on' ? 'before' : 'around' }, '/vt', 2400, errors)
    try {
      await page.evaluate((watch) => window.__rh.record(watch), F3_WATCH)
      await page.evaluate(() => window.__rh.click('enter'))
      await settle(page, '/vt/enter')
      // fixed-wait: an entrance (MOTION.entrance, 1.3 s, plus its stagger) has to end before it can be read as played
      await sleep(1800)
      const rec = await page.evaluate(() => window.__rh.stopRecord())
      const state = await page.evaluate(() => ({ hasVT: typeof document.startViewTransition === 'function', phase: document.documentElement.dataset.entrance ?? null }))
      const vtEnd = rec.log.find((e) => e.kind === 'vt-end')?.t ?? null
      if (!state.hasVT || vtEnd === null) {
        line(true, 'no view transition ran in this browser', 'F3 entrance against the transition: skipped')
      } else {
        const names = Object.fromEntries(F3_WATCH.map((selector) => [selector, selector.replace(/^.*\[data-split-word\]$/, 'split words')]))
        const early = F3_WATCH.filter((selector) => rec.watched[selector]?.started != null && rec.watched[selector].started < vtEnd - 1)
        const never = F3_WATCH.filter((selector) => rec.watched[selector]?.started == null)
        line(
          early.length === 0 && never.length === 0,
          `transition ended at ${Math.round(vtEnd)} ms` +
            (early.length ? ` · started under it: ${early.map((sel) => `${names[sel]} at ${Math.round(rec.watched[sel].started)}`).join(', ')}` : '') +
            (never.length ? ` · never played: ${never.map((sel) => names[sel]).join(', ')}` : ''),
          'F3 link to /vt/enter: no entrance starts while the view transition runs, and each plays after it',
        )
        if (contract === 'on') {
          const phases = rec.phases.filter((ph) => ph.kind === 'push')
          const running = phases.find((ph) => ph.phase === 'running')
          const order = phases.map((ph) => ph.phase).join(' → ')
          line(
            phases[0]?.phase === 'pending' && phases[0].t < vtEnd && !!running && running.t >= vtEnd - 1 && state.phase === 'settled',
            `${order || 'no phases'} · running at ${running ? Math.round(running.t) : '–'} ms, now ${state.phase}`,
            'F3 the visit is pending through the transition, running after it, then settled',
          )
        }
      }
      // Back: a traverse arrives settled, and the heading's words don't replay.
      if (contract === 'on') {
        await page.evaluate(() => window.__rh.click('home'))
        await settle(page, '/vt')
        await page.evaluate((watch) => window.__rh.record(watch), F3_WATCH)
        await page.evaluate(() => history.back())
        await settle(page, '/vt/enter')
        const back = await page.evaluate(() => ({
          rec: window.__rh.stopRecord(),
          words: Array.from(document.querySelectorAll('[data-route="enter"] [data-split-word]')).flatMap((el) => el.getAnimations()).length,
          kind: document.documentElement.dataset.visitKind,
          phase: document.documentElement.dataset.entrance,
        }))
        // A mount reveal that replays fades in over its entrance; one that landed is opaque within a few frames.
        const replayed = ['#e-gsap-mount', '#e-motion'].filter((selector) => {
          const seen = back.rec.watched[selector]
          return !seen || seen.opaque === null || seen.opaque - seen.seen > 100
        })
        line(
          back.kind === 'traverse' && back.phase === 'settled' && back.words === 0 && replayed.length === 0 && !back.rec.phases.some((ph) => ph.phase === 'pending'),
          `kind ${back.kind}, phase ${back.phase}, ${back.words} word animations${replayed.length ? `, replayed: ${replayed.join(', ')}` : ''}`,
          'F3 back to /vt/enter: a traverse arrives settled, no word or mount reveal replays',
        )
      }
    } finally {
      await context.close()
    }
  })

  // F4: the same link, the contract in each place. Under ScrollSmoother a contract that syncs too early glides.
  const landings = []
  for (const place of ['before', 'after', 'around']) {
    await run(`F4 ${place}`, async () => {
      const { context, page } = await openAt(browser, base, { contract, place }, '/smoothed', 2400, errors)
      try {
        await page.evaluate(() => window.__rh.record())
        await page.evaluate(() => window.__rh.click('smoothed-more'))
        const s = await settle(page, '/smoothed/more')
        await contentStill(page)
        const rec = await page.evaluate(() => window.__rh.stopRecord())
        const glide = glideOf(rec, '/smoothed/more')
        const last = rec.frames[rec.frames.length - 1]
        landings.push({ place, y: s.y, c: last ? Math.round(last.c) : null, off: glide.off })
        line(
          near(s.y, 0) && glide.off === 0,
          `scrollY ${s.y}, content at ${last ? Math.round(last.c) : '–'} · ${glide.off}/${glide.frames} frames off the scroll position (worst ${glide.worst} px)`,
          `F4 link from /smoothed at 2400, contract ${place} the page: lands at the top, no glide`,
        )
      } finally {
        await context.close()
      }
    })
  }
  const same = landings.length === 3 && landings.every((l) => l.y === landings[0].y && l.c === landings[0].c && l.off === landings[0].off)
  line(same, landings.map((l) => `${l.place}: y ${l.y}, content ${l.c}, ${l.off} off`).join(' · '), 'F4 one result in all three places')

  // F5: back and forward under ScrollSmoother, and a link clicked right after a flick of the wheel.
  await run('F5', async () => {
    const { context, page } = await openAt(browser, base, { contract, place: contract === 'on' ? 'before' : 'around' }, '/smoothed', 2400, errors)
    try {
      // `slack`: a flick's last wheel events can land after the restore; they are the reader's, on the new page.
      const traverse = async (name, path, act, expectY, slack = 0) => {
        await page.evaluate(() => window.__rh.record())
        await act()
        const s = await settle(page, path)
        await contentStill(page)
        const rec = await page.evaluate(() => window.__rh.stopRecord())
        const glide = glideOf(rec, path)
        line(
          s.y >= expectY - 1 && s.y <= expectY + slack + 1 && glide.off === 0,
          `scrollY ${s.y} (expected ${expectY}${slack ? ` to ${expectY + slack}` : ''}), seen ${[...new Set(rec.frames.map((f) => `${f.p.split('/').pop()}@${Math.round(f.y)}`))].slice(0, 8).join(' → ')} · ${glide.off}/${glide.frames} frames off the scroll position (worst ${glide.worst} px)`,
          `F5 ${name}: lands where it was, no glide`,
        )
      }
      await page.evaluate(() => window.__rh.click('smoothed-more'))
      await settle(page, '/smoothed/more')
      await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), 900)
      await settle(page, '/smoothed/more')
      await contentStill(page)
      await traverse('back to /smoothed', '/smoothed', () => page.evaluate(() => history.back()), 2400)
      await traverse('forward to /smoothed/more', '/smoothed/more', () => page.evaluate(() => history.forward()), 900)
      await traverse(
        'a flick of the wheel, then back',
        '/smoothed',
        async () => {
          await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2)
          for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 250)
          await page.evaluate(() => history.back())
        },
        2400,
        750,
      )
      await page.evaluate(() => window.__rh.record())
      await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2)
      for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 250)
      await page.evaluate(() => window.__rh.click('smoothed-more'))
      const s = await settle(page, '/smoothed/more')
      await contentStill(page)
      const glide = glideOf(await page.evaluate(() => window.__rh.stopRecord()), '/smoothed/more')
      line(
        s.y >= 0 && s.y <= 751 && glide.off === 0,
        `scrollY ${s.y} (0 to 750) · ${glide.off}/${glide.frames} frames off the scroll position (worst ${glide.worst} px)`,
        'F5 a flick of the wheel, then a link: lands at the top, no glide',
      )
      // A link to a hash on another page. Next lands it with scrollIntoView(), which under ScrollSmoother scrolls the
      // fixed wrapper, not the page: the handle puts the wrapper back and lands the page on the target.
      await page.evaluate(() => history.back())
      await settle(page, '/smoothed')
      await contentStill(page)
      await page.evaluate(() => window.__rh.click('smoothed-more-hash'))
      const hashed = await settle(page, '/smoothed/more')
      await contentStill(page)
      const wrapperTop = await page.evaluate(() => document.getElementById('smooth-wrapper')?.scrollTop ?? null)
      line(
        near(hashed.hashTop, HEADER_H) && wrapperTop === 0 && hashed.y > 0,
        `${hashed.hash} top at ${hashed.hashTop} px (header ${HEADER_H}) · scrollY ${hashed.y} · wrapper scrollTop ${wrapperTop}`,
        'F5 a link to a hash on another page lands on it under ScrollSmoother',
      )
      await page.evaluate(() => history.back())
      await settle(page, '/smoothed')
      await contentStill(page)
      await page.evaluate(() => window.__rh.click('smoothed-more'))
      await settle(page, '/smoothed/more')
      await contentStill(page)
      // The reader's own wheel is still smoothed afterwards: the rule adopts placements, not input.
      await page.evaluate(() => window.__rh.record())
      await wheel(page, 3)
      const smoothed = await page.evaluate(() => window.__rh.stopRecord())
      const lag = Math.max(0, ...smoothed.frames.filter((f) => f.c !== null).map((f) => Math.abs(f.c - f.y)))
      if (contract === 'on') line(lag > GLIDE_PX, `content trailed the scroll by up to ${Math.round(lag)} px`, 'F5 a wheel after the navigation is still smoothed')
    } finally {
      await context.close()
    }
  })

  const unique = [...new Set(errors)]
  line(unique.length === 0, unique.slice(0, 3).join(' | '), 'lifecycle checks: no uncaught errors')
}

async function folioSequence({ browser, base, line }) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: 'no-preference' })
  await context.addInitScript(probes, { contract: 'legacy', place: 'around' })
  const errors = []
  try {
    const fresh = {}
    for (const [route, path] of [
      ['home', '/'],
      ['journal', '/journal'],
    ]) {
      const p = await context.newPage()
      await p.goto(`${base}${path}`, { waitUntil: 'load' })
      fresh[route] = (await settle(p, path)).triggers.map(({ id, start, end }) => ({ id, start, end }))
      await p.close()
    }
    const page = await context.newPage()
    page.on('pageerror', (e) => errors.push(e.message))
    const step = async (name, path, act, y) => {
      await act()
      const s = await settle(page, path)
      const route = path === '/' ? 'home' : 'journal'
      line(...authorityOf(s, route), `${name}: authority`)
      line(...triggersOf(s, fresh[route]), `${name}: triggers`)
      if (y !== null) line(...scrollOf(s, { y }), `${name}: scroll`)
    }
    // The position the page settled at (a short page clamps it).
    const scrollTo = async (y, path) => {
      await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y)
      return (await settle(page, path)).y
    }
    await page.goto(`${base}/`, { waitUntil: 'load' })
    await step('load Home', '/', async () => {}, null)
    const y1 = await scrollTo(Y1, '/')
    await step('link to Journal', '/journal', () => page.evaluate(() => window.__rh.click('/journal')), 0)
    const y2 = await scrollTo(Y2, '/journal')
    await step('back to Home', '/', () => page.evaluate(() => history.back()), y1)
    await step('forward to Journal', '/journal', () => page.evaluate(() => history.forward()), y2)
    await step('link to Home', '/', () => page.evaluate(() => window.__rh.click('/')), 0)
  } finally {
    await context.close()
  }
  const unique = [...new Set(errors)]
  line(unique.length === 0, unique.slice(0, 3).join(' | '), 'no uncaught errors')
}

// ── run ─────────────────────────────────────────────────────────────────

const open = { browser: null, server: null }
async function shutdown() {
  await open.browser?.close().catch(() => {})
  open.browser = null
  await stop(open.server?.child)
  open.server = null
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await shutdown()
    process.exit(130)
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!existsSync(join(folioModules, 'next'))) {
    console.error('[route-hygiene] examples/folio has no node_modules (the fixture borrows its Next): run `pnpm install` there first')
    return 2
  }
  let failures = 0
  let infos = 0
  for (const variant of args.variants) {
    open.server = await start(build(variant), variant)
    for (const browserName of args.browsers) {
      open.browser = await launch(BROWSERS[browserName])
      const before = variant === 'before'
      for (const prefix of before ? [''] : args.prefixes) {
        for (const contract of before ? ['legacy'] : args.contract) {
          const tag = `${variant}${prefix || ''}${contract === 'off' ? ' (no contract)' : before ? ' (2.1.2 blocks)' : contract === 'legacy' ? ' (2.1)' : ''}`
          // `off` measures the page with no contract; `legacy` is 2.1's, a failure only in its documented place.
          let informative = contract === 'off'
          const line = (ok, detail, name) => {
            const word = ok ? 'PASS' : informative ? 'INFO' : 'FAIL'
            if (!ok && informative) infos++
            else if (!ok) failures++
            console.log(`${word}  ${browserName.padEnd(8)}  ${tag.padEnd(22)}  ${name}${detail ? `  (${detail})` : ''}`)
          }
          if (before) informative = true
          if (variant === 'folio' || (!before && args.only.includes('sequence'))) {
            try {
              const run = variant === 'folio' ? folioSequence : sequence
              await run({ browser: open.browser, base: open.server.base, prefix, contract, line })
            } catch (err) {
              line(false, err.message.split('\n')[0], 'the sequence ran to completion')
            }
          }
          if (variant !== 'folio' && !prefix && contract !== 'off' && args.only.includes('lifecycle')) {
            informative = contract === 'legacy'
            await lifecycleSequence({ browser: open.browser, base: open.server.base, contract, line })
            informative = before
          }
          if (variant !== 'folio' && !before && !prefix && contract === 'on' && args.only.includes('arrival')) {
            try {
              await arrivalSequence({ browser: open.browser, base: open.server.base, line })
            } catch (err) {
              line(false, err.message.split('\n')[0], 'the arrival sequence ran to completion')
            }
          }
        }
      }
      await open.browser.close()
      open.browser = null
    }
    await stop(open.server.child)
    open.server = null
  }
  console.log(
    (failures ? `\n${failures} check(s) failed` : '\nall route-hygiene checks passed') +
      (infos ? ` · ${infos} INFO line(s): what fails without the contract, or with 2.1's` : ''),
  )
  return failures ? 1 : 0
}

let code = 1
try {
  code = await main()
} catch (err) {
  console.error(err)
} finally {
  await shutdown()
}
process.exit(code)
