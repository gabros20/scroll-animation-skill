#!/usr/bin/env node
// header-theme.mjs: the header ink (assets/header-theme.ts, motion/useHeaderTheme.ts, css/header-theme.css) in
// Chromium, WebKit and Firefox. The ink follows the sections crossing the probe line, down and up, nested and
// overlapping ones included; it follows the page on screen, frame by frame, under native scrolling, Lenis and
// ScrollSmoother; a header resize moves the line; the default applies between themed sections; sections that come and
// go are picked up without a flash; no scroll listener, no requestAnimationFrame and one observer callback per edge
// crossing; forced colors reset the blend variant; the React hook tracks the attribute and cleans up on unmount and on
// Activity hide. Builds tests/fixtures/header-theme with Vite (the React page's server render first, for Node), serves
// it with `vite preview`, prints one PASS/FAIL line per check/page/browser, and exits 1 on any FAIL. Needs the
// Playwright browsers, so it is its own script: `npm run test:header-theme`.
//
//   node tests/header-theme.mjs [--browsers chromium,webkit,firefox] [--pages native,lenis,smoother,motion] [--only ink,…]
//
// Pages share one layout (tests/fixtures/header-theme/src/layout.ts): native (no scroll authority), lenis (Lenis on
// its own rAF driver), smoother (ScrollSmoother, the header outside the wrapper) and motion (React, server-rendered and
// hydrated, the header's ink from the hook).

import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium, firefox, webkit } from 'playwright'
import { build, preview } from 'vite'

const testsDir = dirname(fileURLToPath(import.meta.url))
const fixtureRoot = join(testsDir, 'fixtures', 'header-theme')
const outDir = join(testsDir, '.scratch', 'header-theme-dist')
const ssrDir = join(testsDir, '.scratch', 'header-theme-ssr')
const { DEFAULT_INK, HEADER_H, headerMarkup, markup, tops } = await import(
  pathToFileURL(join(fixtureRoot, 'src', 'layout.ts')).href
)

const BROWSERS = { chromium, webkit, firefox }
const PAGES = ['native', 'lenis', 'smoother', 'motion']
const VIEWPORT = { width: 1280, height: 800 }
/** A smooth scroll (Lenis, ScrollSmoother's catch-up) settles well inside this. */
const SETTLE_MS = 6000
/**
 * How many frames the ink may trail the page on screen. The observer reports in a task after the frame it measured,
 * usually by the next frame; a busy main thread (ScrollSmoother's per-frame work) can hold that task a few frames. 6 is
 * 100 ms at 60 Hz, well inside the ink's 200 ms transition.
 */
const LAG_FRAMES = 6
/** How far back an ink is looked for on screen: found there, it trails; never there, it leads (or is wrong). */
const LOOKBACK_FRAMES = 30
const SCROLL_EVENTS = ['scroll', 'scrollend', 'wheel', 'mousewheel', 'DOMMouseScroll', 'touchstart', 'touchmove', 'touchend']

const T = tops()
/** [label, document y the probe line sits on, the ink expected there]: every section kind, top to bottom. */
const STOPS = [
  ['hero', T.hero + 500, 'night'],
  ['gap (default)', T.gap1 + 200, DEFAULT_INK],
  ['day', T.day + 400, 'day'],
  ['brand', T.brand + 300, 'brand'],
  ['outer', T.outer + 200, 'day'],
  ['nested inner', T.inner + 150, 'night'],
  ['outer past inner', T.inner + 450, 'day'],
  ['second gap', T.gap2 + 150, DEFAULT_INK],
  ['over-a', T['over-a'] + 200, 'day'],
  ['over-b pulled over over-a', T['over-b'] + 100, 'brand'],
  ['over-b', T['over-b'] + 400, 'brand'],
  ['footer', T.footer + 400, 'night'],
  ['tail (default)', T.tail + 200, DEFAULT_INK],
]
/** [label, document y of an edge, ink above it, ink below it]. */
const EDGES = [
  ['gap → day', T.day, DEFAULT_INK, 'day'],
  ['day → brand', T.brand, 'day', 'brand'],
  ['nested inner → outer', T.inner + 300, 'night', 'day'],
  ['over-a → over-b', T['over-b'], 'day', 'brand'],
]

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
  for (const c of out.only ?? []) if (!CHECKS[c]) throw new Error(`unknown check: ${c} (${Object.keys(CHECKS).join(', ')})`)
  return out
}

// ── build + serve ──────────────────────────────────────────────────────

function onwarn(warning, warn) {
  // The React blocks open with 'use client', meaningless outside a server-components bundler.
  if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
  if (warning.code === 'SOURCEMAP_ERROR' && /\.tsx? \(1:0\)/.test(warning.message)) return
  warn(warning)
}

