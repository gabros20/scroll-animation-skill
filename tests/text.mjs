#!/usr/bin/env node
// text.mjs — the text blocks in Chromium, WebKit and Firefox, spike S6's measurements turned into checks.
//   SplitWords    motion/SplitWords.tsx + css/split.css, server-rendered here in Node (react-dom/server), and
//                 splitWordsHTML (split-words.ts): the first frame with JavaScript off and with the bundle late,
//                 nothing moving, config's timing, the accessible name, reduced motion, ja/zh/th words (S6d, S6e)
//   split-reveal  gsap/split-reveal.ts (GSAP SplitText) in a web font the preview server sends late: the split waits
//                 for it and matches the unsplit lines, re-splits on a width change, heading and paragraph
//                 accessibility, the trigger line and timing, revertAfter and destroy() restoring the DOM exactly,
//                 live reduced motion, ja/zh/th through prepareText, the keyed React pattern (S6a, S6b, S6c, S6e)
// Builds tests/fixtures/text with Vite, serves the build with `vite preview`, prints one PASS/FAIL line per check and
// browser, and exits 1 on any FAIL. Needs the Playwright browsers, so it is its own script: `npm run test:text`.
//
//   node tests/text.mjs [--browsers chromium,webkit,firefox] [--only node,words,cjk-words,font,a11y,play,lifecycle,reduced,cjk,react]
//
// The late font is S6a's: the preview server answers /__late-font TEXT_FONT_DELAY ms (1000) after the request with
// TEXT_FONT, by default the first that exists of macOS's Courier New and Linux's DejaVu Sans Mono and Liberation
// Mono. The pages fall back to Georgia (serif on Linux), so the swap moves every line break.
// WebKit tabs to links only with Option held, as Safari does by default, so its keyboard check presses Alt+Tab.

import './unit/load-ts.mjs'

import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium, firefox, webkit } from 'playwright'
import { build, createLogger, preview } from 'vite'

const testsDir = dirname(fileURLToPath(import.meta.url))
const fixtureRoot = join(testsDir, 'fixtures', 'text')
const outDir = join(testsDir, '.scratch', 'text-dist')
const assets = join(testsDir, '..', 'skills', 'scroll-animation', 'assets')
const load = (path) => import(pathToFileURL(path).href)

const { MOTION, cubicBezier } = await load(join(assets, 'config.ts'))
const { splitWords, splitWordsHTML } = await load(join(assets, 'split-words.ts'))
const { SplitWords } = await load(join(assets, 'motion', 'SplitWords.tsx'))
const { HEADING, HERO, LEDE, LINK, SAMPLES, revealCjkMarkup, revealMarkup } = await load(
  join(fixtureRoot, 'src', 'samples.ts')
)
const React = await import('react')
const { renderToStaticMarkup, renderToString } = await import('react-dom/server')

const BROWSERS = { chromium, webkit, firefox }
const VIEWPORT = { width: 1000, height: 700 }
const PAGES = ['words', 'words-cjk', 'reveal', 'reveal-cjk', 'react']
/** The words bundle's delay: well past the slowest word's entrance (the lede's last ends 2.02 s after the first frame). */
const BUNDLE_DELAY = 4000
const FONT_DELAY = Number(process.env.TEXT_FONT_DELAY ?? 1000)
const FONT =
  process.env.TEXT_FONT ??
  [
    '/System/Library/Fonts/Supplemental/Courier New.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
    '/usr/share/fonts/TTF/DejaVuSansMono.ttf'
  ].find((file) => existsSync(file)) ??
  null
const FONT_TYPES = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2' }
/** The lede's props, and every word the words page renders. */
const LEDE_PROPS = { delay: 0.2, stagger: 0.04 }
const WORDS = HERO.split(' ').length + LEDE.split(' ').length

// ── args ────────────────────────────────────────────────────────────────

const GROUPS = ['node', 'words', 'cjk-words', 'font', 'a11y', 'play', 'lifecycle', 'reduced', 'cjk', 'react']

function parseArgs(argv) {
  const out = { browsers: Object.keys(BROWSERS), only: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--browsers') out.browsers = argv[++i].split(',')
    else if (a === '--only') out.only = argv[++i].split(',')
    else throw new Error(`unknown argument: ${a}`)
  }
  for (const b of out.browsers) if (!BROWSERS[b]) throw new Error(`unknown browser: ${b}`)
  for (const g of out.only ?? []) if (!GROUPS.includes(g)) throw new Error(`unknown group: ${g} (${GROUPS.join(', ')})`)
  return out
}

// ── the server render, build + serve ─────────────────────────────────────

const h = React.createElement
const WORDS_MARKUP = renderToStaticMarkup(
  h(
    React.Fragment,
    null,
    h(SplitWords, { text: HERO }),
    h(SplitWords, { as: 'p', className: 'lede', text: LEDE, ...LEDE_PROPS })
  )
)
const CJK_WORDS_MARKUP = Object.entries(SAMPLES)
  .map(([lang, text]) => `<div lang="${lang}" data-sample="${lang}">${renderToStaticMarkup(h(SplitWords, { as: 'p', text, locale: lang }))}</div>`)
  .join('\n      ')

/** Vite's own warnings, less the one the late font always causes: its URL only exists on the preview server. */
const logger = createLogger('warn')
for (const level of ['warn', 'warnOnce']) {
  const log = logger[level]
  logger[level] = (message, options) => {
    if (!message.includes('/__late-font')) log(message, options)
  }
}

function onwarn(warning, warn) {
  if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
  warn(warning)
}

