#!/usr/bin/env node
// view-transitions.mjs: the view-transitions block (assets/view-transitions.ts, css/view-transitions.css,
// css/view-transitions-mpa.css) in Chromium, WebKit and Firefox. transition() runs its update once and the
// pseudo-elements exist while it animates; the header's group never moves and never fades; vt-morph carries the shared
// element's box with a plus-lighter crossfade; forward/back types pick the slides; reduced motion (at load and toggled
// mid-visit) leaves no slide or morph, only the short crossfade; no API, a hidden tab and a concurrent call update
// directly without an uncaught rejection; clicks reach the page once a transition settles; under Lenis a transition
// that jumps to the top leaves no smooth catch-up; React 19.3's <ViewTransition> picks up the same classes;
// cross-document navigations between two pages crossfade, keep the header still and carry their direction; the
// CSS timing matches config.ts. A feature a browser lacks passes by asserting the fallback. Builds
// tests/fixtures/view-transitions with Vite, serves it with `vite preview`, prints one PASS/FAIL line per
// check/page/browser, and exits 1 on any FAIL. Needs the Playwright browsers: `npm run test:view-transitions`.
//
//   node tests/view-transitions.mjs [--browsers chromium,webkit,firefox] [--pages native,lenis,react,mpa] [--only morph,…]

import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium, firefox, webkit } from 'playwright'
import { build, preview } from 'vite'

const testsDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(testsDir, '..')
const fixtureRoot = join(testsDir, 'fixtures', 'view-transitions')
const outDir = join(testsDir, '.scratch', 'view-transitions-dist')
const { COVER, MAIN_STYLE, articleView, headerMarkup, indexView } = await import(
  pathToFileURL(join(fixtureRoot, 'src', 'layout.ts')).href
)
const { CURVES, MOTION } = await import(pathToFileURL(join(repoRoot, 'skills/scroll-animation/assets/config.ts')).href)

const BROWSERS = { chromium, webkit, firefox }
const PAGES = ['native', 'lenis', 'react', 'mpa']
const VIEWPORT = { width: 1280, height: 800 }
const MS = (s) => Math.round(s * 1000)
/** The timing config.ts gives the block (css/view-transitions.css mirrors it). */
const bezier = (name) => `cubic-bezier(${CURVES[name].join(', ')})`
const TIMING = {
  duration: MS(MOTION.disclosure.duration),
  easing: bezier(MOTION.disclosure.curve),
  route: MS(MOTION.route.duration),
  routeEasing: bezier(MOTION.route.curve),
  reduced: MS(MOTION.entranceFade.duration),
}
/** Every animation in `anims` runs MOTION.route on its curve. */
const onRoute = (anims) => anims.length > 0 && anims.every((a) => a.duration === TIMING.route && norm(a.easing) === norm(TIMING.routeEasing))
const timings = (anims) => [...new Set(anims.map((a) => `${a.duration}ms ${a.easing}`))].join(' | ')
const norm = (easing) => String(easing).replace(/\s+/g, '')

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
  if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
  if (warning.code === 'SOURCEMAP_ERROR' && /\.tsx? \(1:0\)/.test(warning.message)) return
  warn(warning)
}

const HTML = ['native', 'lenis', 'react', 'mpa-a', 'mpa-b']

