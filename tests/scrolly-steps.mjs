#!/usr/bin/env node
// scrolly-steps.mjs: the scrolly-steps block (assets/scrolly-steps.ts, css/scrolly.css, motion/ScrollySteps.tsx) in
// Chromium, WebKit and Firefox. Without JavaScript and in print the section is stacked; in sticky mode each step
// crossing the line activates once, in order, down and up, the graphic shows that step's state and the rest are inert;
// a jump (an anchor, a reload, an immediate scrollTo) reports one change; the same under Lenis and ScrollSmoother;
// --step-p is monotonic within a step and nothing runs off-screen; a breakpoint switch and a reduced-motion toggle keep
// the active step; keyboard focus activates its step; the graphic stays in the section, the last step reaches the line
// and mounting shifts nothing; no scroll listener; the crossfade's numbers are config.ts's; the React wrapper's hook
// agrees with the attributes and survives Activity. Builds tests/fixtures/scrolly-steps with Vite (the React page's
// server render first, for Node), serves it with `vite preview`, prints one PASS/FAIL line per check/page/browser, and
// exits 1 on any FAIL. Needs the Playwright browsers, so it is its own script: `npm run test:scrolly-steps`.
//
//   node tests/scrolly-steps.mjs [--browsers chromium,webkit,firefox] [--pages native,lenis,smoother,motion] [--only steps,…]

import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium, firefox, webkit } from 'playwright'
import { build, preview } from 'vite'

const testsDir = dirname(fileURLToPath(import.meta.url))
const fixtureRoot = join(testsDir, 'fixtures', 'scrolly-steps')
const outDir = join(testsDir, '.scratch', 'scrolly-steps-dist')
const ssrDir = join(testsDir, '.scratch', 'scrolly-steps-ssr')
const { HEADER_H, STEPS, headerMarkup, markup, shows } = await import(pathToFileURL(join(fixtureRoot, 'src', 'layout.ts')).href)
const { CURVES, GATE_SCRIPT, MOTION } = await import(
  pathToFileURL(join(testsDir, '..', 'skills', 'scroll-animation', 'assets', 'config.ts')).href
)

const BROWSERS = { chromium, webkit, firefox }
const PAGES = ['native', 'lenis', 'smoother', 'motion']
/** Pages with checks of their own only: a GSAP timeline driven from onStep (the reference's snippet). */
const EXTRA_PAGES = ['gsap']
const VIEWPORT = { width: 1280, height: 800 }
const PHONE = { width: 700, height: 800 }
const LAST = STEPS.length - 1
const SETTLE_MS = 6000
const SCROLL_EVENTS = ['scroll', 'scrollend', 'wheel', 'mousewheel', 'DOMMouseScroll', 'touchstart', 'touchmove', 'touchend']