/** S6a's late font: served by the preview server itself, FONT_DELAY ms after the request, never cached. */
const lateFont = {
  name: 'late-font',
  configurePreviewServer(server) {
    server.middlewares.use('/__late-font', (req, res) => {
      setTimeout(() => {
        if (!FONT) {
          res.statusCode = 404
          res.end()
          return
        }
        res.setHeader('Content-Type', FONT_TYPES[extname(FONT).toLowerCase()] ?? 'font/ttf')
        res.setHeader('Cache-Control', 'no-store')
        res.end(readFileSync(FONT))
      }, FONT_DELAY)
    })
  }
}

async function serve() {
  const fill = {
    '<!--words-->': WORDS_MARKUP,
    '<!--words-cjk-->': CJK_WORDS_MARKUP,
    '<!--reveal-->': revealMarkup(),
    '<!--reveal-cjk-->': revealCjkMarkup()
  }
  await build({
    root: fixtureRoot,
    configFile: false,
    customLogger: logger,
    publicDir: false,
    esbuild: { jsx: 'automatic' },
    plugins: [
      {
        name: 'text-fixture',
        transformIndexHtml: {
          order: 'pre',
          handler: (html) => Object.entries(fill).reduce((out, [mark, markup]) => out.replace(mark, () => markup), html)
        }
      }
    ],
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      rollupOptions: { input: Object.fromEntries(PAGES.map((p) => [p, join(fixtureRoot, `${p}.html`)])), onwarn }
    }
  })
  return preview({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'warn',
    plugins: [lateFont],
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0, strictPort: false }
  })
}

// ── helpers ─────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const near = (a, b, tol = 1e-6) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : x)
const frames = (page, n = 3) =>
  page.evaluate(
    (k) =>
      new Promise((resolve) => {
        const step = () => (--k <= 0 ? resolve() : requestAnimationFrame(step))
        requestAnimationFrame(step)
      }),
    n
  )

/** Polls `fn` in the page until it returns truthy; resolves with the elapsed ms, or null on timeout. */
async function until(page, fn, arg, timeout) {
  const t0 = Date.now()
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 'raf' })
    return Date.now() - t0
  } catch {
    return null
  }
}

/** Waits until `ms` after the navigation began, then reads the page. */
async function at(page, t0, ms, fn) {
  await sleep(Math.max(0, ms - (Date.now() - t0)))
  return page.evaluate(fn)
}

/**
 * The words the moment the page has painted and their animations have started, polled from here: with JavaScript off
 * nothing can wait in the page. The first animation to end, the first word's fade, ends 300 ms after that frame.
 */
async function atFirstPaint(page, timeout = 5000) {
  const t0 = Date.now()
  for (;;) {
    const s = await page.evaluate(wordsSnapshot)
    if ((s.fcp !== null && s.animations && s.started) || Date.now() - t0 > timeout) return s
    await sleep(8)
  }
}

/** Polls until no word animates (or 6 s pass); `at` is ms since the navigation began. */
async function atRest(page, t0, timeout = 6000) {
  for (;;) {
    const s = await page.evaluate(wordsSnapshot)
    if ((s.animations === 0 && s.rest) || Date.now() - t0 > timeout) return { ...s, at: Date.now() - t0 }
    await sleep(50)
  }
}

/** Every word rising, all the animations started in one frame, and that frame no later than the first paint. */
const fromFirstFrame = (s) => s.rises === WORDS && s.starts.length === 1 && s.fcp !== null && s.firstStart !== null && s.firstStart <= s.fcp + 1
const showFirst = (s) =>
  `${s.rises}/${s.words} words rising, ${s.animations} animations, started at ${s.starts.join(' / ') || 'none'} ms, first paint ${s.fcp} ms`

/** The original DOM, exactly: markup, attributes, the same node objects throughout, no inline style anywhere. */
/** A one-node aria snapshot: Playwright quotes the node after the dash when its text holds ': '. */
const snapshotIs = (snapshot, node) => snapshot === `- ${node}` || snapshot === `- '${node}'`
const exact = (d) => !!d && d.html && d.attrs && d.nodes && d.all && d.styled === 0
const showDom = (d) =>
  d ? `html ${d.html} · attrs ${d.attrs} (${d.attrsNow || 'none'}) · same nodes ${d.nodes}/${d.all} · styled ${d.styled}` : 'none'

const splitReady = (page) => until(page, () => window.__t?.ready(), null, FONT_DELAY + 8000)

// ── in-page readers (they run with JavaScript off too) ─────────────────

function wordsSnapshot() {
  const words = Array.from(document.querySelectorAll('[data-split-word]'))
  const animations = document.getAnimations().filter((a) => String(a.animationName).startsWith('split-word'))
  const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null
  const starts = animations.map((a) => (a.startTime === null ? null : Math.round(a.startTime * 10) / 10))
  return {
    fcp: fcp === null ? null : Math.round(fcp * 10) / 10,
    words: words.length,
    animations: animations.length,
    rises: animations.filter((a) => a.animationName === 'split-word-rise' && a.playState === 'running').length,
    started: starts.every((t) => t !== null),
    /** Every start time there is: all the words' animations start in one frame. */
    starts: [...new Set(starts)],
    firstStart: starts.length && starts.every((t) => t !== null) ? Math.min(...starts) : null,
    rest: words.every((word) => {
      const style = getComputedStyle(word)
      return style.opacity === '1' && style.transform === 'none'
    }),
    bundle: window.__bundleRanAt == null ? null : Math.round(window.__bundleRanAt)
  }
}