async function serve() {
  const mpaMain = (view) => {
    const markup =
      view === 'index'
        ? indexView().replace('href="#kiln"', 'id="go" href="/mpa-b.html"')
        : articleView().replace('<h1>', '<a id="go" href="/mpa-a.html">Index</a><h1>')
    return `<main id="page" style="${MAIN_STYLE}">${markup}</main>`
  }
  await build({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'warn',
    publicDir: false,
    esbuild: { jsx: 'automatic' },
    plugins: [
      {
        name: 'view-transitions-fixture',
        transformIndexHtml: {
          order: 'pre',
          handler: (html) =>
            html
              .replace('<!--header-->', () => headerMarkup())
              .replace('<!--main-->', () => `<main id="page" style="${MAIN_STYLE}"></main>`)
              .replace('<!--main:index-->', () => mpaMain('index'))
              .replace('<!--main:article-->', () => mpaMain('article')),
        },
      },
      {
        // Vite rewrites the entry <script> and drops its blocking="render": put it back on the multi-page entry, so the
        // block's pagereveal listener is in place before the first frame (as the block asks).
        name: 'view-transitions-render-blocking',
        transformIndexHtml: {
          order: 'post',
          handler: (html) => html.replace(/<script type="module" crossorigin src="(\/assets\/mpa-[^"]+)"><\/script>/, '<script type="module" blocking="render" crossorigin src="$1"></script>'),
        },
      },
    ],
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      rollupOptions: { input: Object.fromEntries(HTML.map((p) => [p, join(fixtureRoot, `${p}.html`)])), onwarn },
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

// ── in-page tools ───────────────────────────────────────────────────────

/**
 * Installed before any page script: `window.__t`, what the checks read. The running transition's animations (the
 * pseudo-element each one runs on, its name and timing), seeking them to a fraction of their duration and playing
 * them on, a pseudo-element's computed style, frames, and every unhandled rejection. With `record`, it also keeps what
 * each cross-document reveal brought (`window.__reveal`): its types and animations, and the header group at three
 * points of it.
 */
function tools({ removeApi = false, record = false } = {}) {
  if (removeApi) {
    delete Document.prototype.startViewTransition
    delete document.startViewTransition
  }
  const isVT = (a) => typeof a.effect?.pseudoElement === 'string' && a.effect.pseudoElement.startsWith('::view-transition')
  const vtAnimations = () => document.getAnimations().filter(isVT)
  const t = {
    rejections: [],
    clicks: [],
    frames: (n = 1) =>
      new Promise((resolve) => {
        let i = 0
        const step = () => (++i >= n ? resolve() : requestAnimationFrame(step))
        requestAnimationFrame(step)
      }),
    anims: () =>
      vtAnimations().map((a) => ({
        pseudo: a.effect.pseudoElement,
        name: a.animationName ?? '',
        duration: Math.round(a.effect.getComputedTiming().duration),
        // A CSS animation's timing function is its keyframes' easing; the effect's own stays linear.
        easing: a.effect.getKeyframes()[0]?.easing ?? a.effect.getTiming().easing,
      })),
    seek(fraction) {
      for (const a of vtAnimations()) {
        a.pause()
        a.currentTime = a.effect.getComputedTiming().duration * fraction
      }
    },
    play: () => vtAnimations().forEach((a) => a.play()),
    style(pseudo, props) {
      const cs = getComputedStyle(document.documentElement, pseudo)
      return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p).trim()]))
    },
    /** Waits for a running transition's animations; false when none starts within `ms`. */
    async ready(ms = 3000) {
      const end = performance.now() + ms
      while (performance.now() < end) {
        const vt = document.activeViewTransition
        if (vt) {
          const ok = await vt.ready.then(
            () => true,
            () => false,
          )
          return ok
        }
        await t.frames(1)
      }
      return false
    },
    async finished() {
      t.play()
      await document.activeViewTransition?.finished.catch(() => {})
      await t.frames(2)
    },
  }
  window.__t = t
  window.addEventListener('unhandledrejection', (e) => t.rejections.push(String(e.reason?.name ?? e.reason)))
  document.addEventListener('click', (e) => t.clicks.push(e.target.id || e.target.tagName.toLowerCase()), true)
  if (record) {
    window.addEventListener('pagereveal', (e) => {
      const vt = e.viewTransition
      window.__reveal = { vt: !!vt }
      if (!vt) return
      // After the block's own pagereveal listener (registered later, so it runs later): the types are in by `ready`.
      vt.ready.then(
        () => {
          const anims = t.anims()
          const header = [0, 0.5, 0.95].map((f) => {
            t.seek(f)
            return t.style('::view-transition-group(site-header)', ['transform', 'width', 'height'])
          })
          t.play()
          window.__reveal = { vt: true, types: [...vt.types], anims, header }
        },
        (err) => (window.__reveal = { vt: true, aborted: err?.name ?? String(err) }),
      )
    })
  }
}

