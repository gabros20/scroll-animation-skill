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
//                                [--prefixes /,/vt] [--contract on,off] [--folio]
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

import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium, firefox, webkit } from 'playwright'

const testsDir = dirname(fileURLToPath(import.meta.url))
const repo = join(testsDir, '..')
const fixture = join(testsDir, 'fixtures', 'route-hygiene')
const scratch = join(testsDir, '.scratch', 'route-hygiene')
const assets = join(repo, 'skills', 'scroll-animation', 'assets')
const folioModules = join(repo, 'examples', 'folio', 'node_modules')
// The blocks the fixture imports, copied to <app>/animation the way `scroll-animation add` copies them.
const BLOCKS = ['config.ts', 'smooth/authority.ts', 'smooth/lenis.ts', 'smooth/SmoothScroll.tsx', 'smooth/route.ts', 'gsap/setup.ts']

const BROWSERS = { chromium, webkit, firefox }
const VARIANTS = { plain: '0', cache: '1' }
const VIEWPORT = { width: 1280, height: 800 }
const HEADER_H = 64
const Y1 = 3000
const Y2 = 900

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ── args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { browsers: Object.keys(BROWSERS), variants: Object.keys(VARIANTS), prefixes: ['', '/vt'], contract: ['on', 'off'], folio: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--browsers') out.browsers = argv[++i].split(',')
    else if (a === '--variants') out.variants = argv[++i].split(',')
    else if (a === '--prefixes') out.prefixes = argv[++i].split(',').map((p) => (p === '/' ? '' : p))
    else if (a === '--contract') out.contract = argv[++i].split(',')
    else if (a === '--folio') out.folio = true
    else throw new Error(`unknown argument: ${a}`)
  }
  for (const b of out.browsers) if (!BROWSERS[b]) throw new Error(`unknown browser: ${b}`)
  for (const v of out.variants) if (!VARIANTS[v]) throw new Error(`unknown variant: ${v} (${Object.keys(VARIANTS).join(', ')})`)
  for (const c of out.contract) if (c !== 'on' && c !== 'off') throw new Error(`unknown contract mode: ${c} (on, off)`)
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

const envFor = (variant) => ({ ...process.env, RH_ROOT: repo, RH_CACHE_COMPONENTS: VARIANTS[variant] ?? '0', NEXT_TELEMETRY_DISABLED: '1' })
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
function probes(contractOff) {
  try {
    if (contractOff) sessionStorage.setItem('rh:contract', 'off')
    else sessionStorage.removeItem('rh:contract')
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
  let frames = null
  const frame = () => {
    if (!frames) return
    const lenis = window.__rhLenis
    frames.push({ p: location.pathname, y: window.scrollY, ly: lenis ? lenis.animatedScroll : null, s: lenis ? lenis.isScrolling : null })
    requestAnimationFrame(frame)
  }
  window.__rh = {
    liveLenis: () => live.size,
    record() {
      frames = []
      window.__rhLog.length = 0
      requestAnimationFrame(frame)
    },
    stopRecord() {
      const out = { frames: frames ?? [], log: window.__rhLog.slice() }
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
  await sleep(250)
  return page.evaluate(() => window.__rh.state())
}

async function wheel(page, notches, delta = 100) {
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2)
  for (let i = 0; i < notches; i++) {
    await page.mouse.wheel(0, delta)
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
  await context.addInitScript(probes, contract === 'off')
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

async function folioSequence({ browser, base, line }) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: 'no-preference' })
  await context.addInitScript(probes, false)
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
      open.browser = await BROWSERS[browserName].launch()
      for (const prefix of args.prefixes) {
        for (const contract of args.contract) {
          const tag = `${variant}${prefix || ''}${contract === 'off' ? ' (no contract)' : ''}`
          const line = (ok, detail, name) => {
            const word = ok ? 'PASS' : contract === 'off' ? 'INFO' : 'FAIL'
            if (!ok && contract === 'off') infos++
            else if (!ok) failures++
            console.log(`${word}  ${browserName.padEnd(8)}  ${tag.padEnd(22)}  ${name}${detail ? `  (${detail})` : ''}`)
          }
          try {
            const run = variant === 'folio' ? folioSequence : sequence
            await run({ browser: open.browser, base: open.server.base, prefix, contract, line })
          } catch (err) {
            line(false, err.message.split('\n')[0], 'the sequence ran to completion')
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
      (infos ? ` · ${infos} INFO line(s): what fails without the contract` : ''),
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
