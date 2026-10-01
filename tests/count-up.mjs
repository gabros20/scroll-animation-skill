#!/usr/bin/env node
// count-up.mjs: the count-up (assets/count-up.ts, motion/CountUp.tsx) in Chromium, WebKit and Firefox, one page per
// engine on the same stats (tests/fixtures/count-up/src/stats.ts): agnostic (mountCountUps) and motion (<CountUp>,
// server-rendered and hydrated). Builds the fixture with Vite (the Motion page's server render first, for Node),
// serves it with `vite preview`, prints one PASS/FAIL line per check/engine/browser, and exits 1 on any FAIL. Needs the
// Playwright browsers, so it is its own script: `npm run test:count-up`.
//
//   node tests/count-up.mjs [--browsers chromium,webkit,firefox] [--engines agnostic,motion] [--only count,…]
//
// Groups (each opens fresh browser contexts; every engine and browser ends with a check for uncaught page errors):
//   nojs      JavaScript off: every stat shows its final value, prefix and suffix around it
//   count     each stat counts once in view from its `from` to exactly its final text: monotonic, formatted like the
//             text in its locale, the text node written in place, MOTION.entrance.duration on CURVES.entrance, and on
//             the Motion page not one React render during it
//   trigger   45% visible doesn't start it, 80% does
//   once      a finished count never plays again, through leaving and coming back
//   reduced   reduced motion at load: the final value at once, no intermediate value; switched on mid-count: it lands
//   failsafe  the engine boots after the failsafe fired: the final value at once, no intermediate value
//   hidden    a hidden tab lands a running count and never starts one
//   a11y      while it counts, the stat's accessible text never changes and carries the final value
//   activity  hiding the route mid-count lands it; showing it again replays nothing
//   ready     (agnostic) count-up never marks the engine ready, so the failsafe stays armed for what else is hidden

import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium, firefox, webkit } from 'playwright'
import { build, preview } from 'vite'

const testsDir = dirname(fileURLToPath(import.meta.url))
const fixtureRoot = join(testsDir, 'fixtures', 'count-up')
const outDir = join(testsDir, '.scratch', 'count-up-dist')
const ssrDir = join(testsDir, '.scratch', 'count-up-ssr')
const assets = join(testsDir, '..', 'skills', 'scroll-animation', 'assets')
const { GATE_SCRIPT, MOTION, CURVES } = await import(pathToFileURL(join(assets, 'config.ts')).href)
const { STATS, markup } = await import(pathToFileURL(join(fixtureRoot, 'src', 'stats.ts')).href)

const BROWSERS = { chromium, webkit, firefox }
const ENGINES = ['agnostic', 'motion']
const VIEWPORT = { width: 800, height: 600 }
const DURATION_MS = MOTION.entrance.duration * 1000

/** How each stat's frames read: its locale's grouping and fraction digits, and back to a number. */
const FRAMES = {
  usd: { pattern: /^\d{1,3}(,\d{3})*$/, parse: (s) => Number(s.replaceAll(',', '')) },
  pct: { pattern: /^\d{1,2}\.\d$/, parse: Number },
  eur: { pattern: /^\d{1,3}(\.\d{3})*,\d{2}$/, parse: (s) => Number(s.replaceAll('.', '').replace(',', '.')) },
  fr: { pattern: /^\d{1,3}(\u202f\d{3})*$/, parse: (s) => Number(s.replaceAll('\u202f', '')) },
  year: { pattern: /^\d{4}$/, parse: Number },
  dec: { pattern: /^\d\.\d$/, parse: Number },
}

/** The final text each engine renders: the author's text on the agnostic page, CountUp's own format on Motion's. */
function finalText(spec, engine) {
  if (engine === 'agnostic') return spec.text
  const { locale = 'en-US', decimals, grouping = true } = spec.format ?? {}
  const digits = decimals ?? (String(spec.to).split('.')[1] ?? '').length
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    ...(grouping ? {} : { useGrouping: false }),
  }).format(spec.to)
}

