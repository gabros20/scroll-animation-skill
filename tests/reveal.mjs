#!/usr/bin/env node
// reveal.mjs: Reveal in real browsers, one page per engine on identical geometry (tests/fixtures/reveal/src/page.ts):
// motion (motion/Reveal.tsx, server-rendered and hydrated), gsap (gsap/reveal.ts) and agnostic (reveal.ts, the
// engine-free IntersectionObserver + css/reveal.css transitions), in Chromium, WebKit and Firefox. Builds the
// fixture with Vite (the Motion page's server render first, for Node), serves it with `vite preview`, prints one
// PASS/FAIL line per check/engine/browser, and exits 1 on any FAIL. Needs the Playwright browsers, so it is its own
// script, like `test:loop-video`: `npm run test:reveal`.
//
//   node tests/reveal.mjs [--browsers chromium,webkit,firefox] [--engines motion,gsap,agnostic] [--only gate,…]
//
// Groups (each opens fresh browser contexts; every engine and browser ends with a check for uncaught page errors):
//   gate      before the engine boots: the gate is on and every item rests hidden, nothing inline; the veil covers,
//             then clears once the engine is ready (hydration, on Motion); the mount group plays on boot; an item
//             below the trigger line stays hidden and reveals once across it; an item's own translate survives the
//             reveal; a group's margin moves its line
//   nojs      JavaScript off: every item visible and still, no veil
//   print     printed: every item visible and still, a clip item too
//   failsafe  the engine boots after the failsafe fired: nothing hides or replays, every item ends shown
//   reduced   reduced motion at load: everything visible and still, nothing animates; turned on mid-reveal:
//             everything lands at rest; turned off again: nothing hides, the page doesn't move
//   once      once: a revealed group stays revealed through leave and return; replay: it resets out of view and
//             plays again on return
//   layout    the resting state costs no layout: every box and the page height are unchanged once revealed, and a
//             resting item's computed style differs from its revealed one only in opacity, transform and clip-path
//   stagger   items that cross together start in document order, MOTION.lineStagger apart
//   activity  hide and show the route (Next's Activity on Motion; teardown + display: none elsewhere): nothing
//             replays, what was hidden stays hidden, and the engine picks up again
// Plus, once: css/reveal.css's durations and curves match config.ts.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium, firefox, webkit } from 'playwright'
import { build, preview } from 'vite'

const testsDir = dirname(fileURLToPath(import.meta.url))
const fixtureRoot = join(testsDir, 'fixtures', 'reveal')
const outDir = join(testsDir, '.scratch', 'reveal-dist')
const ssrDir = join(testsDir, '.scratch', 'reveal-ssr')
const assets = join(testsDir, '..', 'skills', 'scroll-animation', 'assets')
const { GATE_SCRIPT, MOTION, cubicBezier } = await import(pathToFileURL(join(assets, 'config.ts')).href)
const { GROUPS, markup } = await import(pathToFileURL(join(fixtureRoot, 'src', 'page.ts')).href)

const BROWSERS = { chromium, webkit, firefox }
const ENGINES = ['motion', 'gsap', 'agnostic']
const VIEWPORT = { width: 800, height: 600 }

const idsOf = (groupId) => GROUPS.find((g) => g.id === groupId).items.map((item) => item.id)
const ALL = GROUPS.flatMap((g) => g.items.map((item) => item.id))
const MOUNT = idsOf('g-mount')
const VIEW = idsOf('g-view')
const REPLAY = idsOf('g-replay')
const EDGE = idsOf('g-edge')
const ONCE = ALL.filter((id) => !REPLAY.includes(id))
// Where an item's layout top sits, as a fraction of the viewport height, relative to the 80% line (a rise item's
// resting box sits 32 px lower, and the per-item engines measure that box).
const BELOW_LINE = 0.88
const ACROSS_LINE = 0.65
// Inside the viewport but below the 80% line: only a margin-0 group (TRIGGERS.pageEnd) fires here.
const NEAR_BOTTOM = 0.9

// ── args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { browsers: Object.keys(BROWSERS), engines: ENGINES, only: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--browsers') out.browsers = argv[++i].split(',')
    else if (a === '--engines') out.engines = argv[++i].split(',')
    else if (a === '--only') out.only = argv[++i].split(',')
    else throw new Error(`unknown argument: ${a}`)
  }
  for (const b of out.browsers) if (!BROWSERS[b]) throw new Error(`unknown browser: ${b}`)
  for (const e of out.engines) if (!ENGINES.includes(e)) throw new Error(`unknown engine: ${e} (${ENGINES.join(', ')})`)
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