function wordsTiming() {
  const read = (el) =>
    el.getAnimations().map((a) => {
      const timing = a.effect.getTiming()
      return {
        name: a.animationName,
        delay: timing.delay,
        duration: timing.duration,
        fill: timing.fill,
        easing: a.effect.getKeyframes()[0]?.easing ?? null
      }
    })
  return {
    hero: Array.from(document.querySelectorAll('h1 [data-split-word]'), read),
    lede: Array.from(document.querySelectorAll('.lede [data-split-word]'), read)
  }
}

/** Every word's two animations against config: the rise and the trailing fade, at `delay` + i × `stagger` (s). */
function timingMatches(words, delay, stagger) {
  return (
    words.length > 1 &&
    words.every((anims, i) => {
      const start = (delay + i * stagger) * 1000
      const [rise, fade] = anims
      return (
        anims.length === 2 &&
        rise.name === 'split-word-rise' &&
        near(rise.delay, start, 0.5) &&
        near(rise.duration, MOTION.entrance.duration * 1000, 0.5) &&
        rise.easing === cubicBezier(MOTION.entrance.curve) &&
        rise.fill === 'backwards' &&
        fade.name === 'split-word-fade' &&
        near(fade.delay, start + MOTION.entranceFade.delay * 1000, 0.5) &&
        near(fade.duration, MOTION.entranceFade.duration * 1000, 0.5) &&
        fade.easing === 'linear' &&
        fade.fill === 'backwards'
      )
    })
  )
}

// ── Node checks: run once ─────────────────────────────────────────────────

function nodeChecks() {
  const cases = [
    [HERO, {}],
    [LEDE, { as: 'p', className: 'lede', ...LEDE_PROPS }],
    [SAMPLES.ja, { as: 'p', locale: 'ja' }],
    [`Tom & "Jerry's" <b>  split\n\ttoo `, { as: 'h2', className: 'a "b"', delay: 0 }]
  ]
  const mismatches = cases.filter(([text, options]) => {
    const html = splitWordsHTML(text, options)
    const element = h(SplitWords, { text, ...options })
    return html !== renderToStaticMarkup(element) || html !== renderToString(element)
  })
  // Spike S6e's measured recipe: Intl.Segmenter's segments, punctuation glued to the one before it.
  const spike = (lang, text) =>
    [...new Intl.Segmenter(lang, { granularity: 'word' }).segment(text)]
      .reduce((acc, { segment }) => {
        if (/^\p{P}+$/u.test(segment) && acc.length) acc[acc.length - 1] += segment
        else acc.push(segment)
        return acc
      }, [])
      .filter((segment) => segment.trim())
  const segmented = Object.entries(SAMPLES).map(([lang, text]) => {
    const words = splitWords(text, lang)
    return { lang, ok: same(words, spike(lang, text)) && !words.some((w) => /^\p{P}/u.test(w)), words: words.length }
  })
  return [
    [
      'splitWordsHTML is byte for byte the server render of <SplitWords> (renderToStaticMarkup, renderToString), escaping included',
      mismatches.length === 0,
      mismatches.length ? `differs for ${mismatches.map(([text]) => JSON.stringify(text)).join(', ')}` : `${cases.length} cases`
    ],
    [
      `ja, zh and th: splitWords is spike S6e's segmentation with punctuation on the word before it (Node ${process.version}, ICU ${process.versions.icu})`,
      segmented.every((s) => s.ok),
      segmented.map((s) => `${s.lang} ${s.words} words${s.ok ? '' : ' MISMATCH'}`).join(' · ')
    ]
  ]
}

// ── browser checks ───────────────────────────────────────────────────────
// Each takes a `t` bound to one browser and returns [[name, ok, detail], ...].

