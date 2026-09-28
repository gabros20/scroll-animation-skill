#!/usr/bin/env node
// rail.mjs — the GSAP horizontal rail (assets/gsap/horizontal-rail.ts + css/rail.css) in Chromium, WebKit and
// Firefox: measured travel and runway, the band-to-translate writer and its holds, RTL, re-measuring after a resize
// and a late image, keyboard focus following into off-screen panels through each scroll authority, the reduced-motion
// native scroller (at load and switched live), destroy() and re-creation, and no uncaught errors.
// Builds tests/fixtures/rail with Vite, serves the build with `vite preview`, prints one PASS/FAIL line per
// check/page/browser, and exits 1 on any FAIL. Needs the Playwright browsers, so it is its own script, like
// `test:scrub-video` — not part of `npm test`.
//
// Pages: native (sticky pin, no authority), rtl (the same, <html dir="rtl">), lenis (sticky pin under Lenis on the
// GSAP ticker) and smoother (ScrollSmoother, `pin: 'gsap'`). The fixture's holds are 120 / 240 px, far from the scene
// defaults, so a writer that read raw progress instead of the band would show.
//
//   node tests/rail.mjs [--browsers chromium,webkit,firefox] [--pages native,rtl,lenis,smoother] [--only bands,focus,…]
//
// WebKit tabs to links only with Option held, as Safari does by default, so its keyboard checks press Alt+Tab.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium, firefox, webkit } from 'playwright'
import { build, preview } from 'vite'

const testsDir = dirname(fileURLToPath(import.meta.url))
const fixtureRoot = join(testsDir, 'fixtures', 'rail')
const outDir = join(testsDir, '.scratch', 'rail-dist')

const BROWSERS = { chromium, webkit, firefox }
const PAGES = ['native', 'rtl', 'lenis', 'smoother']
const VIEWPORT = { width: 1280, height: 800 }
const NARROW = { width: 1000, height: 800 }
/** The late image's width at the fixture's 300 px height (1600 x 800 intrinsic). */
const IMAGE_W = 600
const PANELS = 5
/** A smooth scroll (native, Lenis, ScrollSmoother) settles well inside this. */
const SETTLE_MS = 6000

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
      rollupOptions: { input: Object.fromEntries(PAGES.map((p) => [p, join(fixtureRoot, `${p}.html`)])) }
    }
  })
  return preview({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'warn',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0, strictPort: false }
  })
}

// ── helpers ─────────────────────────────────────────────────────────────

const near = (a, b, tol = 1) => a !== null && b !== null && Math.abs(a - b) <= tol
/** An end edge against the pin's: never short of it (a hairline of page showing), at most a clipped sub-pixel past. */
const flush = (gap) => gap !== null && gap <= 0.05 && gap > -1
const state = (page) => page.evaluate(() => window.__t.state())

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

/**
 * Focus on the intro link, the last stop before the rail: the sequential-navigation starting point for the key
 * presses under test. Set by script, because where a first Tab lands depends on what the page did before (Chromium
 * moves the starting point with a scrollIntoView).
 */
async function focusIntro(page) {
  await page.focus('[data-intro]')
  return (await page.evaluate(() => window.__t.active())) === 'intro'
}

// ── checks ──────────────────────────────────────────────────────────────
// Each takes a `t` bound to one browser + one page and returns [[name, ok, detail], ...].