/** CURVES.entrance at a share of the duration, solved independently of the block. */
function curveAt(share) {
  const [x1, y1, x2, y2] = CURVES[MOTION.entrance.curve]
  const bez = (t, a, b) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (bez(mid, x1, x2) < share) lo = mid
    else hi = mid
  }
  return bez((lo + hi) / 2, y1, y2)
}

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
        name: 'count-up-fixture',
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

/**
 * Installed before any page script. A MutationObserver on the whole document records, with page times, every write a
 * count makes: the number's text node (characterData), its children (a count must never replace them), its
 * data-count-state and aria-hidden, and the visually hidden label coming and going. A stand-in React DevTools hook
 * counts React commits.
 */
function instrument() {
  const records = []
  const statOf = (node) => node?.closest?.('.stat')?.id ?? null
  const isNumber = (node) => node instanceof Element && node.hasAttribute('data-count-up')
  const isLabel = (node) => node instanceof Element && node.hasAttribute('data-count-up-label')
  new MutationObserver((list) => {
    const t = performance.now()
    for (const r of list) {
      if (r.type === 'characterData') {
        const el = r.target.parentElement
        if (isNumber(el)) records.push({ t, kind: 'text', stat: statOf(el), value: r.target.data })
      } else if (r.type === 'childList') {
        if (isNumber(r.target)) records.push({ t, kind: 'children', stat: statOf(r.target) })
        r.addedNodes.forEach((n) => isLabel(n) && records.push({ t, kind: 'label+', stat: statOf(n), value: n.textContent }))
        r.removedNodes.forEach((n) => isLabel(n) && records.push({ t, kind: 'label-', stat: statOf(r.target) }))
      } else if (isNumber(r.target)) {
        const kind = r.attributeName === 'aria-hidden' ? 'aria' : 'state'
        records.push({ t, kind, stat: statOf(r.target), value: r.target.getAttribute(r.attributeName) })
      }
    }
  }).observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-count-state', 'aria-hidden'],
  })

  // When the page itself sees reduced motion switch: a check's boundary, not the moment the test asked for it.
  const reduce = matchMedia('(prefers-reduced-motion: reduce)')
  reduce.addEventListener('change', () => records.push({ t: performance.now(), kind: 'reduce', value: reduce.matches }))

  let commits = 0
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject: () => 1,
    onCommitFiberRoot: () => commits++,
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onScheduleFiberRoot() {},
    checkDCE() {},
  }

  const number = (id) => document.getElementById(`n-${id}`)
  const raf = window.requestAnimationFrame.bind(window)
  window.__t = {
    now: () => performance.now(),
    records: (since = 0) => records.filter((r) => r.t >= since),
    commits: () => commits,
    state: (id) => number(id)?.getAttribute('data-count-state') ?? null,
    text: (id) => number(id)?.textContent ?? null,
    statText: (id) => document.getElementById(id)?.textContent ?? null,
    aria: (id) => {
      const el = number(id)
      const next = el?.nextElementSibling
      return { hidden: el?.getAttribute('aria-hidden') ?? null, label: next?.hasAttribute('data-count-up-label') ? next.textContent : null }
    },
    html: () => {
      const d = document.documentElement.dataset
      return { gate: d.animation ?? null, ready: 'animationReady' in d, failsafe: 'animationFailsafe' in d }
    },
    frames: (n) =>
      new Promise((resolve) => {
        let i = 0
        const step = () => (++i >= n ? resolve() : raf(step))
        raf(step)
      }),
    /** The number's centre at `fraction` of the viewport height. */
    center(id, fraction = 0.5) {
      const r = number(id).getBoundingClientRect()
      window.scrollTo({ top: window.scrollY + r.top + r.height / 2 - fraction * innerHeight, behavior: 'instant' })
    },
    /** `share` of the number's height visible at the viewport's bottom edge. */
    peek(id, share) {
      const r = number(id).getBoundingClientRect()
      window.scrollTo({ top: window.scrollY + r.top - (innerHeight - share * r.height), behavior: 'instant' })
    },
    visible(id) {
      const r = number(id).getBoundingClientRect()
      return Math.round(((Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / r.height) * 100) / 100
    },
    /** The tab hidden and shown again, as the page sees it: visibilityState, hidden and the event. */
    hideTab() {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      document.dispatchEvent(new Event('visibilitychange'))
    },
    showTab() {
      delete document.visibilityState
      delete document.hidden
      document.dispatchEvent(new Event('visibilitychange'))
    },
  }
}