async function checkWords(t) {
  const out = []
  {
    const { page, t0 } = await t.open('words.html', { context: { javaScriptEnabled: false }, waitUntil: 'commit' })
    const first = await atFirstPaint(page)
    const late = await atRest(page, t0)
    out.push([
      'SplitWords, JavaScript off: every word animates from the first frame (start ≤ first paint) and lands at rest',
      fromFirstFrame(first) && late.animations === 0 && late.rest,
      `${showFirst(first)} · at rest ${late.rest} at ${late.at} ms, ${late.animations} animations left`
    ])
  }
  {
    const { page, t0 } = await t.open('words.html', {
      waitUntil: 'commit',
      route: { pattern: '**/assets/*.js', delay: BUNDLE_DELAY }
    })
    const first = await atFirstPaint(page)
    const before = await at(page, t0, BUNDLE_DELAY - 200, wordsSnapshot)
    await page.waitForFunction(() => window.__bundleRanAt != null, null, { timeout: BUNDLE_DELAY + 8000 })
    const after = await page.evaluate(() => ({
      bundle: Math.round(window.__bundleRanAt),
      below: window.__below,
      shifts: window.__shifts
    }))
    out.push([
      `SplitWords, the bundle ${BUNDLE_DELAY / 1000} s late: the words animate from the first frame and land before it runs`,
      fromFirstFrame(first) &&
        first.bundle === null &&
        before.animations === 0 &&
        before.rest &&
        before.bundle === null &&
        after.bundle >= BUNDLE_DELAY,
      `${showFirst(first)} · ` +
        `at ${(BUNDLE_DELAY - 200) / 1000} s ${before.animations} left, at rest ${before.rest} · the bundle ran at ${after.bundle} ms`
    ])
    const tops = new Set(after.below)
    const cls = after.shifts === null ? null : after.shifts.reduce((sum, v) => sum + v, 0)
    out.push([
      'SplitWords moves nothing: CLS 0 (Chromium) and the paragraph below sits still in every frame',
      after.below.length >= 60 && tops.size === 1 && (cls === null || cls === 0),
      `${after.below.length} frames, paragraph top ${[...tops].join(' / ')} px · CLS ${cls === null ? 'n/a (no Layout Instability API)' : cls}`
    ])
  }
  {
    const { page, t0 } = await t.open('words.html', { waitUntil: 'commit' })
    const timing = await at(page, t0, 150, wordsTiming)
    const hero = timingMatches(timing.hero, 0, MOTION.lineStagger)
    const lede = timingMatches(timing.lede, LEDE_PROPS.delay, LEDE_PROPS.stagger)
    const show = (w) => (w ? `${w.name} ${r1(w.delay)}+${r1(w.duration)} ms ${w.easing} ${w.fill}` : 'none')
    out.push([
      "SplitWords runs on config's timing: the rise MOTION.entrance on CURVES.entrance, the fade MOTION.entranceFade, " +
        '--i × MOTION.lineStagger; the lede\'s delay and stagger props apply',
      hero && lede,
      `hero word 2: ${timing.hero[2]?.map(show).join(', ')} · lede word 2: ${timing.lede[2]?.map(show).join(', ')}` +
        (hero && lede ? '' : ` · hero ${hero}, lede ${lede}`)
    ])
  }
  {
    const { page } = await t.open('words.html')
    const byName = await page.getByRole('heading', { name: HERO, exact: true }).count()
    const heading = await page.locator('h1').ariaSnapshot()
    const lede = await page.locator('p.lede').ariaSnapshot()
    const hidden = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-split-copy]'), (el) => {
        const r = el.getBoundingClientRect()
        return r.width <= 1 && r.height <= 1
      })
    )
    out.push([
      "SplitWords' name is the sentence, read once (the words hidden, the copy invisible); the lede's text too",
      byName === 1 && heading === `- heading "${HERO}" [level=1]` && lede === `- paragraph: ${LEDE}` && hidden.every(Boolean),
      `by name ${byName} · ${JSON.stringify(heading)} · ${JSON.stringify(lede)} · copies invisible ${hidden.join('/')}`
    ])
  }
  {
    const { page } = await t.open('words.html', { context: { reducedMotion: 'reduce' }, waitUntil: 'commit' })
    await atFirstPaint(page, 1500)
    const s = await page.evaluate(wordsSnapshot)
    out.push([
      'SplitWords under reduced motion: no animation, every word at rest',
      s.words === WORDS && s.animations === 0 && s.rest,
      `${s.words} words · ${s.animations} animations · at rest ${s.rest}`
    ])
  }
  return out
}

async function checkCjkWords(t) {
  const { page } = await t.open('words-cjk.html')
  const read = await page.evaluate(() =>
    Object.fromEntries(
      Array.from(document.querySelectorAll('[data-sample]'), (box) => {
        const spans = Array.from(box.querySelectorAll('[data-split-word]'))
        // Rendered lines: the words grouped by their layout top (transforms left out).
        const lines = []
        let top = null
        for (const span of spans) {
          if (top === null || Math.abs(span.offsetTop - top) > 4) {
            lines.push('')
            top = span.offsetTop
          }
          lines[lines.length - 1] += span.textContent
        }
        return [box.dataset.sample, { words: spans.map((s) => s.textContent), copy: box.querySelector('[data-split-copy]')?.textContent, lines }]
      })
    )
  )
  return Object.entries(SAMPLES).map(([lang, text]) => {
    const r = read[lang]
    const expected = splitWords(text, lang)
    const bare = r.words.filter((w) => /^\p{P}+$/u.test(w))
    const punctuated = r.lines.filter((line) => /^\p{P}/u.test(line))
    return [
      `SplitWords, ${lang}: the server's words (Node's Intl.Segmenter, punctuation on the word before it), no line starting with punctuation`,
      same(r.words, expected) && r.copy === text && !bare.length && !punctuated.length && r.lines.length > 1,
      `${r.words.length} words (server ${expected.length}) · ${r.lines.length} lines ${JSON.stringify(r.lines)}`
    ]
  })
}