// ── shared assertions ───────────────────────────────────────────────────

const pseudoOf = (anims, re) => anims.filter((a) => re.test(a.pseudo))
const names = (anims) => [...new Set(anims.map((a) => a.name))].join(',') || 'none'
const px = (v) => parseFloat(v)
const same = (rects) => rects.every((r) => JSON.stringify(r) === JSON.stringify(rects[0]))

/** Starts `go(view, opts)` on the page, waits for its animations; returns whether a transition ran and its animations. */
async function begin(page, view, opts = {}) {
  return page.evaluate(
    async ([view, opts]) => {
      const before = window.__fx.updates
      window.__p = window.__fx.go(view, opts)
      const sync = window.__fx.updates - before
      const ran = await window.__t.ready(opts.wait ?? 3000)
      return { sync, ran, anims: window.__t.anims() }
    },
    [view, opts],
  )
}
const settle = (page) => page.evaluate(async () => {
  await window.__p
  await window.__t.finished()
  await window.__fx.finished?.()
})

/** Under reduced motion, a transition that still runs (React's, a direct call): no group moves, no slide, a short linear fade. */
function reducedShape(anims) {
  // CSS animations only: React cancels an unchanged root with zero-duration script animations (opacity 0 on the root
  // group, a 0 × 0 overlay), which move nothing.
  const groups = pseudoOf(anims, /^::view-transition-group/).filter((a) => a.name)
  const pairs = pseudoOf(anims, /^::view-transition-(old|new)/)
  const ok =
    groups.length === 0 &&
    !anims.some((a) => a.name.startsWith('vt-slide')) &&
    pairs.length > 0 &&
    pairs.every((a) => a.duration === TIMING.reduced && a.easing === 'linear')
  return [ok, `groups ${groups.length}${groups.length ? ` (${groups.map((a) => `${a.pseudo} ${a.name || 'unnamed'}`).join(', ')})` : ''}, names ${names(anims)}, pairs ${[...new Set(pairs.map((a) => `${a.duration}ms ${a.easing}`))].join(' | ')}`]
}

// ── checks ──────────────────────────────────────────────────────────────

