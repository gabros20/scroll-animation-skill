#!/usr/bin/env node
// checks/run.mjs — the site's checks in Chromium, WebKit and Firefox, against `vite preview` of the production build
// (run `pnpm build` first). One PASS/FAIL line per check, page and browser; exits 1 on any FAIL.
//
//   node checks/run.mjs [--browsers chromium,webkit,firefox] [--only load,split,scene,rail,entrances,reduced,nojs,mount]
//
//   load       each page loads without errors and stamps its scroll authority: smoother on /, native on /guide/
//   split      the hero headline is split in the served HTML, and the load shifts no layout (CLS < 0.01)
//   scene      the four clocks' timeline rises monotonically through the pin, with the pin held at the top
//   rail       the engine map's track moves the whole travel, flush at both ends
//   entrances  a scroll through each page lands every entrance, split heading and count-up, and the header's ink
//              follows the section under it
//   reduced    reduced motion, at load and switched on live: ScrollSmoother in native mode, nothing transformed,
//              every word visible; the CSS timelines off on /guide/
//   nojs       JavaScript off: no gate, every word visible, the rail's panels in reach; the CSS timelines still run
//   mount      mount() on a scratch root (document order across two block types, one refresh, double mount, the
//              context and reverse-order cleanup, never the document), then each page's own cleanup: no
//              ScrollTriggers and no inline styles left in the route's root

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium, firefox, webkit } from 'playwright'
import { preview } from 'vite'

const siteDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const BROWSERS = { chromium, webkit, firefox }
const PAGES = { home: '/', guide: '/guide/' }
const AUTHORITY = { home: 'smoother', guide: 'native' }
const VIEWPORT = { width: 1280, height: 800 }
const CLOCKS = ['trigger', 'scroll', 'media', 'render']
const HEADLINE = 'Every animation runs on one of four clocks'
const CHECK_IDS = ['load', 'split', 'scene', 'rail', 'entrances', 'reduced', 'nojs', 'mount']

// ── args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { browsers: Object.keys(BROWSERS), only: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--browsers') out.browsers = argv[++i].split(',')
    else if (a === '--only') out.only = argv[++i].split(',')
    else throw new Error(`unknown argument: ${a}`)
  }
  for (const b of out.browsers) if (!BROWSERS[b]) throw new Error(`unknown browser: ${b}`)
  for (const c of out.only ?? []) if (!CHECK_IDS.includes(c)) throw new Error(`unknown check: ${c} (${CHECK_IDS.join(', ')})`)
  return out
}

// ── in the page ─────────────────────────────────────────────────────────
// Runs before any page script: the helpers the checks call, the inline styles the HTML itself wrote (snapshotted when
// parsing ends, before the module scripts run), the layout shifts (Chromium only) and where the hero's lede sits in
// every frame of the load.