async function checkFont(t) {
  if (!FONT) return [['split-reveal and the late web font', false, 'no font file to send late: set TEXT_FONT to a .ttf, .otf or .woff2']]
  const { page } = await t.open('reveal.html', { waitUntil: 'domcontentloaded' })
  const ready = await splitReady(page)
  const s = await page.evaluate(() => ({ start: window.__t.atStart(), split: window.__t.atSplit(), h: window.__t.now('h'), p: window.__t.now('p') }))
  const out = []
  for (const [id, what] of [
    ['h', 'heading'],
    ['p', 'paragraph']
  ]) {
    const at = s.split[id]
    const now = s[id]
    const fontMoves = !same(s.start.twin[id], now.twin)
    out.push([
      `split-reveal splits the ${what} once the late font is in: its lines are the unsplit text's, and nothing moves`,
      ready !== null &&
        !!at &&
        at.t >= FONT_DELAY &&
        at.probe === now.probe &&
        now.probe !== s.start.probe &&
        same(at.lines, at.twin) &&
        same(at.twin, now.twin) &&
        fontMoves &&
        near(at.height, at.twinHeight, 0.5),
      at
        ? `split at ${at.t} ms (font sent ${FONT_DELAY} ms late; check() ${at.fontCheck}) · probe ${s.start.probe} → ${at.probe} px ` +
          `(final ${now.probe}) · ${at.lines?.length} lines = twin ${at.twin.length} (${s.start.twin[id].length} in the fallback) · ` +
          `height ${at.height} / twin ${at.twinHeight} px`
        : `never split (ready ${ready})`
    ])
  }
  await page.setViewportSize({ width: 600, height: VIEWPORT.height })
  const resplit = await until(
    page,
    () =>
      ['h', 'p'].every((id) => {
        const n = window.__t.now(id)
        return n.split && JSON.stringify(n.lines) === JSON.stringify(n.twin)
      }),
    null,
    3000
  )
  const r = await page.evaluate(() => ({ h: window.__t.now('h'), p: window.__t.now('p'), fh: window.__t.first('h'), fp: window.__t.first('p') }))
  out.push([
    "a narrower viewport re-splits both (autoSplit): the lines are the unsplit text's again, the reveals still waiting",
    resplit !== null && !same(r.h.twin, s.h.twin) && r.fh?.yPercent === 100 && r.fp?.yPercent === 100 && !r.h.done && !r.p.done,
    `re-split in ${resplit} ms · heading ${s.h.lines?.length} → ${r.h.lines?.length} lines, paragraph ${s.p.lines?.length} → ` +
      `${r.p.lines?.length} · first lines at yPercent ${r.fh?.yPercent} / ${r.fp?.yPercent}`
  ])
  return out
}

async function checkA11y(t) {
  const { page } = await t.open('reveal.html', { waitUntil: 'domcontentloaded' })
  await splitReady(page)
  const byName = await page.getByRole('heading', { name: HEADING, exact: true }).count()
  const heading = await page.locator('#h').ariaSnapshot()
  const paragraph = await page.locator('#p').ariaSnapshot()
  const reference = await page.locator('#p-ref').ariaSnapshot()
  const links = await page.locator('#p').getByRole('link').count()
  const named = await page.locator('#p').getByRole('link', { name: LINK, exact: true }).count()
  const split = await page.evaluate(() => ({ h: window.__t.now('h').split, p: window.__t.now('p').split }))
  const out = [
    [
      'split-reveal: the split heading is named by its full text, its pieces hidden',
      split.h && byName === 1 && snapshotIs(heading, `heading "${HEADING}" [level=2]`),
      `split ${split.h} · by name ${byName} · ${JSON.stringify(heading)}`
    ],
    [
      'split-reveal: the split paragraph reads as it does unsplit, its link in the tree once',
      split.p && paragraph === reference && links === 1 && named === 1,
      `split ${split.p} · ${paragraph === reference ? 'the unsplit tree' : `${JSON.stringify(paragraph)} vs ${JSON.stringify(reference)}`} · ${links} link(s)`
    ]
  ]
  await page.focus('#before-p')
  await page.keyboard.press(t.tab)
  const first = await page.evaluate(() => ({ original: window.__t.focusedOriginalLink(), active: window.__t.active() }))
  await frames(page, 3)
  const landed = await page.evaluate(() => ({ dom: window.__t.dom('p'), done: window.__t.now('p').done, original: window.__t.focusedOriginalLink() }))
  await page.keyboard.press(t.tab)
  const next = await page.evaluate(() => window.__t.active())
  out.push([
    "split-reveal: Tab stops once on the paragraph's link (its own node), and focus there ends the entrance, the text back and still focused",
    first.original && landed.done && exact(landed.dom) && landed.original && next === 'after-p',
    `Tab → ${first.active} (the original ${first.original}) · done ${landed.done}, ${showDom(landed.dom)}, still focused ${landed.original} · Tab → ${next}`
  ])
  return out
}

