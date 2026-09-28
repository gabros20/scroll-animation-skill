#!/usr/bin/env node
// scroll-effects.mjs — css/scroll-effects.css in Chromium, WebKit and Firefox. Builds tests/fixtures/scroll-effects
// with Vite, serves the build with `vite preview`, prints one PASS/FAIL line per check/page/browser, and exits 1 on
// any FAIL. Needs the Playwright browsers, so it is its own script, like `test:rail`: `npm run test:scroll-effects`.
//
// Where a browser runs scroll-driven animations (read from CSS.supports, so Firefox switches over by itself once it
// ships them), each effect is read at rest at known scroll offsets and compared with what the spec's range maths says
// it must show (scroll-animations-1 §4, the way spike S7a checked Chromium and WebKit). Where it doesn't (Firefox
// 155), every effect must show its static state and no scroll-driven animation may exist. The marquee is time-driven
// and runs everywhere. Reduced motion and print show the static state in every browser.
//
// Pages (tests/fixtures/scroll-effects, at a 1000 x 600 viewport):
//   effects   parallax, fade-in, exit-fade and scale-in, alone and composed, tuned and on the defaults; a 900 px
//             subject; a range tuned on a parent; an overflow: clip frame (and an overflow: hidden control); a pinned
//             scene's riding copy; the progress bar
//   stack     two sticky stacks under an 80 px header: 4 tuned cards whose last is held by an ::after spacer, and 13
//             cards on the defaults with no spacer
//   marquee   two marquees (one reversed) and the page's pause button
//   rtl       <html dir="rtl">: the progress bar and a marquee
//   smoother  ScrollSmoother: the view() effects switched off, the progress bar outside the wrapper
//
//   node tests/scroll-effects.mjs [--browsers chromium,webkit,firefox,firefox-pref] [--only effects,stack,…]
//
// `firefox-pref`, not in the default run, is Firefox with layout.css.scroll-driven-animations.enabled: what Firefox
// does once it ships them.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium, firefox, webkit } from 'playwright'
import { build, preview } from 'vite'

const testsDir = dirname(fileURLToPath(import.meta.url))
const fixtureRoot = join(testsDir, 'fixtures', 'scroll-effects')
const outDir = join(testsDir, '.scratch', 'scroll-effects-dist')

const BROWSERS = {
  chromium: { type: chromium },
  webkit: { type: webkit },
  firefox: { type: firefox },
  'firefox-pref': { type: firefox, prefs: { 'layout.css.scroll-driven-animations.enabled': true } },
}
const DEFAULT_BROWSERS = ['chromium', 'webkit', 'firefox']
const PAGES = ['effects', 'stack', 'marquee', 'rtl', 'smoother']
const VIEWPORT = { width: 1000, height: 600 }
/** The stack page's --header-h: the cards' sticky top, and animation.css's scroll-padding-top, which view() insets by. */
const HEADER = 80
/** Readouts at rest: translate in px, opacity and scale. S7a's worst WebKit error was 0.0004 of progress. */
const TOL = { px: 0.5, opacity: 0.002, scale: 0.002 }

// ── args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { browsers: DEFAULT_BROWSERS, only: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--browsers') out.browsers = argv[++i].split(',')
    else if (a === '--only') out.only = argv[++i].split(',')
    else throw new Error(`unknown argument: ${a}`)
  }
  for (const b of out.browsers) if (!BROWSERS[b]) throw new Error(`unknown browser: ${b} (${Object.keys(BROWSERS).join(', ')})`)
  return out
}

// ── build + serve ──────────────────────────────────────────────────────