const CHECKS = {
  measure: {
    pages: PAGES,
    async run(t) {
      const { page } = await t.open()
      const s = await state(page)
      return [
        [
          "travel is measured (the track's scroll width minus the pin's width) and the runway is that distance",
          s.travel > 0 && near(s.travel, s.scrollWidth - s.pinWidth) && near(s.spacer, s.travel) && near(s.rangePx, s.travel),
          `travel ${s.travel} (scrollWidth ${s.scrollWidth} − pin ${s.pinWidth}) · spacer ${s.spacer} · range ${s.rangePx}${s.rtl ? ' · rtl' : ''}`
        ]
      ]
    }
  },

  bands: {
    pages: PAGES,
    async run(t) {
      const { page } = await t.open()
      const rtl = t.page === 'rtl'
      const sign = rtl ? 1 : -1
      const stops = [
        ['head hold', () => window.__t.toHeadHold(), 0],
        ['band 0', () => window.__t.toBand(0), 0],
        ['band ½', () => window.__t.toBand(0.5), 0.5],
        ['band 1', () => window.__t.toBand(1), 1],
        ['tail hold', () => window.__t.toTailHold(), 1]
      ]
      const seen = []
      let writerOk = true
      let landedOk = true
      for (const [label, go, band] of stops) {
        await page.evaluate(go)
        const s = await state(page)
        // The scroll lands on whole pixels: within one pixel of scroll of the band asked for.
        const landed = Math.abs(s.band - band) <= 1 / Math.max(1, s.bandPx) + 1e-4
        const want = sign * s.travel * s.band
        const writes = near(s.translate, want) && near(s.drawn, s.translate)
        writerOk &&= writes && s.rtl === rtl
        landedOk &&= landed
        seen.push(`${label}: band ${s.band} p ${s.p} → ${s.translate} (ideal ${Math.round(sign * s.travel * band * 10) / 10}, drawn ${s.drawn})`)
      }
      await page.evaluate(() => window.__t.toBand(0))
      const start = await state(page)
      await page.evaluate(() => window.__t.toBand(1))
      const end = await state(page)
      const dir = rtl ? 'RTL: the sign flips; ' : ''
      return [
        [
          `${dir}at band 0, ½ and 1 the translate is 0, ${rtl ? '+' : '−'}travel/2 and ${rtl ? '+' : '−'}travel (±1 px), holds respected`,
          writerOk && landedOk,
          `travel ${start.travel} · ${seen.join(' · ')}`
        ],
        [
          `${dir}the first panel starts flush at band 0 and the last ends flush at band 1`,
          near(start.firstGap, 0) && flush(end.lastGap) && near(end.translate, sign * end.travel),
          `first gap ${start.firstGap} px, last gap ${end.lastGap} px, end translate ${end.translate}`
        ]
      ]
    }
  },

  resize: {
    pages: ['native', 'smoother'],
    async run(t) {
      const { page } = await t.open()
      // Mid-rail, so a 'gsap' pin is pinned (carrying its old inline width) when the viewport changes.
      await page.evaluate(() => window.__t.toBand(0.5))
      const before = await state(page)
      await page.setViewportSize(NARROW)
      const ms = await until(
        page,
        (old) => {
          const s = window.__t.state()
          return Math.abs(s.travel - old) > 1 && Math.abs(s.travel - (s.scrollWidth - s.pinWidth)) <= 1 && Math.abs(s.spacer - s.travel) <= 1
        },
        before.travel
      )
      await page.waitForTimeout(500)
      const after = await state(page)
      await page.evaluate(() => window.__t.toBand(1))
      const end = await state(page)
      return [
        [
          'after a resize the travel is re-measured and the end still lands flush',
          ms !== null &&
            near(after.travel, after.scrollWidth - after.pinWidth) &&
            near(after.spacer, after.travel) &&
            near(after.rangePx, after.travel) &&
            flush(end.lastGap) &&
            near(end.translate, -end.travel),
          `travel ${before.travel} → ${after.travel} (${after.scrollWidth} − ${after.pinWidth}) in ${ms} ms · ` +
            `spacer ${after.spacer} · range ${after.rangePx} · band 1: last gap ${end.lastGap}, translate ${end.translate}`
        ]
      ]
    }
  },

  content: {
    pages: ['native', 'smoother'],
    async run(t) {
      const { page } = await t.open()
      const before = await state(page)
      await page.evaluate(() => window.__t.loadImage())
      // The panel ends up as wide as the image plus its 2 × 40 px padding; the travel grows by what it gained.
      const ms = await until(
        page,
        ({ travel, lateWidth, panel }) => {
          const s = window.__t.state()
          return s.lateWidth === panel && Math.abs(s.travel - (travel + panel - lateWidth)) <= 1 && Math.abs(s.spacer - s.travel) <= 1
        },
        { ...before, panel: IMAGE_W + 80 }
      )
      await page.evaluate(() => window.__t.toBand(1))
      const end = await state(page)
      return [
        [
          'a late image widens a panel: the travel follows it and the end lands flush',
          ms !== null && near(end.travel, end.scrollWidth - end.pinWidth) && flush(end.lastGap) && near(end.rangePx, end.travel),
          `panel ${before.lateWidth} → ${end.lateWidth} px · travel ${before.travel} → ${end.travel} in ${ms} ms · ` +
            `range ${end.rangePx} · band 1: last gap ${end.lastGap}`
        ]
      ]
    }
  },

  gutter: {
    pages: ['native', 'rtl', 'smoother'],
    async run(t) {
      const { page } = await t.open()
      const before = await state(page)
      await page.evaluate(() => window.__t.gutter(48))
      // Both ends' padding: the start's moves every panel, the end's is travel the engine's scrollWidth may leave out.
      const ms = await until(page, (old) => Math.abs(window.__t.state().travel - (old + 96)) <= 1, before.travel)
      await page.evaluate(() => window.__t.toBand(0))
      const start = await state(page)
      await page.evaluate(() => window.__t.toBand(1))
      const end = await state(page)
      return [
        [
          'a track padded 48 px each side (a gutter) starts and ends 48 px from the edge, in every engine',
          ms !== null && near(start.firstGap, 48) && end.lastGap > 47 && end.lastGap <= 48.05,
          `travel ${before.travel} → ${end.travel} (want +96; scrollWidth − pin ${end.scrollWidth - end.pinWidth}) · ` +
            `band 0: first gap ${start.firstGap} · band 1: last gap ${end.lastGap}`
        ]
      ]
    }
  },

  api: {
    pages: ['native', 'smoother'],
    async run(t) {
      const { page } = await t.open()
      const before = await state(page)
      await page.evaluate(() => {
        window.__t.addPanel()
        window.__rail.refresh()
      })
      // 400 px and one more 24 px gap.
      const ms = await until(
        page,
        (want) => {
          const s = window.__t.state()
          return Math.abs(s.travel - want) <= 1 && Math.abs(s.spacer - s.travel) <= 1 && Math.abs(s.rangePx - s.travel) <= 1
        },
        before.travel + 424
      )
      const after = await state(page)
      // The runway grew, so pinnedScene's layout watch refreshes ScrollTrigger 150 ms later; a native smooth scroll
      // under way then would stop where it is (the refresh scrolls to measure). Let it land first.
      await page.waitForTimeout(400)
      await page.evaluate(() => window.__rail.scrollToPanel(2, { immediate: true }))
      await page.evaluate(() => window.__t.frames(4))
      const third = await page.evaluate(() => window.__t.inView(2))
      await page.evaluate(() => window.__rail.scrollToPanel(5))
      const sixth = await until(page, () => window.__t.inView(5))
      return [
        [
          'rail.refresh() after adding a panel (no box resized, nothing for a ResizeObserver) re-measures the travel',
          ms !== null,
          `travel ${before.travel} → ${after.travel} (want +424) · spacer ${after.spacer} · range ${after.rangePx}`
        ],
        [
          'rail.scrollToPanel() brings a panel fully into view (at once, and smoothly to the new last one)',
          third && sixth !== null,
          `panel 3 in view: ${third} · panel 6 in view after ${sixth} ms`
        ]
      ]
    }
  },

  print: {
    pages: ['native'],
    async run(t) {
      const { page } = await t.open()
      await page.evaluate(() => window.__t.toBand(0.5))
      await page.emulateMedia({ media: 'print' })
      await page.evaluate(() => window.__t.frames(2))
      const p = await page.evaluate(() => window.__t.print())
      return [
        [
          'print: every panel in flow on the page, none translated, no runway',
          p.display === 'block' && p.translate === 'none' && p.spacer === 'none' && p.pinPosition === 'static' && p.onPage,
          JSON.stringify(p)
        ]
      ]
    }
  },

  // What the page is without its script: no rail mounted (so no data-scene-state) and no pre-JS gate. The fixtures run
  // no GATE_SCRIPT, so the same page also shows that a mounted rail is never turned into a scroller, and that a gated
  // page never gets one before its rail mounts.
  nojs: {
    pages: ['native'],
    async run(t) {
      const { page } = await t.open()
      const r = await page.evaluate(async () => {
        const track = document.querySelector('[data-rail-track]')
        const mounted = getComputedStyle(track).overflowX
        window.__rail.destroy()
        await window.__t.frames(2)
        const overflowX = getComputedStyle(track).overflowX
        track.scrollLeft = track.scrollWidth
        await window.__t.frames(2)
        const panels = track.querySelectorAll('[data-rail-panel]')
        const tr = track.getBoundingClientRect()
        const lr = panels[panels.length - 1].getBoundingClientRect()
        const lastInView = lr.left >= tr.left - 1 && lr.right <= tr.right + 1
        document.documentElement.setAttribute('data-animation', 'on')
        await window.__t.frames(2)
        const gated = getComputedStyle(track).overflowX
        document.documentElement.removeAttribute('data-animation')
        return { mounted, overflowX, lastInView, gated }
      })
      return [
        [
          'no script: the track is a native scroller with the last panel in reach; mounted, or gated, it is not',
          r.mounted !== 'auto' && r.overflowX === 'auto' && r.lastInView && r.gated !== 'auto',
          JSON.stringify(r)
        ]
      ]
    }
  },

  focus: {
    pages: PAGES,
    async run(t) {
      const out = []
      {
        // Straight to the last panel's link: five presses, no waiting in between.
        const { page } = await t.open()
        const ready = await focusIntro(page)
        for (let i = 0; i < PANELS; i++) await page.keyboard.press(t.tab)
        const active = await page.evaluate(() => window.__t.active())
        const ms = await until(page, (i) => window.__t.inView(i), PANELS - 1)
        const s = await state(page)
        out.push([
          'tabbing to a link in the last panel scrolls the page until that panel is fully in view',
          ready && active === `panel-${PANELS - 1}` && ms !== null,
          `focus on ${active} · in view after ${ms} ms · band ${s.band}, last gap ${s.lastGap}, pin top ${s.pinTop}`
        ])
      }
      {
        // One panel at a time: each is whole in view before the next Tab.
        const { page } = await t.open()
        const ready = await focusIntro(page)
        const steps = []
        let ok = ready
        for (let i = 0; i < PANELS; i++) {
          await page.keyboard.press(t.tab)
          const active = await page.evaluate(() => window.__t.active())
          const ms = await until(page, (n) => window.__t.inView(n), i)
          ok &&= active === `panel-${i}` && ms !== null
          steps.push(`${i + 1}: ${active === `panel-${i}` ? (ms === null ? 'never' : `${ms} ms`) : `focus on ${active}`}`)
        }
        // And back out of the rail, Shift+Tab to the first panel again.
        for (let i = 0; i < PANELS - 1; i++) await page.keyboard.press(`Shift+${t.tab}`)
        const back = await page.evaluate(() => window.__t.active())
        const ms = await until(page, () => window.__t.inView(0))
        ok &&= back === 'panel-0' && ms !== null
        steps.push(`back to 1: ${ms === null ? 'never' : `${ms} ms`}`)
        out.push(['Tab through every panel and Shift+Tab back: each panel is fully in view in turn', ok, steps.join(', ')])
      }
      if (t.page === 'native' && t.browser !== 'webkit') {
        // A click focuses a link without :focus-visible: the reader aimed at what they could see, so nothing moves.
        const { page } = await t.open()
        await page.evaluate(() => window.__t.toBand(0.25))
        const target = await page.evaluate(() => {
          for (let i = 0; i < 5; i++) {
            if (window.__t.inView(i)) continue
            const r = window.__t.linkRect(i)
            if (r.x > 0 && r.x < innerWidth - 10) return { i, ...r }
          }
          return null
        })
        let detail = 'no half-visible panel with a visible link at band ¼'
        let ok = false
        if (target) {
          const y0 = await page.evaluate(() => scrollY)
          await page.mouse.click(target.x, target.y)
          await page.waitForTimeout(800)
          const y1 = await page.evaluate(() => scrollY)
          const active = await page.evaluate(() => window.__t.active())
          ok = y1 === y0
          detail = `clicked panel ${target.i + 1}'s link (focus on ${active}) · scrollY ${y0} → ${y1}`
        }
        out.push(['a mouse click on a link in a half-visible panel does not move the page', ok, detail])
      }
      return out
    }
  },

  reduced: {
    pages: ['native', 'smoother'],
    async run(t) {
      const { page } = await t.open({ reducedMotion: 'reduce' })
      const r = await page.evaluate(() => window.__t.reduced())
      // Through the whole section and past it: nothing may start writing.
      for (const y of [0.25, 0.5, 1, 1.4]) {
        await page.evaluate((f) => {
          const root = document.querySelector('[data-scene-root]')
          window.scrollTo({ top: root.getBoundingClientRect().top + scrollY + f * root.offsetHeight, behavior: 'instant' })
        }, y)
        await page.evaluate(() => window.__t.frames(3))
      }
      const later = await page.evaluate(() => window.__t.reduced())
      const scrolled = await page.evaluate(() => window.__t.scrollTrack())
      // scrollToPanel() scrolls the scroller now: the panel's start edge to the track's.
      await page.evaluate(() => window.__rail.scrollToPanel(3))
      await page.evaluate(() => window.__t.frames(4))
      const offset = await page.evaluate(() => window.__t.panelOffset(3))
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
      await focusIntro(page)
      await page.keyboard.press(t.tab)
      const active = await page.evaluate(() => window.__t.active())
      const ring = await page.evaluate(() => window.__t.reduced().outline)
      const noPin = r.pinPosition === 'relative' && !r.pinSpacer && r.spacer === 0 && r.rootHeight === r.pinHeight
      const noTranslate = r.inline === '' && r.computed === 'none' && later.inline === '' && later.computed === 'none'
      return [
        [
          'reduced motion at load: no pin, no runway, no translate (scrolled through and past)',
          noPin && noTranslate,
          `pin ${r.pinPosition} · spacer ${r.spacer} · root ${r.rootHeight} = pin ${r.pinHeight} · translate '${r.inline}'/${r.computed} → '${later.inline}'/${later.computed}`
        ],
        [
          'reduced motion: the track is a native snap scroller, focusable, with a visible focus ring',
          r.overflowX === 'auto' &&
            /x mandatory/.test(r.snapType) &&
            /start/.test(r.snapAlign) &&
            r.scrollable &&
            scrolled > 0 &&
            near(offset, 0) &&
            r.tabindex === '0' &&
            active === 'track' &&
            /solid 2px/.test(ring),
          `overflow-x ${r.overflowX} · snap '${r.snapType}' / '${r.snapAlign}' · scrolled to ${scrolled} · ` +
            `scrollToPanel(3) → offset ${offset} · tabindex ${r.tabindex} · focus on ${active}, outline ${ring}`
        ]
      ]
    }
  },

  reducedLive: {
    pages: ['native', 'smoother'],
    async run(t) {
      const { page } = await t.open()
      await page.evaluate(() => window.__t.toBand(0.5))
      const before = await state(page)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.waitForTimeout(600)
      const r = await page.evaluate(() => window.__t.reduced())
      const scrolled = await page.evaluate(() => window.__t.scrollTrack())
      await page.evaluate(() => (document.querySelector('[data-rail-track]').scrollLeft = 0))
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.waitForTimeout(900)
      const back = await state(page)
      const pin = await page.evaluate(() => ({
        position: getComputedStyle(document.querySelector('[data-scene-pin]')).position,
        tabindex: document.querySelector('[data-rail-track]').getAttribute('tabindex')
      }))
      const pinned = t.page === 'smoother' ? back.pinTop === 0 || near(back.pinTop, 0) : pin.position === 'sticky'
      return [
        [
          'reduced motion switched on mid-rail: pin released, runway gone, no translate, a native snap scroller',
          near(before.translate, -before.travel * before.band) &&
            r.pinPosition === 'relative' &&
            !r.pinSpacer &&
            r.spacer === 0 &&
            r.inline === '' &&
            r.computed === 'none' &&
            r.overflowX === 'auto' &&
            scrolled > 0 &&
            r.tabindex === '0',
          `before: band ${before.band}, translate ${before.translate} · after: pin ${r.pinPosition}, spacer ${r.spacer}, translate '${r.inline}'/${r.computed}, overflow-x ${r.overflowX}, scrolled to ${scrolled}, tabindex ${r.tabindex}`
        ],
        [
          'switched back: pin, runway and translate return, the translate matching the band',
          pinned &&
            pin.tabindex === null &&
            near(back.spacer, back.travel) &&
            near(back.travel, back.scrollWidth - back.pinWidth) &&
            near(back.translate, -back.travel * back.band),
          `pin ${pin.position} (top ${back.pinTop}) · spacer ${back.spacer} / travel ${back.travel} · band ${back.band} → translate ${back.translate} · tabindex ${pin.tabindex}`
        ]
      ]
    }
  },

  destroy: {
    pages: ['native', 'rtl', 'lenis', 'smoother'],
    async run(t) {
      const { page } = await t.open()
      await page.evaluate(() => window.__t.toBand(0.5))
      const before = await state(page)
      await page.evaluate(() => window.__t.destroy())
      await page.evaluate(() => window.__t.frames(3))
      const left = await page.evaluate(() => window.__t.leftovers())
      const twice = await page
        .evaluate(() => {
          window.__rail.destroy()
          return 'ok'
        })
        .catch((err) => err.message.split('\n')[0])
      // Shown again (Activity, a remount): the same scroll gives the same frame. The runway comes back above the
      // viewport, and WebKit's scroll anchoring moves the page by it to keep what the reader sees in place (not the
      // rail's doing: gone with `overflow-anchor: none`), so the check goes back to the same offset first.
      await page.evaluate(() => window.__t.remount())
      await until(page, () => window.__t.state().inline !== '', null, 3000)
      // A few frames for that scroll event to reach the authority (Lenis syncs its target from it).
      await page.evaluate(() => window.__t.frames(4))
      const shift = (await page.evaluate(() => Math.round(scrollY))) - before.scrollY
      await page.evaluate((y) => window.__t.toScroll(y), before.scrollY)
      const again = await state(page)
      await page.evaluate(() => window.__t.destroy())
      await page.evaluate(() => window.__t.frames(3))
      const left2 = await page.evaluate(() => window.__t.leftovers())
      const clean = (l) =>
        l.styled.length === 0 &&
        l.emptyStyle.length === 0 &&
        l.state === null &&
        l.pinAttr === '' &&
        l.tabindex === null &&
        l.pinSpacers === 0 &&
        l.pinParent
      return [
        [
          'destroy() leaves no inline styles (not even an empty style attribute), state or pin-spacer, and a second destroy() is a no-op',
          clean(left) && clean(left2) && twice === 'ok',
          `${JSON.stringify(left)} · second destroy: ${twice} · after re-create + destroy: ${JSON.stringify(left2)}`
        ],
        [
          'created again on the same page (hide and show): the same scroll gives the same translate',
          near(again.translate, before.translate) && near(again.travel, before.travel) && near(again.spacer, again.travel),
          `before ${before.translate} (band ${before.band}) · again ${again.translate} (band ${again.band})` +
            (shift ? ` · the browser moved the page ${shift} px as the runway returned` : '')
        ]
      ]
    }
  }
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
          tab: browserName === 'webkit' ? 'Alt+Tab' : 'Tab',
          /** A fresh context on this page, the rail built and its first translate written (or none, reduced). */
          async open({ reducedMotion = 'no-preference' } = {}) {
            const context = await open.browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion })
            contexts.push(context)
            const page = await context.newPage()
            page.on('pageerror', (err) => errors.push(`${id}: ${err.message.split('\n')[0]}`))
            page.on('console', (msg) => msg.type() === 'error' && errors.push(`${id}: console: ${msg.text().split('\n')[0]}`))
            await page.goto(`${base}/${pageName}.html`, { waitUntil: 'load' })
            await page.waitForFunction(() => !!window.__rail && !!document.querySelector('[data-scene-root]')?.dataset.sceneState)
            await page.evaluate(() => document.fonts.ready.then(() => window.__t.frames(3)))
            if (reducedMotion !== 'reduce') await page.waitForFunction(() => window.__t.state().inline !== '')
            // Let the load-time refreshes (ScrollTrigger's own, ScrollSmoother's) finish before measuring.
            await page.waitForTimeout(400)
            return { page }
          }
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
console.log(failures ? `\n${failures} check(s) failed` : '\nall rail checks passed')
process.exit(failures ? 1 : 0)
