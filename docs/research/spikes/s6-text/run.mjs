// S6 — text splitting (Chromium, WebKit, Firefox).
//
//   a  pages/font.html                     SplitText autoSplit/onSplit/mask on a web font that lands 1 s late
//   b  pages/aria.html                     SplitText aria 'auto' | 'hidden' | 'none': ariaSnapshot + Chromium's AX tree
//   c  pages/react.html                    SplitText on React-rendered text through re-renders
//   d  pages/server-split*.html            server-split words, CSS keyframes staggered by --i
//   e  pages/segmenter.html                Intl.Segmenter 'word' on ja/zh/th, and SplitText on the same text
//
// The late font is served by the preview server (vite.config.mjs), not the
// fixture: /__late-font answers S6_FONT_DELAY ms (1000) after the request with
// S6_FONT (default: macOS's Courier New; the fallback in the page is Georgia, so
// the swap changes every line break). No browser-side interception.
// @gsap/react resolves from the repository root's node_modules (npm install there).
//
//   node run.mjs                         all parts, all engines
//   ENGINES=chromium PARTS=a,c node run.mjs
import { existsSync } from 'node:fs'
import { PNG } from 'pngjs'
import { SAMPLES } from './src/samples.js'
import { frames, newPage, r3, sleep, withBrowser, withServer, writeResult } from './harness.mjs'

const RUN = (process.env.ENGINES ?? 'chromium,webkit,firefox').split(',')
const PARTS = (process.env.PARTS ?? 'a,b,c,d,e').split(',')
const FONT =
  process.env.S6_FONT ??
  ['/System/Library/Fonts/Supplemental/Courier New.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', '/usr/share/fonts/TTF/DejaVuSansMono.ttf'].find((f) => existsSync(f))
const FONT_DELAY = Number((process.env.S6_FONT_DELAY ??= '1000'))
if (FONT) process.env.S6_FONT = FONT
const BUNDLE_DELAY = Number(process.env.BUNDLE_DELAY ?? 2000)