async function serve() {
  await build({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      // Every rule reaches the browser as written: no CSS minification or lowering.
      cssMinify: false,
      cssTarget: 'esnext',
      rollupOptions: { input: Object.fromEntries(PAGES.map((p) => [p, join(fixtureRoot, `${p}.html`)])) },
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

// ── spec maths ──────────────────────────────────────────────────────────

const clamp01 = (v) => Math.min(1, Math.max(0, v))
const lerp = (a, b, t) => a + (b - a) * t
const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : v)

/**
 * Scroll offsets where each named view() range starts and ends (scroll-animations-1 §4, as S7a checked it), for a
 * subject whose border box starts at T (document px) and is h tall, in a scrollport H tall whose top edge is inset by
 * p: view()'s auto inset is the scroller's scroll-padding, which animation.css sets from --header-h.
 */
function namedRanges({ T, h }, H, p = 0) {
  const containStart = Math.min(T - p, T + h - H)
  const containEnd = Math.max(T - p, T + h - H)
  return {
    cover: [T - H, T + h - p],
    contain: [containStart, containEnd],
    entry: [T - H, containStart],
    exit: [containEnd, T + h - p],
    'entry-crossing': [T - H, T + h - H],
    'exit-crossing': [T - p, T + h - p],
  }
}

/** 'exit-crossing 10%' → its scroll offset. */
function offsetOf(spec, box, H, p) {
  const [name, pct] = spec.split(/\s+/)
  const [a, b] = namedRanges(box, H, p)[name]
  return a + ((b - a) * parseFloat(pct)) / 100
}

/** The computed translate as [x, y] px ('none' is 0 0). */
function parseTranslate(v) {
  if (!v || v === 'none') return [0, 0]
  const [x, y = '0px'] = v.split(/\s+/)
  return [parseFloat(x), parseFloat(y)]
}

/** The computed scale as [x, y] ('none' is 1 1; one value is uniform). */
function parseScale(v) {
  if (!v || v === 'none') return [1, 1]
  const [x, y = x] = v.split(/\s+/)
  return [parseFloat(x), parseFloat(y)]
}

// ── the effects and the effects page's probes ───────────────────────────

/** Each view() effect's default range and keyframes (css/scroll-effects.css §2), in slot order. */
const EFFECTS = {
  parallax: { range: ['cover 0%', 'cover 100%'], keyframes: 'fx-parallax' },
  'fade-in': { range: ['entry 0%', 'entry 100%'], keyframes: 'fx-fade-in' },
  'exit-fade': { range: ['exit-crossing 10%', 'exit-crossing 35%'], keyframes: 'fx-exit-fade' },
  'scale-in': { range: ['entry 0%', 'entry 100%'], keyframes: 'fx-scale-in' },
}

/**
 * effects.html's probes: each one's effects with the value its tuning sets (the drift, the faded opacity, the reduced
 * scale), a tuned range, and a translate of its own. What each must show comes from these and its layout box.
 */
const PROBES = {
  parallax: { fx: { parallax: 100 } },
  'parallax-default': { fx: { parallax: 60 } },
  'parallax-own': { fx: { parallax: -80 }, own: [10, 20] },
  'fade-in': { fx: { 'fade-in': 0 } },
  'fade-in-tuned': { fx: { 'fade-in': 0.25 }, range: ['cover 0%', 'cover 50%'] },
  'exit-fade': { fx: { 'exit-fade': 0 } },
  'scale-in': { fx: { 'scale-in': 0.5 } },
  'scale-in-default': { fx: { 'scale-in': 0.9 } },
  composed: { fx: { parallax: 100, 'fade-in': 0, 'exit-fade': 0, 'scale-in': 0.5 } },
  'leak-parent': { fx: { 'exit-fade': 0.3 }, range: ['cover 0%', 'cover 100%'] },
  'leak-child': { fx: { 'fade-in': 0 } },
  'tall-fade': { fx: { 'fade-in': 0, 'exit-fade': 0 } },
  'tall-parallax-scale': { fx: { parallax: 60, 'scale-in': 0.9 } },
  'clip-child': { fx: { parallax: 100, 'fade-in': 0 } },
  'hidden-child': { fx: { parallax: 100, 'fade-in': 0 } },
  'riding-copy': { fx: { 'exit-fade': 0 } },
}

/** Translates the page sets itself, which parallax adds to and every static state keeps. */
const OWN = { 'parallax-own': [10, 20] }

/** What a probe must show at scroll offset S: its translate (its own plus parallax), opacity and scale. */
function expected(spec, box, H, p, S) {
  const progress = (effect) => {
    const [a, b] = (spec.range ?? EFFECTS[effect].range).map((s) => offsetOf(s, box, H, p))
    return (S - a) / (b - a)
  }
  const { fx } = spec
  const [x, y] = spec.own ?? [0, 0]
  const out = { x, y, opacity: 1, scale: 1 }
  if ('parallax' in fx) out.y += lerp(-fx.parallax, fx.parallax, clamp01(progress('parallax')))
  if ('scale-in' in fx) out.scale = lerp(fx['scale-in'], 1, clamp01(progress('scale-in')))
  if ('fade-in' in fx) out.opacity = lerp(fx['fade-in'], 1, clamp01(progress('fade-in')))
  if ('exit-fade' in fx) {
    // Before its range (fill: forwards) it leaves the opacity alone; in it, it fades from whatever is under it, since
    // its from keyframe is left out: fade-in's opacity, or the element's.
    const k = progress('exit-fade')
    if (k >= 0) out.opacity = lerp(out.opacity, fx['exit-fade'], Math.min(1, k))
  }
  out.scaleY = out.scale
  return out
}

/**
 * Where to read each of a probe's effects: 40 px before its range, a quarter, half and three quarters in, and 40 px
 * after. exit-fade is also read 400 px after, where it has to stay gone.
 */
function offsetsFor(spec, box, H, p, max) {
  const out = []
  for (const effect of Object.keys(spec.fx)) {
    const [a, b] = (spec.range ?? EFFECTS[effect].range).map((s) => offsetOf(s, box, H, p))
    out.push(a - 40, lerp(a, b, 0.25), lerp(a, b, 0.5), lerp(a, b, 0.75), b + 40)
    if (effect === 'exit-fade') out.push(b + 400)
  }
  return [...new Set(out.map((y) => Math.round(Math.min(max, Math.max(0, y)))))]
}

// ── page helpers ────────────────────────────────────────────────────────

const read = (page) => page.evaluate(() => window.__fx.read())
const geometry = (page) => page.evaluate(() => window.__fx.geometry())
const frames = (page, n = 3) => page.evaluate((k) => window.__fx.frames(k), n)

/** Scroll to each offset in turn and read every probe there. */
async function sweep(page, offsets) {
  const rows = []
  for (const y of [...new Set(offsets)].sort((a, b) => a - b)) {
    const S = await page.evaluate((v) => window.__fx.scrollTo(v), y)
    rows.push({ y, S, probes: (await read(page)).probes })
  }
  return rows
}

/**
 * One probe against `want(S)` at the offsets it was read at: the worst error of each kind, and the first miss. Every
 * value is compared at every offset, so an effect that disturbs another effect's property fails too.
 */
function score(rows, id, offsets, want) {
  const at = new Set(offsets)
  const worst = { px: 0, opacity: 0, scale: 0 }
  let n = 0
  let miss = null
  for (const row of rows) {
    if (!at.has(row.y)) continue
    const probe = row.probes[id]
    const w = want(row.S)
    const [x, y] = parseTranslate(probe.translate)
    const [sx, sy] = parseScale(probe.scale)
    const err = {
      px: Math.max(Math.abs(x - w.x), Math.abs(y - w.y)),
      opacity: Math.abs(probe.opacity - w.opacity),
      scale: Math.max(Math.abs(sx - w.scale), Math.abs(sy - w.scaleY)),
    }
    n++
    for (const k of Object.keys(worst)) {
      worst[k] = Math.max(worst[k], err[k])
      if (err[k] > TOL[k] && !miss) {
        miss =
          `${id} at ${row.S}: translate ${probe.translate}, opacity ${probe.opacity}, scale ${probe.scale}; ` +
          `want ${r4(w.x)}px ${r4(w.y)}px, ${r4(w.opacity)}, ${r4(w.scale)} ${r4(w.scaleY)}`
      }
    }
  }
  return { ok: n > 0 && !miss, n, worst, miss }
}

/** Scores as one check line: how many readings, the worst error of each kind, and the first miss. */
function joined(name, scores, extra = '') {
  const n = scores.reduce((sum, s) => sum + s.n, 0)
  const worst = (k) => r4(Math.max(...scores.map((s) => s.worst[k])))
  const miss = scores.find((s) => s.miss)?.miss
  return [
    name,
    scores.every((s) => s.ok),
    `${scores.length > 1 ? `${scores.length} elements, ` : ''}${n} readings, max error ${worst('px')} px · ` +
      `opacity ${worst('opacity')} · scale ${worst('scale')}${extra}${miss ? ` · FIRST MISS ${miss}` : ''}`,
  ]
}

/** A probe at rest: opacity 1, its own translate (or none), scale none (a progress bar: not drawn), nothing attached. */
function atRest(id, probe) {
  const [x, y] = parseTranslate(probe.translate)
  const [ownX, ownY] = OWN[id] ?? [0, 0]
  const [sx, sy] = parseScale(probe.scale)
  const scaleOk = id.startsWith('progress') ? sx === 0 && sy === 1 : sx === 1 && sy === 1
  return probe.anims.length === 0 && probe.opacity === 1 && x === ownX && y === ownY && scaleOk
}

/** Every listed probe at rest in every row: [ok, the first one that isn't]. */
function allAtRest(rows, ids) {
  for (const row of rows) {
    for (const id of ids) {
      const p = row.probes[id]
      if (!atRest(id, p)) {
        const anims = p.anims.map((a) => `${a.name} on ${a.timeline}`).join(', ') || 'none'
        return [false, `${id} at ${row.S}: opacity ${p.opacity}, translate ${p.translate}, scale ${p.scale}, animations ${anims}`]
      }
    }
  }
  return [true, null]
}

const isMarquee = (id) => /^m\d/.test(id)

// ── checks ──────────────────────────────────────────────────────────────
// Each takes a `t` bound to one browser + one page and returns [[name, ok, detail], ...]. `t.supports` is what the
// browser runs: view() and scroll() timelines, and timeline-scope.

/** Where scroll-driven animations don't run: every scroll effect on the page at rest at five offsets, nothing attached. */
async function staticLines(page, what) {
  const geo = await geometry(page)
  const rows = await sweep(page, [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * geo.scrollMax)))
  const ids = Object.keys(rows[0].probes).filter((id) => !isMarquee(id))
  const [ok, first] = allAtRest(rows, ids)
  const all = await page.evaluate(() => window.__fx.all())
  const scrollDriven = all.filter((a) => a.timeline !== 'DocumentTimeline')
  const other = all.filter((a) => !/^fx-marquee/.test(a.name ?? ''))
  return [
    [`no scroll-driven animations here: ${what} show their static state at every offset`, ok, first ?? `${ids.length} probes × ${rows.length} offsets`],
    [
      'document.getAnimations() holds no scroll-driven animation (only a marquee, time-driven, may run)',
      scrollDriven.length === 0 && other.length === 0,
      `${all.length} animations: ${all.map((a) => `${a.name} on ${a.timeline}`).join(', ') || 'none'}`,
    ],
  ]
}

const CHECKS = {
  effects: {
    pages: ['effects'],
    async run(t) {
      const { page } = await t.open()
      if (!t.supports.view) return staticLines(page, 'parallax, fade-in, exit-fade, scale-in and the progress bar')
      const geo = await geometry(page)
      const ids = Object.keys(PROBES).filter((id) => !['clip-child', 'hidden-child', 'riding-copy'].includes(id))
      const plan = Object.fromEntries(ids.map((id) => [id, offsetsFor(PROBES[id], geo.boxes[id], geo.H, 0, geo.scrollMax)]))
      const rows = await sweep(page, Object.values(plan).flat())
      const s = (id) => score(rows, id, plan[id], (S) => expected(PROBES[id], geo.boxes[id], geo.H, 0, S))
      const first = rows[0].probes
      const slots = (id) => Object.keys(EFFECTS).filter((e) => e in PROBES[id].fx).map((e) => EFFECTS[e].keyframes)
      const wrongSlots = ids.filter((id) => {
        const a = first[id].anims
        const want = slots(id)
        return a.length !== want.length || a.some((x, i) => x.name !== want[i] || x.timeline !== 'ViewTimeline' || x.subject !== id)
      })
      return [
        joined('parallax: translate runs from -d to +d over cover 0–100%, 0 at the midpoint (100px, and the 60px default)', [s('parallax'), s('parallax-default')]),
        joined("parallax adds to the element's own translate (10px 20px), and a negative distance drifts the other way", [s('parallax-own')]),
        joined('fade-in: opacity runs from --fx-fade-from to 1 over entry 0–100% (0), and over a tuned range (0.25, cover 0–50%)', [s('fade-in'), s('fade-in-tuned')]),
        joined("exit-fade: opacity runs from 1 to 0 over exit-crossing 10–35% (v1's exit fade defaults) and stays 0 past it", [s('exit-fade')]),
        joined('scale-in: scale runs from --fx-scale-from to 1 over entry 0–100% (0.5, and the 0.9 default)', [s('scale-in'), s('scale-in-default')]),
        joined('all four on one element: each follows its own range, and exit-fade takes over from fade-in', [s('composed')]),
        joined('a subject taller than the viewport (900 px): fade-in + exit-fade, parallax + scale-in', [s('tall-fade'), s('tall-parallax-scale')]),
        joined("a range and a fade tuned on a parent (exit-fade over cover, to 0.3) don't reach the fade-in nested in it", [s('leak-parent'), s('leak-child')]),
        [
          "each element carries exactly its own effects' animations, in slot order, each on its own view()",
          wrongSlots.length === 0,
          wrongSlots.length
            ? wrongSlots.map((id) => `${id}: ${first[id].anims.map((a) => `${a.name} on ${a.timeline}@${a.subject}`).join(', ')}`).join(' | ')
            : `${ids.length} elements, ${ids.reduce((n, id) => n + first[id].anims.length, 0)} animations`,
        ],
      ]
    },
  },

  clip: {
    pages: ['effects'],
    async run(t) {
      if (!t.supports.view) return []
      const { page } = await t.open()
      const geo = await geometry(page)
      const plan = Object.fromEntries(['clip-child', 'hidden-child'].map((id) => [id, offsetsFor(PROBES[id], geo.boxes[id], geo.H, 0, geo.scrollMax)]))
      const rows = await sweep(page, Object.values(plan).flat())
      const clip = score(rows, 'clip-child', plan['clip-child'], (S) => expected(PROBES['clip-child'], geo.boxes['clip-child'], geo.H, 0, S))
      // The control, not a pass condition: overflow: hidden makes the frame the child's scroller, which never scrolls.
      const control = rows.filter((row) => plan['hidden-child'].includes(row.y)).map((row) => parseTranslate(row.probes['hidden-child'].translate)[1])
      return [
        joined('an overflow: clip frame (a 500 px child in a 300 px frame) still tracks the page', [clip], ` · control, overflow: hidden: parallax y ${[...new Set(control.map(r4))].join(', ')} across the same pass (S7c)`),
      ]
    },
  },

  scene: {
    pages: ['effects'],
    async run(t) {
      if (!t.supports.view) return []
      const { page } = await t.open()
      const geo = await geometry(page)
      const spec = PROBES['riding-copy']
      const box = geo.boxes['riding-copy']
      const plan = offsetsFor(spec, box, geo.H, 0, geo.scrollMax)
      // and far past, while the pin is still stuck: v1's Motion binding faded the copy back in there
      const [, end] = EFFECTS['exit-fade'].range.map((s) => offsetOf(s, box, geo.H, 0))
      plan.push(Math.round(end + 800))
      const rows = await sweep(page, plan)
      return [
        joined("exit-fade on a scene's riding copy (pulled back over the sticky pin) fades on exit-crossing and stays gone", [
          score(rows, 'riding-copy', plan, (S) => expected(spec, box, geo.H, 0, S)),
        ]),
      ]
    },
  },

  header: {
    pages: ['effects'],
    async run(t) {
      if (!t.supports.view) return []
      const { page } = await t.open()
      await page.evaluate((h) => document.documentElement.style.setProperty('--header-h', `${h}px`), HEADER)
      await frames(page)
      const padding = await page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingTop)
      const geo = await geometry(page)
      const ids = ['exit-fade', 'parallax', 'fade-in']
      const plan = Object.fromEntries(ids.map((id) => [id, offsetsFor(PROBES[id], geo.boxes[id], geo.H, HEADER, geo.scrollMax)]))
      const rows = await sweep(page, Object.values(plan).flat())
      return [
        joined(
          `with --header-h: ${HEADER}px (animation.css's scroll-padding-top), the ranges' top edge is the header's bottom: exit-fade and parallax's end move ${HEADER} px, fade-in doesn't`,
          ids.map((id) => score(rows, id, plan[id], (S) => expected(PROBES[id], geo.boxes[id], geo.H, HEADER, S))),
          ` · scroll-padding-top ${padding}`,
        ),
      ]
    },
  },

  progress: {
    pages: ['effects'],
    async run(t) {
      const { page } = await t.open()
      const geo = await geometry(page)
      const offsets = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * geo.scrollMax))
      const rows = await sweep(page, offsets)
      const bar = rows[0].probes.progress
      const originX = parseFloat(bar.origin)
      if (!t.supports.scroll) {
        return [['no scroll(): the progress bar is not drawn (scale 0 1), and would grow from its inline start', atRest('progress', bar) && originX === 0, `scale ${bar.scale} · origin ${bar.origin}`]]
      }
      const s = score(rows, 'progress', offsets, (S) => ({ x: 0, y: 0, opacity: 1, scale: S / geo.scrollMax, scaleY: 1 }))
      const a = bar.anims
      const [name, ok, detail] = joined(
        'progress: scaleX equals the scroll fraction (0, ¼, ½, ¾, 1), from the inline start, on scroll(root)',
        [s],
        ` · origin ${bar.origin} · ${a.map((x) => `${x.name} on ${x.timeline}`).join(', ')}`,
      )
      // --fx-range-start: 600px, a hero's height: empty until 600 px, full at the end.
      const lateOffsets = [300, 600, Math.round(600 + (geo.scrollMax - 600) / 2), geo.scrollMax]
      const lateRows = await sweep(page, lateOffsets)
      const late = score(lateRows, 'progress-late', lateOffsets, (S) => {
        const k = clamp01((S - 600) / (geo.scrollMax - 600))
        return { x: 0, y: 0, opacity: 1, scale: k, scaleY: 1 }
      })
      return [
        [name, ok && originX === 0 && a.length === 1 && a[0].name === 'fx-progress' && a[0].timeline === 'ScrollTimeline', detail],
        joined('progress with --fx-range-start: 600px starts after that much scroll (a scroll() range takes lengths)', [late]),
      ]
    },
  },

  stack: {
    pages: ['stack'],
    async run(t) {
      const { page } = await t.open()
      const geo = await geometry(page)
      const a = ['a1', 'a2', 'a3', 'a4']
      const b = Array.from({ length: 13 }, (_, i) => `b${i + 1}`)
      const cards = [...a, ...b]
      const sticky = (row) => cards.every((id) => row.probes[id].position === 'sticky' && row.probes[id].top === `${HEADER}px`)
      const supported = t.supports.view && t.supports.scope
      const staticChecks = supported ? [] : await staticLines(page, 'the stacks (cards unscaled, undimmed)')
      // Card N runs on card N+1's entry range: [N+1's top at the viewport's bottom, N+1 fully in (or at the header)].
      const entry = (next) => namedRanges(geo.boxes[next], geo.H, HEADER).entry
      const pairs = (list, n) => list.slice(0, n).map((id, i) => [id, list[i + 1]])
      const plan = {}
      for (const [card, next] of [...pairs(a, 3), ...pairs(b, 11)]) {
        const [s0, s1] = entry(next)
        plan[card] = [s0 - 40, lerp(s0, s1, 0.25), lerp(s0, s1, 0.5), lerp(s0, s1, 0.75), s1 + 40].map(Math.round)
        if (card.startsWith('a')) plan[card].push(Math.round(s1)) // the end, where the next card reaches the header
      }
      // Stack B has no spacer: its last card reaches the header, and 40 px later it has left with the stack.
      const lastB = geo.boxes.b13.T - HEADER
      plan.b13 = [lastB, lastB + 40]
      const rows = await sweep(page, Object.values(plan).flat())
      // Sticky, whatever the browser animates. Stack A's cards are exactly as tall as the viewport under the header, so
      // the next card reaches the header where the previous card's range ends (its shrink done, where that runs). It
      // sticks there, the last one too, held by the stack's ::after spacer: 40 px later it hasn't moved.
      const at = (y) => rows.find((row) => row.y === Math.round(y)).probes
      const sticks = pairs(a, 3).map(([card, next]) => {
        const [, s1] = entry(next)
        return { card, next, top: at(s1)[next].rect.top, later: at(s1 + 40)[next].rect.top, scale: at(s1)[card].scale }
      })
      const sticksOk = sticks.every(
        (x) =>
          Math.abs(x.top - HEADER) <= 0.5 &&
          Math.abs(x.later - HEADER) <= 0.5 &&
          Math.abs(parseScale(x.scale)[0] - (supported ? 0.8 : 1)) <= TOL.scale,
      )
      const leaves = { top: at(lastB).b13.rect.top, later: at(lastB + 40).b13.rect.top }
      const stickyLines = [
        [
          "stack A (cards as tall as the viewport under the header): the next card reaches the header as each card's range ends, and sticks; the stack's ::after spacer holds the last",
          sticksOk,
          sticks.map((x) => `${x.card} at ${x.scale} as ${x.next}'s top reaches ${r4(x.top)} (40 px later: ${r4(x.later)})`).join(' · '),
        ],
        [
          'stack B, no spacer: the last card leaves with the stack as soon as it reaches the header',
          Math.abs(leaves.top - HEADER) <= 0.5 && Math.abs(leaves.later - (HEADER - 40)) <= 0.5,
          `b13's top ${r4(leaves.top)}, 40 px later ${r4(leaves.later)}`,
        ],
        ['the cards stick under the header (position: sticky, top: --header-h)', rows.every(sticky), `${cards.length} cards × ${rows.length} offsets`],
      ]
      if (!supported) return [...staticChecks, ...stickyLines]
      const want = (next, scale, opacity) => (S) => {
        const [s0, s1] = entry(next)
        const k = clamp01((S - s0) / (s1 - s0))
        return { x: 0, y: 0, opacity: lerp(1, opacity, k), scale: lerp(1, scale, k), scaleY: lerp(1, scale, k) }
      }
      const scoresA = pairs(a, 3).map(([card, next]) => score(rows, card, plan[card], want(next, 0.8, 0.5)))
      const scoresB = pairs(b, 11).map(([card, next]) => score(rows, card, plan[card], want(next, 0.9, 1)))
      const first = rows[0].probes
      const nextOf = Object.fromEntries([...pairs(a, 3), ...pairs(b, 11)])
      const wiring = cards.map((id) => {
        const anims = first[id].anims
        if (!nextOf[id]) return [id, anims.length === 0, anims.length ? `${id}: ${anims.map((x) => x.name).join(', ')}` : null]
        const ok = anims.length === 1 && anims[0].name === 'fx-stack-card' && anims[0].timeline === 'ViewTimeline' && anims[0].subject === nextOf[id]
        return [id, ok, ok ? null : `${id}: ${anims.map((x) => `${x.name} on ${x.timeline}@${x.subject}`).join(', ') || 'none'}`]
      })
      return [
        joined('stack A (tuned 0.8 / 0.5): card N scales and dims exactly while card N+1 enters (cards 1–3)', scoresA),
        joined('stack B (13 cards, defaults): card N scales to 0.9, opacity untouched, exactly while card N+1 enters (cards 1–11)', scoresB),
        [
          "each card runs on the next card's view timeline in its own stack (timeline-scope per stack); the last card and the 12th of 13 carry none",
          wiring.every(([, ok]) => ok),
          wiring.filter(([, ok]) => !ok).map(([, , d]) => d).join(' | ') || `a1–a3 → a2–a4, b1–b11 → b2–b12; a4, b12, b13: none`,
        ],
        ...stickyLines,
      ]
    },
  },

  marquee: {
    pages: ['marquee'],
    async run(t) {
      const out = []
      const state = async (page) => {
        const r = await read(page)
        const one = (id) => ({ shift: r.probes[`${id}-track`].rect.left - r.probes[id].rect.left, anim: r.probes[`${id}-track`].anims[0] ?? null })
        return { m1: one('m1'), m2: one('m2'), pressed: await page.evaluate(() => document.querySelector('[data-probe="toggle"]').getAttribute('aria-pressed')) }
      }
      /** Running (or not) and moving (or not) over 300 ms, once a play-state change has landed (on the next frame). */
      const motion = async (page) => {
        await frames(page, 2)
        const s0 = await state(page)
        await page.waitForTimeout(300)
        const s1 = await state(page)
        const one = (id) => ({ play: s1[id].anim?.playState ?? 'none', moved: r4(s1[id].shift - s0[id].shift) })
        return { m1: one('m1'), m2: one('m2'), pressed: s1.pressed }
      }
      const running = (m) => m.play === 'running' && Math.abs(m.moved) > 5
      const paused = (m) => m.play === 'paused' && Math.abs(m.moved) < 0.01
      const fmt = (m) => `${m.play}, moved ${m.moved} px`
      {
        const { page } = await t.open()
        const s = await state(page)
        const m = await motion(page)
        const a1 = s.m1.anim
        const a2 = s.m2.anim
        out.push([
          'the marquee runs on the document timeline, infinitely, one loop per --fx-marquee-duration (8s); reversed, it runs the other way',
          a1?.name === 'fx-marquee' &&
            a1.timeline === 'DocumentTimeline' &&
            a1.iterations === 'infinite' &&
            a1.duration === 8000 &&
            a2?.direction === 'reverse' &&
            running(m.m1) &&
            m.m1.moved < 0 &&
            running(m.m2) &&
            m.m2.moved > 0,
          `m1: ${a1?.name} on ${a1?.timeline}, ${a1?.iterations} × ${a1?.duration} ms, ${fmt(m.m1)} · m2: ${a2?.direction}, ${fmt(m.m2)}`,
        ])
      }
      {
        const { page } = await t.open()
        const seam = await page.evaluate(() => {
          const box = document.querySelector('[data-probe="m1"]')
          const track = box.firstElementChild
          const [c1, c2] = track.children
          const anim = track.getAnimations()[0]
          const d = anim.effect.getTiming().duration
          const left = (el) => el.getBoundingClientRect().left - box.getBoundingClientRect().left
          anim.pause()
          anim.currentTime = 0
          const start = { c1: left(c1), c2: left(c2), width: track.getBoundingClientRect().width }
          anim.currentTime = d / 2
          const half = left(track)
          anim.currentTime = d - 1
          return { ...start, half, end: left(c2) }
        })
        const ok =
          Math.abs(seam.c1) <= 0.5 &&
          Math.abs(seam.c2 - seam.width / 2) <= 0.5 &&
          Math.abs(seam.half + seam.width / 4) <= 0.5 &&
          Math.abs(seam.end - seam.c1) <= 0.5
        out.push([
          'it loops seamlessly: the copy starts half the track in, and 1 ms before the loop point it sits where the items started',
          ok,
          `track ${seam.width} px · copy at ${r4(seam.c2)} · half-way ${r4(seam.half)} · copy 1 ms before the loop ${r4(seam.end)} (items started at ${r4(seam.c1)})`,
        ])
      }
      {
        const { page } = await t.open()
        await page.mouse.move(5, 5)
        await page.hover('[data-probe="m1"]')
        const over = await motion(page)
        await page.mouse.move(5, 5)
        const away = await motion(page)
        out.push(['it pauses while hovered, and runs again after', paused(over.m1) && running(over.m2) && running(away.m1), `hovered: ${fmt(over.m1)} (the other: ${fmt(over.m2)}) · after: ${fmt(away.m1)}`])
      }
      {
        const { page } = await t.open()
        await page.focus('[data-probe="m1-copy1"] a')
        const focused = await motion(page)
        const active = await page.evaluate(() => document.activeElement?.getAttribute('href'))
        await page.evaluate(() => document.activeElement?.blur())
        const blurred = await motion(page)
        out.push(['it pauses while focus is inside it, and runs again after', active === '#one' && paused(focused.m1) && running(blurred.m1), `focus on ${active}: ${fmt(focused.m1)} · blurred: ${fmt(blurred.m1)}`])
      }
      {
        const { page } = await t.open()
        await page.mouse.move(5, 5)
        await page.click('[data-probe="toggle"]')
        const on = await motion(page)
        await page.click('[data-probe="toggle"]')
        const off = await motion(page)
        await page.evaluate(() => document.documentElement.setAttribute('data-marquee-paused', ''))
        const all = await motion(page)
        await page.evaluate(() => document.documentElement.removeAttribute('data-marquee-paused'))
        const back = await motion(page)
        out.push([
          "data-marquee-paused pauses it: from the page's button (aria-pressed follows), and on an ancestor (html pauses both)",
          paused(on.m1) && on.pressed === 'true' && running(on.m2) && running(off.m1) && off.pressed === 'false' && paused(all.m1) && paused(all.m2) && running(back.m1) && running(back.m2),
          `button on: ${fmt(on.m1)}, aria-pressed ${on.pressed}, the other ${fmt(on.m2)} · off: ${fmt(off.m1)}, ${off.pressed} · html: ${fmt(all.m1)} / ${fmt(all.m2)} · removed: ${fmt(back.m1)} / ${fmt(back.m2)}`,
        ])
      }
      return out
    },
  },

  rtl: {
    pages: ['rtl'],
    async run(t) {
      const out = []
      {
        const { page } = await t.open()
        const geo = await geometry(page)
        const offsets = [0, 0.5, 1].map((f) => Math.round(f * geo.scrollMax))
        const rows = await sweep(page, offsets)
        const bar = rows[0].probes.progress
        const originX = parseFloat(bar.origin)
        // the layout width: at scale 0 the rect has none
        const width = geo.boxes.progress.w
        const atEnd = Math.abs(originX - width) <= 0.5
        if (t.supports.scroll) {
          const s = score(rows, 'progress', offsets, (S) => ({ x: 0, y: 0, opacity: 1, scale: S / geo.scrollMax, scaleY: 1 }))
          const [name, ok, detail] = joined(
            'right to left: the progress bar grows from the right edge, its scaleX the scroll fraction',
            [s],
            ` · origin ${bar.origin}, bar ${width} px`,
          )
          out.push([name, ok && atEnd, detail])
        } else {
          out.push(['right to left: the progress bar is not drawn, and would grow from the right edge', atEnd && atRest('progress', bar), `origin ${bar.origin}, bar ${width} px, scale ${bar.scale}`])
        }
      }
      {
        const { page } = await t.open()
        const r0 = await read(page)
        await page.waitForTimeout(300)
        const r1 = await read(page)
        const shift = (r) => r.probes['m1-track'].rect.right - r.probes.m1.rect.right
        const moved = r4(shift(r1) - shift(r0))
        const seam = await page.evaluate(() => {
          const box = document.querySelector('[data-probe="m1"]')
          const track = box.firstElementChild
          const [c1, c2] = track.children
          const anim = track.getAnimations()[0]
          const d = anim.effect.getTiming().duration
          const right = (el) => el.getBoundingClientRect().right - box.getBoundingClientRect().right
          anim.pause()
          anim.currentTime = 0
          const start = { c1: right(c1), c2: right(c2), width: track.getBoundingClientRect().width }
          anim.currentTime = d / 2
          const half = right(track)
          anim.currentTime = d - 1
          return { ...start, half, end: right(c2), name: anim.animationName }
        })
        const ok =
          moved > 5 &&
          seam.name === 'fx-marquee-rtl' &&
          Math.abs(seam.c1) <= 0.5 &&
          Math.abs(seam.c2 + seam.width / 2) <= 0.5 &&
          Math.abs(seam.half - seam.width / 4) <= 0.5 &&
          Math.abs(seam.end - seam.c1) <= 0.5
        out.push([
          'right to left: the marquee runs rightward and loops seamlessly, mirrored',
          ok,
          `${seam.name}, moved ${moved} px in 300 ms · track ${seam.width} px · copy at ${r4(seam.c2)} · half-way ${r4(seam.half)} · copy 1 ms before the loop ${r4(seam.end)}`,
        ])
      }
      return out
    },
  },

  smoother: {
    pages: ['smoother'],
    async run(t) {
      const { page } = await t.open()
      const stamp = await page.evaluate(() => document.documentElement.dataset.scrollAuthority ?? null)
      const geo = await geometry(page)
      const offsets = [0, 0.25, 0.5, 0.75].map((f) => Math.round(f * geo.scrollMax))
      const rows = await sweep(page, offsets)
      const ids = ['parallax', 'fade-in', 'exit-fade', 'scale-in', 'stack', 's1', 's2', 's3']
      const [ok, first] = allAtRest(rows, ids)
      const control = [...new Set(rows.map((row) => row.probes.control.opacity))].map(r4)
      const out = [
        [
          'under ScrollSmoother (html[data-scroll-authority="smoother"]) the view() effects and the stack show their static state, nothing attached',
          stamp === 'smoother' && ok,
          `${first ?? `${ids.length} probes × ${rows.length} offsets`} · stamp ${stamp}${t.supports.view ? ` · the ungated control's opacity: ${control.join(', ')} (S2)` : ''}`,
        ],
      ]
      if (t.supports.scroll) {
        const s = score(rows, 'progress', offsets, (S) => ({ x: 0, y: 0, opacity: 1, scale: S / geo.scrollMax, scaleY: 1 }))
        out.push(joined('under ScrollSmoother the progress bar, outside the wrapper, still equals the scroll fraction', [s]))
      }
      return out
    },
  },

  reduced: {
    pages: PAGES,
    async run(t) {
      const { page } = await t.open(t.page, { reducedMotion: 'reduce' })
      const geo = await geometry(page)
      const rows = await sweep(page, [0, 1 / 3, 2 / 3, 1].map((f) => Math.round(f * geo.scrollMax)))
      await page.waitForTimeout(500)
      const all = await page.evaluate(() => window.__fx.all())
      const [ok, first] = allAtRest(rows, Object.keys(rows[0].probes))
      // a stack's cards keep sticking: sticky is layout, not motion
      const cards = Object.keys(rows[0].probes).filter((id) => /^[ab]\d+$/.test(id))
      const sticky = rows.every((row) => cards.every((id) => row.probes[id].position === 'sticky'))
      return [
        [
          `reduced motion at load: every effect shows its static state at every offset, and nothing runs after settling${cards.length ? '; the cards still stick' : ''}`,
          ok && all.length === 0 && sticky,
          `${first ?? `${Object.keys(rows[0].probes).length} probes × ${rows.length} offsets`} · ${all.length} animations${all.length ? `: ${all.map((a) => `${a.name} on ${a.on}`).join(', ')}` : ''}`,
        ],
      ]
    },
  },

  reducedLive: {
    pages: ['effects', 'stack', 'marquee'],
    async run(t) {
      const { page } = await t.open()
      const geo = await geometry(page)
      await page.evaluate((y) => window.__fx.scrollTo(y), Math.round(geo.scrollMax / 5))
      const before = (await page.evaluate(() => window.__fx.all())).length
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.waitForTimeout(300)
      await frames(page)
      const rows = [{ S: await page.evaluate(() => document.scrollingElement.scrollTop), probes: (await read(page)).probes }]
      const all = await page.evaluate(() => window.__fx.all())
      const [ok, first] = allAtRest(rows, Object.keys(rows[0].probes))
      // something ran before the switch wherever the page has something this browser runs
      const expectBefore = t.page === 'marquee' || t.supports.view
      return [
        [
          'reduced motion switched on mid-page: every effect lands on its static state and nothing stays attached',
          ok && all.length === 0 && (!expectBefore || before > 0),
          `${before} animations before, ${all.length} after${first ? ` · ${first}` : ''}`,
        ],
      ]
    },
  },

  print: {
    pages: ['effects', 'stack', 'marquee'],
    async run(t) {
      const { page } = await t.open()
      const geo = await geometry(page)
      await page.evaluate((y) => window.__fx.scrollTo(y), Math.round(geo.scrollMax / 5))
      await page.emulateMedia({ media: 'print' })
      await frames(page)
      const rows = [{ S: await page.evaluate(() => document.scrollingElement.scrollTop), probes: (await read(page)).probes }]
      const all = await page.evaluate(() => window.__fx.all())
      const [ok, first] = allAtRest(rows, Object.keys(rows[0].probes))
      return [['print: every effect at its static state, nothing attached, whatever the scroll', ok && all.length === 0, first ?? `${all.length} animations`]]
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
  open.server = await serve()
  const base = `http://127.0.0.1:${open.server.httpServer.address().port}`

  let failures = 0
  const counts = {}
  const line = (ok, browser, pageName, name, detail) => {
    counts[browser] ??= { pass: 0, fail: 0 }
    counts[browser][ok ? 'pass' : 'fail']++
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${browser.padEnd(12)}  ${pageName.padEnd(8)}  ${name}${detail ? `  (${detail})` : ''}`)
  }

  for (const browserName of args.browsers) {
    const { type, prefs } = BROWSERS[browserName]
    open.browser = await type.launch(prefs ? { firefoxUserPrefs: prefs } : {})
    const newPage = async (pageName, reducedMotion, contexts, onError) => {
      const context = await open.browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion })
      contexts.push(context)
      const page = await context.newPage()
      page.on('pageerror', (err) => onError(err.message.split('\n')[0]))
      page.on('console', (msg) => msg.type() === 'error' && onError(`console: ${msg.text().split('\n')[0]}`))
      await page.goto(`${base}/${pageName}.html`, { waitUntil: 'load' })
      await page.waitForFunction(() => !!window.__fx)
      if (pageName === 'smoother') await page.waitForFunction(() => document.documentElement.dataset.scrollAuthority === 'smoother')
      await page.evaluate(() => document.fonts.ready.then(() => window.__fx.frames(3)))
      return page
    }
    // What this browser runs, read once: it picks the measured checks or the static ones.
    const supportContexts = []
    const supports = await (await newPage('effects', 'no-preference', supportContexts, () => {})).evaluate(() => window.__fx.support())
    for (const context of supportContexts) await context.close()
    console.log(`\n${browserName} ${open.browser.version()}: view() ${supports.view}, scroll() ${supports.scroll}, timeline-scope ${supports.scope}`)

    for (const pageName of PAGES) {
      const errors = []
      for (const [id, check] of Object.entries(CHECKS)) {
        if (!check.pages.includes(pageName) || (args.only && !args.only.includes(id))) continue
        const contexts = []
        const t = {
          browser: browserName,
          page: pageName,
          supports,
          /** A fresh context on a fixture page (this check's page by default), loaded, fonts in, three frames painted. */
          async open(name = pageName, { reducedMotion = 'no-preference' } = {}) {
            return { page: await newPage(name, reducedMotion, contexts, (e) => errors.push(`${id}: ${e}`)) }
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
console.log(failures ? `\n${failures} check(s) failed` : '\nall scroll-effects checks passed')
process.exit(failures ? 1 : 0)