/** For a page with JavaScript off: no init script runs, so the read is self-contained. */
function readStatic(ids) {
  return ids.map((id) => {
    const n = document.getElementById(`n-${id}`)
    return { id, text: n?.textContent ?? null, stat: document.getElementById(id)?.textContent ?? null, state: n?.getAttribute('data-count-state') ?? null }
  })
}

// ── verdicts ────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const only = (records, stat, kind) => records.filter((r) => r.stat === stat && (!kind || r.kind === kind))

/** Resolves with the ms until `id` reaches `state`, or null. */
async function untilState(page, id, state, timeout = 4000) {
  const t0 = Date.now()
  return page
    .waitForFunction(([i, s]) => window.__t.state(i) === s, [id, state], { timeout, polling: 'raf' })
    .then(() => Date.now() - t0)
    .catch(() => null)
}

/** One stat's count, from the records: frames, the landing, the timing and the curve. */
function analyze(records, spec, engine) {
  const texts = only(records, spec.id, 'text')
  const want = finalText(spec, engine)
  const f = FRAMES[spec.id]
  const from = spec.from ?? 0
  if (texts.length < 3) return { ok: false, detail: `${texts.length} writes: ${texts.map((r) => r.value).join(' ')}` }
  const frames = texts.slice(0, -1)
  const last = texts[texts.length - 1]
  const values = frames.map((r) => f.parse(r.value))
  const t0 = texts[0].t
  const duration = Math.round(last.t - t0)
  const curve = [0.25, 0.5, 0.75].map((share) => {
    const at = t0 + share * DURATION_MS
    const shown = [...frames].reverse().find((r) => r.t <= at) ?? frames[0]
    return { share, got: (f.parse(shown.value) - from) / (spec.to - from), want: curveAt(share) }
  })
  const checks = {
    'starts at from': values[0] === from,
    monotonic: values.every((v, i) => i === 0 || v >= values[i - 1]),
    'within from..to': values.every((v) => v >= from && v <= spec.to),
    formatted: frames.every((r) => f.pattern.test(r.value)),
    'lands on the exact final text': last.value === want,
    'duration ≈ MOTION.entrance': Math.abs(duration - DURATION_MS) <= 160,
    'CURVES.entrance': curve.every((c) => Math.abs(c.got - c.want) <= 0.07),
    'text node written in place': only(records, spec.id, 'children').length === 0,
  }
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k)
  const sample = texts.length > 6 ? [...texts.slice(0, 3), '…', ...texts.slice(-3)] : texts
  return {
    ok: failed.length === 0,
    duration,
    detail:
      `${spec.id}: ${sample.map((r) => (r === '…' ? r : JSON.stringify(r.value))).join(' ')} (${texts.length} writes, ${duration} ms; ` +
      `curve ${curve.map((c) => `${c.share}: ${c.got.toFixed(2)}/${c.want.toFixed(2)}`).join(' ')})` +
      (failed.length ? ` ✗ ${failed.join(', ')}` : ''),
  }
}

// ── checks ──────────────────────────────────────────────────────────────
// Each takes a `t` bound to one browser + one engine page and returns [[name, ok, detail], ...].