async function checkPlay(t) {
  const { page } = await t.open('reveal.html', { waitUntil: 'domcontentloaded' })
  await splitReady(page)
  const out = []
  await page.evaluate(() => window.__t.scrollTo('h', 0.86))
  await frames(page, 4)
  await sleep(200)
  const waiting = await page.evaluate(() => ({ entrance: window.__t.entrance('h'), first: window.__t.first('h'), trigger: window.__t.trigger('h') }))
  await page.evaluate(() => window.__t.scrollTo('h', 0.74))
  await frames(page, 3)
  const playing = await page.evaluate(() => ({ entrance: window.__t.entrance('h'), eases: window.__t.eases }))
  out.push([
    'split-reveal waits below the trigger line (TRIGGERS.reveal: the top at 80% of the viewport) and plays across it',
    waiting.entrance?.paused === true &&
      waiting.entrance.progress === 0 &&
      waiting.first?.yPercent === 100 &&
      near(waiting.trigger?.start, waiting.trigger?.line, 1) &&
      playing.entrance?.paused === false &&
      playing.entrance.progress > 0,
    `at 86%: paused ${waiting.entrance?.paused}, progress ${waiting.entrance?.progress}, first line yPercent ${waiting.first?.yPercent} · ` +
      `trigger start ${waiting.trigger?.start} (the 80% line ${waiting.trigger?.line}) · at 74%: paused ${playing.entrance?.paused}, progress ${playing.entrance?.progress}`
  ])
  const e = playing.entrance
  const move = e?.tweens.find((tw) => tw.props.includes('yPercent'))
  const fade = e?.tweens.find((tw) => tw.props.includes('opacity'))
  const total = MOTION.entrance.duration + MOTION.lineStagger * ((e?.pieces ?? 1) - 1)
  out.push([
    "split-reveal runs on config's timing: lines rise on EASES.entrance over MOTION.entrance.duration, MOTION.lineStagger apart, " +
      'and fade in on MOTION.entranceFade',
    move?.ease === playing.eases.entrance &&
      near(move.duration, MOTION.entrance.duration) &&
      move.start === 0 &&
      near(move.stagger, MOTION.lineStagger) &&
      fade?.ease === 'none' &&
      near(fade.duration, MOTION.entranceFade.duration) &&
      near(fade.start, MOTION.entranceFade.delay, 1e-3) &&
      near(fade.stagger, MOTION.lineStagger) &&
      near(e.duration, total, 2e-3),
    `${e?.pieces} lines · rise ${move?.ease} ${move?.duration} s from ${move?.start}, stagger ${move?.stagger} · fade ${fade?.ease} ` +
      `${fade?.duration} s from ${fade?.start} · ${e?.duration} s in all (want ${Math.round(total * 1000) / 1000})`
  ])
  await until(page, () => window.__t.now('h').done, null, 6000)
  const kept = await page.evaluate(() => ({ now: window.__t.now('h'), first: window.__t.first('h') }))
  await page.evaluate(() => window.__t.scrollTo('top'))
  await frames(page, 3)
  await page.evaluate(() => window.__t.scrollTo('h', 0.5))
  await frames(page, 3)
  await sleep(300)
  const again = await page.evaluate(() => ({ now: window.__t.now('h'), first: window.__t.first('h') }))
  const atRest = (f) => f?.transform === 'none' && f.opacity === '1' && f.mask === 'visible'
  out.push([
    'a heading stays split after its entrance: at rest, unclipped, named by its text; scrolled away and back, it does not replay',
    kept.now.done && kept.now.split && atRest(kept.first) && kept.now.label === HEADING && again.now.split && atRest(again.first),
    `done ${kept.now.done}, split ${kept.now.split} · first line ${kept.first?.transform} o${kept.first?.opacity}, mask ${kept.first?.mask} · ` +
      `label ${kept.now.label === HEADING ? 'the text' : JSON.stringify(kept.now.label)} · after away and back: ${again.first?.transform} o${again.first?.opacity}`
  ])
  const clicks = await page.evaluate(() => window.__t.clicks())
  const crossed = Date.now()
  await page.evaluate(() => window.__t.scrollTo('p', 0.74))
  await frames(page, 2)
  const pieces = await page.evaluate(() => window.__t.entrance('p')?.pieces ?? null)
  const back = await until(page, () => window.__t.now('p').done && window.__t.dom('p').nodes, null, 6000)
  const took = back === null ? null : Date.now() - crossed
  const dom = await page.evaluate(() => window.__t.dom('p'))
  await page.evaluate(() => window.__t.click())
  const clicked = await page.evaluate(() => window.__t.clicks())
  const entrance = (MOTION.entrance.duration + MOTION.lineStagger * ((pieces ?? 1) - 1)) * 1000
  out.push([
    "revertAfter (a paragraph's default): when the entrance ends, the original DOM is back exactly, the same nodes, attributes and listeners",
    // Never before the entrance ends; the slack after it is for a loaded machine (GSAP's lag smoothing stretches jank).
    took !== null && exact(dom) && clicked === clicks + 1 && took >= entrance - 150 && took <= entrance + 1500,
    `back ${took} ms after crossing (the entrance ${Math.round(entrance)} ms, ${pieces} lines) · ${showDom(dom)} · the link's listener ${clicks} → ${clicked}`
  ])
  {
    // A link into the page: the paragraph is past the line before its font is in, the heading above the view.
    const { page: linked } = await t.open('reveal.html#before-p', { waitUntil: 'domcontentloaded' })
    await splitReady(linked)
    const y = await linked.evaluate(() => window.__t.scrollY())
    const played = await until(linked, () => window.__t.now('p').done && window.__t.dom('p').nodes, null, 6000)
    const loaded = await linked.evaluate(() => ({ y: window.__t.scrollY(), h: window.__t.now('h'), dom: window.__t.dom('p') }))
    await linked.evaluate(() => window.__t.scrollTo('h', 0.5))
    const back = await until(linked, () => window.__t.now('h').done, null, 6000)
    out.push([
      'loaded past the line (a link into the page): the paragraph plays once its font is in, the page stays put, and the heading above reveals on the way back up',
      y > 0 && played !== null && exact(loaded.dom) && loaded.y === y && !loaded.h.done && back !== null,
      `scrollY ${y} → ${loaded.y} · the paragraph back to its DOM ${played} ms after the split (${showDom(loaded.dom)}) · ` +
        `the heading done ${loaded.h.done} at load, then ${back === null ? 'never' : `${back} ms`} after scrolling up to it`
    ])
  }
  return out
}