function pageHelpers() {
  const frames = (n = 1) =>
    new Promise((resolve) => {
      let i = 0
      const step = () => (++i >= n ? resolve() : requestAnimationFrame(step))
      requestAnimationFrame(step)
    })
  const round = (v) => Math.round(v * 100) / 100
  window.__c = {
    frames,
    /** Scroll to `y` at once, through the page's scroll authority. */
    async scrollTo(y) {
      const site = window.__site
      if (site) site.authority.scrollTo(y, { immediate: true })
      else window.scrollTo({ top: y, behavior: 'instant' })
      await frames(4)
    },
    maxScroll: () => document.documentElement.scrollHeight - window.innerHeight,
    block: (selector) => window.__site.blocks.get(document.querySelector(selector)),
    /** The scroll that puts a scene at band `band` (0..1 across its band, the holds outside it). */
    bandScroll(selector, band) {
      const scene = window.__c.block(selector)
      const { headExit, tailEnter } = scene.bounds()
      const t = scene.trigger
      return t.start + (headExit + band * (tailEnter - headExit)) * (t.end - t.start)
    },
    /** The ink the header should wear: the last themed section, in document order, across its bottom edge. */
    ink() {
      const header = document.querySelector('[data-header]')
      const line = header.offsetTop + header.offsetHeight
      const under = Array.from(document.querySelectorAll('[data-header-theme]')).filter((el) => {
        const r = el.getBoundingClientRect()
        return r.height > 0 && r.top <= line && r.bottom > line
      })
      const want = under.length ? under[under.length - 1].dataset.headerTheme : header.dataset.headerInkDefault
      return { want, have: header.dataset.headerInk ?? null }
    },
    /**
     * Elements under `root` whose computed transform, translate, scale or rotate isn't none: `displaced` where one of
     * them moves the element, `identity` where it's written but moves nothing (a matrix(1, 0, 0, 1, 0, 0) left inline).
     */
    transformed(root) {
      const displaced = []
      const identity = []
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const cs = getComputedStyle(el)
        if (cs.transform === 'none' && cs.translate === 'none' && cs.scale === 'none' && cs.rotate === 'none') continue
        const still =
          new DOMMatrixReadOnly(cs.transform === 'none' ? undefined : cs.transform).isIdentity &&
          (cs.translate === 'none' || /^0px( 0px){0,2}$/.test(cs.translate)) &&
          (cs.scale === 'none' || /^1( 1){0,2}$/.test(cs.scale)) &&
          (cs.rotate === 'none' || /^0deg$/.test(cs.rotate))
        ;(still ? identity : displaced).push(window.__c.name(el))
      }
      return { displaced, identity }
    },
    name(el) {
      const attrs = Array.from(el.attributes, (a) => (a.name === 'class' ? `.${a.value.split(' ')[0]}` : a.name.startsWith('data-') ? `[${a.name}]` : ''))
      return `${el.tagName.toLowerCase()}${attrs.join('')}`
    },
    /** Every text run on the page that a reader can't see: transparent, hidden, or inside something that is. */
    invisibleText() {
      const out = []
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.data.trim()
        const el = node.parentElement
        if (!text || !el || el.closest('script, style, noscript, [data-split-copy]')) continue
        let opacity = 1
        let why = ''
        for (let e = el; e; e = e.parentElement) {
          const cs = getComputedStyle(e)
          opacity *= Number(cs.opacity)
          if (cs.display === 'none') why = 'display: none'
          if (cs.clipPath !== 'none' && /inset\(100%/.test(cs.clipPath)) why = 'clipped'
        }
        const cs = getComputedStyle(el)
        if (cs.visibility !== 'visible') why = `visibility: ${cs.visibility}`
        if (opacity < 0.99) why = `opacity ${round(opacity)}`
        if (!why && el.getClientRects().length === 0) why = 'no box'
        if (why) out.push(`${window.__c.name(el)} "${text.slice(0, 24)}": ${why}`)
      }
      return out
    },
  }

  window.__authored = new WeakMap()
  document.addEventListener('readystatechange', () => {
    if (document.readyState !== 'interactive') return
    for (const el of document.querySelectorAll('[style]')) window.__authored.set(el, el.getAttribute('style'))
  })

  window.__shifts = null
  if ((PerformanceObserver.supportedEntryTypes || []).includes('layout-shift')) {
    window.__shifts = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__shifts.push(entry.value)
    }).observe({ type: 'layout-shift', buffered: true })
  }
  window.__ledeTops = []
  const track = () => {
    const lede = document.querySelector('.hero__lede, .guide__lede')
    if (lede) window.__ledeTops.push(round(lede.getBoundingClientRect().top))
    if (window.__ledeTops.length < 180) requestAnimationFrame(track)
  }
  requestAnimationFrame(track)
}

// ── helpers ─────────────────────────────────────────────────────────────

const near = (a, b, tol = 1) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol
const r3 = (v) => Math.round(v * 1000) / 1000

/** Scrolls the whole page top to bottom, half a viewport at a time, and back to the bottom; `each` samples a stop. */
async function scrollThrough(page, each) {
  const max = await page.evaluate(() => window.__c.maxScroll())
  const step = VIEWPORT.height / 2
  for (let y = 0; y <= max + step; y += step) {
    await page.evaluate((top) => window.__c.scrollTo(top), Math.min(y, max))
    await page.waitForTimeout(120)
    if (each) await each(Math.min(y, max))
  }
  return max
}

/** Waits (up to `timeout` ms) for `fn` in the page to return truthy; the elapsed ms, or null. */
async function until(page, fn, arg, timeout = 6000) {
  const t0 = Date.now()
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 100 })
    return Date.now() - t0
  } catch {
    return null
  }
}

/** Every entrance on the page, as it stands: items, split headings (by handle), count-ups. */
function entranceState() {
  const items = Array.from(document.querySelectorAll('[data-reveal-item]'))
  const pending = items.filter((el) => el.getAttribute('data-reveal-state') !== 'shown' || getComputedStyle(el).opacity !== '1')
  const splits = Array.from(document.querySelectorAll('[data-split-reveal]'), (el) => window.__site.blocks.get(el))
  const counts = Array.from(document.querySelectorAll('[data-count-up]'))
  return {
    items: items.length,
    pending: pending.map(window.__c.name),
    moving: items.filter((el) => getComputedStyle(el).transform !== 'none').length,
    splits: splits.length,
    splitsDone: splits.filter((s) => s && s.done).length,
    counts: counts.length,
    countsDone: counts.filter((el) => el.getAttribute('data-count-state') === 'done').length,
    countText: counts.map((el) => el.textContent),
  }
}

// ── checks ──────────────────────────────────────────────────────────────
// Each takes a `t` bound to one browser and returns [[page, name, ok, detail], ...].