/** The Motion page's server render, built for Node and run here: the HTML a Next page ships before hydration. */
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
        name: 'reveal-fixture',
        transformIndexHtml: {
          order: 'pre',
          handler: (html) =>
            html
              .replace('<!--gate-script-->', () => `<script>${GATE_SCRIPT}</script>`)
              .replace('<!--ssr-->', () => ssrHtml)
              .replace('<!--page-->', () => markup()),
        },
      },
    ],
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      rollupOptions: { input: Object.fromEntries(ENGINES.map((e) => [e, join(fixtureRoot, `${e}.html`)])), onwarn },
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

// ── in-page helpers ────────────────────────────────────────────────────

/** Installed before any page script. Checks read computed style, what the reader sees; the sampler reads inline too. */
function helpersInit() {
  const byId = (id) => document.getElementById(id)
  const docTop = (el) => {
    let y = 0
    for (let n = el; n; n = n.offsetParent) y += n.offsetTop
    return y
  }
  const read = (el) => {
    const cs = getComputedStyle(el)
    return {
      id: el.id,
      effect: el.getAttribute('data-reveal-effect') || 'rise',
      state: el.getAttribute('data-reveal-state'),
      opacity: cs.opacity,
      transform: cs.transform,
      clip: cs.clipPath,
      translate: cs.translate,
      inline: el.getAttribute('style'),
    }
  }
  let stopSampler = null
  window.__t = {
    ids: () => [...document.querySelectorAll('[data-reveal-item]')].map((el) => el.id),
    read: (ids) => (ids ?? window.__t.ids()).map((id) => read(byId(id))),
    html: () => {
      const d = document.documentElement.dataset
      return { gate: d.animation ?? null, ready: 'animationReady' in d, failsafe: 'animationFailsafe' in d }
    },
    veil: () => {
      const cs = getComputedStyle(document.querySelector('[data-reveal-veil]'))
      return { opacity: cs.opacity, visibility: cs.visibility, display: cs.display }
    },
    scrollItemTo: (id, fraction) =>
      window.scrollTo({ top: docTop(byId(id)) - fraction * innerHeight, behavior: 'instant' }),
    scrollTop: () => window.scrollTo({ top: 0, behavior: 'instant' }),
    scrollY: () => window.scrollY,
    /** Animations still running on the items (a CSS transition, a Motion WAAPI animation). */
    running: (ids) =>
      ids.flatMap((id) => byId(id).getAnimations().filter((a) => a.playState === 'running').map(() => id)),
    layout: (props) => ({
      height: document.documentElement.scrollHeight,
      items: window.__t.ids().map((id) => {
        const el = byId(id)
        const cs = getComputedStyle(el)
        return { id, top: docTop(el), left: el.offsetLeft, width: el.offsetWidth, height: el.offsetHeight, box: props.map((p) => cs.getPropertyValue(p)).join('|') }
      }),
    }),
    /** Every computed property of one item, for a full diff. */
    style: (id) => {
      const cs = getComputedStyle(byId(id))
      return Object.fromEntries([...cs].map((p) => [p, cs.getPropertyValue(p)]))
    },
    /**
     * Per frame, until stop(): each item's lowest opacity, frames with a transform or a clip, and frames where an
     * engine wrote a moving value inline. The inline count sees an engine animating under the failsafe's !important,
     * which keeps the computed values still whatever the engine does.
     */
    sample(ids) {
      const stats = Object.fromEntries(ids.map((id) => [id, { minOpacity: 1, moved: 0, clipped: 0, inline: 0, frames: 0 }]))
      const still = (value, rest) => value === '' || value === rest
      let frame = 0
      const tick = () => {
        for (const id of ids) {
          const el = byId(id)
          const cs = getComputedStyle(el)
          const s = stats[id]
          s.frames++
          s.minOpacity = Math.min(s.minOpacity, Number(cs.opacity))
          if (cs.transform !== 'none') s.moved++
          if (cs.clipPath !== 'none') s.clipped++
          if (!still(el.style.opacity, '1') || !still(el.style.transform, 'none') || !still(el.style.clipPath, 'none')) s.inline++
        }
        frame = requestAnimationFrame(tick)
      }
      tick()
      stopSampler = () => {
        cancelAnimationFrame(frame)
        return stats
      }
    },
    stopSample: () => stopSampler(),
    /** Per frame, until stop(): the page time each item first leaves its resting values. */
    watchStarts(ids, resting) {
      const starts = Object.fromEntries(ids.map((id) => [id, null]))
      let frame = 0
      const tick = (now) => {
        for (const id of ids) {
          if (starts[id] !== null) continue
          const r = read(byId(id))
          const still = { rise: r.transform === resting.rise, fade: r.opacity === '0', clip: r.clip.startsWith('inset(100%'), 'scale-in': r.transform === resting.scale }[r.effect]
          if (!still) starts[id] = now
        }
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
      stopSampler = () => {
        cancelAnimationFrame(frame)
        return starts
      }
    },
  }
}

/** For a page with JavaScript off: no init script runs, so the read is self-contained. */
function readStatic() {
  const items = [...document.querySelectorAll('[data-reveal-item]')].map((el) => {
    const cs = getComputedStyle(el)
    return { id: el.id, opacity: cs.opacity, transform: cs.transform, clip: cs.clipPath }
  })
  const veil = getComputedStyle(document.querySelector('[data-reveal-veil]'))
  return { gate: document.documentElement.dataset.animation ?? null, items, veil: { opacity: veil.opacity, visibility: veil.visibility } }
}

// ── verdicts ────────────────────────────────────────────────────────────

const RISE_REST = 'matrix(1, 0, 0, 1, 0, 32)'
const SCALE_REST = 'matrix(0.95, 0, 0, 0.95, 0, 0)'
const RESTING = {
  rise: (r) => r.opacity === '0' && r.transform === RISE_REST && r.clip === 'none',
  fade: (r) => r.opacity === '0' && r.transform === 'none' && r.clip === 'none',
  clip: (r) => r.opacity === '1' && r.transform === 'none' && r.clip.startsWith('inset(100%'),
  'scale-in': (r) => r.opacity === '0' && r.transform === SCALE_REST && r.clip === 'none',
}
/** At its resting (hidden) state, not marked shown. */
const resting = (r) => r.state === null && RESTING[r.effect](r)
/** Visible and still. */
const atRest = (r) => r.opacity === '1' && r.transform === 'none' && r.clip === 'none'
/** Revealed: shown, visible and still. */
const landed = (r) => r.state === 'shown' && atRest(r)

const brief = (r) => `${r.id}:${r.state ?? '-'}/o${r.opacity}/${r.transform === 'none' ? 't-' : r.transform.replace(/matrix/, 'm')}/${r.clip === 'none' ? 'c-' : r.clip}`
const show = (rows) => rows.map(brief).join(' ')
const stillStats = (stats) =>
  Object.values(stats).every((s) => s.minOpacity === 1 && s.moved === 0 && s.clipped === 0 && s.inline === 0)
const showStats = (stats) =>
  Object.entries(stats)
    .map(([id, s]) => `${id}:min${s.minOpacity.toFixed(2)}/m${s.moved}/c${s.clipped}/i${s.inline}/${s.frames}f`)
    .join(' ')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const untilPageTime = (page, t) => page.waitForFunction((at) => performance.now() >= at, t, { timeout: t + 15000 })
const read = (page, ids) => page.evaluate((list) => window.__t.read(list), ids)
const untilReady = (page, timeout = 8000) =>
  page.waitForFunction(() => 'animationReady' in document.documentElement.dataset, null, { timeout })
/** Resolves true once every item has landed, false at the timeout. */
async function untilLanded(page, ids, timeout = 4000) {
  return page
    .waitForFunction(
      (list) =>
        window.__t.read(list).every((r) => r.state === 'shown' && r.opacity === '1' && r.transform === 'none' && r.clip === 'none'),
      ids,
      { timeout, polling: 'raf' },
    )
    .then(() => true)
    .catch(() => false)
}
async function untilResting(page, ids, timeout = 3000) {
  return page
    .waitForFunction((list) => window.__t.read(list).every((r) => r.state === null && (r.effect === 'clip' ? r.clip.startsWith('inset(100%') : r.opacity === '0')), ids, { timeout, polling: 'raf' })
    .then(() => true)
    .catch(() => false)
}
const scrollItemTo = (page, id, fraction) => page.evaluate(([i, f]) => window.__t.scrollItemTo(i, f), [id, fraction])
/** Through every group, pausing on each, then back to the top. */
async function scrollThrough(page, pause = 400) {
  for (const group of GROUPS) {
    await scrollItemTo(page, group.items[0].id, 0.5)
    await sleep(pause)
  }
  await page.evaluate(() => window.__t.scrollTop())
  await sleep(pause)
}

// ── checks ──────────────────────────────────────────────────────────────
// Each takes a `t` bound to one browser + one engine page and returns [[name, ok, detail], ...].

const LAYOUT_PROPS = [
  'display', 'position', 'box-sizing', 'width', 'height', 'top', 'left', 'margin-top', 'margin-right', 'margin-bottom',
  'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'font-size', 'line-height',
  'visibility',
]

const CHECKS = {
  async gate(t) {
    const out = []
    const { page } = await t.open('?boot=1500')
    await untilPageTime(page, 400)
    const html = await page.evaluate(() => window.__t.html())
    const before = await read(page)
    const veilBefore = await page.evaluate(() => window.__t.veil())
    out.push([
      'hidden under the gate before JavaScript: every item at its resting state, nothing inline',
      html.gate === 'on' && !html.ready && before.every((r) => resting(r) && r.inline === null),
      `gate=${html.gate} ready=${html.ready} · ${show(before)}${before.some((r) => r.inline) ? ` · inline: ${before.filter((r) => r.inline).map((r) => `${r.id}="${r.inline}"`).join(' ')}` : ''}`,
    ])

    await untilReady(page)
    const readyAt = await page.evaluate(() => performance.now())
    await page
      .waitForFunction(() => window.__t.veil().visibility === 'hidden', null, { timeout: 2000, polling: 'raf' })
      .catch(() => {})
    const cleared = await page.evaluate(() => ({ veil: window.__t.veil(), t: performance.now() }))
    out.push([
      'the veil covers until the engine is ready (hydration, on Motion), then clears',
      veilBefore.opacity === '1' && veilBefore.visibility === 'visible' && cleared.veil.opacity === '0' && cleared.veil.visibility === 'hidden',
      `before: ${JSON.stringify(veilBefore)} · ${Math.round(cleared.t - readyAt)} ms after ready: ${JSON.stringify(cleared.veil)}`,
    ])

    const mountLanded = await untilLanded(page, MOUNT, 3000)
    out.push(['the mount group reveals when the engine boots', mountLanded, show(await read(page, MOUNT))])

    await scrollItemTo(page, VIEW[0], BELOW_LINE)
    await sleep(700)
    const below = await read(page, VIEW)
    await scrollItemTo(page, VIEW[0], ACROSS_LINE)
    const across = await untilLanded(page, VIEW, 4000)
    out.push([
      'below the trigger line an item stays hidden; across it, it reveals (rise, fade, clip, scale-in)',
      below.every(resting) && across,
      `at ${BELOW_LINE * 100}%: ${show(below)} · at ${ACROSS_LINE * 100}%: ${show(await read(page, VIEW))}`,
    ])

    // fixture.css gives two of them a translate of their own: the same once they land, and none of it left inline.
    const own = before.filter((r) => r.translate !== 'none')
    const landedView = await read(page, own.map((r) => r.id))
    out.push([
      "an item's own translate composes with the reveal and is intact once it lands",
      own.length === 2 &&
        landedView.every((r, i) => landed(r) && r.translate === own[i].translate && !/translate/.test(r.inline ?? '')),
      landedView.map((r, i) => `${r.id}: ${own[i].translate} → ${r.translate}, inline "${r.inline ?? ''}"`).join(' · '),
    ])

    await scrollItemTo(page, EDGE[0], NEAR_BOTTOM)
    const edge = await untilLanded(page, EDGE, 3500)
    out.push([
      `a group's margin moves its line: margin 0px (TRIGGERS.pageEnd) fires at ${NEAR_BOTTOM * 100}%, below the 80% line`,
      edge,
      show(await read(page, EDGE)),
    ])
    return out
  },

  async nojs(t) {
    const { page } = await t.open('', { javaScriptEnabled: false })
    const s = await page.evaluate(readStatic)
    return [
      [
        'JavaScript off: every item visible and still, no veil',
        s.gate === null && s.items.length === ALL.length && s.items.every(atRest) && s.veil.visibility === 'hidden',
        `gate=${s.gate} · ${s.items.map((r) => brief({ ...r, state: null })).join(' ')} · veil ${JSON.stringify(s.veil)}`,
      ],
    ]
  },

  async print(t) {
    const { page } = await t.open('?boot=never')
    const screen = await read(page)
    await page.emulateMedia({ media: 'print' })
    const printed = await read(page)
    return [
      [
        'print: every item prints visible and still, a clip item too',
        screen.every(resting) && printed.every(atRest),
        `screen: ${show(screen)} · print: ${show(printed)}`,
      ],
    ]
  },

  async failsafe(t) {
    // Well after the failsafe's 4 s, which counts from the page's first style pass (under 1 s even on a loaded run).
    const { page } = await t.open('?boot=5200')
    await page.waitForFunction(() => window.__t.html().failsafe, null, { timeout: 9000 })
    const latched = await read(page)
    const veil = await page.evaluate(() => window.__t.veil())
    await page.evaluate((ids) => window.__t.sample(ids), ALL)
    await page.waitForFunction(() => window.__fx.bootedAt !== null, null, { timeout: 4000 })
    await sleep(1500)
    await scrollThrough(page)
    const stats = await page.evaluate(() => window.__t.stopSample())
    const after = await read(page)
    const running = await page.evaluate((ids) => window.__t.running(ids), ALL)
    return [
      [
        'failsafe latched, then the engine boots: nothing hides or replays, every item ends shown',
        latched.every(atRest) && veil.display === 'none' && stillStats(stats) && after.every(landed) && running.length === 0,
        `latched: ${show(latched)} veil ${veil.display} · sampled: ${showStats(stats)} · after: ${show(after)} · running: ${running.join(',') || 'none'}`,
      ],
    ]
  },

  async reduced(t) {
    const out = []
    {
      const { page } = await t.open('', { reducedMotion: 'reduce' })
      await untilReady(page)
      await sleep(500)
      const atLoad = await read(page)
      await page.evaluate((ids) => window.__t.sample(ids), ALL)
      await scrollThrough(page)
      const stats = await page.evaluate(() => window.__t.stopSample())
      const running = await page.evaluate((ids) => window.__t.running(ids), ALL)
      out.push([
        'reduced motion: every item visible and still at load (below the fold too), nothing moves or animates',
        atLoad.every(landed) && stillStats(stats) && running.length === 0,
        `at load: ${show(atLoad)} · sampled: ${showStats(stats)} · running: ${running.join(',') || 'none'}`,
      ])
    }
    {
      const { page } = await t.open()
      await untilReady(page)
      await scrollItemTo(page, VIEW[0], ACROSS_LINE)
      await sleep(150)
      const midway = await read(page, VIEW)
      const y0 = await page.evaluate(() => window.__t.scrollY())
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await sleep(400)
      const settled = await read(page)
      const y1 = await page.evaluate(() => window.__t.scrollY())
      await page.evaluate((ids) => window.__t.sample(ids), ONCE)
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await sleep(1200)
      const stats = await page.evaluate(() => window.__t.stopSample())
      const y2 = await page.evaluate(() => window.__t.scrollY())
      out.push([
        'reduced motion turned on mid-reveal: every item lands visible and still; turned off: nothing hides; the page never moves',
        !midway.every(landed) && settled.every(atRest) && stillStats(stats) && y0 > 0 && y1 === y0 && y2 === y0,
        `mid-reveal: ${show(midway)} · reduced: ${show(settled)} · lifted, sampled: ${showStats(stats)} · ` +
          `scrollY ${y0} → ${y1} (on) → ${y2} (off)`,
      ])
    }
    return out
  },

  async once(t) {
    const out = []
    const { page } = await t.open()
    await untilReady(page)
    await scrollItemTo(page, VIEW[0], ACROSS_LINE)
    const first = await untilLanded(page, VIEW)
    await page.evaluate(() => window.__t.scrollTop())
    await sleep(500)
    await page.evaluate((ids) => window.__t.sample(ids), VIEW)
    await scrollItemTo(page, VIEW[0], ACROSS_LINE)
    await sleep(900)
    const stats = await page.evaluate(() => window.__t.stopSample())
    const back = await read(page, VIEW)
    out.push([
      'once (default): a revealed group stays revealed through leave and return, nothing replays',
      first && stillStats(stats) && back.every(landed),
      `sampled on return: ${showStats(stats)} · ${show(back)}`,
    ])

    await scrollItemTo(page, REPLAY[0], ACROSS_LINE)
    const shown = await untilLanded(page, REPLAY)
    await page.evaluate(() => window.__t.scrollTop())
    const reset = await untilResting(page, REPLAY)
    const hidden = await read(page, REPLAY)
    await page.evaluate((ids) => window.__t.sample(ids), REPLAY)
    await scrollItemTo(page, REPLAY[0], ACROSS_LINE)
    const again = await untilLanded(page, REPLAY)
    const replayStats = await page.evaluate(() => window.__t.stopSample())
    const replayed = replayStats[REPLAY[0]].minOpacity < 1 && replayStats[REPLAY[1]].clipped > 0
    out.push([
      'replay: reset once out of view, revealed again on return',
      shown && reset && again && replayed,
      `out of view: ${show(hidden)} · on return, sampled: ${showStats(replayStats)} · ${show(await read(page, REPLAY))}`,
    ])
    return out
  },

  async layout(t) {
    const { page } = await t.open('?boot=1200')
    await untilPageTime(page, 300)
    const before = await page.evaluate((props) => window.__t.layout(props), LAYOUT_PROPS)
    await untilReady(page)
    // Resting, below the fold, once the engine is ready: before that, animation.css's failsafe animation is on too.
    const styleBefore = await page.evaluate((ids) => ids.map((id) => window.__t.style(id)), VIEW)
    for (const group of GROUPS) {
      await scrollItemTo(page, group.items[0].id, 0.5)
      await untilLanded(page, group.items.map((item) => item.id))
    }
    const all = await untilLanded(page, ALL.filter((id) => !REPLAY.includes(id)), 1000)
    const after = await page.evaluate((props) => window.__t.layout(props), LAYOUT_PROPS)
    const styleAfter = await page.evaluate((ids) => ids.map((id) => window.__t.style(id)), VIEW)
    const moved = before.items.filter((b, i) => JSON.stringify(b) !== JSON.stringify(after.items[i]))
    const ALLOWED = new Set(['opacity', 'transform', 'clip-path'])
    const differs = [
      ...new Set(styleBefore.flatMap((s, i) => Object.keys(s).filter((p) => s[p] !== styleAfter[i][p] && !ALLOWED.has(p)))),
    ]
    return [
      [
        'no layout shift from the resting state: boxes and page height unchanged once revealed; only opacity, transform and clip-path differ',
        all && before.height === after.height && moved.length === 0 && differs.length === 0,
        `page ${before.height} → ${after.height}px · boxes moved: ${moved.map((b) => b.id).join(',') || 'none'} · ` +
          `other properties that differ: ${differs.join(',') || 'none'}`,
      ],
    ]
  },

  async stagger(t) {
    const { page } = await t.open()
    await untilReady(page)
    await page.evaluate(([ids, resting]) => window.__t.watchStarts(ids, resting), [VIEW, { rise: RISE_REST, scale: SCALE_REST }])
    await scrollItemTo(page, VIEW[0], ACROSS_LINE)
    await sleep(1500)
    const starts = await page.evaluate(() => window.__t.stopSample())
    const times = VIEW.map((id) => starts[id])
    const gaps = times.slice(1).map((time, i) => (time === null || times[i] === null ? null : time - times[i]))
    const step = MOTION.lineStagger * 1000
    // Each start is seen on a frame, up to a frame late, so a single gap can be off by a frame either way; over the
    // whole run that error is shared by every gap.
    const mean = gaps.includes(null) ? null : (times[times.length - 1] - times[0]) / gaps.length
    const ok = mean !== null && gaps.every((g) => g > 0) && Math.abs(mean - step) <= 20
    return [
      [
        `items that cross together start in document order, ${step} ms (MOTION.lineStagger) apart`,
        ok,
        `gaps ${gaps.map((g) => (g === null ? 'never started' : `${Math.round(g)}`)).join(', ')} ms, mean ${mean === null ? '-' : Math.round(mean)} ms`,
      ],
    ]
  },

  async activity(t) {
    const { page } = await t.open()
    await untilReady(page)
    await scrollItemTo(page, VIEW[0], ACROSS_LINE)
    const first = await untilLanded(page, VIEW)
    await page.evaluate(() => window.__t.scrollTop())
    await sleep(300)
    const shownIds = [...MOUNT, ...VIEW]
    await page.evaluate(() => window.__fx.hide())
    await sleep(300)
    await page.evaluate((ids) => window.__t.sample(ids), shownIds)
    await page.evaluate(() => window.__fx.show())
    await sleep(1200)
    const stats = await page.evaluate(() => window.__t.stopSample())
    const shown = await read(page, shownIds)
    const waiting = await read(page, [...REPLAY, ...EDGE])
    await scrollItemTo(page, REPLAY[0], ACROSS_LINE)
    const resumed = await untilLanded(page, REPLAY)
    return [
      [
        'hidden and shown again (Activity): nothing replays, what waited still waits, the engine picks up again',
        first && stillStats(stats) && shown.every(landed) && waiting.every(resting) && resumed,
        `sampled on show: ${showStats(stats)} · waiting: ${show(waiting)} · replay group after show: ${resumed ? 'revealed' : 'stuck'}`,
      ],
    ]
  },
}

/** css/reveal.css can't import config.ts, so its numbers are checked against it here. */
function cssMirrorsConfig() {
  const css = readFileSync(join(assets, 'css', 'reveal.css'), 'utf8').replace(/\s+/g, ' ')
  const s = (n) => `${+n.toFixed(3)}s`
  const move = `${s(MOTION.entrance.duration)} ${cubicBezier(MOTION.entrance.curve)}`
  const expected = [
    `transform ${move} var(--reveal-delay, 0s)`,
    `opacity ${s(MOTION.entranceFade.duration)} linear calc(var(--reveal-delay, 0s) + ${s(MOTION.entranceFade.delay)})`,
    `opacity ${move} var(--reveal-delay, 0s)`,
    `clip-path ${move} var(--reveal-delay, 0s)`,
    `opacity ${s(MOTION.veil.duration)} linear ${s(MOTION.veil.delay)}`,
    `visibility 0s linear ${s(MOTION.veil.delay + MOTION.veil.duration)}`,
  ]
  const missing = expected.filter((e) => !css.includes(e))
  return [missing.length === 0, missing.length ? `missing: ${missing.join(' | ')}` : `${expected.length} timings match`]
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
  let failures = 0
  const line = (ok, browser, engine, name, detail) => {
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${browser.padEnd(8)}  ${engine.padEnd(8)}  ${name}${detail ? `  (${detail})` : ''}`)
  }

  const [cssOk, cssDetail] = cssMirrorsConfig()
  line(cssOk, '-', '-', 'css/reveal.css timings match config.ts (MOTION, CURVES)', cssDetail)

  open.server = await serve(await serverRender())
  const base = `http://127.0.0.1:${open.server.httpServer.address().port}`
  const groups = args.only ?? Object.keys(CHECKS)

  for (const browserName of args.browsers) {
    open.browser = await BROWSERS[browserName].launch()
    for (const engine of args.engines) {
      const errors = []
      for (const group of groups) {
        const contexts = []
        const t = {
          async open(query = '', contextOptions = {}) {
            const context = await open.browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: 'no-preference', ...contextOptions })
            contexts.push(context)
            await context.addInitScript(helpersInit)
            const page = await context.newPage()
            page.on('pageerror', (e) => errors.push(`${group}: ${e.message}`))
            await page.goto(`${base}/${engine}.html${query}`, { waitUntil: 'load' })
            return { page }
          },
        }
        try {
          for (const [name, ok, detail] of await CHECKS[group](t)) line(ok, browserName, engine, name, detail)
        } catch (err) {
          line(false, browserName, engine, `${group}: ran to completion`, err.message.split('\n')[0])
        } finally {
          for (const context of contexts) await context.close().catch(() => {})
        }
      }
      const unique = [...new Set(errors)]
      line(unique.length === 0, browserName, engine, 'no uncaught errors in the page', unique.length ? `${errors.length}x: ${unique.slice(0, 3).join(' | ')}` : '')
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
console.log(failures ? `\n${failures} check(s) failed` : '\nall reveal checks passed')
process.exit(failures ? 1 : 0)