async function checkLifecycle(t) {
  const { page } = await t.open('reveal.html', { waitUntil: 'domcontentloaded' })
  await splitReady(page)
  await page.evaluate(() => {
    window.__t.destroy('h')
    window.__t.destroy('p')
  })
  await frames(page, 2)
  const gone = await page.evaluate(() => ({ h: window.__t.dom('h'), p: window.__t.dom('p'), triggers: window.__t.triggers() }))
  const twice = await page
    .evaluate(() => {
      window.__t.destroy('h')
      window.__t.destroy('p')
      return 'ok'
    })
    .catch((err) => err.message.split('\n')[0])
  const out = [
    [
      'split-reveal destroy() mid-split puts the heading and the paragraph back exactly and removes the trigger; again, a no-op',
      exact(gone.h) && exact(gone.p) && gone.triggers === 0 && twice === 'ok',
      `heading: ${showDom(gone.h)} · paragraph: ${showDom(gone.p)} · ${gone.triggers} trigger(s) · second destroy: ${twice}`
    ]
  ]
  await page.evaluate(() => {
    window.__t.create('h')
    window.__t.create('p')
  })
  const resplit = await until(page, () => window.__t.now('h').split && window.__t.now('p').split, null, 4000)
  const waiting = await page.evaluate(() => ({ h: window.__t.first('h'), p: window.__t.first('p') }))
  await page.evaluate(() => window.__t.scrollTo('p', 0.74))
  const revealed = await until(page, () => window.__t.now('p').done && window.__t.dom('p').nodes, null, 6000)
  await page.evaluate(() => {
    window.__t.destroy('p')
    window.__t.create('p')
  })
  await frames(page, 4)
  await sleep(300)
  const shown = await page.evaluate(() => ({ now: window.__t.now('p'), dom: window.__t.dom('p') }))
  out.push([
    'split-reveal created again (a route shown again): an unrevealed element splits and waits, a revealed one is left as it is',
    resplit !== null && waiting.h?.yPercent === 100 && waiting.p?.yPercent === 100 && revealed !== null && !shown.now.split && shown.now.done && exact(shown.dom),
    `re-split in ${resplit} ms, first lines at yPercent ${waiting.h?.yPercent} / ${waiting.p?.yPercent} · revealed in ${revealed} ms, ` +
      `then created again: split ${shown.now.split}, done ${shown.now.done}, ${showDom(shown.dom)}`
  ])
  {
    const { page: printing } = await t.open('reveal.html', { waitUntil: 'domcontentloaded' })
    await splitReady(printing)
    await printing.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
    await frames(printing, 2)
    const r = await printing.evaluate(() => ({ h: window.__t.now('h'), p: window.__t.now('p'), first: window.__t.first('h'), dom: window.__t.dom('p') }))
    out.push([
      'split-reveal before printing: every entrance ends, the heading at rest and the paragraph back to its DOM',
      r.h.done && r.h.split && r.first?.transform === 'none' && r.first.opacity === '1' && r.p.done && !r.p.split && exact(r.dom),
      `heading done ${r.h.done}, first line ${r.first?.transform} o${r.first?.opacity} · paragraph done ${r.p.done}, split ${r.p.split}, ${showDom(r.dom)}`
    ])
  }
  return out
}

async function checkReduced(t) {
  const out = []
  {
    const { page } = await t.open('reveal.html', { context: { reducedMotion: 'reduce' }, waitUntil: 'domcontentloaded' })
    await sleep(FONT_DELAY + 1200)
    const read = () =>
      page.evaluate(() => ({
        h: window.__t.now('h'),
        p: window.__t.now('p'),
        dh: window.__t.dom('h'),
        dp: window.__t.dom('p'),
        triggers: window.__t.triggers()
      }))
    const loaded = await read()
    for (const id of ['h', 'p']) {
      await page.evaluate((i) => window.__t.scrollTo(i, 0.5), id)
      await frames(page, 3)
    }
    await sleep(300)
    const later = await read()
    const none = (r) => !r.h.split && !r.p.split && r.h.done && r.p.done && exact(r.dh) && exact(r.dp) && r.triggers === 0
    out.push([
      'split-reveal under reduced motion at load: nothing is split, ever (the font in, scrolled through), and no trigger',
      none(loaded) && none(later),
      `at load: split ${loaded.h.split}/${loaded.p.split}, done ${loaded.h.done}/${loaded.p.done}, ${loaded.triggers} trigger(s), ` +
        `heading ${showDom(loaded.dh)} · scrolled through: split ${later.h.split}/${later.p.split}, paragraph ${showDom(later.dp)}`
    ])
  }
  {
    const { page } = await t.open('reveal.html', { waitUntil: 'domcontentloaded' })
    await splitReady(page)
    // Both below the line, the page scrolled: GSAP 3.15 throws the reader to the top if a trigger is made or killed
    // during the matchMedia rebuild.
    await page.evaluate(() => window.__t.scrollTo('h', 0.95))
    await frames(page, 3)
    const y = await page.evaluate(() => window.__t.scrollY())
    const read = () =>
      page.evaluate(() => ({
        h: window.__t.now('h'),
        p: window.__t.now('p'),
        dh: window.__t.dom('h'),
        dp: window.__t.dom('p'),
        y: window.__t.scrollY()
      }))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await sleep(700)
    const on = await read()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await sleep(700)
    const off = await read()
    out.push([
      'reduced motion switched on after the split: both go back to the original DOM, and the page does not move',
      y > 0 && !on.h.split && !on.p.split && exact(on.dh) && exact(on.dp) && on.y === y,
      `scrollY ${y} → ${on.y} · split ${on.h.split}/${on.p.split} · heading ${showDom(on.dh)} · paragraph ${showDom(on.dp)}`
    ])
    out.push([
      'reduced motion switched off again: nothing splits (the text counts as shown), and the page does not move',
      !off.h.split && !off.p.split && off.h.done && off.p.done && exact(off.dh) && exact(off.dp) && off.y === y,
      `scrollY ${y} → ${off.y} · split ${off.h.split}/${off.p.split}, done ${off.h.done}/${off.p.done}`
    ])
  }
  return out
}