const CHECKS = {
  async load(t) {
    const out = []
    for (const [name, path] of Object.entries(PAGES)) {
      const { page } = await t.open(path)
      const s = await page.evaluate(() => {
        const wrapper = document.getElementById('smooth-wrapper')
        const content = document.getElementById('smooth-content')
        return {
          authority: document.documentElement.dataset.scrollAuthority ?? null,
          gate: document.documentElement.dataset.animation ?? null,
          ready: 'animationReady' in document.documentElement.dataset,
          wrapper: wrapper ? getComputedStyle(wrapper).position : null,
          content: content ? getComputedStyle(content).transform : null,
        }
      })
      if (name === 'guide') {
        const res = await fetch(new URL(path.replace(/\/$/, ''), t.base).href, { redirect: 'manual' })
        out.push([
          name,
          'typed without its trailing slash, the page folder redirects to it',
          res.status === 301 && res.headers.get('location') === path,
          `${path.replace(/\/$/, '')} → ${res.status} ${res.headers.get('location')}`,
        ])
      }
      out.push([
        name,
        `loads with the gate on and stamps html[data-scroll-authority="${AUTHORITY[name]}"]`,
        s.authority === AUTHORITY[name] && s.gate === 'on' && s.ready,
        `authority ${s.authority} · gate ${s.gate} · engine ready ${s.ready}`,
      ])
      if (name === 'home') {
        await page.evaluate(() => window.__c.scrollTo(1200))
        await page.waitForTimeout(300)
        const moved = await page.evaluate(() => ({
          wrapper: getComputedStyle(document.getElementById('smooth-wrapper')).position,
          content: getComputedStyle(document.getElementById('smooth-content')).transform,
        }))
        out.push([
          name,
          'ScrollSmoother runs: the wrapper is fixed and the content moves by transform',
          moved.wrapper === 'fixed' && /matrix/.test(moved.content),
          `wrapper ${moved.wrapper} · content ${moved.content}`,
        ])
      }
    }
    return out
  },

  async split(t) {
    const out = []
    const served = await fetch(new URL('/', t.base)).then((res) => res.text())
    const h1 = /<h1\b[^>]*\bdata-split-words\b[^>]*>([\s\S]*?)<\/h1>/.exec(served)?.[1] ?? ''
    const words = h1.match(/data-split-word=""/g)?.length ?? 0
    const copy = /<span data-split-copy="">([^<]*)<\/span>/.exec(h1)?.[1]
    {
      // JavaScript off: what the browser got is what it shows.
      const { page } = await t.open('/', { javaScriptEnabled: false })
      await page.waitForTimeout(2600)
      const dom = await page.evaluate(() => {
        const h1 = document.querySelector('h1')
        const spans = Array.from(h1.querySelectorAll('[data-split-word]'))
        return {
          words: spans.length,
          shown: spans.filter((el) => getComputedStyle(el).opacity === '1' && getComputedStyle(el).transform === 'none').length,
          text: h1.querySelector('[data-split-copy]')?.textContent ?? null,
        }
      })
      out.push([
        'home',
        'the hero headline is split in the served HTML, and without JavaScript every word lands',
        words === HEADLINE.split(' ').length && copy === HEADLINE && dom.words === words && dom.shown === words && dom.text === HEADLINE,
        `served: ${words} words, copy "${copy}" · no JS: ${dom.shown}/${dom.words} words at rest`,
      ])
    }
    {
      const { page } = await t.open('/', { settle: false })
      await page.waitForTimeout(3000)
      const s = await page.evaluate(() => ({ shifts: window.__shifts, tops: window.__ledeTops }))
      const cls = s.shifts === null ? null : s.shifts.reduce((sum, v) => sum + v, 0)
      const tops = new Set(s.tops)
      out.push([
        'home',
        'CLS during load < 0.01 (Chromium), and the lede under the headline never moves (every engine)',
        (cls === null || cls < 0.01) && s.tops.length >= 30 && tops.size === 1,
        `CLS ${cls === null ? 'n/a (no Layout Instability API)' : r3(cls)} · lede top ${[...tops].join(' / ')} px over ${s.tops.length} frames`,
      ])
    }
    return out
  },

  async scene(t) {
    const { page } = await t.open('/')
    const setup = await page.evaluate(() => {
      const scene = window.__c.block('.clocks')
      const t = scene.trigger
      return { start: t.start, end: t.end, labels: Object.keys(scene.timeline().labels) }
    })
    const samples = []
    const steps = 32
    for (let i = 0; i <= steps; i++) {
      const y = setup.start - 200 + ((setup.end - setup.start + 400) * i) / steps
      await page.evaluate((top) => window.__c.scrollTo(top), y)
      samples.push(
        await page.evaluate(() => {
          const scene = window.__c.block('.clocks')
          const pin = document.querySelector('.clocks [data-scene-pin]')
          return { p: scene.progress(), tl: scene.timeline().progress(), pinTop: pin.getBoundingClientRect().top }
        }),
      )
    }
    const tl = samples.map((s) => s.tl)
    const rising = tl.every((v, i) => i === 0 || v >= tl[i - 1] - 1e-6)
    const inside = samples.filter((s) => s.p > 0.02 && s.p < 0.98)
    const pinned = inside.every((s) => near(s.pinTop, 0, 1.5))
    return [
      [
        'home',
        'the clocks timeline has a span per clock and rises monotonically from 0 to 1 through the pin',
        CLOCKS.every((c) => setup.labels.includes(c)) && rising && tl[0] <= 0.001 && tl[tl.length - 1] >= 0.999 && inside.length >= 20,
        `labels ${setup.labels.join(', ')} · timeline ${tl.map((v) => r3(v)).join(' ')}`,
      ],
      [
        'home',
        'the pin holds at the top of the viewport while the scene runs (ScrollTrigger pin under ScrollSmoother)',
        pinned,
        `pin top over ${inside.length} stops: ${[...new Set(inside.map((s) => Math.round(s.pinTop)))].join(', ')} px`,
      ],
    ]
  },

  async rail(t) {
    const { page } = await t.open('/')
    const stops = []
    for (const band of [0, 0.25, 0.5, 0.75, 1]) {
      const y = await page.evaluate((b) => window.__c.bandScroll('[data-rail]', b), band)
      await page.evaluate((top) => window.__c.scrollTo(top), y)
      stops.push(
        await page.evaluate(() => {
          const rail = window.__c.block('[data-rail]')
          const pin = document.querySelector('[data-rail] [data-scene-pin]').getBoundingClientRect()
          const panels = Array.from(document.querySelectorAll('[data-rail-panel]'), (el) => el.getBoundingClientRect())
          return {
            band: rail.band(),
            travel: rail.travel(),
            x: parseFloat(rail.track.style.translate) || 0,
            first: panels[0].left - pin.left,
            last: pin.right - panels[panels.length - 1].right,
            pinTop: pin.top,
          }
        }),
      )
    }
    const [start, , , , end] = stops
    const xs = stops.map((s) => s.x)
    const moving = xs.every((x, i) => i === 0 || x <= xs[i - 1])
    const gutter = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-rail-track]')).paddingInlineEnd))
    return [
      [
        'home',
        "the rail's track moves the whole travel: 0 at band 0, −travel at band 1, only ever leftward",
        start.travel > 100 && near(start.x, 0) && near(end.x, -end.travel) && moving,
        `travel ${r3(start.travel)} · translate ${xs.map((x) => Math.round(x)).join(' → ')}`,
      ],
      [
        'home',
        'the first panel starts at the gutter and the last one ends at it, with the pin held at the top',
        near(start.first, gutter) && near(end.last, gutter) && stops.every((s) => near(s.pinTop, 0, 1.5)),
        `first ${r3(start.first)} px · last ${r3(end.last)} px · gutter ${gutter} px · pin top ${stops.map((s) => Math.round(s.pinTop)).join('/')}`,
      ],
    ]
  },

  async entrances(t) {
    const out = []
    for (const [name, path] of Object.entries(PAGES)) {
      const { page } = await t.open(path)
      const before = await page.evaluate(entranceState)
      let inkSamples = 0
      const inkMisses = []
      await scrollThrough(page, async (y) => {
        await page.evaluate(() => window.__c.frames(2))
        const ink = await page.evaluate(() => window.__c.ink())
        inkSamples++
        if (ink.want !== ink.have) inkMisses.push(`${Math.round(y)}: ${ink.have} for ${ink.want}`)
      })
      const ms = await until(page, () => {
        const s = window.__checkEntrances()
        return s.pending.length === 0 && s.moving === 0 && s.splitsDone === s.splits && s.countsDone === s.counts
      })
      const after = await page.evaluate(entranceState)
      out.push([
        name,
        'a scroll through the page lands every entrance, split heading and count-up',
        ms !== null &&
          before.pending.length > 0 &&
          after.pending.length === 0 &&
          after.moving === 0 &&
          after.splits > 0 &&
          after.splitsDone === after.splits &&
          after.countsDone === after.counts,
        `${after.items} items (${before.pending.length} hidden at load, ${after.pending.length} left: ${after.pending.slice(0, 3).join(', ')}) · ` +
          `split ${after.splitsDone}/${after.splits} · counts ${after.countsDone}/${after.counts} ${after.countText.join(' ')} · landed in ${ms} ms`,
      ])
      out.push([
        name,
        "the header's ink is the theme of the section under its bottom edge at every stop",
        inkSamples > 5 && inkMisses.length === 0,
        `${inkSamples - inkMisses.length}/${inkSamples} stops${inkMisses.length ? ` · missed ${inkMisses.slice(0, 3).join(', ')}` : ''}`,
      ])
    }
    return out
  },

  async reduced(t) {
    const out = []
    for (const [name, path] of Object.entries(PAGES)) {
      const { page } = await t.open(path, { reducedMotion: 'reduce' })
      const transformed = new Set()
      const smoothed = []
      await scrollThrough(page, async (y) => {
        const s = await page.evaluate(() => ({
          transformed: window.__c.transformed(document.querySelector('main')),
          wrapper: document.getElementById('smooth-wrapper') && getComputedStyle(document.getElementById('smooth-wrapper')).position,
          content: document.getElementById('smooth-content') && getComputedStyle(document.getElementById('smooth-content')).transform,
        }))
        // At load nothing may even carry a transform: identity counts too.
        ;[...s.transformed.displaced, ...s.transformed.identity].forEach((el) => transformed.add(el))
        if (s.wrapper === 'fixed' || (s.content && s.content !== 'none')) smoothed.push(`${Math.round(y)}: wrapper ${s.wrapper}, content ${s.content}`)
      })
      await page.evaluate(() => window.__c.frames(3))
      const s = await page.evaluate(() => {
        const running = document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName ?? a.constructor.name)
        return {
          authority: document.documentElement.dataset.scrollAuthority,
          invisible: window.__c.invisibleText(),
          entrances: window.__checkEntrances(),
          running,
          split: Array.from(document.querySelectorAll('[data-split-reveal]'), (el) => window.__site.blocks.get(el)?.split ?? null).filter(Boolean).length,
        }
      })
      const pieces = [
        `authority ${s.authority}`,
        name === 'home' ? `smoother ${smoothed.length ? `smoothing at ${smoothed.slice(0, 2).join('; ')}` : 'in native mode at every stop'}` : null,
        `transformed: ${transformed.size ? [...transformed].slice(0, 4).join(', ') : 'none'}`,
        `invisible text: ${s.invisible.length ? s.invisible.slice(0, 3).join('; ') : 'none'}`,
        `split headings ${s.split}`,
        `running animations: ${s.running.length ? s.running.join(', ') : 'none'}`,
      ].filter(Boolean)
      out.push([
        name,
        name === 'home'
          ? 'reduced motion at load: ScrollSmoother in native mode, nothing transformed, every word visible, nothing running'
          : 'reduced motion at load: nothing transformed (no parallax), every word visible, nothing running',
        s.authority === AUTHORITY[name] &&
          smoothed.length === 0 &&
          transformed.size === 0 &&
          s.invisible.length === 0 &&
          s.entrances.pending.length === 0 &&
          s.split === 0 &&
          s.running.length === 0,
        pieces.join(' · '),
      ])
    }
    {
      // /guide/, switched on live half-way down: entrances landed, the split heading back to its text, the CSS
      // timelines gone.
      const { page } = await t.open('/guide/')
      const half = await page.evaluate(() => window.__c.maxScroll() / 2)
      for (let y = 0; y < half; y += VIEWPORT.height / 2) await page.evaluate((top) => window.__c.scrollTo(top), y)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.waitForTimeout(900)
      const displaced = new Set()
      await scrollThrough(page, async () => {
        const s = await page.evaluate(() => window.__c.transformed(document.querySelector('main')))
        ;[...s.displaced, ...s.identity].forEach((el) => displaced.add(el))
      })
      const s = await page.evaluate(() => ({
        invisible: window.__c.invisibleText(),
        entrances: window.__checkEntrances(),
        split: window.__c.block('[data-split-reveal]').split,
        timelines: document.getAnimations().filter((a) => !(a.timeline instanceof DocumentTimeline)).length,
      }))
      out.push([
        'guide',
        'reduced motion switched on half-way: every entrance shown, the heading unsplit, no CSS timeline, nothing transformed',
        displaced.size === 0 && s.invisible.length === 0 && s.entrances.pending.length === 0 && s.split === null && s.timelines === 0,
        `transformed: ${displaced.size ? [...displaced].slice(0, 4).join(', ') : 'none'} · pending entrances ${s.entrances.pending.length} · ` +
          `split ${s.split === null ? 'reverted' : 'still split'} · ${s.timelines} scroll-driven animations · ` +
          `invisible text: ${s.invisible.length ? s.invisible.slice(0, 3).join('; ') : 'none'}`,
      ])
    }
    {
      // Switched on live, mid-scene.
      const { page } = await t.open('/')
      const y = await page.evaluate(() => window.__c.bandScroll('.clocks', 0.5))
      await page.evaluate((top) => window.__c.scrollTo(top), y)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.waitForTimeout(900)
      const displaced = new Set()
      const identity = new Set()
      const smoothed = []
      await scrollThrough(page, async (at) => {
        const s = await page.evaluate(() => ({
          transformed: window.__c.transformed(document.querySelector('main')),
          wrapper: getComputedStyle(document.getElementById('smooth-wrapper')).position,
          content: getComputedStyle(document.getElementById('smooth-content')).transform,
        }))
        s.transformed.displaced.forEach((el) => displaced.add(el))
        s.transformed.identity.forEach((el) => identity.add(el))
        if (s.wrapper === 'fixed' || s.content !== 'none') smoothed.push(`${Math.round(at)}: wrapper ${s.wrapper}, content ${s.content}`)
      })
      const s = await page.evaluate(() => ({ invisible: window.__c.invisibleText(), timeline: window.__c.block('.clocks').timeline() }))
      // ScrollSmoother's kill() reverts each data-speed / data-lag effect by writing its start position back inline
      // (translate(0, 0)), so the smoother's re-creation in native mode leaves identity transforms: listed, not failed.
      out.push([
        'home',
        'reduced motion switched on mid-scene: native mode, no timeline, nothing displaced, every word visible',
        smoothed.length === 0 && displaced.size === 0 && s.invisible.length === 0 && s.timeline === null,
        `smoother ${smoothed.length ? smoothed.slice(0, 2).join('; ') : 'native at every stop'} · displaced: ${displaced.size ? [...displaced].slice(0, 4).join(', ') : 'none'} · ` +
          `identity transforms left: ${identity.size ? [...identity].join(', ') : 'none'} · ` +
          `invisible text: ${s.invisible.length ? s.invisible.slice(0, 3).join('; ') : 'none'}`,
      ])
    }
    return out
  },

  async nojs(t) {
    const out = []
    for (const [name, path] of Object.entries(PAGES)) {
      // No page script runs, init scripts included: everything is read by evaluation alone. The headline's words are
      // CSS animations, so they are given time to land.
      const { page } = await t.open(path, { javaScriptEnabled: false })
      await page.waitForTimeout(2600)
      const s = await page.evaluate(() => {
        const out = []
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.data.trim()
          const el = node.parentElement
          if (!text || !el || el.closest('script, style, noscript, [data-split-copy]')) continue
          let opacity = 1
          for (let e = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity)
          const cs = getComputedStyle(el)
          if (opacity < 0.99 || cs.visibility !== 'visible' || el.getClientRects().length === 0) out.push(`${el.tagName} "${text.slice(0, 24)}"`)
        }
        const track = document.querySelector('[data-rail-track]')
        const bar = document.querySelector('[data-scroll-fx~="progress"]')
        return {
          gate: document.documentElement.dataset.animation ?? null,
          invisible: out,
          rail: track ? { overflow: getComputedStyle(track).overflowX, scrolls: track.scrollWidth > track.clientWidth + 1 } : null,
          bar: bar ? getComputedStyle(bar).scale : null,
          timelines: document.getAnimations().filter((a) => a.timeline && !(a.timeline instanceof DocumentTimeline)).length,
        }
      })
      out.push([
        name,
        'JavaScript off: no gate, and every word on the page is visible',
        s.gate === null && s.invisible.length === 0,
        `gate ${s.gate} · invisible: ${s.invisible.length ? s.invisible.slice(0, 4).join('; ') : 'none'}`,
      ])
      if (s.rail) {
        out.push([
          name,
          "JavaScript off: the rail's track is a native scroller, so every panel is in reach",
          s.rail.overflow === 'auto' && s.rail.scrolls,
          `overflow-x ${s.rail.overflow} · scrolls ${s.rail.scrolls}`,
        ])
      }
      if (name === 'guide') {
        const css = t.browser !== 'firefox'
        out.push([
          name,
          css
            ? 'JavaScript off: the reading-progress bar and the parallax still run on CSS timelines'
            : 'JavaScript off: Firefox has no CSS scroll timelines, so the bar and the parallax rest in their static state',
          css ? s.timelines >= 2 : s.timelines === 0 && s.bar === '0 1',
          `${s.timelines} scroll-driven animations · bar scale ${s.bar}`,
        ])
      }
    }
    return out
  },

  async mount(t) {
    const out = []
    {
      const { page } = await t.open('/guide/')
      const s = await page.evaluate(() => {
        const { mount, ScrollTrigger } = window.__site
        const host = document.createElement('div')
        host.innerHTML =
          '<p class="t-a" id="a1"></p><div class="t-b" id="b1"><p class="t-a t-b" id="ab"></p></div>' +
          '<p class="t-b" id="b2"></p><p class="t-a" id="a2"></p>'
        document.body.append(host)
        const log = []
        const spy = (kind) => (el) => {
          log.push(`${kind}:${el.id}`)
        }
        const refresh = ScrollTrigger.refresh
        let refreshes = 0
        ScrollTrigger.refresh = function (...args) {
          refreshes++
          return refresh.apply(this, args)
        }
        let stop
        try {
          // '.t-b' first in the map: document order must win across the two, and the map's order within one element.
          stop = mount(host, { '.t-b': spy('b'), '.t-a': spy('a') })
        } finally {
          ScrollTrigger.refresh = refresh
        }
        const order = [...log]
        const again = mount(host, { '.t-a': spy('again') })
        const twice = { same: again === stop, calls: log.length - order.length }
        stop()
        stop()
        const rejects = [document, document.documentElement].map((root) => {
          try {
            mount(root, {})
            return 'accepted'
          } catch (error) {
            return error instanceof TypeError ? 'TypeError' : String(error)
          }
        })

        // Two block types making ScrollTriggers: one returns a cleanup, one returns nothing (the context's to revert).
        const destroyed = []
        const before = ScrollTrigger.getAll().length
        const stop2 = mount(host, {
          '.t-a': (el) => {
            ScrollTrigger.create({ trigger: el, start: 'top bottom' })
          },
          '.t-b': (el) => {
            const trigger = ScrollTrigger.create({ trigger: el, start: 'top bottom' })
            return () => {
              destroyed.push(el.id)
              trigger.kill()
            }
          },
        })
        const created = ScrollTrigger.getAll().length - before
        stop2()
        const left = ScrollTrigger.getAll().filter((st) => host.contains(st.trigger)).length

        // A block that throws leaves nothing behind, and the root can be mounted again.
        let thrown = null
        try {
          mount(host, {
            '.t-b': (el) => ScrollTrigger.create({ trigger: el }),
            '.t-a': (el) => {
              if (el.id === 'a2') throw new Error('boom')
            },
          })
        } catch (error) {
          thrown = error.message
        }
        const afterThrow = ScrollTrigger.getAll().filter((st) => host.contains(st.trigger)).length
        const remount = mount(host, { '.t-a': spy('remount') })
        const remounted = log.filter((entry) => entry.startsWith('remount:')).length
        remount()
        host.remove()
        return { order, refreshes, twice, rejects, created, destroyed, left, thrown, afterThrow, remounted }
      })
      const ORDER = ['a:a1', 'b:b1', 'b:ab', 'a:ab', 'b:b2', 'a:a2']
      out.push([
        'guide',
        'mount(): blocks are created in document order across two block types (the map\'s order on one element), then one refresh',
        JSON.stringify(s.order) === JSON.stringify(ORDER) && s.refreshes === 1,
        `${s.order.join(' ')} · ${s.refreshes} refresh`,
      ])
      out.push([
        'guide',
        'mount(): mounting a mounted root is a no-op returning its cleanup; the document and <html> are rejected',
        s.twice.same && s.twice.calls === 0 && s.rejects.every((r) => r === 'TypeError'),
        `same cleanup ${s.twice.same}, ${s.twice.calls} new calls · document: ${s.rejects[0]}, <html>: ${s.rejects[1]}`,
      ])
      out.push([
        'guide',
        "mount(): the cleanup destroys in reverse order and the context reverts what a block didn't; a throw leaves nothing",
        s.created === 6 &&
          JSON.stringify(s.destroyed) === JSON.stringify(['b2', 'ab', 'b1']) &&
          s.left === 0 &&
          s.thrown === 'boom' &&
          s.afterThrow === 0 &&
          s.remounted === 3,
        `${s.created} triggers · destroyed ${s.destroyed.join(', ')} · ${s.left} left · throw "${s.thrown}" left ${s.afterThrow} · remounted ${s.remounted}`,
      ])
    }
    for (const [name, path] of Object.entries(PAGES)) {
      // Torn down mid-page: a pin live (the rail, half-way), entrances in flight from the last stop, triggers still
      // waiting below. ScrollSmoother's data-speed and data-lag effects are the page's authority's, not the route's.
      const { page } = await t.open(path)
      const stop = name === 'home' ? await page.evaluate(() => window.__c.bandScroll('[data-rail]', 0.5)) : await page.evaluate(() => window.__c.maxScroll() / 2)
      for (let y = 0; y < stop; y += VIEWPORT.height / 2) {
        await page.evaluate((top) => window.__c.scrollTo(top), y)
        await page.waitForTimeout(100)
      }
      await page.evaluate((top) => window.__c.scrollTo(top), stop)
      const route = () => {
        const main = document.querySelector('main')
        const own = (el) => !!el && main.contains(el) && !el.closest('[data-speed], [data-lag]')
        const all = window.__site.ScrollTrigger.getAll()
        return {
          total: all.length,
          route: all.filter((st) => own(st.trigger) || own(st.pin)).length,
          spacers: main.querySelectorAll('.pin-spacer').length,
          inFlight: Array.from(main.querySelectorAll('[data-reveal-item]')).filter((el) => el.style.length > 0).length,
          styled: [main, ...main.querySelectorAll('*')]
            .filter((el) => !el.closest('[data-speed], [data-lag]'))
            .filter((el) => (el.style.length ? el.getAttribute('style') : null) !== (window.__authored.get(el) ?? null))
            .map((el) => `${window.__c.name(el)} {${el.getAttribute('style')}}`),
        }
      }
      const before = await page.evaluate(route)
      await page.evaluate(() => window.__site.unmount())
      await page.evaluate(() => window.__c.frames(4))
      const after = await page.evaluate(route)
      out.push([
        name,
        "the route's cleanup, mid-page, leaves no ScrollTrigger, pin-spacer or inline style in its root",
        before.route > 0 && after.route === 0 && (name !== 'guide' || after.total === 0) && after.spacers === 0 && after.styled.length === 0,
        `before: ${before.route} route triggers, ${before.spacers} pin-spacers, ${before.inFlight} entrances in flight, ${before.styled.length} styled · ` +
          `after: ${after.route} route triggers (${after.total} in all${name === 'home' ? ', the smoother and its effects' : ''}), ${after.spacers} pin-spacers, ` +
          `inline styles: ${after.styled.length ? after.styled.slice(0, 4).join('; ') : 'none'}`,
      ])
    }
    return out
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
  if (!existsSync(join(siteDir, 'dist', 'index.html')) || !existsSync(join(siteDir, 'dist', 'guide', 'index.html'))) {
    console.error('checks: no build in dist/; run `pnpm build` first')
    process.exit(2)
  }
  open.server = await preview({
    root: siteDir,
    logLevel: 'warn',
    preview: { host: '127.0.0.1', port: 0, strictPort: false, open: false },
  })
  const base = `http://127.0.0.1:${open.server.httpServer.address().port}`

  let failures = 0
  const counts = {}
  const line = (ok, browser, page, name, detail) => {
    counts[browser] ??= { pass: 0, fail: 0 }
    counts[browser][ok ? 'pass' : 'fail']++
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${browser.padEnd(8)}  ${page.padEnd(5)}  ${name}${detail ? `  (${detail})` : ''}`)
  }

  for (const browserName of args.browsers) {
    open.browser = await BROWSERS[browserName].launch()
    const errors = { home: [], guide: [] }
    for (const id of CHECK_IDS) {
      if (args.only && !args.only.includes(id)) continue
      const contexts = []
      const t = {
        browser: browserName,
        base,
        /** A fresh context on `path`: the blocks mounted and the load's refreshes settled (`settle: false` returns at once). */
        async open(path, { reducedMotion = 'no-preference', javaScriptEnabled = true, settle = true } = {}) {
          const context = await open.browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion, javaScriptEnabled })
          contexts.push(context)
          await context.addInitScript(pageHelpers)
          await context.addInitScript(`window.__checkEntrances = ${entranceState.toString()}`)
          const page = await context.newPage()
          const bucket = errors[path === '/' ? 'home' : 'guide']
          page.on('pageerror', (err) => bucket.push(`${id}: ${err.message.split('\n')[0]}`))
          page.on('console', (msg) => msg.type() === 'error' && bucket.push(`${id}: console: ${msg.text().split('\n')[0]}`))
          await page.goto(new URL(path, base).href, { waitUntil: 'load' })
          if (javaScriptEnabled && settle) {
            await page.waitForFunction(() => !!window.__site && !!document.documentElement.dataset.scrollAuthority)
            await page.evaluate(() => document.fonts.ready.then(() => window.__c.frames(3)))
            // ScrollTrigger's and ScrollSmoother's load-time refreshes.
            await page.waitForTimeout(500)
          }
          return { page }
        },
      }
      try {
        for (const [page, name, ok, detail] of await CHECKS[id](t)) line(ok, browserName, page, name, detail)
      } catch (err) {
        line(false, browserName, '-', id, err.message.split('\n')[0])
      } finally {
        for (const context of contexts) await context.close().catch(() => {})
      }
    }
    for (const [page, list] of Object.entries(errors)) {
      line(list.length === 0, browserName, page, 'no uncaught errors or console errors', list.slice(0, 3).join(' | '))
    }
    await open.browser.close()
    open.browser = null
  }

  await shutdown()
  const summary = Object.entries(counts).map(([b, c]) => `${b} ${c.pass}/${c.pass + c.fail}`).join(' · ')
  console.log(`\n${failures ? `${failures} FAILED` : 'all passed'} · ${summary}`)
  process.exit(failures ? 1 : 0)
}

main().catch(async (err) => {
  console.error(err)
  await shutdown()
  process.exit(1)
})