// ── args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { browsers: Object.keys(BROWSERS), pages: [...PAGES, ...EXTRA_PAGES], only: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--browsers') out.browsers = argv[++i].split(',')
    else if (a === '--pages') out.pages = argv[++i].split(',')
    else if (a === '--only') out.only = argv[++i].split(',')
    else throw new Error(`unknown argument: ${a}`)
  }
  for (const b of out.browsers) if (!BROWSERS[b]) throw new Error(`unknown browser: ${b}`)
  const known = [...PAGES, ...EXTRA_PAGES]
  for (const p of out.pages) if (!known.includes(p)) throw new Error(`unknown page: ${p} (${known.join(', ')})`)
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
        name: 'scrolly-steps-fixture',
        transformIndexHtml: {
          order: 'pre',
          handler: (html) =>
            html
              .replace('<!--gate-->', () => GATE_SCRIPT)
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
      rollupOptions: {
        input: Object.fromEntries([...PAGES, ...EXTRA_PAGES].map((p) => [p, join(fixtureRoot, `${p}.html`)])),
        onwarn,
      },
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
 * Installed before any page script. Spies on listeners, requestAnimationFrame and the observers (labelled with the
 * phase the harness marks while the block mounts), records every scrolly:step event and every --step-p write, and
 * adds `window.__t`: what the checks read. Its own work uses the native functions, so it never shows up in the spy.
 */
function instrument({ scrollEvents, headerH }) {
  const native = {
    raf: window.requestAnimationFrame.bind(window),
    add: EventTarget.prototype.addEventListener,
    remove: EventTarget.prototype.removeEventListener,
    IO: window.IntersectionObserver,
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
    const stack = new Error().stack.split('\n').slice(2, 5).join(' < ')
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
  window.IntersectionObserver = class extends native.IO {
    constructor(callback, options) {
      const record = { kind: 'io', phase: spy.phase, disconnected: false, targets: 0, margin: options?.rootMargin ?? '' }
      super((...args) => {
        spy.ioCallbacks++
        return callback(...args)
      }, options)
      spy.observers.push(record)
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

  let events = []
  native.add.call(document, 'scrolly:step', (e) => events.push({ ...e.detail }))
  let styleWrites = 0
  const watchStyle = () => {
    const root = document.querySelector('[data-scrolly]')
    if (!root) return false
    new native.MO((records) => {
      for (const r of records) if (r.oldValue !== r.target.getAttribute('style')) styleWrites++
    }).observe(root, { attributes: true, attributeFilter: ['style'], attributeOldValue: true })
    return true
  }
  native.add.call(document, 'DOMContentLoaded', () => watchStyle() || native.raf(watchStyle))

  const root = () => document.querySelector('[data-scrolly]')
  const steps = () => [...document.querySelectorAll('[data-scrolly-step]')]
  const states = () => [...document.querySelectorAll('[data-scrolly-state]')]
  const fraction = () => {
    const v = root()?.getAttribute('data-scrolly-line')
    return v ? Number(v) / 100 : 0.5
  }
  const lineY = () => headerH + (Math.min(innerHeight, document.documentElement.clientHeight) - headerH) * fraction()
  const round = (v) => Math.round(v * 100) / 100
  let sampler = null

  window.__t = {
    frames: (n) =>
      new Promise((resolve) => {
        let i = 0
        const step = () => (++i >= n ? resolve() : native.raf(step))
        native.raf(step)
      }),
    active: () => (root()?.hasAttribute('data-scrolly-active') ? Number(root().getAttribute('data-scrolly-active')) : null),
    mode: () => root()?.getAttribute('data-scrolly-mode') ?? null,
    hook: () => {
      const h = document.getElementById('hook')
      return h ? [Number(h.dataset.hookActive), h.dataset.hookDirection] : null
    },
    lineY: () => round(lineY()),
    /** The step the line is in by geometry: what the block should say (last step whose top reached the line, else 0). */
    expected() {
      const line = lineY()
      let index = 0
      steps().forEach((s, i) => {
        if (s.getBoundingClientRect().top <= line) index = i
      })
      return index
    },
    /** A step's top in document px, read at rest (ScrollSmoother's content then sits where scrollY says). */
    stepDocTop: (i) => round(steps()[i].getBoundingClientRect().top + scrollY),
    stepTop: (i) => round(steps()[i].getBoundingClientRect().top),
    /** The states shown and whether every other state is inert and aria-hidden (and the shown one is neither). */
    graphic() {
      const shown = states().filter((s) => s.hasAttribute('data-state-active')).map((s) => s.getAttribute('data-scrolly-state'))
      const hiddenOk = states().every((s) =>
        s.hasAttribute('data-state-active')
          ? !s.inert && !s.hasAttribute('aria-hidden')
          : s.inert && s.getAttribute('aria-hidden') === 'true',
      )
      const visible = states()
        .filter((s) => getComputedStyle(s).opacity !== '0')
        .map((s) => s.getAttribute('data-scrolly-state'))
      return { shown, hiddenOk, visible, stepStates: steps().map((s) => s.getAttribute('data-step-state')) }
    },
    events: () => events.slice(),
    clearEvents: () => {
      events = []
      window.__hookSteps = []
    },
    hookSteps: () => (window.__hookSteps ?? []).slice(),
    stepP: () => root()?.style.getPropertyValue('--step-p') ?? '',
    /** --step-p from the rects, as the block computes it: the active step's top to the next step's top (or its bottom). */
    expectedP() {
      const i = window.__t.active()
      const s = steps()
      const r = s[i].getBoundingClientRect()
      const end = s[i + 1]?.getBoundingClientRect().top ?? r.bottom
      const p = Math.min(1, Math.max(0, (lineY() - r.top) / (end - r.top)))
      return Math.round(p * 1e4) / 1e4
    },
    sample() {
      const rows = []
      const tick = () => {
        rows.push({ p: window.__t.stepP(), active: window.__t.active() })
        sampler = native.raf(tick)
      }
      tick()
      window.__t.stopSample = () => {
        cancelAnimationFrame(sampler)
        return rows
      }
    },
    /** Samples one state's computed opacity every frame for `n` frames. */
    async opacityTrace(id, n) {
      const out = []
      for (let i = 0; i < n; i++) {
        out.push(Number(getComputedStyle(document.getElementById(id)).opacity))
        await window.__t.frames(1)
      }
      return out
    },
    resetSpy() {
      spy.rafCalls = 0
      spy.ioCallbacks = 0
      styleWrites = 0
    },
    counters: () => ({ rafCalls: spy.rafCalls, ioCallbacks: spy.ioCallbacks, styleWrites }),
    spy() {
      return {
        // Playwright's own main-world script adds touch listeners for its hit-target checks: tooling, not the page.
        scrollListeners: spy.listeners
          .filter((l) => l.phase === 'mount' && scrollEvents.includes(l.type) && !/InjectedScript/.test(l.stack))
          .map((l) => `${l.type}@${l.where}`),
        mountListeners: spy.listeners.filter((l) => l.phase === 'mount').map((l) => `${l.type}@${l.where}`),
        observers: spy.observers.filter((o) => o.phase === 'mount').map((o) => `${o.kind} ${o.margin}`),
      }
    },
    /** Observers the block still holds: not disconnected, watching something. */
    liveObservers: () => spy.observers.filter((o) => !o.disconnected && o.targets > 0).length,
    /** Live listeners the block added on these targets (root, window, a media query), by type. */
    liveBlockListeners: () =>
      spy.listeners
        .filter((l) => l.live && ['focusin', 'focusout', 'resize', 'change'].includes(l.type) && (l.where === 'window' || l.where === 'section#scrolly' || l.where === 'MediaQueryList'))
        .map((l) => `${l.type}@${l.where}`),
    layout() {
      const box = (el) => {
        const r = el.getBoundingClientRect()
        return { top: round(r.top), bottom: round(r.bottom), left: round(r.left), right: round(r.right), height: round(r.height) }
      }
      const g = document.querySelector('[data-scrolly-graphic]')
      return {
        section: box(root()),
        graphic: box(g),
        steps: box(document.querySelector('[data-scrolly-steps]')),
        stepTops: steps().map((s) => round(s.getBoundingClientRect().top + scrollY)),
        graphicDisplay: getComputedStyle(g).display,
        inline: [...document.querySelectorAll('[data-scrolly-inline]')].map((f) => getComputedStyle(f).display),
        tail: getComputedStyle(document.querySelector('[data-scrolly-steps]')).paddingBlockEnd,
        docHeight: document.documentElement.scrollHeight,
        scrollY: round(scrollY),
      }
    },
    stateStyle(id) {
      const cs = getComputedStyle(document.getElementById(id))
      return { duration: cs.transitionDuration, timing: cs.transitionTimingFunction, property: cs.transitionProperty }
    },
    live() {
      const r = document.querySelector('[data-scrolly-live-region]')
      return r ? { text: r.textContent, live: r.getAttribute('aria-live') } : null
    },
    focused: () => document.activeElement?.id ?? null,
    maxScroll: () => document.documentElement.scrollHeight - innerHeight,
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

/** Scrolls at once (through the page's authority) and waits for the page on screen to hold still. */
async function jump(page, y) {
  await page.evaluate((top) => window.__fx.scrollTo(top, true), y)
  await page.evaluate(() => window.__t.frames(3))
  await until(
    page,
    () => {
      const now = `${window.__t.stepTop(0)}:${window.__t.active()}`
      const settled = now === window.__last
      window.__last = now
      return settled
    },
    null,
    3000,
  )
  await page.evaluate(() => window.__t.frames(2))
}

/** The scroll position that puts the line `offset` px below step i's top. */
async function lineAt(page, i, offset) {
  const [top, line] = await page.evaluate((n) => [window.__t.stepDocTop(n), window.__t.lineY()], i)
  return Math.round(top + offset - line)
}

/** Waits for the active step to be `want`; returns [ok, the active step]. */
async function activeBecomes(page, want, timeout = 3000) {
  const ms = await until(page, (w) => window.__t.active() === w, want, timeout)
  return [ms !== null, await page.evaluate(() => window.__t.active())]
}

async function wheel(page, dy, count, pause = 45) {
  await page.mouse.move(VIEWPORT.width / 4, VIEWPORT.height / 2)
  for (let i = 0; i < count; i++) {
    await page.mouse.wheel(0, dy)
    await sleep(pause)
  }
}

const tabKey = (browser) => (browser === 'webkit' ? 'Alt+Tab' : 'Tab')
const shiftTabKey = (browser) => (browser === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab')
const fmt = (events) => events.map((e) => `${e.previous ?? '∅'}→${e.index}${e.direction ? ` ${e.direction}` : ''}`).join(', ')

// ── checks ──────────────────────────────────────────────────────────────
// Each takes a `t` bound to one browser + one page and returns [[name, ok, detail], ...].

const CHECKS = {
  stacked: {
    pages: ['native', 'motion'],
    async run(t) {
      const out = []
      // No JavaScript: the gate never runs, so the section is stacked from the stylesheet alone.
      const { page } = await t.open('', { javaScriptEnabled: false })
      const nojs = await page.evaluate(() => {
        const steps = [...document.querySelectorAll('[data-scrolly-step]')].map((s) => s.getBoundingClientRect())
        const inline = [...document.querySelectorAll('[data-scrolly-inline]')].map((f) => ({
          display: getComputedStyle(f).display,
          r: f.getBoundingClientRect(),
        }))
        return {
          mode: document.querySelector('[data-scrolly]').getAttribute('data-scrolly-mode'),
          graphic: getComputedStyle(document.querySelector('[data-scrolly-graphic]')).display,
          inOrder: steps.every((r, i) => i === 0 || r.top >= steps[i - 1].bottom),
          inlineShown: inline.every((f, i) => f.display !== 'none' && f.r.height > 0 && f.r.top >= steps[i].top && f.r.bottom <= steps[i].bottom),
          steps: steps.length,
        }
      })
      out.push([
        'no JavaScript: stacked; the graphic column is hidden and every step reads in order with its inline figure inside it',
        nojs.mode === null && nojs.graphic === 'none' && nojs.inOrder && nojs.inlineShown && nojs.steps === STEPS.length,
        JSON.stringify(nojs),
      ])
      // Print, with the block mounted in sticky mode.
      const { page: p2 } = await t.open()
      await p2.emulateMedia({ media: 'print' })
      const print = await p2.evaluate(() => window.__t.layout())
      await p2.emulateMedia({ media: 'screen' })
      out.push([
        'print: stacked whatever the mode (the graphic hidden, inline figures shown)',
        print.graphicDisplay === 'none' && print.inline.every((d) => d !== 'none'),
        `graphic ${print.graphicDisplay} · inline ${[...new Set(print.inline)].join('/')}`,
      ])
      return out
    },
  },

  steps: {
    pages: PAGES,
    async run(t) {
      const { page } = await t.open()
      const out = []
      const mode = await page.evaluate(() => window.__t.mode())
      // Stops: the line inside each step, and in the gap below it (the step above the gap stays), down then up.
      const stops = []
      for (let i = 0; i <= LAST; i++) {
        stops.push([`step ${i}`, i, 120, i])
        if (i < LAST) stops.push([`gap after ${i}`, i, 360 + 100, i])
      }
      for (const [direction, list] of [
        ['down', stops],
        ['up', [...stops].reverse()],
      ]) {
        const seen = []
        let ok = mode === 'sticky'
        for (const [label, i, offset, want] of list) {
          await jump(page, await lineAt(page, i, offset))
          const [landed, active] = await activeBecomes(page, want)
          // The crossfade's length, and a margin: Firefox's headless frames don't run at 60 Hz.
          await sleep(MOTION.disclosure.duration * 1000 + 150)
          const g = await page.evaluate(() => window.__t.graphic())
          const hook = t.page === 'motion' ? await page.evaluate(() => window.__t.hook()) : null
          const stateOk = g.shown.length === 1 && g.shown[0] === shows(want) && g.hiddenOk && g.visible.join() === shows(want)
          const stepsOk = g.stepStates.every((s, n) => s === (n < want ? 'before' : n > want ? 'after' : 'active'))
          const hookOk = !hook || hook[0] === want
          ok &&= landed && stateOk && stepsOk && hookOk
          seen.push(
            `${label}: ${active}${stateOk ? '' : ` (shown ${g.shown}, visible ${g.visible}, inert ok ${g.hiddenOk})`}${stepsOk ? '' : ` (steps ${g.stepStates})`}${hookOk ? '' : ` (hook ${hook})`}`,
          )
        }
        out.push([
          `jumping ${direction} through the section: the step at the line is active (the one above a gap stays), the graphic shows its state alone, every other state is inert and aria-hidden${t.page === 'motion' ? '; the hook agrees' : ''}`,
          ok,
          `mode ${mode} · ${seen.join(' · ')}`,
        ])
      }

      // A wheel pass down and back up: one event per crossing, in order, with its direction.
      await jump(page, (await lineAt(page, 0, 0)) - 300)
      await activeBecomes(page, 0)
      await page.evaluate(() => {
        window.__t.clearEvents()
        window.__t.resetSpy()
      })
      await wheel(page, 100, 45)
      await sleep(1500)
      const bottom = await page.evaluate(() => window.__t.active())
      await wheel(page, -100, 45)
      await sleep(1500)
      const events = await page.evaluate(() => window.__t.events())
      const hookSteps = t.page === 'motion' ? await page.evaluate(() => window.__t.hookSteps()) : events
      const counters = await page.evaluate(() => window.__t.counters())
      const want = [
        ...STEPS.slice(1).map((_, i) => ({ index: i + 1, previous: i, direction: 'down' })),
        ...STEPS.slice(1).map((_, i) => ({ index: LAST - 1 - i, previous: LAST - i, direction: 'up' })),
      ]
      out.push([
        'wheeled down through the section and back up: each crossing reports once, in order, with its direction (one event per change)' +
          (t.page === 'motion' ? '; onStep through the hook saw the same' : ''),
        bottom === LAST && JSON.stringify(events) === JSON.stringify(want) && JSON.stringify(hookSteps) === JSON.stringify(want),
        `at the bottom ${bottom} · ${events.length} events: ${fmt(events)}${t.page === 'motion' ? ` · hook ${hookSteps.length}` : ''}`,
      ])
      out.push([
        'no per-frame work without progress: no requestAnimationFrame from the block, and a bounded number of observer callbacks',
        (t.page === 'native' || t.page === 'motion' ? counters.rafCalls === 0 : true) && counters.ioCallbacks <= 4 * (STEPS.length + 1) * 2 * 2,
        `${counters.rafCalls} rAF calls (the authority's own on lenis/smoother) · ${counters.ioCallbacks} observer callbacks`,
      ])
      return out
    },
  },

  jump: {
    pages: PAGES,
    async run(t) {
      const out = []
      const { page } = await t.open()
      await jump(page, await lineAt(page, 0, 100))
      await activeBecomes(page, 0)
      await page.evaluate(() => window.__t.clearEvents())
      await jump(page, await lineAt(page, 4, 100))
      const [landed] = await activeBecomes(page, 4)
      await page.evaluate(() => window.__t.frames(10))
      const events = await page.evaluate(() => window.__t.events())
      out.push([
        'an immediate scrollTo past four steps reports one change, 0 → 4, never the steps it skipped',
        landed && JSON.stringify(events) === JSON.stringify([{ index: 4, previous: 0, direction: 'down' }]),
        fmt(events),
      ])
      // Reload mid-page and an anchor on load: the page lands where the browser (or the authority) puts it, and the
      // block reports what is on screen: the mount report, then at most one change, never the steps between. Under
      // ScrollSmoother where it lands is the smoother's business: the block must only agree with the screen.
      const lands = t.page !== 'smoother'
      await jump(page, await lineAt(page, 3, 100))
      await activeBecomes(page, 3)
      // WebKit saves the position it restores a moment after the scroll.
      await sleep(500)
      await page.reload({ waitUntil: 'load' })
      await page.waitForFunction(() => !!window.__fx && window.__t.mode() !== null, null, { timeout: 10000 })
      const [reloaded] = await activeBecomes(page, 3)
      await page.waitForTimeout(600)
      const r = await page.evaluate(() => ({ active: window.__t.active(), expected: window.__t.expected(), y: Math.round(scrollY), events: window.__t.events() }))
      out.push([
        `a reload mid-section: ${lands ? 'step 3 again, ' : ''}the step on screen, reported as a landing (previous null: seek, don\'t animate), never the steps before it`,
        (!lands || reloaded) && r.active === r.expected && r.events.length <= 2 && r.events.every((e) => e.previous === null && (e.index === 0 || e.index === r.active)),
        `active ${r.active}, on screen ${r.expected}, scrollY ${r.y} · ${fmt(r.events)}`,
      ])
      const { page: p2 } = await t.open('#step-4')
      const [anchored] = await activeBecomes(p2, 4)
      await p2.waitForTimeout(600)
      const a = await p2.evaluate(() => ({ active: window.__t.active(), expected: window.__t.expected(), y: Math.round(scrollY), events: window.__t.events() }))
      out.push([
        `loading with #step-4: ${lands ? 'step 4, ' : ''}the step on screen, reported as a landing (previous null), never the steps before it`,
        (!lands || anchored) && a.active === a.expected && a.events.length <= 2 && a.events.every((e) => e.previous === null && (e.index === 0 || e.index === a.active)),
        `active ${a.active}, on screen ${a.expected}, scrollY ${a.y} · ${fmt(a.events)}`,
      ])
      return out
    },
  },

  progress: {
    pages: ['native', 'lenis', 'motion'],
    async run(t) {
      const { page } = await t.open('?progress')
      await jump(page, await lineAt(page, 2, -60))
      await activeBecomes(page, 1)
      await page.evaluate(() => window.__t.sample())
      await wheel(page, 40, 22, 60)
      await sleep(1200)
      const rows = await page.evaluate(() => window.__t.stopSample())
      // At rest: Lenis can still be easing 1.2 s after the last wheel on a busy machine.
      await until(
        page,
        () => {
          const now = window.__t.stepTop(0)
          const settled = now === window.__lastTop
          window.__lastTop = now
          return settled
        },
        null,
        3000,
      )
      await page.evaluate(() => window.__t.frames(3))
      const inStep = rows.filter((r) => r.active === 2).map((r) => Number(r.p))
      const monotonic = inStep.every((p, i) => i === 0 || p >= inStep[i - 1])
      const atRest = await page.evaluate(() => [window.__t.stepP(), window.__t.expectedP(), window.__t.active(), window.__t.counters().rafCalls])
      // Off-screen: the section below the viewport. Nothing is requested or written while it stays there.
      await jump(page, 0)
      await page.evaluate(() => window.__t.frames(10))
      await page.evaluate(() => window.__t.resetSpy())
      await sleep(600)
      const off = await page.evaluate(() => window.__t.counters())
      const rafFree = t.page !== 'lenis'
      return [
        [
          'progress: --step-p is monotonic through a step, within 0..1, and exact at rest (the rects, not a smoothed copy)',
          inStep.length > 10 && monotonic && inStep.every((p) => p >= 0 && p <= 1) && inStep.at(-1) > 0.5 && Number(atRest[0]) === atRest[1],
          `${inStep.length} frames in step 2: ${inStep[0]} → ${inStep.at(-1)} · at rest ${atRest[0]} (rects say ${atRest[1]}, step ${atRest[2]}, ${atRest[3]} rAF calls so far)`,
        ],
        [
          'progress: off-screen, no --step-p writes' + (rafFree ? ' and no requestAnimationFrame' : ''),
          off.styleWrites === 0 && (!rafFree || off.rafCalls === 0),
          `${off.styleWrites} writes · ${off.rafCalls} rAF calls in 600 ms`,
        ],
      ]
    },
  },

  modes: {
    pages: ['native', 'lenis', 'motion'],
    async run(t) {
      const { page } = await t.open()
      const out = []
      await jump(page, await lineAt(page, 3, 150))
      await activeBecomes(page, 3)
      await page.evaluate(() => window.__t.clearEvents())
      const top0 = await page.evaluate(() => window.__t.stepTop(3))
      await page.setViewportSize(PHONE)
      await until(page, () => window.__t.mode() === 'stacked', null, 3000)
      await page.evaluate(() => window.__t.frames(5))
      const phone = await page.evaluate(() => ({
        mode: window.__t.mode(),
        active: window.__t.active(),
        top: window.__t.stepTop(3),
        layout: window.__t.layout(),
        stepStates: window.__t.graphic().stepStates,
        observers: window.__t.liveObservers(),
      }))
      await page.setViewportSize(VIEWPORT)
      await until(page, () => window.__t.mode() === 'sticky', null, 3000)
      await page.evaluate(() => window.__t.frames(10))
      const back = await page.evaluate(() => ({ mode: window.__t.mode(), active: window.__t.active(), top: window.__t.stepTop(3) }))
      const events = await page.evaluate(() => window.__t.events())
      out.push([
        'breakpoint switch mid-scroll: stacked on a phone width (no observers, no step states) and sticky again, step 3 active throughout and kept in place, no events',
        phone.mode === 'stacked' &&
          phone.active === 3 &&
          phone.observers === 0 &&
          phone.layout.graphicDisplay === 'none' &&
          phone.layout.inline.every((d) => d !== 'none') &&
          phone.stepStates.every((s) => s === null) &&
          Math.abs(phone.top - top0) <= 2 &&
          back.mode === 'sticky' &&
          back.active === 3 &&
          Math.abs(back.top - top0) <= 2 &&
          events.length === 0,
        `step 3 top ${top0} → phone ${phone.top} (${phone.mode}, active ${phone.active}, ${phone.observers} observers) → ${back.top} (${back.mode}, active ${back.active}) · events ${fmt(events) || 'none'}`,
      ])

      // The crossfade: config.ts's numbers, an actual fade, and an instant swap under reduced motion.
      const style = await page.evaluate(() => window.__t.stateStyle('state-0'))
      const wantDuration = `${MOTION.disclosure.duration}s`
      const wantTiming = `cubic-bezier(${CURVES[MOTION.disclosure.curve].join(', ')})`
      out.push([
        `the crossfade is opacity over MOTION.disclosure (${wantDuration}, ${wantTiming}), as config.ts says`,
        style.duration === wantDuration && style.timing === wantTiming && style.property === 'opacity',
        JSON.stringify(style),
      ])
      await jump(page, await lineAt(page, 4, 150))
      const fade = await page.evaluate(() => window.__t.opacityTrace('state-3', 12))
      const midway = fade.some((o) => o > 0.02 && o < 0.98)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.evaluate(() => window.__t.frames(3))
      const reduced = await page.evaluate(() => ({
        active: window.__t.active(),
        mode: window.__t.mode(),
        style: window.__t.stateStyle('state-3'),
      }))
      await jump(page, await lineAt(page, 5, 150))
      const swap = await page.evaluate(() => window.__t.opacityTrace('state-4', 2))
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.evaluate(() => window.__t.frames(3))
      const restored = await page.evaluate(() => ({ active: window.__t.active(), duration: window.__t.stateStyle('state-4').duration }))
      out.push([
        'a step change crossfades; toggling reduced motion mid-scroll keeps the step and the sticky mode and swaps states instantly',
        midway &&
          reduced.active === 4 &&
          reduced.mode === 'sticky' &&
          reduced.style.duration === '0s' &&
          swap[0] === 1 &&
          restored.active === 5 &&
          restored.duration === wantDuration,
        `fade ${fade.map((o) => o.toFixed(2)).join(' ')} · reduced: active ${reduced.active}, ${reduced.mode}, ${reduced.style.duration}, swap ${swap.join('/')} · back: active ${restored.active}, ${restored.duration}`,
      ])
      return out
    },
  },

  focus: {
    pages: PAGES,
    async run(t) {
      const { page } = await t.open()
      // The line near step 1's bottom: step 2 and its link are on screen below the line, not at it.
      await jump(page, await lineAt(page, 1, 330))
      await activeBecomes(page, 1)
      await page.focus('#link-1')
      await page.evaluate(() => window.__t.frames(5))
      const y0 = await page.evaluate(() => scrollY)
      await page.keyboard.press(tabKey(t.browser))
      const [forward, a1] = await activeBecomes(page, 2)
      const after = await page.evaluate(() => ({ focused: window.__t.focused(), y: scrollY, expected: window.__t.expected() }))
      await page.keyboard.press(shiftTabKey(t.browser))
      const [backward, a2] = await activeBecomes(page, 1)
      const focusedBack = await page.evaluate(() => window.__t.focused())
      const moved = Math.abs(after.y - y0)
      return [
        [
          'Tab into the next step, on screen below the line: it becomes active although the line did not reach it; Shift+Tab back returns',
          forward && after.focused === 'link-2' && after.expected === 1 && backward && focusedBack === 'link-1' && (t.page === 'smoother' || moved <= 1),
          `Tab: focus ${after.focused}, active ${a1}, the line says ${after.expected}, scroll moved ${moved} px · Shift+Tab: focus ${focusedBack}, active ${a2}`,
        ],
      ]
    },
  },

  layout: {
    pages: PAGES,
    async run(t) {
      const { page } = await t.open()
      const out = []
      const start = await page.evaluate(() => window.__t.layout())
      await jump(page, await lineAt(page, 2, 100))
      const mid = await page.evaluate(() => window.__t.layout())
      const max = await page.evaluate(() => window.__t.maxScroll())
      await jump(page, max)
      const [lastActive] = await activeBecomes(page, LAST)
      const end = await page.evaluate(() => ({ ...window.__t.layout(), line: window.__t.lineY(), lastTop: window.__t.stepTop(5) }))
      const wantH = VIEWPORT.height - HEADER_H
      const wantTail = `${(VIEWPORT.height - HEADER_H) * 0.5}px`
      out.push([
        `the graphic sticks under the header at 100svh less the header (${wantH} px) and never runs past the section's end`,
        Math.abs(mid.graphic.top - HEADER_H) <= 1 &&
          Math.abs(mid.graphic.height - wantH) <= 1 &&
          end.graphic.bottom <= end.section.bottom + 0.5 &&
          Math.abs(start.graphic.top - start.section.top) <= 1,
        `before: graphic top ${start.graphic.top} = section top ${start.section.top} · mid: top ${mid.graphic.top}, height ${mid.graphic.height} · end: graphic bottom ${end.graphic.bottom} ≤ section bottom ${end.section.bottom}`,
      ])
      out.push([
        `the section ends the page and its tail (${wantTail}) lets the last step reach the line`,
        lastActive && end.lastTop <= end.line && end.tail === wantTail,
        `at max scroll the last step's top ${end.lastTop} vs line ${end.line} · tail ${end.tail} · active ${await page.evaluate(() => window.__t.active())}`,
      ])
      out.push([
        'side by side: steps in the inline-start column, the graphic in the inline-end one',
        mid.graphic.left >= mid.steps.right - 1,
        `steps ${mid.steps.left}–${mid.steps.right} · graphic ${mid.graphic.left}–${mid.graphic.right}`,
      ])
      return out
    },
  },

  mount: {
    pages: ['native'],
    async run(t) {
      const out = []
      // Mounting over the pre-mount CSS shifts nothing.
      const { page } = await t.open('?defer', { ready: false })
      const before = await page.evaluate(() => window.__t.layout())
      const premountShown = await page.evaluate(() => window.__t.graphic().visible)
      await page.evaluate(() => window.__fx.mount())
      await page.evaluate(() => window.__t.frames(5))
      const after = await page.evaluate(() => window.__t.layout())
      const shifts = await page.evaluate(
        () =>
          new Promise((resolve) => {
            if (!PerformanceObserver.supportedEntryTypes?.includes('layout-shift')) return resolve(null)
            new PerformanceObserver((list) => resolve(list.getEntries().reduce((s, e) => s + e.value, 0))).observe({ type: 'layout-shift', buffered: true })
            setTimeout(() => resolve(0), 300)
          }),
      )
      const same = JSON.stringify({ ...before, scrollY: 0 }) === JSON.stringify({ ...after, scrollY: 0 })
      out.push([
        'mounting over the pre-mount CSS (1024 px and up under the gate) shifts nothing; the first state shows before the mount',
        same && premountShown.join() === '0' && (shifts === null || shifts === 0),
        `${same ? 'same boxes' : `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`} · pre-mount visible states ${premountShown} · layout-shift ${shifts ?? 'n/a'}`,
      ])
      const spy = await page.evaluate(() => window.__t.spy())
      out.push([
        'the mount adds no scroll listener: two IntersectionObservers split the viewport at the line, plus focus, resize and the query',
        spy.scrollListeners.length === 0 && spy.observers.length === 2,
        `scroll listeners: ${spy.scrollListeners.join(', ') || 'none'} · observers: ${spy.observers.join(' | ')} · listeners: ${spy.mountListeners.join(', ')}`,
      ])
      // data-scrolly-query: the root's own query decides (here it never matches).
      const { page: q } = await t.open(`?query=${encodeURIComponent('(min-width: 4000px)')}`)
      const qs = await q.evaluate(() => ({ mode: window.__t.mode(), observers: window.__t.liveObservers(), layout: window.__t.layout() }))
      out.push([
        'data-scrolly-query overrides DESKTOP_QUERY: not matching, the section stays stacked with no observers',
        qs.mode === 'stacked' && qs.observers === 0 && qs.layout.graphicDisplay === 'none',
        `${qs.mode}, ${qs.observers} observers, graphic ${qs.layout.graphicDisplay}`,
      ])
      // RTL mirrors the columns.
      const { page: r } = await t.open('?rtl')
      await jump(r, await lineAt(r, 1, 100))
      const rtl = await r.evaluate(() => window.__t.layout())
      out.push([
        'right to left: the columns mirror (the graphic at the inline end, now the left)',
        rtl.graphic.right <= rtl.steps.left + 1,
        `graphic ${rtl.graphic.left}–${rtl.graphic.right} · steps ${rtl.steps.left}–${rtl.steps.right}`,
      ])
      // data-scrolly-live: the shown state's caption, announced politely, only after a change.
      const { page: l } = await t.open('?live')
      const at0 = await l.evaluate(() => window.__t.live())
      await jump(l, await lineAt(l, 1, 100))
      await activeBecomes(l, 1)
      const at1 = await l.evaluate(() => window.__t.live())
      await jump(l, await lineAt(l, 2, 100))
      await activeBecomes(l, 2)
      const at2 = await l.evaluate(() => window.__t.live())
      out.push([
        'data-scrolly-live: a polite live region, silent on mount, takes the shown state\'s caption on each change',
        at0?.live === 'polite' && at0.text === '' && at1?.text === 'Caption 1' && at2?.text === 'Caption 2',
        `mount ${JSON.stringify(at0)} · step 1 ${JSON.stringify(at1)} · step 2 ${JSON.stringify(at2)}`,
      ])
      return out
    },
  },

  activity: {
    pages: ['motion'],
    async run(t) {
      const { page } = await t.open()
      await jump(page, await lineAt(page, 3, 100))
      await activeBecomes(page, 3)
      const before = await page.evaluate(() => [window.__t.liveObservers(), window.__t.liveBlockListeners().length])
      await page.evaluate(() => window.__fx.hide())
      await page.evaluate(() => window.__t.frames(4))
      const hidden = await page.evaluate(() => ({
        observers: window.__t.liveObservers(),
        listeners: window.__t.liveBlockListeners(),
        active: window.__t.active(),
        shown: window.__t.graphic().shown,
      }))
      await jump(page, 0)
      await page.evaluate(() => window.__t.clearEvents())
      await page.evaluate(() => window.__fx.show())
      const [shown, active] = await activeBecomes(page, 0)
      await page.evaluate(() => window.__t.frames(4))
      const hook = await page.evaluate(() => window.__t.hook())
      const events = await page.evaluate(() => window.__t.events())
      const out = [
        [
          'Activity hide disconnects the observers and listeners and leaves the last state in place; showing mounts again and re-reads the page (one report, previous null)',
          before[0] === 2 &&
            hidden.observers === 0 &&
            hidden.listeners.length === 0 &&
            hidden.active === 3 &&
            hidden.shown.join() === '2' &&
            shown &&
            hook?.[0] === 0 &&
            events.length === 1 &&
            events[0].previous === null,
          `live before ${before[0]} observers, ${before[1]} listeners · hidden: ${hidden.observers} observers, listeners ${hidden.listeners.join(',') || 'none'}, active ${hidden.active}, shown ${hidden.shown} · shown: active ${active}, hook ${hook}, events ${fmt(events)}`,
        ],
      ]
      await page.evaluate(() => window.__fx.unmount())
      await page.evaluate(() => window.__t.frames(4))
      const gone = await page.evaluate(() => [window.__t.liveObservers(), window.__t.liveBlockListeners()])
      out.push([
        'unmounting disconnects everything',
        gone[0] === 0 && gone[1].length === 0,
        `${gone[0]} observers · listeners ${gone[1].join(',') || 'none'}`,
      ])
      return out
    },
  },
  // fixtures/scrolly-steps/src/gsap.ts: the reference's snippet. The core mounts once; gsap.matchMedia builds the
  // timeline per breakpoint and seeks it to the core's step; onStep tweens to the next label, seeks on a mount report.
  gsap: {
    pages: ['gsap'],
    async run(t) {
      const out = []
      const { page } = await t.open()
      const time = () => page.evaluate(() => Math.round((window.__gsap.tl?.time() ?? -1) * 1000) / 1000)
      const t0 = await time()
      await jump(page, await lineAt(page, 2, 100))
      await activeBecomes(page, 2)
      const mid = await time()
      await sleep(900)
      const t2 = await time()
      const log = await page.evaluate(() => ({ seeks: window.__gsap.seeks.slice(), tweens: window.__gsap.tweens.slice() }))
      out.push([
        'GSAP: the timeline starts seeked to s0; a step change tweens it to that step\'s label',
        t0 === 0 && mid > 0 && mid < 2 && t2 === 2 && log.tweens.join() === 's2',
        `t0 ${t0} · mid-tween ${mid} · after ${t2} · seeks ${log.seeks} · tweens ${log.tweens}`,
      ])
      await page.setViewportSize(PHONE)
      await until(page, () => window.__t.mode() === 'stacked', null, 3000)
      const phone = await page.evaluate(() => window.__gsap.tl)
      await page.setViewportSize(VIEWPORT)
      await until(page, () => window.__t.mode() === 'sticky', null, 3000)
      await page.evaluate(() => window.__t.frames(3))
      const back = await time()
      out.push([
        'GSAP: below the breakpoint gsap.matchMedia reverts the timeline; back above it, the new one seeks to the step the core kept',
        phone === null && back === 2,
        `phone timeline ${phone === null ? 'reverted' : 'still there'} · back: ${back}`,
      ])
      await sleep(500)
      await page.reload({ waitUntil: 'load' })
      await page.waitForFunction(() => !!window.__gsap?.tl, null, { timeout: 10000 })
      await activeBecomes(page, 2)
      await sleep(300)
      const reloaded = await page.evaluate(() => ({ time: window.__gsap.tl.time(), seeks: window.__gsap.seeks.slice(), tweens: window.__gsap.tweens.slice() }))
      out.push([
        'GSAP: a reload mid-section lands the timeline on the step (seeked, never tweened from the start)',
        reloaded.time === 2 && reloaded.tweens.length === 0,
        JSON.stringify(reloaded),
      ])
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.evaluate(() => window.__t.frames(3))
      await jump(page, await lineAt(page, 4, 100))
      await activeBecomes(page, 4)
      const reduced = await time()
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      out.push([
        'GSAP: under reduced motion the timeline jumps to the step\'s label',
        reduced === 4,
        `time right after the change: ${reduced}`,
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
          /** A fresh context on this page, the block mounted (unless `ready: false`) and its first state written. */
          async open(suffix = '', { javaScriptEnabled = true, ready = true } = {}) {
            const context = await open.browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, javaScriptEnabled })
            contexts.push(context)
            await context.addInitScript(instrument, { scrollEvents: SCROLL_EVENTS, headerH: HEADER_H })
            const page = await context.newPage()
            page.on('pageerror', (err) => errors.push(`${id}: ${err.message.split('\n')[0]}`))
            page.on('console', (msg) => msg.type() === 'error' && errors.push(`${id}: console: ${msg.text().split('\n')[0]}`))
            await page.goto(`${base}/${pageName}.html${suffix}`, { waitUntil: 'load' })
            if (javaScriptEnabled) {
              await page.waitForFunction((r) => !!window.__fx && (!r || window.__t.mode() !== null), ready, { timeout: 10000 })
              // Let the load-time refreshes (ScrollSmoother's, Lenis's first frames) finish before scrolling.
              await page.waitForTimeout(300)
            }
            return { page, context }
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
console.log(failures ? `\n${failures} check(s) failed` : '\nall scrolly-steps checks passed')
process.exit(failures ? 1 : 0)