async function checkCjk(t) {
  const { page } = await t.open('reveal-cjk.html')
  const ready = await until(page, () => window.__t?.ready(), null, 6000)
  const rows = await page.evaluate(() => window.__t.read())
  return rows.map((r) => {
    const flat = (s) => s.replace(/\s+/g, '')
    const punctuated = r.lines.filter((line) => /^\p{P}/u.test(line))
    return [
      `split-reveal, ${r.lang}: SplitText gets this browser's Intl.Segmenter words through prepareText, no U+200B left, no line starting with punctuation`,
      ready !== null &&
        same(r.words, r.expected) &&
        !r.boundaryLeft &&
        flat(r.pieces) === flat(r.text) &&
        r.copy === r.text.replace(/\s+/g, ' ') &&
        r.lines.length > 1 &&
        !punctuated.length,
      `${r.words.length} words (splitWords ${r.expected.length}, ${same(r.expected, splitWords(r.text, r.lang)) ? 'as Node segments' : 'not as Node segments'}) · ` +
        `${r.lines.length} lines ${JSON.stringify(r.lines)}` +
        (r.boundaryLeft ? ' · U+200B left in the DOM' : '')
    ]
  })
}

async function checkReact(t) {
  const { page } = await t.open('react.html')
  await page.waitForFunction(() => !!window.__rx)
  const steps = ['mount', 'same props', 'new text', 'suffix removed', 'text A again']
  const reads = {}
  for (const step of steps) {
    if (step !== 'mount') await page.evaluate((s) => window.__rx.step(s), step)
    // Split again once the font check resolves (a split paragraph reverts 1.4 s later, so read it straight away).
    await until(page, () => Object.values(window.__rx.read()).every((r) => r.mounted && r.split), null, 3000)
    reads[step] = await page.evaluate(() => window.__rx.read())
  }
  return ['heading', 'paragraph'].map((variant) => {
    const rows = steps.map((step) => [step, reads[step][variant]])
    const good = (r) => r.mounted && r.visible === r.expected && r.accessible === r.expected && r.split && r.errors.length === 0
    return [
      `split-reveal in React, the ${variant} keyed by its content: new text and a removed <em> re-split, no stale text, no NotFoundError`,
      rows.every(([, r]) => good(r)),
      rows
        .map(([step, r]) => {
          const state = !r.mounted ? 'UNMOUNTED' : r.visible === r.expected && r.accessible === r.expected ? 'ok' : `STALE "${r.visible}" / "${r.accessible}"`
          return `${step}: ${state}${r.split ? '' : ', unsplit'}${r.errors.length ? `, ${r.errors.join('; ')}` : ''}`
        })
        .join(' · ')
    ]
  })
}

const CHECKS = {
  words: { page: 'words', run: checkWords },
  'cjk-words': { page: 'words', run: checkCjkWords },
  font: { page: 'reveal', run: checkFont },
  a11y: { page: 'reveal', run: checkA11y },
  play: { page: 'reveal', run: checkPlay },
  lifecycle: { page: 'reveal', run: checkLifecycle },
  reduced: { page: 'reveal', run: checkReduced },
  cjk: { page: 'reveal', run: checkCjk },
  react: { page: 'react', run: checkReact }
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
  const counts = {}
  const line = (ok, browser, group, name, detail) => {
    counts[browser] ??= { pass: 0, fail: 0 }
    counts[browser][ok ? 'pass' : 'fail']++
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${browser.padEnd(8)}  ${group.padEnd(9)}  ${name}${detail ? `  (${detail})` : ''}`)
  }

  if (!args.only || args.only.includes('node')) for (const [name, ok, detail] of nodeChecks()) line(ok, 'node', 'node', name, detail)
  const groups = Object.entries(CHECKS).filter(([id]) => !args.only || args.only.includes(id))
  if (!groups.length) return failures

  open.server = await serve()
  const base = `http://127.0.0.1:${open.server.httpServer.address().port}`
  for (const browserName of args.browsers) {
    open.browser = await BROWSERS[browserName].launch()
    const errors = {}
    for (const [id, check] of groups) {
      const contexts = []
      const pageErrors = (errors[check.page] ??= [])
      const t = {
        browser: browserName,
        tab: browserName === 'webkit' ? 'Alt+Tab' : 'Tab',
        /** A fresh context on a fixture page; `route` holds matching requests back `delay` ms. */
        async open(path, { context: options = {}, waitUntil = 'load', route = null } = {}) {
          const context = await open.browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, ...options })
          contexts.push(context)
          const page = await context.newPage()
          page.on('pageerror', (err) => pageErrors.push(`${id}: ${err.message.split('\n')[0]}`))
          page.on('console', (msg) => msg.type() === 'error' && pageErrors.push(`${id}: console: ${msg.text().split('\n')[0]}`))
          if (route) {
            await page.route(route.pattern, async (r) => {
              await sleep(route.delay)
              await r.continue().catch(() => {})
            })
          }
          const t0 = Date.now()
          await page.goto(`${base}/${path}`, { waitUntil })
          return { page, t0 }
        }
      }
      try {
        for (const [name, ok, detail] of await check.run(t)) line(ok, browserName, id, name, detail)
      } catch (err) {
        line(false, browserName, id, id, err.message.split('\n')[0])
      } finally {
        for (const context of contexts) await context.close().catch(() => {})
      }
    }
    for (const [kind, list] of Object.entries(errors)) {
      line(list.length === 0, browserName, kind, `the ${kind} pages: no uncaught errors or console errors`, list.slice(0, 3).join(' | '))
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
console.log(failures ? `\n${failures} check(s) failed` : '\nall text checks passed')
process.exit(failures ? 1 : 0)