/** The React page's server render, built for Node and run here: the HTML a Next page ships before hydration. */
async function serverRender() {
  await build({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'warn',
    publicDir: false,
    esbuild: { jsx: 'automatic' },
    build: {
      ssr: join(fixtureRoot, 'src', 'motion-ssr.tsx'),
      outDir: ssrDir,
      emptyOutDir: true,
      rollupOptions: { onwarn, output: { entryFileNames: 'motion-ssr.mjs' } },
    },
  })
  const { render } = await import(pathToFileURL(join(ssrDir, 'motion-ssr.mjs')).href)
  return render()
}

async function serve(ssrHtml) {
  await build({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'warn',
    publicDir: false,
    esbuild: { jsx: 'automatic' },
    plugins: [
      {
        name: 'header-theme-fixture',
        transformIndexHtml: {
          order: 'pre',
          handler: (html) =>
            html
              .replace('<!--header-->', () => headerMarkup())
              .replace('<!--page-->', () => markup())
              .replace('<!--ssr-->', () => ssrHtml),
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

// ── in-page instrumentation ─────────────────────────────────────────────

/**
 * Installed before any page script. Spies on listeners, requestAnimationFrame and the three observers (labelled with
 * the phase the harness marks while the block mounts), and adds `window.__t`: what the checks read. Its own work uses
 * the native functions, so it never shows up in the spy.
 */
function instrument(scrollEvents) {
  const native = {
    raf: window.requestAnimationFrame.bind(window),
    add: EventTarget.prototype.addEventListener,
    remove: EventTarget.prototype.removeEventListener,
    IO: window.IntersectionObserver,
    RO: window.ResizeObserver,
    MO: window.MutationObserver,
  }
  const spy = { phase: null, listeners: [], observers: [], rafCalls: 0, ioCallbacks: 0 }
  spy.mark = (phase) => (spy.phase = phase)
  window.__spy = spy
  const label = (target) =>
    target === window
      ? 'window'
      : target === document
        ? 'document'
        : target instanceof Element
          ? `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ''}`
          : (target?.constructor?.name ?? 'other')
  EventTarget.prototype.addEventListener = function (type, fn, options) {
    const stack = scrollEvents.includes(type) ? new Error().stack.split('\n').slice(2, 5).join(' < ') : ''
    spy.listeners.push({ type, where: label(this), phase: spy.phase, target: this, fn, live: true, stack })
    return native.add.call(this, type, fn, options)
  }
  EventTarget.prototype.removeEventListener = function (type, fn, options) {
    const found = spy.listeners.find((l) => l.live && l.type === type && l.fn === fn && l.target === this)
    if (found) found.live = false
    return native.remove.call(this, type, fn, options)
  }
  window.requestAnimationFrame = (cb) => {
    spy.rafCalls++
    return native.raf(cb)
  }
  const wrap = (Native, kind) =>
    class extends Native {
      constructor(callback, options) {
        const record = { kind, phase: spy.phase, disconnected: false, targets: 0, callbacks: 0, stack: new Error().stack.split('\n').slice(2, 5).join(' < ') }
        super((...args) => {
          record.callbacks++
          if (kind === 'io') spy.ioCallbacks++
          return callback(...args)
        }, options)
        // Playwright's own main-world script observes the document too: tooling, not the page.
        if (!/InjectedScript/.test(record.stack)) spy.observers.push(record)
        this.__record = record
      }
      observe(...args) {
        this.__record.targets++
        return super.observe(...args)
      }
      disconnect() {
        this.__record.disconnected = true
        return super.disconnect()
      }
    }
  window.IntersectionObserver = wrap(native.IO, 'io')
  window.ResizeObserver = wrap(native.RO, 'ro')
  window.MutationObserver = wrap(native.MO, 'mo')

  const header = () => document.querySelector('[data-header]')
  const themed = () => [...document.querySelectorAll('[data-header-theme]')].filter((el) => !header()?.contains(el))
  const lineY = (fraction) => header().offsetTop + header().offsetHeight * fraction
  const fallback = () => header()?.getAttribute('data-header-ink-default') ?? null
  const docTop = (el) => {
    let y = 0
    for (let n = el; n; n = n.offsetParent) y += n.offsetTop
    return y
  }
  const round = (v) => Math.round(v * 100) / 100
  let sampler = null
  let writes = []
  let writeWatch = null

  window.__t = {
    frames: (n) =>
      new Promise((resolve) => {
        let i = 0
        const step = () => (++i >= n ? resolve() : native.raf(step))
        native.raf(step)
      }),
    ink: () => header()?.getAttribute('data-header-ink') ?? null,
    hookInk: () => header()?.getAttribute('data-hook-ink') ?? null,
    /** The ink a reader sees: the last themed section (document order) whose painted box holds the probe line. */
    visual(fraction = 1) {
      const y = lineY(fraction) + 0.5
      let token = null
      for (const el of themed()) {
        const r = el.getBoundingClientRect()
        if (r.height > 0 && r.top <= y && r.bottom > y) token = el.getAttribute('data-header-theme')
      }
      return token ?? fallback()
    },
    /** The same from layout and window.scrollY: what a probe reading the scroll position would say. */
    byScrollY(fraction = 1) {
      const y = window.scrollY + lineY(fraction) + 0.5
      let token = null
      for (const el of themed()) {
        const top = docTop(el)
        if (el.offsetHeight > 0 && top <= y && top + el.offsetHeight > y) token = el.getAttribute('data-header-theme')
      }
      return token ?? fallback()
    },
    /** The themed sections the 1 px band holds, as a key: its changes are the observer's work. */
    band(fraction = 1) {
      const y = lineY(fraction)
      return themed()
        .filter((el) => {
          const r = el.getBoundingClientRect()
          return r.height > 0 && r.top < y + 1 && r.bottom > y
        })
        .map((el) => el.id)
        .join('+')
    },
    scrollY: () => Math.round(window.scrollY),
    lineY: (fraction = 1) => round(lineY(fraction)),
    /** Every frame until stopSample(): the ink, what is on screen, what window.scrollY says and the band. */
    sample() {
      const rows = []
      const tick = () => {
        rows.push({ ink: window.__t.ink(), visual: window.__t.visual(), byScrollY: window.__t.byScrollY(), band: window.__t.band() })
        sampler = native.raf(tick)
      }
      tick()
      window.__t.stopSample = () => {
        cancelAnimationFrame(sampler)
        return rows
      }
    },
    /** Records every data-header-ink write on the current header from now on. */
    watchWrites() {
      writeWatch?.disconnect()
      writes = []
      writeWatch = new native.MO((records) => {
        for (const r of records) writes.push({ from: r.oldValue, to: r.target.getAttribute('data-header-ink') })
      })
      writeWatch.observe(header(), { attributes: true, attributeFilter: ['data-header-ink'], attributeOldValue: true })
    },
    writes: () => writes.slice(),
    /** Zeroes the counters, so a measured window excludes the tooling's own frames (Playwright's polling uses rAF). */
    resetSpy() {
      spy.rafCalls = 0
      spy.ioCallbacks = 0
    },
    spy() {
      return {
        // Playwright's own main-world script adds touch listeners for its hit-target checks: tooling, not the page.
        scrollListeners: spy.listeners
          .filter((l) => scrollEvents.includes(l.type) && !/InjectedScript/.test(l.stack))
          .map((l) => `${l.type}@${l.where} [${l.stack}]`),
        mountListeners: spy.listeners.filter((l) => l.phase === 'mount').map((l) => `${l.type}@${l.where}`),
        liveMount: spy.listeners.filter((l) => l.phase === 'mount' && l.live).map((l) => `${l.type}@${l.where}`),
        rafCalls: spy.rafCalls,
        ioCallbacks: spy.ioCallbacks,
        observers: spy.observers.map((o) => ({ kind: o.kind, phase: o.phase, disconnected: o.disconnected, targets: o.targets })),
      }
    },
    /** Observers the block still holds: not disconnected, watching something. */
    liveObservers: () =>
      spy.observers.filter((o) => !o.disconnected && o.targets > 0).map((o) => o.kind).sort().join(','),
    liveObserverStacks: () => spy.observers.filter((o) => !o.disconnected && o.targets > 0).map((o) => `${o.kind}: ${o.stack}`),
    liveListeners: (type, where) => spy.listeners.filter((l) => l.live && l.type === type && l.where === where).length,
    style(selector) {
      const cs = getComputedStyle(document.querySelector(selector))
      return {
        blend: cs.mixBlendMode,
        color: cs.color,
        property: cs.transitionProperty,
        duration: cs.transitionDuration,
        timing: cs.transitionTimingFunction,
      }
    },
    forced: () => matchMedia('(forced-colors: active)').matches,
  }
}

// ── helpers ─────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Polls `fn` in the page until it returns truthy; resolves with the elapsed ms, or null on timeout. */
async function until(page, fn, arg, timeout = SETTLE_MS) {
  const t0 = Date.now()
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 'raf' })
    return Date.now() - t0
  } catch {
    return null
  }
}

/** The scroll position that puts the probe line on document y `y`. */
const scrollFor = (y, line = HEADER_H) => y - line

/** Scrolls at once (through the page's authority) and waits for the page on screen to hold still. */
async function jump(page, y) {
  await page.evaluate((top) => window.__fx.scrollTo(top, true), y)
  await page.evaluate(() => window.__t.frames(3))
  await until(
    page,
    () => {
      const now = window.__t.visual() + window.__t.scrollY()
      const settled = now === window.__last
      window.__last = now
      return settled
    },
    null,
    2000,
  )
}

/** Waits for the ink to equal `want`; returns [ok, ms, the ink and the ink on screen]. `fraction` places the line. */
async function inkBecomes(page, want, { timeout = 2000, fraction = 1 } = {}) {
  const ms = await until(page, (w) => window.__t.ink() === w, want, timeout)
  const [ink, visual] = await page.evaluate((f) => [window.__t.ink(), window.__t.visual(f)], fraction)
  return [ms !== null && visual === want, ms, ink, visual]
}

/**
 * Every frame whose ink isn't what is on screen: trailing when the screen showed that ink within LOOKBACK_FRAMES,
 * leading (or plainly wrong) when it didn't. `ahead` counts frames where window.scrollY disagreed with the screen.
 */
function lagReport(rows) {
  let bad = 0
  let lead = 0
  let ahead = 0
  let lagMax = 0
  const examples = []
  rows.forEach((row, i) => {
    if (row.byScrollY !== row.visual) ahead++
    if (row.ink === row.visual) return
    let lag = null
    for (let j = i - 1; j >= Math.max(0, i - LOOKBACK_FRAMES); j--) {
      if (rows[j].visual === row.ink) {
        lag = i - j
        break
      }
    }
    if (lag === null) {
      bad++
      if (row.ink === row.byScrollY) lead++
      if (examples.length < 3) examples.push(`frame ${i}: ink ${row.ink}, screen ${row.visual}, scrollY says ${row.byScrollY}`)
    } else lagMax = Math.max(lagMax, lag)
  })
  const bandChanges = rows.filter((row, i) => i > 0 && row.band !== rows[i - 1].band).length
  return { frames: rows.length, bad, lead, ahead, lagMax, bandChanges, examples }
}

/** Wheels through the whole page and back, sampling every frame. */
async function wheelThrough(page, step = 320, count = 26) {
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2)
  await page.evaluate(() => {
    window.__t.resetSpy()
    window.__t.sample()
  })
  for (let i = 0; i < count; i++) {
    await page.mouse.wheel(0, step)
    await sleep(45)
  }
  await sleep(1600)
  for (let i = 0; i < count; i++) {
    await page.mouse.wheel(0, -step)
    await sleep(45)
  }
  await sleep(1600)
  return page.evaluate(() => window.__t.stopSample())
}

// ── checks ──────────────────────────────────────────────────────────────
// Each takes a `t` bound to one browser + one page and returns [[name, ok, detail], ...].

const CHECKS = {
  ink: {
    pages: PAGES,
    async run(t) {
      const { page } = await t.open()
      const out = []
      for (const [direction, stops] of [
        ['down', STOPS],
        ['up', [...STOPS].reverse()],
      ]) {
        const seen = []
        let ok = true
        for (const [label, y, want] of stops) {
          await jump(page, scrollFor(y))
          const [landed, ms, ink, visual] = await inkBecomes(page, want)
          const hook = t.page === 'motion' ? await page.evaluate(() => window.__t.hookInk()) : want
          ok &&= landed && hook === want
          seen.push(`${label}: ${ink}${visual !== want ? ` (screen ${visual})` : ''}${hook !== want ? ` (hook ${hook})` : ''}${ms === null ? ' ✗' : ''}`)
        }
        out.push([
          `scrolling ${direction}, the ink is the section under the line: nested → the inner one, overlapping → the later one, gaps → the default${t.page === 'motion' ? '; the hook returns it too' : ''}`,
          ok,
          seen.join(' · '),
        ])
      }
      return out
    },
  },

  edges: {
    pages: PAGES,
    async run(t) {
      const { page } = await t.open()
      const seen = []
      let ok = true
      for (const [label, edge, above, below] of EDGES) {
        // The edge 3 px below the line, then 3 px above it, then back: the line is the header's bottom edge.
        for (const [offset, want] of [
          [3, above],
          [-3, below],
          [3, above],
        ]) {
          await jump(page, edge - HEADER_H - offset)
          const [landed, , ink] = await inkBecomes(page, want)
          ok &&= landed
          seen.push(`${label} ${offset > 0 ? 'below' : 'above'} the line: ${ink}`)
        }
      }
      return [['an edge flips the ink as it crosses the header\'s bottom edge (±3 px), in both directions', ok, seen.join(' · ')]]
    },
  },

  follow: {
    pages: PAGES,
    async run(t) {
      const { page } = await t.open()
      const rows = await wheelThrough(page)
      const r = lagReport(rows)
      const spy = await page.evaluate(() => window.__t.spy())
      const end = await page.evaluate(() => [window.__t.ink(), window.__t.visual()])
      const smoother = t.page === 'smoother'
      return [
        [
          `wheeled through the page and back: the ink follows the page on screen within ${LAG_FRAMES} frames and never leads it` +
            (smoother ? ', though window.scrollY runs ahead' : ''),
          r.frames > 60 && r.bad === 0 && r.lagMax <= LAG_FRAMES && end[0] === end[1] && (!smoother || r.ahead > 0),
          `${r.frames} frames · inks never on screen ${r.bad} (${r.lead} of them where scrollY pointed) · max lag ${r.lagMax} frames · ` +
            `frames where scrollY disagreed with the screen: ${r.ahead} · at rest ${end[0]}/${end[1]}` +
            (r.examples.length ? ` · ${r.examples.join('; ')}` : ''),
        ],
        [
          'no per-frame work: one observer callback or fewer per change in what the band holds',
          spy.ioCallbacks <= r.bandChanges + 4,
          `${spy.ioCallbacks} observer callbacks for ${r.bandChanges} band changes over ${r.frames} frames`,
        ],
      ]
    },
  },

  resize: {
    pages: ['native', 'smoother', 'motion'],
    async run(t) {
      const { page } = await t.open()
      // The gap → day edge 100 px down the viewport: above a 64 px header's line, below a 160 px one's.
      await jump(page, T.day - 100)
      const [before] = await inkBecomes(page, DEFAULT_INK)
      await page.evaluate(() => (document.querySelector('[data-header]').style.height = '160px'))
      const [taller, ms, ink] = await inkBecomes(page, 'day')
      const line = await page.evaluate(() => window.__t.lineY())
      await page.evaluate(() => (document.querySelector('[data-header]').style.height = ''))
      const [back, , inkBack] = await inkBecomes(page, DEFAULT_INK)
      return [
        [
          'a taller header moves the line with it (no scroll): the section under the new bottom edge takes over, and back',
          before && taller && back && line === 160,
          `line ${HEADER_H} → ${line}: ${DEFAULT_INK} → ${ink} in ${ms} ms → back to ${inkBack}`,
        ],
      ]
    },
  },

  line: {
    pages: ['native'],
    async run(t) {
      const { page } = await t.open('?line=0.5')
      // line: 0.5 puts the probe at 32 px. The gap → day edge at 48 px is below it, then at 16 px above it.
      await jump(page, T.day - 48)
      const [below, , ink1] = await inkBecomes(page, DEFAULT_INK, { fraction: 0.5 })
      await jump(page, T.day - 16)
      const [above, , ink2] = await inkBecomes(page, 'day', { fraction: 0.5 })
      const line = await page.evaluate(() => window.__t.lineY(0.5))
      return [
        ["`line: 0.5` probes the header's middle", below && above && line === 32, `line ${line}: edge at 48 px → ${ink1}, at 16 px → ${ink2}`],
      ]
    },
  },

  fallback: {
    pages: ['native'],
    async run(t) {
      const { page } = await t.open()
      await jump(page, scrollFor(T.gap1 + 200))
      const [gap] = await inkBecomes(page, DEFAULT_INK)
      await page.evaluate(() => document.querySelector('[data-header]').removeAttribute('data-header-ink-default'))
      const none = await until(page, () => window.__t.ink() === null, null, 2000)
      await page.evaluate(() => document.querySelector('[data-header]').setAttribute('data-header-ink-default', 'mist'))
      const [mist] = await inkBecomes(page, 'mist')
      await page.evaluate((d) => document.querySelector('[data-header]').setAttribute('data-header-ink-default', d), DEFAULT_INK)
      await jump(page, scrollFor(T.day + 200))
      const [day] = await inkBecomes(page, 'day')
      return [
        [
          'between themed sections the header takes data-header-ink-default; without one it has no ink; a new default applies at once',
          gap && none !== null && mist && day,
          `gap: ${gap ? DEFAULT_INK : 'wrong'} · default removed: ${none !== null ? 'no attribute' : 'still set'} · default "mist": ${mist ? 'mist' : 'no'} · then day: ${day}`,
        ],
      ]
    },
  },

  dom: {
    pages: ['native', 'motion'],
    async run(t) {
      const { page } = await t.open()
      const out = []
      // A route change: the section under the line is removed and another inserted in its place, in one task.
      await jump(page, scrollFor(T.day + 400))
      await inkBecomes(page, 'day')
      await page.evaluate(() => window.__t.watchWrites())
      await page.evaluate(() => {
        const old = document.getElementById('day')
        const next = document.createElement('section')
        next.id = 'day-new'
        next.className = 'band'
        next.style.height = old.style.height || `${old.offsetHeight}px`
        next.setAttribute('data-header-theme', 'mint')
        old.replaceWith(next)
      })
      const [swapped, ms] = await inkBecomes(page, 'mint')
      await page.evaluate(() => window.__t.frames(4))
      const swapWrites = await page.evaluate(() => window.__t.writes())
      out.push([
        'a section swapped in under the line (a route change) takes over, with no flash of the default in between',
        swapped && swapWrites.length === 1 && swapWrites[0].to === 'mint',
        `mint in ${ms} ms · writes ${JSON.stringify(swapWrites)}`,
      ])
      await page.evaluate(() => document.getElementById('day-new').setAttribute('data-header-theme', 'rose'))
      const [retheme, ms2] = await inkBecomes(page, 'rose')
      out.push(['a section under the line that changes its token takes the header with it', retheme, `rose in ${ms2} ms`])
      await jump(page, scrollFor(T.inner + 150))
      await inkBecomes(page, 'night')
      await page.evaluate(() => (document.getElementById('inner').style.display = 'none'))
      const [hidden, , inkHidden] = await inkBecomes(page, 'day')
      await page.evaluate(() => (document.getElementById('inner').style.display = ''))
      const [shown, , inkShown] = await inkBecomes(page, 'night')
      out.push([
        'a section hidden with display: none (a route Activity hides) drops out, and comes back when shown',
        hidden && shown,
        `inner hidden → ${inkHidden}, shown → ${inkShown}`,
      ])
      await jump(page, scrollFor(T.gap2 + 150))
      await inkBecomes(page, DEFAULT_INK)
      await page.evaluate(() => {
        const add = document.createElement('div')
        add.setAttribute('data-header-theme', 'mint')
        add.style.height = '300px'
        document.getElementById('gap2').append(add)
      })
      const [added, ms3] = await inkBecomes(page, 'mint')
      out.push(['a themed section added later, nested in a gap, is picked up', added, `mint in ${ms3} ms`])
      return out
    },
  },

  listeners: {
    pages: ['native', 'lenis', 'smoother'],
    async run(t) {
      const { page } = await t.open()
      await page.evaluate(() => window.__t.watchWrites())
      const rows = await wheelThrough(page, 400, 20)
      await page.setViewportSize({ width: 1000, height: 700 })
      await page.evaluate(() => window.__t.frames(10))
      await page.setViewportSize(VIEWPORT)
      await page.evaluate(() => window.__t.frames(10))
      const spy = await page.evaluate(() => window.__t.spy())
      const writes = await page.evaluate(() => window.__t.writes())
      const inkChanges = rows.filter((row, i) => i > 0 && row.ink !== rows[i - 1].ink).length
      const mountObservers = spy.observers.filter((o) => o.phase === 'mount').map((o) => o.kind).sort().join(',')
      const out = [
        [
          'mounting adds one listener, resize on window, and one each of IntersectionObserver, MutationObserver and ResizeObserver',
          spy.mountListeners.join(',') === 'resize@window' && mountObservers === 'io,mo,ro',
          `listeners: ${spy.mountListeners.join(', ') || 'none'} · observers: ${mountObservers}`,
        ],
        [
          'a write only when the ink changes',
          inkChanges > 0 && writes.length >= inkChanges && writes.every((w) => w.from !== w.to),
          `${writes.length} writes, ${inkChanges} ink changes seen frame by frame` +
            `${writes.some((w) => w.from === w.to) ? ' (some rewrote the same ink)' : ''}`,
        ],
      ]
      if (t.page === 'native') {
        // Nothing else on this page listens to scrolling or asks for frames, so anything here would be the block's.
        out.push([
          'no scroll, wheel or touch listener and no requestAnimationFrame, through a scroll down and up and two resizes',
          spy.scrollListeners.length === 0 && spy.rafCalls === 0,
          `scroll-type listeners: ${spy.scrollListeners.join(', ') || 'none'} · requestAnimationFrame calls: ${spy.rafCalls}`,
        ])
      }
      return out
    },
  },

  blend: {
    pages: ['native'],
    async run(t) {
      const { page } = await t.open()
      await page.evaluate(() => document.querySelector('[data-header]').setAttribute('data-header-blend', ''))
      const normal = await page.evaluate(() => window.__t.style('[data-header]'))
      await page.emulateMedia({ forcedColors: 'active' })
      const forced = await page.evaluate(() => ({ ...window.__t.style('[data-header]'), on: window.__t.forced() }))
      await page.emulateMedia({ forcedColors: 'none' })
      return [
        [
          'data-header-blend: white ink in a difference blend; forced colors reset it to a normal blend',
          normal.blend === 'difference' && normal.color === 'rgb(255, 255, 255)' && forced.on && forced.blend === 'normal',
          `blend ${normal.blend}, color ${normal.color} → forced colors (${forced.on ? 'on' : 'not emulated'}): ${forced.blend}`,
        ],
      ]
    },
  },

  transition: {
    pages: ['native'],
    async run(t) {
      const { page } = await t.open()
      const header = await page.evaluate(() => window.__t.style('[data-header]'))
      const logo = await page.evaluate(() => window.__t.style('[data-logo]'))
      const { page: reduced } = await t.open('', { reducedMotion: 'reduce' })
      const still = await reduced.evaluate(() => window.__t.style('[data-header]'))
      const same = (s) => /color/.test(s.property) && s.duration.split(', ').every((d) => d === '0.2s') && /ease-out/.test(s.timing)
      const inherited = (s) => s.property.split(', ').filter((p) => ['color', 'fill', 'stroke'].includes(p))
      return [
        [
          'css/header-theme.css: one 200 ms ease-out transition, every colour on the header, only what doesn\'t inherit on its parts; none under reduced motion',
          same(header) && inherited(header).length === 3 && same(logo) && inherited(logo).length === 0 &&
            still.duration.split(', ').every((d) => d === '0s'),
          `header ${header.property} ${header.duration} ${header.timing} · logo ${logo.property} · reduced: ${still.duration}`,
        ],
      ]
    },
  },

  // A link two levels down inherits the header's colour. Transitioning it there too made it restart on every frame of
  // the header's transition and trail it by 200–400 ms (seen in Folio).
  trail: {
    pages: ['native'],
    async run(t) {
      const { page } = await t.open()
      await jump(page, scrollFor(T.day + 400))
      await inkBecomes(page, 'day')
      await page.evaluate(() => window.__t.frames(30))
      const r = await page.evaluate(
        (y) =>
          new Promise((resolve) => {
            const header = document.querySelector('[data-header]')
            const link = document.querySelector('[data-link]')
            let flip = 0
            let final = ''
            let headerAt = 0
            let linkAt = 0
            const start = performance.now()
            window.__fx.scrollTo(y, true)
            const tick = (now) => {
              if (!flip && header.getAttribute('data-header-ink') === 'night') {
                flip = now
                // The ink's target colour, read off a probe that takes the same rule without a transition.
                const probe = header.cloneNode(false)
                probe.style.transition = 'none'
                probe.style.visibility = 'hidden'
                document.body.append(probe)
                final = getComputedStyle(probe).color
                probe.remove()
              }
              if (flip && !headerAt && getComputedStyle(header).color === final) headerAt = now
              if (flip && !linkAt && getComputedStyle(link).color === final) linkAt = now
              if ((headerAt && linkAt) || now - start > 2000) {
                resolve({ final, header: headerAt && Math.round(headerAt - flip), link: linkAt && Math.round(linkAt - flip) })
              } else requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          }),
        scrollFor(T.hero + 500),
      )
      return [
        [
          'a nested link that inherits the ink lands with the header, not on a transition of its own',
          r.header > 0 && r.link > 0 && r.link - r.header <= 50,
          JSON.stringify(r),
        ],
      ]
    },
  },

  // A sticky header's offsetTop is its place in the document, which runs with the scroll once it sticks: mounted mid-page
  // (a route shown again, a resize), a probe read from it lands off screen. The block probes where it sticks instead.
  sticky: {
    pages: ['native'],
    async run(t) {
      const { page } = await t.open()
      await page.evaluate(() => {
        const header = document.querySelector('[data-header]')
        header.style.position = 'sticky'
        header.style.top = '0px'
      })
      const rows = []
      for (const token of ['day', 'brand', 'night']) {
        const y = await page.evaluate((tk) => {
          const el = document.querySelector(`[data-header-theme="${tk}"]`)
          const header = document.querySelector('[data-header]')
          return el.getBoundingClientRect().top + window.scrollY + 100 - header.offsetHeight
        }, token)
        await jump(page, y)
        await page.evaluate(() => window.__fx.mount())
        const ms = await until(page, (w) => window.__t.ink() === w, token, 2000)
        const seen = await page.evaluate(() => {
          const line = document.querySelector('[data-header]').getBoundingClientRect().bottom + 0.5
          let token = null
          for (const el of document.querySelectorAll('[data-header-theme]')) {
            const r = el.getBoundingClientRect()
            if (r.height > 0 && r.top <= line && r.bottom > line) token = el.getAttribute('data-header-theme')
          }
          return token
        })
        rows.push({ token, ms, seen, ink: await page.evaluate(() => window.__t.ink()) })
      }
      return [
        [
          'a sticky header mounted mid-page, once stuck, takes the ink of the section under its bottom edge',
          rows.every((r) => r.ms !== null && r.seen === r.token),
          rows.map((r) => `${r.token}: ink ${r.ink}, on screen ${r.seen}${r.ms === null ? ' (never)' : ''}`).join(' · '),
        ],
      ]
    },
  },

  activity: {
    pages: ['motion'],
    async run(t) {
      const { page } = await t.open()
      await jump(page, scrollFor(T.brand + 300))
      await inkBecomes(page, 'brand')
      const before = await page.evaluate(() => window.__t.liveObservers())
      await page.evaluate(() => window.__fx.hide())
      await page.evaluate(() => window.__t.frames(4))
      const hidden = await page.evaluate(() => [
        window.__t.liveObservers(),
        window.__t.liveListeners('resize', 'window'),
        window.__t.liveObserverStacks(),
      ])
      // While hidden, the page moves on: nothing may follow it.
      await jump(page, scrollFor(T.footer + 400))
      await page.evaluate(() => window.__t.frames(6))
      const stale = await page.evaluate(() => window.__t.ink())
      await page.evaluate(() => window.__fx.show())
      const [shown, ms, ink] = await inkBecomes(page, 'night')
      const hook = await page.evaluate(() => window.__t.hookInk())
      const after = await page.evaluate(() => window.__t.liveObservers())
      const out = [
        [
          'Activity hide disconnects every observer and the resize listener; showing mounts again and catches up with the page',
          before === 'io,mo,ro' &&
            hidden[0] === '' &&
            hidden[1] === 0 &&
            stale === 'brand' &&
            shown &&
            hook === 'night' &&
            after === 'io,mo,ro',
          `live before: ${before} · hidden: ${hidden[0] || 'none'}${hidden[0] ? ` ${JSON.stringify(hidden[2])}` : ''}, resize listeners on window ${hidden[1]}, ink stays ${stale} · ` +
            `shown: ${ink} in ${ms} ms, hook ${hook}, live ${after}`,
        ],
      ]
      await page.evaluate(() => window.__fx.unmount())
      await page.evaluate(() => window.__t.frames(4))
      const gone = await page.evaluate(() => [window.__t.liveObservers(), window.__t.liveListeners('resize', 'window')])
      await page.evaluate(() => window.__fx.remount())
      await jump(page, scrollFor(T.day + 400))
      const [back, , inkBack] = await inkBecomes(page, 'day')
      out.push([
        'unmounting disconnects everything; a new header mounts and follows again',
        gone[0] === '' && gone[1] === 0 && back,
        `unmounted: live ${gone[0] || 'none'}, resize listeners on window ${gone[1]} · remounted: ${inkBack}`,
      ])
      return out
    },
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  open.server = await serve(await serverRender())
  const base = `http://127.0.0.1:${open.server.httpServer.address().port}`

  let failures = 0
  const counts = {}
  const line = (ok, browser, pageName, name, detail) => {
    counts[browser] ??= { pass: 0, fail: 0 }
    counts[browser][ok ? 'pass' : 'fail']++
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${browser.padEnd(8)}  ${pageName.padEnd(8)}  ${name}${detail ? `  (${detail})` : ''}`)
  }

  for (const browserName of args.browsers) {
    open.browser = await BROWSERS[browserName].launch()
    for (const pageName of args.pages) {
      const errors = []
      for (const [id, check] of Object.entries(CHECKS)) {
        if (!check.pages.includes(pageName) || (args.only && !args.only.includes(id))) continue
        const contexts = []
        const t = {
          browser: browserName,
          page: pageName,
          /** A fresh context on this page, the block mounted and its first ink written. */
          async open(query = '', { reducedMotion = 'no-preference' } = {}) {
            const context = await open.browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion })
            contexts.push(context)
            await context.addInitScript(instrument, SCROLL_EVENTS)
            const page = await context.newPage()
            page.on('pageerror', (err) => errors.push(`${id}: ${err.message.split('\n')[0]}`))
            page.on('console', (msg) => msg.type() === 'error' && errors.push(`${id}: console: ${msg.text().split('\n')[0]}`))
            await page.goto(`${base}/${pageName}.html${query}`, { waitUntil: 'load' })
            await page.waitForFunction(() => !!window.__fx && window.__t.ink() !== null, null, { timeout: 10000 })
            // Let the load-time refreshes (ScrollSmoother's, Lenis's first frames) finish before scrolling.
            await page.waitForTimeout(300)
            return { page }
          },
        }
        try {
          for (const [name, ok, detail] of await check.run(t)) line(ok, browserName, pageName, name, detail)
        } catch (err) {
          line(false, browserName, pageName, id, err.message.split('\n')[0])
        } finally {
          for (const context of contexts) await context.close().catch(() => {})
        }
      }
      if (!args.only) line(errors.length === 0, browserName, pageName, 'no uncaught errors or console errors', errors.slice(0, 3).join(' | '))
    }
    await open.browser.close()
    open.browser = null
  }
  console.log(`\n${Object.entries(counts).map(([b, c]) => `${b}: ${c.pass} passed, ${c.fail} failed`).join(' · ')}`)
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
console.log(failures ? `\n${failures} check(s) failed` : '\nall header-theme checks passed')
process.exit(failures ? 1 : 0)