const CHECKS = {
  async nojs(t) {
    const { page } = await t.open('', { javaScriptEnabled: false })
    const rows = await page.evaluate(readStatic, STATS.map((s) => s.id))
    const bad = rows.filter((r) => {
      const spec = STATS.find((s) => s.id === r.id)
      const want = finalText(spec, t.engine)
      return r.text !== want || r.stat !== `${spec.prefix ?? ''}${want}${spec.suffix ?? ''}` || r.state !== null
    })
    return [
      [
        'JavaScript off: every stat shows its final value, prefix and suffix around it, no state',
        bad.length === 0,
        rows.map((r) => `${r.id} ${JSON.stringify(r.stat)}`).join(' · '),
      ],
    ]
  },

  async count(t) {
    const { page } = await t.open()
    const results = []
    let commitsDuring = 0
    let waiting = true
    for (const spec of STATS) {
      // The stat in view at load counts from the engine's boot: before it, the parser inserted its text.
      const since = await page.evaluate((load) => (load ? window.__fx.bootedAt : window.__t.now()), spec.id === 'usd')
      if (spec.id !== 'usd') {
        waiting &&= (await page.evaluate((id) => window.__t.state(id), spec.id)) === 'waiting'
        const before = await page.evaluate(() => window.__t.commits())
        await page.evaluate((id) => window.__t.center(id), spec.id)
        await untilState(page, spec.id, 'done')
        commitsDuring += (await page.evaluate(() => window.__t.commits())) - before
      } else {
        await untilState(page, spec.id, 'done')
      }
      const records = await page.evaluate((s) => window.__t.records(s), since)
      const states = only(records, spec.id, 'state').map((r) => r.value)
      const [text, stat] = await page.evaluate((id) => [window.__t.text(id), window.__t.statText(id)], spec.id)
      const want = finalText(spec, t.engine)
      const a = analyze(records, spec, t.engine)
      results.push({
        ...a,
        ok:
          a.ok &&
          text === want &&
          stat === `${spec.prefix ?? ''}${want}${spec.suffix ?? ''}` &&
          states.slice(-2).join('>') === 'counting>done',
      })
    }
    const out = [
      [
        'each stat counts once in view, from its `from` to exactly its final text, monotonic, every frame in its locale ' +
          '(grouping, fraction digits), prefix and suffix untouched; data-count-state waiting > counting > done',
        waiting && results.every((r) => r.ok),
        results.map((r) => r.detail).join(' · '),
      ],
    ]
    if (t.engine === 'motion') {
      out.push(['no React render while numbers count: the MotionValue writes the text node', commitsDuring === 0, `${commitsDuring} commits`])
    }
    return out
  },

  async trigger(t) {
    const { page } = await t.open()
    const since = await page.evaluate(() => window.__t.now())
    await page.evaluate(() => window.__t.peek('pct', 0.45))
    const low = await page.evaluate(() => window.__t.visible('pct'))
    await sleep(500)
    const before = await page.evaluate(([s]) => [window.__t.state('pct'), window.__t.records(s).filter((r) => r.stat === 'pct' && r.kind === 'text').length], [since])
    await page.evaluate(() => window.__t.peek('pct', 0.8))
    const high = await page.evaluate(() => window.__t.visible('pct'))
    const ms = await untilState(page, 'pct', 'counting', 1500).then((v) => v ?? untilState(page, 'pct', 'done', 10))
    return [
      [
        'about 60% visible starts it: 45% does not, 80% does',
        before[0] === 'waiting' && before[1] === 0 && ms !== null,
        `${Math.round(low * 100)}% visible for 500 ms: ${before[0]}, ${before[1]} writes · ${Math.round(high * 100)}% visible: started after ${ms} ms`,
      ],
    ]
  },

  async once(t) {
    const { page } = await t.open()
    await page.evaluate(() => window.__t.center('pct'))
    await untilState(page, 'pct', 'done')
    const since = await page.evaluate(() => window.__t.now())
    for (const y of [0, 0.5]) {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
      await sleep(250)
      await page.evaluate((f) => window.__t.center('pct', f), y + 0.25)
      await sleep(400)
    }
    const later = await page.evaluate((s) => window.__t.records(s).filter((r) => r.stat === 'pct'), since)
    const state = await page.evaluate(() => window.__t.state('pct'))
    return [['a finished count never plays again: left and came back twice, nothing written', later.length === 0 && state === 'done', `${later.length} records after done, state ${state}`]]
  },

  async reduced(t) {
    const out = []
    {
      const { page } = await t.open('', { reducedMotion: 'reduce' })
      for (const spec of STATS) {
        await page.evaluate((id) => window.__t.center(id), spec.id)
        await untilState(page, spec.id, 'done', 1500)
      }
      const records = await page.evaluate(() => window.__t.records())
      const texts = records.filter((r) => r.kind === 'text')
      const rows = await page.evaluate((ids) => ids.map((id) => [id, window.__t.state(id), window.__t.text(id)]), STATS.map((s) => s.id))
      const ok = texts.length === 0 && rows.every(([id, state, text]) => state === 'done' && text === finalText(STATS.find((s) => s.id === id), t.engine))
      out.push([
        'reduced motion: every stat shows its final value at once, not one intermediate value written',
        ok,
        `${texts.length} text writes · ${rows.map(([id, state, text]) => `${id} ${state} ${JSON.stringify(text)}`).join(' · ')}`,
      ])
    }
    {
      const { page } = await t.open()
      await page.evaluate(() => window.__t.center('eur'))
      await untilState(page, 'eur', 'counting')
      await sleep(350)
      const mid = await page.evaluate(() => window.__t.text('eur'))
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const ms = await untilState(page, 'eur', 'done', 1000)
      await sleep(400)
      const after = await page.evaluate(() => {
        const records = window.__t.records()
        const switched = records.find((r) => r.kind === 'reduce' && r.value)?.t ?? Infinity
        return records.filter((r) => r.t >= switched && r.stat === 'eur' && r.kind === 'text').map((r) => r.value)
      })
      const text = await page.evaluate(() => window.__t.text('eur'))
      const want = finalText(STATS.find((s) => s.id === 'eur'), t.engine)
      out.push([
        'reduced motion switched on mid-count: it lands on the final value at once',
        ms !== null && text === want && after.length === 1 && after[0] === want && mid !== want,
        `at ${JSON.stringify(mid)} → done in ${ms} ms on ${JSON.stringify(text)}, writes once the page saw the switch: ${JSON.stringify(after)}`,
      ])
    }
    return out
  },

  async failsafe(t) {
    // Well after the failsafe's 4 s, which counts from the page's first style pass.
    const { page } = await t.open('?boot=5200')
    const latched = await page
      .waitForFunction(() => window.__t.html().failsafe, null, { timeout: 9000 })
      .then(() => true)
      .catch(() => false)
    await page.waitForFunction(() => window.__fx?.bootedAt != null, null, { timeout: 15000 })
    await page.evaluate(() => window.__t.frames(10))
    for (const spec of STATS) {
      await page.evaluate((id) => window.__t.center(id), spec.id)
      await untilState(page, spec.id, 'done', 1500)
    }
    const texts = (await page.evaluate(() => window.__t.records())).filter((r) => r.kind === 'text')
    const rows = await page.evaluate((ids) => ids.map((id) => [id, window.__t.state(id), window.__t.text(id)]), STATS.map((s) => s.id))
    const ok = latched && texts.length === 0 && rows.every(([id, state, text]) => state === 'done' && text === finalText(STATS.find((s) => s.id === id), t.engine))
    return [
      [
        'the engine boots after the failsafe fired: every stat shows its final value at once, nothing counts',
        ok,
        `failsafe ${latched ? 'latched' : 'never latched'} · ${texts.length} text writes · ${rows.map(([id, state]) => `${id} ${state}`).join(' · ')}`,
      ],
    ]
  },

  async hidden(t) {
    const { page } = await t.open()
    const want = (id) => finalText(STATS.find((s) => s.id === id), t.engine)
    await page.evaluate(() => window.__t.center('eur'))
    await untilState(page, 'eur', 'counting')
    await sleep(300)
    const mid = await page.evaluate(() => window.__t.text('eur'))
    // Stamped and hidden in one task: no frame of the count can fall between the two.
    const since = await page.evaluate(() => {
      const t = window.__t.now()
      window.__t.hideTab()
      return t
    })
    const [state, text] = await page.evaluate(() => [window.__t.state('eur'), window.__t.text('eur')])
    await sleep(300)
    const after = await page.evaluate((s) => window.__t.records(s).filter((r) => r.stat === 'eur' && r.kind === 'text').map((r) => r.value), since)
    // Still hidden: a stat that comes into view now shows its final value and never counts.
    await page.evaluate(() => window.__t.center('fr'))
    const fr = await untilState(page, 'fr', 'done', 1500)
    await sleep(300)
    const frWrites = await page.evaluate((s) => window.__t.records(s).filter((r) => r.stat === 'fr' && r.kind === 'text').length, since)
    await page.evaluate(() => window.__t.showTab())
    await sleep(300)
    const frText = await page.evaluate(() => window.__t.text('fr'))
    return [
      [
        'the tab hidden mid-count: it lands on the final value at once',
        mid !== want('eur') && state === 'done' && text === want('eur') && after.length === 1 && after[0] === want('eur'),
        `at ${JSON.stringify(mid)} → ${state} ${JSON.stringify(text)} in the same task, writes since: ${JSON.stringify(after)}`,
      ],
      [
        'in view while the tab is hidden: the final value, no count, not even after the tab returns',
        fr !== null && frWrites === 0 && frText === want('fr'),
        `fr ${fr === null ? 'never done' : 'done'} · ${frWrites} writes · ${JSON.stringify(frText)}`,
      ],
    ]
  },

  async a11y(t) {
    const { page } = await t.open()
    const spec = STATS.find((s) => s.id === 'eur')
    const want = finalText(spec, t.engine)
    const stat = page.locator('#eur')
    const resting = await stat.ariaSnapshot()
    await page.evaluate(() => window.__t.center('eur'))
    await untilState(page, 'eur', 'counting')
    const samples = []
    for (;;) {
      const [state, text, aria] = await page.evaluate(() => [window.__t.state('eur'), window.__t.text('eur'), window.__t.aria('eur')])
      if (state !== 'counting') break
      samples.push({ snapshot: await stat.ariaSnapshot(), text, aria })
    }
    const after = await stat.ariaSnapshot()
    const aria = await page.evaluate(() => window.__t.aria('eur'))
    const names = [...new Set(samples.map((s) => s.snapshot))]
    const moved = new Set(samples.map((s) => s.text)).size
    const words = (s) => s.replace(/\s+/g, '')
    return [
      [
        'while it counts, the stat reads its final value and never changes (the number aria-hidden, a visually hidden copy beside it); both go when it lands',
        samples.length >= 5 &&
          moved > 1 &&
          names.length === 1 &&
          names[0].includes(want) &&
          samples.every((s) => s.aria.hidden === 'true' && s.aria.label === want) &&
          words(after) === words(names[0]) &&
          after === resting &&
          aria.hidden === null &&
          aria.label === null,
        `${samples.length} reads over ${moved} different visible values: ${names.map((n) => JSON.stringify(n)).join(' | ')} · ` +
          `landed: ${JSON.stringify(after)}, aria-hidden ${aria.hidden}, copy ${aria.label === null ? 'gone' : 'still there'}`,
      ],
    ]
  },

  async activity(t) {
    const { page } = await t.open()
    const want = finalText(STATS.find((s) => s.id === 'dec'), t.engine)
    await page.evaluate(() => window.__t.center('dec'))
    await untilState(page, 'dec', 'counting')
    await sleep(300)
    const mid = await page.evaluate(() => window.__t.text('dec'))
    await page.evaluate(() => window.__fx.hide())
    const ms = await untilState(page, 'dec', 'done', 1000)
    const hidden = await page.evaluate(() => [window.__t.text('dec'), window.__t.aria('dec')])
    const since = await page.evaluate(() => window.__t.now())
    await page.evaluate(() => window.__fx.show())
    await page.evaluate(() => window.__t.center('dec'))
    await sleep(700)
    const later = await page.evaluate((s) => window.__t.records(s).filter((r) => r.stat === 'dec' && r.kind === 'text').length, since)
    const shown = await page.evaluate(() => [window.__t.state('dec'), window.__t.text('dec')])
    return [
      [
        'the route hidden mid-count lands it on its final value; shown again, it never replays',
        mid !== want && ms !== null && hidden[0] === want && hidden[1].hidden === null && hidden[1].label === null && later === 0 && shown[0] === 'done' && shown[1] === want,
        `at ${JSON.stringify(mid)} → hidden: ${JSON.stringify(hidden[0])} in ${ms} ms, aria-hidden ${hidden[1].hidden}, copy ${hidden[1].label === null ? 'gone' : 'left'} · shown: ${later} writes, ${shown[0]}`,
      ],
    ]
  },

  async ready(t) {
    if (t.engine !== 'agnostic') return []
    const { page } = await t.open('?noready')
    await page.waitForFunction(() => window.__fx?.bootedAt != null)
    await page.evaluate(() => window.__t.frames(5))
    const early = await page.evaluate(() => window.__t.html())
    const latched = await page
      .waitForFunction(() => window.__t.html().failsafe, null, { timeout: 9000 })
      .then(() => true)
      .catch(() => false)
    return [
      [
        'count-up never marks the engine ready: with nothing else to, the failsafe still fires for what else is hidden',
        early.gate === 'on' && !early.ready && latched,
        `after mount: gate ${early.gate}, ready ${early.ready} · failsafe ${latched ? 'latched' : 'never latched'}`,
      ],
    ]
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
  const line = (ok, browser, engine, name, detail) => {
    counts[browser] ??= { pass: 0, fail: 0 }
    counts[browser][ok ? 'pass' : 'fail']++
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${browser.padEnd(8)}  ${engine.padEnd(8)}  ${name}${detail ? `  (${detail})` : ''}`)
  }

  for (const browserName of args.browsers) {
    open.browser = await BROWSERS[browserName].launch()
    for (const engine of args.engines) {
      const errors = []
      for (const [id, check] of Object.entries(CHECKS)) {
        if (args.only && !args.only.includes(id)) continue
        const contexts = []
        const t = {
          browser: browserName,
          engine,
          async open(query = '', { reducedMotion = 'no-preference', javaScriptEnabled = true } = {}) {
            const context = await open.browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion, javaScriptEnabled })
            contexts.push(context)
            await context.addInitScript(instrument)
            const page = await context.newPage()
            page.on('pageerror', (err) => errors.push(`${id}: ${err.message.split('\n')[0]}`))
            page.on('console', (msg) => msg.type() === 'error' && errors.push(`${id}: console: ${msg.text().split('\n')[0]}`))
            await page.goto(`${base}/${engine}.html${query}`, { waitUntil: 'load' })
            if (javaScriptEnabled && !query.includes('boot=')) {
              await page.waitForFunction(() => window.__fx?.bootedAt != null && document.querySelector('[data-count-state]'))
            }
            return { page }
          },
        }
        try {
          for (const [name, ok, detail] of await check(t)) line(ok, browserName, engine, name, detail)
        } catch (err) {
          line(false, browserName, engine, id, err.message.split('\n')[0])
        } finally {
          for (const context of contexts) await context.close().catch(() => {})
        }
      }
      if (!args.only) line(errors.length === 0, browserName, engine, 'no uncaught errors or console errors', errors.slice(0, 3).join(' | '))
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
console.log(failures ? `\n${failures} check(s) failed` : '\nall count-up checks passed')
process.exit(failures ? 1 : 0)