const CHECKS = {
  timing: {
    pages: ['native'],
    async run(t) {
      const { page } = await t.open()
      const vars = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement)
        return ['--vt-duration', '--vt-ease', '--vt-reduced-duration', '--vt-route-duration'].map((p) => cs.getPropertyValue(p).trim())
      })
      const { ran, anims } = await begin(page, 'article')
      const root = pseudoOf(anims, /\(root\)$/)
      await settle(page)
      // One --vt-ease serves both: it fails here the day MOTION.route takes another curve.
      const varsOk =
        vars[0] === `${MOTION.disclosure.duration}s` &&
        norm(vars[1]) === norm(TIMING.easing) &&
        norm(vars[1]) === norm(TIMING.routeEasing) &&
        vars[2] === `${MOTION.entranceFade.duration}s` &&
        vars[3] === `${MOTION.route.duration}s`
      const live = root.length > 0 && root.every((a) => a.duration === TIMING.duration && norm(a.easing) === norm(TIMING.easing))
      return [
        ['the CSS custom properties mirror config.ts (MOTION.disclosure, MOTION.route, their curve, MOTION.entranceFade)', varsOk, vars.join(' · ')],
        [
          'the root crossfade runs on that duration and curve',
          ran && live,
          `${root.length} root animations: ${[...new Set(root.map((a) => `${a.name} ${a.duration}ms ${a.easing}`))].join(' | ')}`,
        ],
      ]
    },
  },

  update: {
    pages: ['native'],
    async run(t) {
      const { page } = await t.open()
      const r = await page.evaluate(async () => {
        const before = window.__fx.updates
        const p = window.__fx.go('article')
        const sync = window.__fx.updates - before
        const active = !!document.activeViewTransition
        await p
        const resolved = { view: window.__fx.view(), updates: window.__fx.updates - before }
        await window.__t.ready()
        const during = window.__t.anims().length
        await p.finished
        await window.__t.frames(2)
        return { sync, active, resolved, during, after: window.__t.anims().length, activeAfter: !!document.activeViewTransition, updates: window.__fx.updates - before }
      })
      return [
        [
          'transition() runs update once, after the capture; resolves with the DOM updated',
          r.active && r.sync === 0 && r.resolved.view === 'article' && r.resolved.updates === 1 && r.updates === 1,
          `transition running ${r.active}, sync updates ${r.sync}, at resolve: ${r.resolved.view} after ${r.resolved.updates} update(s), total ${r.updates}`,
        ],
        [
          'the pseudo-elements animate during it; finished resolves once they are gone',
          r.during > 0 && r.after === 0 && !r.activeAfter,
          `${r.during} animations during, ${r.after} after, still active ${r.activeAfter}`,
        ],
      ]
    },
  },

  header: {
    pages: ['native'],
    async run(t) {
      const { page } = await t.open()
      const { ran, anims } = await begin(page, 'article', { types: ['forward'] })
      const r = await page.evaluate(() => {
        const rects = [0, 0.25, 0.5, 0.75, 0.95].map((f) => {
          window.__t.seek(f)
          return window.__t.style('::view-transition-group(site-header)', ['transform', 'width', 'height'])
        })
        return {
          rects,
          group: window.__t.style('::view-transition-group(site-header)', ['z-index']),
          old: window.__t.style('::view-transition-old(site-header)', ['opacity']),
          new: window.__t.style('::view-transition-new(site-header)', ['opacity']),
        }
      })
      await settle(page)
      const own = pseudoOf(anims, /\(site-header\)/)
      return [
        [
          'the header group never animates and keeps one rect',
          ran && own.length === 0 && same(r.rects) && px(r.rects[0].height) === 64,
          `${own.length} header animations (${names(own)}), rects ${same(r.rects) ? 'constant' : 'differ'}: ${JSON.stringify(r.rects[0])}`,
        ],
        [
          'it shows its new state at once, over every other group',
          r.old.opacity === '0' && r.new.opacity === '1' && r.group['z-index'] === '1',
          `old ${r.old.opacity}, new ${r.new.opacity}, z-index ${r.group['z-index']}`,
        ],
      ]
    },
  },

  morph: {
    pages: ['native'],
    async run(t) {
      const { page } = await t.open()
      const { ran, anims } = await begin(page, 'article')
      const r = await page.evaluate(() => {
        const at = (f) => {
          window.__t.seek(f)
          return window.__t.style('::view-transition-group(cover)', ['width', 'height'])
        }
        const start = at(0)
        const mid = at(0.5)
        const pair = ['mix-blend-mode', 'object-fit', 'height']
        return {
          start,
          mid,
          end: at(0.999),
          old: window.__t.style('::view-transition-old(cover)', pair),
          new: window.__t.style('::view-transition-new(cover)', pair),
        }
      })
      await settle(page)
      const { index: a, article: b } = COVER
      const between = (v, lo, hi) => px(v) > lo + 1 && px(v) < hi - 1
      const group = pseudoOf(anims, /^::view-transition-group\(cover\)/)
      const cover = pseudoOf(anims, /\(cover\)$/)
      return [
        [
          'vt-morph: the group carries the cover from the card box to the hero box',
          ran &&
            group.length > 0 &&
            Math.abs(px(r.start.width) - a.width) < 1 &&
            between(r.mid.width, a.width, b.width) &&
            between(r.mid.height, a.height, b.height) &&
            Math.abs(px(r.end.width) - b.width) < 2,
          `${r.start.width}×${r.start.height} → ${r.mid.width}×${r.mid.height} → ${r.end.width}×${r.end.height}`,
        ],
        ['the group and its pair run MOTION.route', onRoute(cover), `${cover.length} animations: ${timings(cover)}`],
        [
          'old and new crossfade plus-lighter, both filling the moving box (no ghost)',
          r.old['mix-blend-mode'] === 'plus-lighter' &&
            r.new['mix-blend-mode'] === 'plus-lighter' &&
            r.old['object-fit'] === 'cover' &&
            r.new['object-fit'] === 'cover' &&
            r.old.height === r.new.height,
          `old ${JSON.stringify(r.old)}, new ${JSON.stringify(r.new)}`,
        ],
      ]
    },
  },

  types: {
    pages: ['native'],
    async run(t) {
      const { page } = await t.open()
      const out = []
      const runs = [
        ['article', ['forward'], 'vt-slide-out-forward', 'vt-slide-in-forward', 1],
        ['index', ['back'], 'vt-slide-out-back', 'vt-slide-in-back', -1],
        ['article', [], null, null, 0],
      ]
      for (const [view, types, oldName, newName, sign] of runs) {
        const { ran, anims } = await begin(page, view, { types })
        const x = await page.evaluate(() => {
          window.__t.seek(0.5)
          return window.__t.style('::view-transition-new(page)', ['translate']).translate
        })
        await settle(page)
        const pageAnims = pseudoOf(anims, /\(page\)$/)
        const o = names(pseudoOf(anims, /^::view-transition-old\(page\)/))
        const n = names(pseudoOf(anims, /^::view-transition-new\(page\)/))
        const shift = parseFloat(String(x).split(' ')[0]) || 0
        // A slide (group and pair) runs MOTION.route; without a type the page crossfades on MOTION.disclosure.
        const crossfade = pageAnims.length > 0 && pageAnims.every((a) => a.duration === TIMING.duration)
        const ok = oldName
          ? o === oldName && n === newName && Math.sign(shift) === sign && onRoute(pageAnims)
          : !o.includes('vt-slide') && !n.includes('vt-slide') && shift === 0 && crossfade
        out.push([
          `${types[0] ?? 'no type'}: ${oldName ? `${oldName} / ${newName} on MOTION.route` : 'the page crossfades on MOTION.disclosure, no slide'}`,
          ran && ok,
          `old ${o}, new ${n}, new translate at 50% ${x || 'none'}, ${timings(pageAnims)}`,
        ])
      }
      return out
    },
  },

  'reduced-load': {
    pages: ['native'],
    async run(t) {
      const { page } = await t.open({ reducedMotion: 'reduce' })
      const own = await begin(page, 'article', { types: ['forward'], wait: 300 })
      await settle(page)
      const raw = await begin(page, 'index', { via: 'raw', types: ['forward'] })
      await settle(page)
      const [ok, detail] = reducedShape(raw.anims)
      return [
        ['transition() under reduced motion: the update runs at once, no transition', own.sync === 1 && !own.ran, `sync updates ${own.sync}, transition ${own.ran}`],
        ['a direct startViewTransition() (React, any caller): no slide, no morph, the short crossfade', raw.ran && ok, detail],
      ]
    },
  },

  'reduced-toggle': {
    pages: ['native'],
    async run(t) {
      const { page } = await t.open()
      const first = await begin(page, 'article', { types: ['forward'] })
      await settle(page)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const own = await begin(page, 'index', { types: ['back'], wait: 300 })
      await settle(page)
      const raw = await begin(page, 'article', { via: 'raw', types: ['forward'] })
      await settle(page)
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      const again = await begin(page, 'index', { types: ['back'] })
      await settle(page)
      const [ok, detail] = reducedShape(raw.anims)
      const slides = (r) => r.anims.some((a) => a.name.startsWith('vt-slide'))
      return [
        [
          'turned on mid-visit: transition() stops transitioning, a direct call only crossfades',
          first.ran && slides(first) && own.sync === 1 && !own.ran && raw.ran && ok,
          `before: slides ${slides(first)} · on: sync ${own.sync}, transition ${own.ran} · direct: ${detail}`,
        ],
        ['turned off again: the slides come back', again.ran && slides(again), `names ${names(again.anims)}`],
      ]
    },
  },

  fallback: {
    pages: ['native'],
    async run(t) {
      const out = []
      {
        const { page } = await t.open({ removeApi: true })
        const r = await page.evaluate(async () => {
          const before = window.__fx.updates
          const p = window.__fx.go('article', { types: ['forward'] })
          const sync = window.__fx.updates - before
          await p
          await p.finished
          return { api: typeof document.startViewTransition, sync, view: window.__fx.view() }
        })
        out.push(['no View Transitions API: update runs at once, both promises resolve', r.api === 'undefined' && r.sync === 1 && r.view === 'article', `api ${r.api}, sync updates ${r.sync}, view ${r.view}`])
      }
      {
        const { page } = await t.open()
        const r = await page.evaluate(async () => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
          const before = window.__fx.updates
          const p = window.__fx.go('article')
          const sync = window.__fx.updates - before
          const active = !!document.activeViewTransition
          await p
          await p.finished
          return { sync, active, view: window.__fx.view() }
        })
        out.push(['a hidden tab: update runs at once, no transition', r.sync === 1 && !r.active && r.view === 'article', `sync updates ${r.sync}, transition ${r.active}`])
      }
      return out
    },
  },

  concurrent: {
    pages: ['native'],
    async run(t) {
      const { page } = await t.open()
      const r = await page.evaluate(async () => {
        const fx = window.__fx
        // Two calls in a row: the second waits only for the first's pending update, so the last call wins.
        const before = fx.updates
        const p1 = fx.go('article', { types: ['forward'] })
        const p2 = fx.go('index')
        const sync = fx.updates - before
        await Promise.all([p1, p2])
        const view = fx.view()
        await window.__t.finished()
        const pair = { sync, view, updates: fx.updates - before }
        // A direct startViewTransition() (React's) already running: ours updates at once.
        fx.go('article', { via: 'raw' })
        await window.__t.ready()
        const b2 = fx.updates
        const p3 = fx.go('index')
        const sync3 = fx.updates - b2
        await p3
        await window.__t.finished()
        // Ours running, then a direct call: the browser skips ours (its ready rejects); our promises still settle.
        // (Which of the two updates lands last is the browser's call, not the block's.)
        const b4 = fx.updates
        const p4 = fx.go('article')
        const raw = fx.go('index', { via: 'raw' })
        await Promise.all([p4, raw])
        await p4.finished
        await window.__t.finished()
        const updates4 = fx.updates - b4
        // And the next call transitions again.
        fx.go('article')
        const next = await window.__t.ready()
        await window.__t.finished()
        await window.__t.frames(3)
        return { pair, sync3, updates4, next, rejections: window.__t.rejections }
      })
      return [
        [
          'two calls in a row: one transition, both updates once, in call order',
          r.pair.sync === 0 && r.pair.updates === 2 && r.pair.view === 'index',
          `sync ${r.pair.sync}, updates ${r.pair.updates}, final view ${r.pair.view}`,
        ],
        ['over a transition someone else started: the update runs at once', r.sync3 === 1, `sync updates ${r.sync3}`],
        [
          'a transition skipped by a later one settles cleanly; the next call transitions again',
          r.updates4 === 2 && r.next && r.rejections.length === 0,
          `updates ${r.updates4}, next transition ${r.next}, unhandled rejections ${r.rejections.join(',') || 'none'}`,
        ],
      ]
    },
  },

  pointer: {
    pages: ['native'],
    async run(t) {
      const { page } = await t.open()
      const box = await page.locator('#menu').boundingBox()
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      const { ran } = await begin(page, 'article')
      const hit = await page.evaluate(([x, y]) => {
        window.__t.seek(0.5)
        return document.elementFromPoint(x, y)?.tagName.toLowerCase()
      }, [x, y])
      await page.mouse.click(x, y)
      const during = await page.evaluate(() => window.__t.clicks.splice(0))
      await settle(page)
      await page.mouse.click(x, y)
      const after = await page.evaluate(() => window.__t.clicks.splice(0))
      return [
        ['during a transition the overlay takes the click (the root element), by design', ran && hit === 'html' && during.join() === 'html', `hit ${hit}, click target ${during.join() || 'none'}`],
        ['once it settles the page takes clicks again', after.join() === 'menu', `click target ${after.join() || 'none'}`],
      ]
    },
  },

  lenis: {
    pages: ['lenis'],
    async run(t) {
      const { page } = await t.open()
      const trial = (via) =>
        page.evaluate(async (via) => {
          const lenis = window.__lenis
          lenis.resize()
          lenis.scrollTo(3000, { duration: 2 })
          await window.__t.frames(20)
          const mid = Math.round(window.scrollY)
          await window.__fx.go('article', { via, scrollTop: true })
          await window.__t.finished()
          const samples = []
          for (let i = 0; i < 30; i++) {
            await window.__t.frames(1)
            samples.push([Math.round(window.scrollY), Math.round(lenis.scroll)])
          }
          const out = { mid, samples, scrolling: lenis.isScrolling }
          // Back to the top of the index, at once, for the next trial.
          await window.__fx.go('index', { scrollTop: true })
          await window.__t.finished()
          lenis.scrollTo(0, { immediate: true })
          await window.__t.frames(5)
          return out
        }, via)
      const raw = await trial('raw')
      const own = await trial('transition')
      const maxY = (r) => Math.max(...r.samples.map((s) => s[0]))
      const synced = (r) => r.samples.every(([y, l]) => y === 0 && l === 0)
      return [
        [
          'control: a direct startViewTransition() leaves Lenis gliding back toward its old target',
          raw.mid > 100 && maxY(raw) > 50,
          `mid-scroll ${raw.mid}, scrollY after the jump up to ${maxY(raw)}`,
        ],
        [
          'transition(): after the jump to the top, Lenis equals scrollY (0) and no catch-up runs',
          // 'smooth' would be a glide still in flight; 'native' is Lenis's state for a native scroll it follows.
          own.mid > 100 && synced(own) && own.scrolling !== 'smooth',
          `mid-scroll ${own.mid}, 30 frames after: scrollY ≤ ${maxY(own)}, lenis ${[...new Set(own.samples.map((s) => s[1]))].join(',')}, isScrolling ${own.scrolling}`,
        ],
      ]
    },
  },

  react: {
    pages: ['react'],
    async run(t) {
      const { page } = await t.open()
      const out = []
      const runs = [
        ['article', ['forward'], 'vt-slide-out-forward', 'vt-slide-in-forward'],
        ['index', ['back'], 'vt-slide-out-back', 'vt-slide-in-back'],
        ['article', [], null, null],
      ]
      for (const [view, types, oldName, newName] of runs) {
        const { ran, anims } = await begin(page, view, { types })
        const r = await page.evaluate(() => {
          window.__t.seek(0.5)
          return {
            group: window.__t.style('::view-transition-group(cover)', ['width']),
            fit: window.__t.style('::view-transition-new(cover)', ['object-fit'])['object-fit'],
          }
        })
        await settle(page)
        const all = anims.map((a) => a.name)
        const header = pseudoOf(anims, /\(site-header\)/)
        const slideOk = oldName ? all.includes(oldName) && all.includes(newName) : !all.some((n) => n.startsWith('vt-slide'))
        const w = px(r.group.width)
        const morphOk = w > COVER.index.width + 1 && w < COVER.article.width - 1 && r.fit === 'cover'
        out.push([
          `<ViewTransition> ${types[0] ?? 'no type'}: ${oldName ? 'the views slide' : 'the views crossfade'}, share="vt-morph" morphs the cover, the header stays`,
          ran && slideOk && morphOk && header.length === 0,
          `names ${names(anims)}, cover at 50% ${r.group.width} (${r.fit}), header animations ${header.length}`,
        ])
      }
      return out
    },
  },

  'react-reduced': {
    pages: ['react'],
    async run(t) {
      const { page } = await t.open({ reducedMotion: 'reduce' })
      const { ran, anims } = await begin(page, 'article', { types: ['forward'] })
      await settle(page)
      const [ok, detail] = reducedShape(anims)
      return [['<ViewTransition> under reduced motion: no slide, no morph, the short crossfade', ran && ok, detail]]
    },
  },

  mpa: {
    pages: ['mpa'],
    async run(t) {
      const { page } = await t.open({ path: 'mpa-a.html', record: true })
      const supported = await page.evaluate(() => 'onpagereveal' in window && typeof CSSViewTransitionRule !== 'undefined')
      const navigate = async (how) => {
        // Chromium 153 skipped the inbound transition ("opt-in disabled") on a navigation 200 ms after load; a reader
        // takes longer than that.
        await page.waitForTimeout(1000)
        await Promise.all([page.waitForURL(how === 'back' ? /mpa-a/ : /mpa-b/), how === 'back' ? page.evaluate(() => history.back()) : page.click('#go')])
        await page.waitForFunction(() => document.readyState === 'complete')
        if (supported) await page.waitForFunction(() => window.__reveal && (!window.__reveal.vt || 'types' in window.__reveal || window.__reveal.aborted), null, { timeout: 5000 })
        await page.waitForTimeout(400)
        return page.evaluate(() => ({ reveal: window.__reveal ?? null, rejections: window.__t.rejections, url: location.pathname }))
      }
      const forward = await navigate('link')
      const back = await navigate('back')
      if (!supported) {
        return [
          [
            'no cross-document transitions (fallback): both navigations just load, nothing throws',
            forward.url === '/mpa-b.html' && back.url === '/mpa-a.html' && !forward.reveal?.vt && !back.reveal?.vt && [...forward.rejections, ...back.rejections].length === 0,
            `pagereveal transition: ${forward.reveal?.vt ?? 'no event'} / ${back.reveal?.vt ?? 'no event'}`,
          ],
        ]
      }
      const shape = (r, type, oldName, newName) => {
        const rv = r.reveal ?? {}
        const anims = rv.anims ?? []
        const root = pseudoOf(anims, /\(root\)$/)
        const header = pseudoOf(anims, /\(site-header\)/)
        const page = names(pseudoOf(anims, /\((page)\)$/))
        const ok =
          rv.vt &&
          JSON.stringify(rv.types) === JSON.stringify([type]) &&
          root.length > 0 &&
          root.every((a) => a.duration === TIMING.duration && !a.name.startsWith('vt-slide')) &&
          header.length === 0 &&
          same(rv.header ?? [{}, 1]) &&
          page.includes(oldName) &&
          page.includes(newName)
        return [ok, `types ${JSON.stringify(rv.types)}${rv.aborted ? ` aborted ${rv.aborted}` : ''}, root ${names(root)} ${[...new Set(root.map((a) => a.duration))].join(',')}ms, header animations ${header.length} rect ${same(rv.header ?? [{}, 1]) ? 'constant' : 'moves'}, page ${page}`]
      }
      const [fOk, fDetail] = shape(forward, 'forward', 'vt-slide-out-forward', 'vt-slide-in-forward')
      const [bOk, bDetail] = shape(back, 'back', 'vt-slide-out-back', 'vt-slide-in-back')
      return [
        ['cross-document, a link: forward; the root crossfades, the header stays put', fOk, fDetail],
        ['cross-document, the back button: back', bOk && [...forward.rejections, ...back.rejections].length === 0, bDetail],
      ]
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
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${browser.padEnd(8)}  ${pageName.padEnd(6)}  ${name}${detail ? `  (${detail})` : ''}`)
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
          /** A fresh context on this page, its harness ready. */
          async open({ reducedMotion = 'no-preference', removeApi = false, record = false, path = `${pageName}.html` } = {}) {
            const context = await open.browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion })
            contexts.push(context)
            await context.addInitScript(tools, { removeApi, record })
            const page = await context.newPage()
            page.on('pageerror', (err) => errors.push(`${id}: ${err.message.split('\n')[0]}`))
            page.on('console', (msg) => msg.type() === 'error' && errors.push(`${id}: console: ${msg.text().split('\n')[0]}`))
            await page.goto(`${base}/${path}`, { waitUntil: 'load' })
            if (pageName !== 'mpa') await page.waitForFunction(() => !!window.__fx?.go && !!window.__fx.view, null, { timeout: 10000 })
            await page.waitForTimeout(200)
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
console.log(failures ? `\n${failures} check(s) failed` : '\nall view-transitions checks passed')
process.exit(failures ? 1 : 0)