// ---- (a) SplitText and a late font ------------------------------------------------
async function partA(browser, base) {
  if (!FONT) throw new Error('no font file: set S6_FONT to a .ttf/.otf/.woff2')
  const out = { font: FONT, fontDelayMs: FONT_DELAY }
  for (const mode of ['unsplit', 'auto', 'noauto', 'ready', 'ready-auto', 'load-auto']) {
    const page = await newPage(browser, { viewport: { width: 1000, height: 700 } })
    let requestedAt = null
    const t0 = Date.now()
    page.on('request', (r) => {
      if (r.url().endsWith('/__late-font')) requestedAt = Date.now() - t0
    })
    await page.goto(`${base}/pages/font.html?mode=${mode}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__s6a)
    await sleep(FONT_DELAY + 1800)
    const settled = await page.evaluate(() => ({ log: window.__s6a.log, final: window.__s6a.final(), shifts: window.__s6a.shifts(), fontTrace: window.__s6a.fontTrace(), reveal: window.__s6a.revealAcrossResplits() }))
    await page.setViewportSize({ width: 700, height: 700 })
    await sleep(900)
    const resized = await page.evaluate(() => ({ final: window.__s6a.final(), splitCount: window.__s6a.log.splits.length, lastSplit: window.__s6a.log.splits.at(-1) ?? null }))
    out[mode] = {
      fontRequestedAtMs: requestedAt,
      scriptAt: settled.log.scriptAt,
      fontEvents: settled.log.fontEvents,
      fontSetEventsFromHead: settled.fontTrace.setEvents,
      fontStatuses: settled.fontTrace.statuses,
      readyAt: settled.log.readyAt,
      fontAtReady: settled.log.fontAtReady,
      splits: settled.log.splits.map((s) => ({ t: s.t, font: s.font, lineCount: s.lines.length, h1Height: s.h1Height })),
      revealAcrossResplits: settled.reveal,
      final: settled.final,
      shifts: settled.shifts,
      afterResizeTo700: {
        splitCount: resized.splitCount,
        linesMatchUnsplit: resized.final.linesMatchUnsplit,
        shownLines: resized.final.shownLines.length,
        twinLines: resized.final.twinLines.length,
        tallestLineBox: resized.final.tallestLineBox
      },
      errors: page.__errors
    }
    await page.context().close()
  }
  return out
}

// ---- (b) aria modes ------------------------------------------------------------------
async function chromiumAx(page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Accessibility.enable')
  const { nodes } = await cdp.send('Accessibility.getFullAXTree')
  const byId = new Map(nodes.map((n) => [n.nodeId, n]))
  const textUnder = (n) => {
    const out = []
    const walk = (x) => {
      if (!x) return
      if (x.role?.value === 'StaticText' && !x.ignored) out.push(x.name?.value)
      for (const c of x.childIds ?? []) walk(byId.get(c))
    }
    walk(n)
    return out.join('').replace(/\s+/g, ' ').trim()
  }
  return nodes
    .filter((n) => ['heading', 'paragraph', 'link'].includes(n.role?.value))
    .map((n) => ({ role: n.role.value, name: n.name?.value ?? '', ignored: n.ignored, textExposed: textUnder(n) }))
}

async function partB(browser, base, engine) {
  const out = {}
  for (const aria of ['unsplit', 'auto', 'hidden', 'none']) {
    const page = await newPage(browser)
    await page.goto(`${base}/pages/aria.html?aria=${aria}`)
    await page.waitForFunction(() => window.__s6b)
    await frames(page, 2)
    // Keyboard: does Tab still land on the link, and is it inside an aria-hidden subtree?
    await page.keyboard.press('Tab')
    const focus = await page.evaluate(() => {
      const el = document.activeElement
      return el && el !== document.body ? { tag: el.tagName.toLowerCase(), text: el.textContent.replace(/\s+/g, ' ').trim(), insideAriaHidden: !!el.closest('[aria-hidden="true"]') } : null
    })
    out[aria] = {
      tabFocus: focus,
      attrs: await page.evaluate(() => window.__s6b.attrs()),
      ariaSnapshot: { h1: await page.locator('#h').ariaSnapshot(), p: await page.locator('#p').ariaSnapshot() },
      getByRole: {
        heading: await page.getByRole('heading', { name: 'Every line arrives when its reader does', exact: true }).count(),
        anyHeading: await page.getByRole('heading').count(),
        link: await page.getByRole('link', { name: 'screen readers', exact: true }).count(),
        anyLink: await page.getByRole('link').count()
      },
      chromiumAxTree: engine === 'chromium' ? await chromiumAx(page) : undefined
    }
    await page.context().close()
  }
  return out
}

// ---- (c) React --------------------------------------------------------------------------
async function partC(browser, base) {
  const page = await newPage(browser, { viewport: { width: 1000, height: 1400 } })
  await page.goto(`${base}/pages/react.html`)
  await page.waitForFunction(() => window.__s6c)
  await frames(page, 3)
  const steps = [['mount', null], ['same props'], ['new text'], ['suffix removed'], ['text A again']]
  const out = {}
  for (const [name] of steps) {
    if (name !== 'mount') await page.evaluate((s) => window.__s6c.step(s), name)
    await frames(page, 3)
    await sleep(100)
    out[name] = await page.evaluate(() => window.__s6c.read())
  }
  const variants = Object.keys(out.mount)
  const table = Object.fromEntries(
    variants.map((v) => [
      v,
      Object.fromEntries(
        steps.map(([s]) => {
          const r = out[s][v]
          const status = !r.mounted ? 'UNMOUNTED' : r.ok ? 'ok' : `STALE shows "${r.shown}"`
          return [s, `${status}${r.nestedSplits ? ` nested=${r.nestedSplits}` : ''}${r.errors.length ? ` errors=${r.errors.length}` : ''}`]
        })
      )
    ])
  )
  return { table, errors: Object.fromEntries(variants.map((v) => [v, out['text A again'][v].errors])), raw: out, pageErrors: page.__errors }
}

// ---- (d) server-split words ------------------------------------------------------------
const SNAPSHOT = () => {
  const anims = document.getAnimations().filter((a) => a.animationName === 'word-in')
  const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null
  const words = [...document.querySelectorAll('.w')]
  const op = (el) => (el ? Number(getComputedStyle(el).opacity) : null)
  return {
    t: Math.round(performance.now()),
    fcp: fcp == null ? null : Math.round(fcp),
    bundleRanAt: window.__bundleRanAt == null ? null : Math.round(window.__bundleRanAt),
    slowRanAt: window.__slowRanAt == null ? null : Math.round(window.__slowRanAt),
    words: words.length,
    anims: anims.length,
    firstStart: anims.length ? Math.round(Math.min(...anims.map((a) => a.startTime ?? Infinity))) : null,
    states: [...new Set(anims.map((a) => a.playState))],
    firstWordOpacity: op(words[0]),
    lastWordOpacity: op(words[words.length - 1]),
    belowTop: document.getElementById('below') ? Math.round(document.getElementById('below').getBoundingClientRect().top * 100) / 100 : null
  }
}

async function inkIn(page) {
  const box = await page.evaluate(() => {
    const a = document.getElementById('h')?.getBoundingClientRect()
    const b = document.getElementById('p')?.getBoundingClientRect()
    return a && b ? { x: Math.floor(a.left), y: Math.floor(a.top), w: Math.ceil(Math.max(a.right, b.right) - a.left), h: Math.ceil(b.bottom - a.top) } : null
  })
  if (!box) return null
  const png = PNG.sync.read(await page.screenshot({ clip: { x: box.x, y: box.y, width: box.w, height: box.h } }))
  let ink = 0
  for (let i = 0; i < png.data.length; i += 4) if ((png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3 < 128) ink++
  return ink
}

async function partD(browser, base, engine) {
  const out = {}
  const cases = {
    'module bundle 2 s late': { path: 'server-split.html', ctx: {}, route: ['**/assets/*.js', 'delay'] },
    'JavaScript disabled': { path: 'server-split.html', ctx: { javaScriptEnabled: false } },
    'render-blocking <script> 2 s late': { path: 'server-split-blocking.html', ctx: {}, route: ['**/__slow.js', 'slow'] }
  }
  for (const [name, c] of Object.entries(cases)) {
    const page = await newPage(browser, { viewport: { width: 1000, height: 700 }, ...c.ctx })
    if (c.route) {
      await page.route(c.route[0], async (route) => {
        await sleep(BUNDLE_DELAY)
        if (c.route[1] === 'slow') await route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.__slowRanAt = performance.now()' })
        else await route.continue()
      })
    }
    const t0 = Date.now()
    await page.goto(`${base}/pages/${c.path}`, { waitUntil: 'commit' })
    const snaps = []
    let ink1500 = null
    for (const at of [300, 900, 1500, 2700]) {
      await sleep(Math.max(0, at - (Date.now() - t0)))
      snaps.push({ at, ...(await page.evaluate(SNAPSHOT)) })
      if (at === 1500) ink1500 = await inkIn(page)
    }
    await page.waitForLoadState('load')
    await sleep(300)
    const inkFinal = await inkIn(page)
    const cls =
      c.ctx.javaScriptEnabled === false
        ? 'not measured (JavaScript disabled)'
        : await page.evaluate(
            () =>
              new Promise((res) => {
                if (!PerformanceObserver.supportedEntryTypes.includes('layout-shift')) return res('unsupported')
                let sum = 0
                let n = 0
                new PerformanceObserver((l) => {
                  for (const e of l.getEntries()) {
                    sum += e.value
                    n++
                  }
                }).observe({ type: 'layout-shift', buffered: true })
                setTimeout(() => res({ cls: sum, entries: n }), 200)
              })
          )
    out[name] = {
      snaps,
      cls,
      belowMoved: new Set(snaps.map((s) => s.belowTop).filter((v) => v != null)).size > 1,
      inkAt1500VsFinal: ink1500 && inkFinal ? r3(ink1500 / inkFinal) : null,
      ariaSnapshot: { h1: await page.locator('#h').ariaSnapshot(), p: await page.locator('#p').ariaSnapshot() },
      headingByName: await page.getByRole('heading', { name: 'Every line arrives when its reader does', exact: true }).count(),
      innerText: await page.evaluate(() => document.getElementById('h').innerText.replace(/\s+/g, ' ').trim()),
      chromiumAxTree: engine === 'chromium' ? (await chromiumAx(page)).filter((n) => n.role !== 'link') : undefined,
      errors: page.__errors
    }
    await page.context().close()
  }
  return out
}

// ---- (e) Intl.Segmenter --------------------------------------------------------------------
async function partE(browser, base) {
  const page = await newPage(browser, { viewport: { width: 1000, height: 900 } })
  await page.goto(`${base}/pages/segmenter.html`)
  await page.waitForFunction(() => window.__s6e)
  const res = await page.evaluate(() => window.__s6e)
  await page.context().close()
  return res
}

function nodeSegmenter() {
  return {
    node: process.version,
    icu: process.versions.icu,
    samples: Object.fromEntries(
      Object.entries(SAMPLES).map(([lang, text]) => {
        const seg = new Intl.Segmenter(lang, { granularity: 'word' })
        return [lang, { resolvedLocale: seg.resolvedOptions().locale, segments: [...seg.segment(text)].map((s) => (s.isWordLike ? s.segment : `[${s.segment}]`)) }]
      })
    )
  }
}

const PART_FNS = { a: partA, b: partB, c: partC, d: partD, e: partE }
const out = { spike: 'S6', date: new Date().toISOString(), engines: {} }
if (PARTS.includes('e')) out.nodeSegmenter = nodeSegmenter()
await withServer(async (base) => {
  for (const engine of RUN) {
    await withBrowser(engine, async (browser) => {
      const res = (out.engines[engine] = { version: browser.version() })
      for (const part of PARTS) {
        const t0 = Date.now()
        res[part] = await PART_FNS[part](browser, base, engine)
        console.error(`[s6] ${engine} ${part} ${Date.now() - t0} ms`)
      }
    })
  }
})
const file = writeResult(process.env.OUT ?? 's6', out)

// Compact summary: the numbers the write-up quotes.
const summary = {}
for (const [engine, e] of Object.entries(out.engines)) {
  const s = (summary[engine] = { version: e.version })
  if (e.a)
    s.a = Object.fromEntries(
      Object.entries(e.a)
        .filter(([, v]) => v?.final)
        .map(([mode, v]) => [
          mode,
          [
            `fcp ${v.final.fcp}ms`,
            `loadingdone ${v.fontSetEventsFromHead?.find((x) => x.type === 'loadingdone')?.t ?? 'never'}`,
            `splits at ${v.splits.map((x) => `${Math.round(x.t)}ms/${x.lineCount} lines`).join(', ') || '-'}`,
            `final lines ${v.final.linesMatchUnsplit ? '= unsplit' : `!= unsplit (heading ${v.final.h1Height}px vs ${v.final.twinHeight}px)`}`,
            `CLS ${typeof v.shifts.layoutShift === 'object' ? v.shifts.layoutShift.cls : v.shifts.layoutShift}`,
            `paragraph moved ${v.shifts.belowMoves.map((m) => `${m.px > 0 ? '+' : ''}${m.px}px@${m.t}`).join(' ') || '0'}`,
            `after resize: ${v.afterResizeTo700.splitCount} splits, lines ${v.afterResizeTo700.linesMatchUnsplit ? '=' : '!='} unsplit`
          ].join('; ')
        ])
    )
  if (e.b) s.b = Object.fromEntries(Object.entries(e.b).map(([aria, v]) => [aria, `h1 ${JSON.stringify(v.ariaSnapshot.h1)}; p ${JSON.stringify(v.ariaSnapshot.p.split('\n')[0])}; links by role ${v.getByRole.link}`]))
  if (e.c) s.c = e.c.table
  if (e.d)
    s.d = Object.fromEntries(
      Object.entries(e.d).map(([name, v]) => {
        const last = v.snaps.at(-1)
        const at1500 = v.snaps.find((x) => x.at === 1500)
        return [name, `fcp ${last.fcp}ms, first word animation start ${last.firstStart}ms, script ran ${last.bundleRanAt ?? last.slowRanAt ?? 'never'}; at 1.5 s: ${at1500.anims} animations ${at1500.states.join('/') || 'none'}, ink ${v.inkAt1500VsFinal ?? '-'}; CLS ${typeof v.cls === 'object' ? v.cls.cls : v.cls}; paragraph moved ${v.belowMoved}; heading by name ${v.headingByName}`]
      })
    )
  if (e.e)
    s.e = Object.fromEntries(
      Object.entries(e.e.samples).map(([lang, v]) => [
        lang,
        `segments ${v.segmenter.segments.length} (same as Node ${JSON.stringify(v.segmenter.segments) === JSON.stringify(out.nodeSegmenter?.samples[lang].segments)}); SplitText default ${v.default.words} words/${v.default.lines.length} lines vs ${v.unsplitLines.length} rendered; segmenter ${v.segmenterSplit.words} words, lines = unsplit ${v.segmenterSplit.matchesUnsplit}, line starts with punctuation ${v.segmenterSplit.lineStartsWithPunctuation}; glued lines = unsplit ${v.segmenterGlued.matchesUnsplit}, punctuation start ${v.segmenterGlued.lineStartsWithPunctuation}`
      ])
    )
}
console.log(JSON.stringify({ spike: 'S6', raw: file, summary }, null, 1))
