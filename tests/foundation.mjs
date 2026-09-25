#!/usr/bin/env node
// foundation.mjs — the v2 foundation in real browsers (config's gate, css/animation.css, gsap/setup,
// motion/MotionProvider, smooth/*), in Chromium and WebKit. Builds the fixture pages in
// tests/foundation with Vite, serves the build with `vite preview`, prints one PASS/FAIL line per
// check and browser, and exits 1 on any FAIL. Needs the Playwright browsers, so `npm test` leaves
// it out: `npm run test:foundation`.
//
//   node tests/foundation.mjs [--browsers chromium,webkit] [--only gsap-driver,gate,…]
//
// Groups (each opens fresh browser contexts, and each ends with a check for uncaught page errors):
//   gsap-driver    Lenis on gsapDriver with a `scrub: true` tween: ScrollTrigger's progress and the
//                  tween trail scrollTop by 0 frames (S4a's recorder and lag count, wheel input);
//                  destroy() restores lagSmoothing and removes its ticker listener
//   motion-driver  Lenis on motionDriver: a hand-written useScroll() value trails by 0 frames (S4b)
//   authority      <html data-scroll-authority>: set and cleared by createSmoothScroll, `native`
//                  under reduced motion (at load and live, on the same handle), a warning for a second
//                  live handle, SmoothScroll switching lenis -> native by prop leaves one stamp and no
//                  Lenis, and a modal's stop() survives both switches
//   smoother       createSmoother: ScrollSmoother's native mode under reduced motion (at load and
//                  live) with the triggers still tracking, no replay from the top when it is created
//                  on a scrolled page, grown content refreshes every trigger, stop() survives switches
//   anchors        a same-page #target link under Lenis lands the target at --header-h, pushes the hash
//   gate           the pre-JS gate and the failsafe latch: JavaScript off; no engine (the failsafe
//                  fires at 4 s); a late engine after it (the latch holds); an engine at 1 s (it never fires)
//   print          a pinned scene prints in flow, entrance items print visible
//
// GATE_SCRIPT comes from assets/config.ts itself (Node strips its types), injected into the gate
// and print pages at build time, so the checks run the string projects ship.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, webkit } from 'playwright'
import { build, preview } from 'vite'

const testsDir = dirname(fileURLToPath(import.meta.url))
const fixtures = join(testsDir, 'foundation')
const outDir = join(testsDir, '.scratch', 'foundation-dist')
const { GATE_SCRIPT } = await import('../skills/scroll-animation/assets/config.ts')

const ENGINES = { chromium, webkit }
const PAGES = ['gsap-driver', 'motion-driver', 'authority', 'smoother', 'anchors', 'gate', 'print']
const VIEWPORT = { width: 1000, height: 600 }
// A lag verdict needs at least this many moving frames inside the measured range (one wheel pass
// gives 130–180 here; S4 counted 565–699 over three passes).
const MIN_MOVING = 60

// ── args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { browsers: Object.keys(ENGINES), only: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--browsers') out.browsers = argv[++i].split(',')
    else if (a === '--only') out.only = argv[++i].split(',')
    else throw new Error(`unknown argument: ${a}`)
  }
  for (const b of out.browsers) if (!ENGINES[b]) throw new Error(`unknown browser: ${b}`)
  for (const g of out.only ?? []) if (!GROUPS[g]) throw new Error(`unknown group: ${g} (${Object.keys(GROUPS).join(', ')})`)
  return out
}

// ── shared helpers ──────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const ms = (s) => `${Math.round(s * 1000)} ms`

/** A mouse-wheel gesture: `steps` notches of `delta` px, `gap` ms apart (the S4 input). */
async function wheel(page, { steps, delta, gap = 40 }) {
  await page.mouse.move(300, 300)
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, delta)
    await sleep(gap)
  }
}

/** One recorded pass from the top: 14 notches down, 7 back up. Rows are end-of-frame samples. */
async function recordWheelPass(page) {
  await page.evaluate(() => {
    window.__fx.handle.scrollTo(0, { immediate: true })
    window.scrollTo(0, 0)
  })
  await sleep(600)
  await page.evaluate(() => window.__fx.rec.start())
  await wheel(page, { steps: 14, delta: 100 })
  await sleep(1400)
  await wheel(page, { steps: 7, delta: -100 })
  await sleep(1400)
  return page.evaluate(() => window.__fx.rec.stop())
}

const moving = (rows, n) => Math.abs(rows[n].y - rows[n - 1].y) > 0.5

/** S4's lag: the k whose f(scrollTop k frames earlier) best explains `value`, if within `tol`. */
function lagOf(rows, n, value, f, tol, maxK = 4) {
  let best = 'none'
  let bestErr = Infinity
  for (let k = 0; k <= Math.min(maxK, n); k++) {
    const e = Math.abs(value - f(rows[n - k].y))
    if (e < bestErr - 1e-9) {
      bestErr = e
      best = k
    }
  }
  return bestErr <= tol ? best : 'none'
}

function lagVerdict(lags) {
  const hist = lags.reduce((h, k) => ((h[k] = (h[k] ?? 0) + 1), h), {})
  const zero = hist[0] ?? 0
  const ok = lags.length >= MIN_MOVING && zero === lags.length
  const others = Object.entries(hist).filter(([k]) => k !== '0')
  const detail =
    `0 frames late in ${zero}/${lags.length} moving frames` +
    (others.length ? ` (${others.map(([k, n]) => `${k === 'none' ? 'no match' : `${k} late`}: ${n}`).join(', ')})` : '') +
    (lags.length < MIN_MOVING ? `; fewer than ${MIN_MOVING} moving frames` : '')
  return [ok, detail]
}

const untilPageTime = (page, t) => page.waitForFunction((at) => performance.now() >= at, t, { timeout: t + 15000 })
const frames = (page, n) =>
  page.evaluate(
    (count) =>
      new Promise((resolve) => {
        let left = count
        const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step))
        requestAnimationFrame(step)
      }),
    n,
  )

// ── groups ──────────────────────────────────────────────────────────────

const GROUPS = {
  async 'gsap-driver'(t) {
    const { page } = await t.open('gsap-driver.html')
    await page.waitForFunction(() => window.__fx)
    await sleep(500)
    const info = await page.evaluate(() => window.__fx.info())
    const rows = await recordWheelPass(page)

    const span = info.end - info.start
    const pe = (y) => Math.min(1, Math.max(0, (y - info.start) / span))
    const stLags = []
    const tweenLags = []
    for (let n = 1; n < rows.length; n++) {
      const r = rows[n]
      const p = pe(r.y)
      if (!moving(rows, n) || p <= 0 || p >= 1) continue
      stLags.push(lagOf(rows, n, r.stP * span, (y) => pe(y) * span, 1.01))
      tweenLags.push(lagOf(rows, n, (r.x / 400) * span, (y) => pe(y) * span, 1.01))
    }
    t.check('ScrollTrigger progress is 0 frames behind scrollTop', () => lagVerdict(stLags))
    t.check('the scrub: true tween is 0 frames behind scrollTop', () => lagVerdict(tweenLags))

    const live = await page.evaluate(() => window.__fx.tickerJump(800))
    const listenersLive = await page.evaluate(() => window.__fx.listeners())
    await page.evaluate(() => window.__fx.handle.destroy())
    const after = await page.evaluate(() => window.__fx.tickerJump(800))
    const listenersAfter = await page.evaluate(() => window.__fx.listeners())
    t.check('lagSmoothing is 0 while live and restored by destroy()', () => [
      live >= 0.6 && after <= 0.1,
      `ticker clock across an 800 ms stall: ${ms(live)} while live, ${ms(after)} after destroy()`,
    ])
    t.check('destroy() removes the ticker listener', () => [
      listenersLive.added === 1 && listenersLive.stillThere === 1 && listenersAfter.stillThere === 0 && listenersAfter.now === listenersAfter.before,
      `driver listeners: ${listenersLive.stillThere} while live, ${listenersAfter.stillThere} after destroy(); ticker listeners ${listenersAfter.before} before create, ${listenersAfter.now} after destroy()`,
    ])
  },

  async 'motion-driver'(t) {
    const { page } = await t.open('motion-driver.html')
    await page.waitForFunction(() => window.__fx && document.getElementById('raw'))
    await sleep(500)
    const rows = await recordWheelPass(page)
    const lags = []
    for (let n = 1; n < rows.length; n++) {
      if (!moving(rows, n) || rows[n].raw == null) continue
      lags.push(lagOf(rows, n, rows[n].raw, (y) => y, 0.51))
    }
    t.check('a hand-written useScroll() value is 0 frames behind scrollTop', () => lagVerdict(lags))
  },

  async authority(t) {
    const state = (page) => page.evaluate(() => window.__fx.state())
    const show = (s) => `stamp=${s.stamp} on [${s.stamped}] html.lenis=${s.lenisClass} live Lenis=${s.lenis} handle=${s.current}`
    // One stamp, on <html>, and the Lenis count that goes with it.
    const only = (s, stamp) =>
      s.stamp === stamp && s.stamped.length === 1 && s.stamped[0] === 'html' && s.current === stamp &&
      s.lenisClass === (stamp === 'lenis') && s.lenis === (stamp === 'lenis' ? 1 : 0)
    const none = (s) => s.stamp === null && s.stamped.length === 0 && !s.lenisClass && s.lenis === 0 && s.current === null

    {
      const { page } = await t.open('authority.html')
      const i = await page.evaluate(() => window.__fx.create())
      const live = await state(page)
      await page.evaluate((n) => window.__fx.destroy(n), i)
      const after = await state(page)
      t.check('createSmoothScroll stamps lenis; destroy() removes the stamp', () => [
        only(live, 'lenis') && none(after),
        `live: ${show(live)} · after destroy(): ${show(after)}`,
      ])
    }

    {
      const { page } = await t.open('authority.html', { reducedMotion: 'reduce' })
      const i = await page.evaluate(() => window.__fx.create())
      const authority = await page.evaluate((n) => window.__fx.authorityOf(n), i)
      const live = await state(page)
      await page.evaluate((n) => window.__fx.destroy(n), i)
      const after = await state(page)
      t.check('under reduced motion it returns a native handle and stamps native', () => [
        authority === 'native' && only(live, 'native') && none(after),
        `handle.authority=${authority} · live: ${show(live)} · after destroy(): ${show(after)}`,
      ])
    }

    {
      const { page } = await t.open('authority.html')
      const a = await page.evaluate(() => window.__fx.create())
      const before = await page.evaluate(() => window.__fx.warnings.length)
      const b = await page.evaluate(() => window.__fx.create())
      const warnings = await page.evaluate(() => window.__fx.warnings)
      await page.evaluate(([x, y]) => (window.__fx.destroy(y), window.__fx.destroy(x)), [a, b])
      const hit = warnings.slice(before).find((w) => w.includes('one scroll authority per page'))
      t.check('a second handle while one is live warns "one scroll authority per page"', () => [
        before === 0 && !!hit,
        hit ? `warned: ${hit}` : `warnings: ${JSON.stringify(warnings)}`,
      ])
    }

    {
      const { page } = await t.open('authority.html')
      await page.evaluate(() => window.__fx.mount('lenis'))
      const lenis = await state(page)
      await page.evaluate(() => window.__fx.set('native'))
      const native = await state(page)
      await page.evaluate(() => window.__fx.set('lenis'))
      const back = await state(page)
      await page.evaluate(() => window.__fx.unmount())
      const gone = await state(page)
      const warnings = await page.evaluate(() => window.__fx.warnings)
      t.check('SmoothScroll lenis -> native by prop: one native stamp, no live Lenis (and back)', () => [
        only(lenis, 'lenis') && only(native, 'native') && only(back, 'lenis') && none(gone) && warnings.length === 0,
        `lenis: ${show(lenis)} · native: ${show(native)} · back: ${show(back)} · unmounted: ${show(gone)}` +
          (warnings.length ? ` · warnings: ${JSON.stringify(warnings)}` : ''),
      ])
    }

    {
      const { page } = await t.open('authority.html')
      const i = await page.evaluate(() => window.__fx.create())
      const lenis = await state(page)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await sleep(100)
      const reduced = await state(page)
      const same = await page.evaluate((n) => window.__fx.isCurrent(n), i)
      await page.evaluate((n) => window.__fx.scrollTo(n, 900), i)
      await sleep(50)
      const jumped = await page.evaluate(() => Math.round(window.scrollY))
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await sleep(100)
      const back = await state(page)
      const y = await page.evaluate(() => Math.round(window.scrollY))
      await page.evaluate((n) => window.__fx.destroy(n), i)
      const after = await state(page)
      t.check('reduced motion on mid-visit: Lenis goes, native stamp, same handle; off again: Lenis back at the same place', () => [
        only(lenis, 'lenis') && only(reduced, 'native') && same && only(back, 'lenis') && y === 900 && none(after),
        `lenis: ${show(lenis)} · reduce on: ${show(reduced)}${same ? '' : ' (not the same live handle)'} · off: ` +
          `${show(back)} at scrollY ${y} · destroyed: ${show(after)}`,
      ])
      t.check("under reduced motion the handle's scrollTo jumps", () => [
        jumped === 900,
        `scrollY 50 ms after scrollTo(900): ${jumped}`,
      ])
    }

    {
      const { page } = await t.open('authority.html')
      const i = await page.evaluate(() => window.__fx.create())
      await page.evaluate((n) => window.__fx.stop(n), i)
      const locked = []
      for (const reducedMotion of ['reduce', 'no-preference']) {
        await page.emulateMedia({ reducedMotion })
        await sleep(100)
        locked.push((await state(page)).locked)
      }
      await page.evaluate((n) => window.__fx.start(n), i)
      const started = (await state(page)).locked
      // A handle destroyed while stopped must not leave the page locked (native, then Lenis).
      await page.evaluate((n) => window.__fx.destroy(n), i)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const j = await page.evaluate(() => window.__fx.create())
      await page.evaluate((n) => (window.__fx.stop(n), window.__fx.destroy(n)), j)
      const nativeLeft = (await state(page)).locked
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      const k = await page.evaluate(() => window.__fx.create())
      await page.evaluate((n) => (window.__fx.stop(n), window.__fx.destroy(n)), k)
      const lenisLeft = (await state(page)).locked
      t.check("a modal's stop() holds across both switches; start() or destroy() releases it", () => [
        locked.every(Boolean) && !started && !nativeLeft && !lenisLeft,
        `locked after reduce on / off: ${locked.join(' / ')}; after start(): ${started}; ` +
          `after destroy() while stopped, native: ${nativeLeft}, Lenis: ${lenisLeft}`,
      ])
    }
  },

  async smoother(t) {
    const state = (page) => page.evaluate(() => window.__fx.state())
    const show = (s) =>
      `stamp=${s.stamp} wrapper ${s.wrapperFixed ? 'fixed' : 'in flow'} smooth=${s.smooth} effects=${s.effects} ` +
      `speedY=${s.speedY} scrollY=${s.scrollY} contentTop=${s.contentTop} progress=${s.progress}`
    // Smoothed mode catches up over about a second; wait until the content is drawn at the scroll position.
    const settle = (page, y) =>
      page.waitForFunction((y) => Math.abs(document.getElementById('smooth-content').getBoundingClientRect().top + y) < 1, y)

    {
      const { page } = await t.open('smoother.html')
      await page.evaluate(() => window.__fx.create())
      await page.evaluate(() => window.__fx.scrollTo(1500))
      await settle(page, 1500)
      const smooth = await state(page)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await sleep(100)
      const reduced = await state(page)
      await page.evaluate(() => window.scrollTo(0, 2100))
      await sleep(100)
      const scrolled = await state(page)
      await page.evaluate(() => window.__fx.scrollTo(900, false))
      await sleep(50)
      const jumped = await state(page)
      t.check('reduced motion on mid-visit: native mode (wrapper in flow, no effects), the reader stays, triggers track', () => [
        smooth.stamp === 'smoother' && smooth.wrapperFixed && smooth.effects === 1 && smooth.progress === 0.5 &&
          reduced.stamp === 'smoother' && !reduced.wrapperFixed && reduced.effects === 0 && reduced.speedY === 0 &&
          reduced.scrollY === 1500 && reduced.contentTop === -1500 &&
          scrolled.contentTop === -2100 && scrolled.progress === 0.75,
        `smoothed: ${show(smooth)} · reduce on: ${show(reduced)} · native scroll to 2100: ${show(scrolled)}`,
      ])
      t.check("under reduced motion the handle's scrollTo jumps", () => [
        jumped.scrollY === 900,
        `scrollY 50 ms after scrollTo(900): ${jumped.scrollY}`,
      ])

      await page.emulateMedia({ reducedMotion: 'no-preference' })
      const drift = await page.evaluate(() => window.__fx.drift(45))
      const back = await state(page)
      t.check('reduced motion off again: smoothed from where the reader is, no replay from the top', () => [
        drift <= 2 && back.wrapperFixed && back.effects === 1 && back.scrollY === 900,
        `farthest the content was drawn from the scroll position over 45 frames: ${drift} px · ${show(back)}`,
      ])

      await page.evaluate(() => window.__fx.grow(500))
      await sleep(600)
      const grown = await state(page)
      // #track now spans 1400–3200 px: at scrollY 900 the trigger (start 'top bottom' = 800) reads 100 / 2400.
      t.check('content that grows refreshes every trigger, not only the smoother', () => [
        Math.abs(grown.progress - 0.042) < 0.002 && grown.bodyHeight === '4700px',
        `progress ${grown.progress} (0.042 expected) · body height ${grown.bodyHeight} (4700px expected)`,
      ])

      await page.evaluate(() => window.__fx.destroy())
      const gone = await state(page)
      t.check('destroy() kills the smoother and removes the stamp', () => [
        gone.stamp === null && !gone.smoother && !gone.wrapperFixed,
        show(gone),
      ])
    }

    {
      // The page is already scrolled and at rest when the smoother starts (a reload mid-page, a late mount). Under
      // GSAP 3.15's own autoResize this replays the scroll from the top ~0.2 s after creation.
      const { page } = await t.open('smoother.html')
      await page.evaluate(() => window.scrollTo(0, 1500))
      await sleep(300)
      await page.evaluate(() => window.__fx.create())
      const drift = await page.evaluate(() => window.__fx.drift(45))
      t.check('created on a page already scrolled: holds the position, no replay from the top', () => [
        drift <= 2,
        `farthest the content was drawn from the scroll position over 45 frames: ${drift} px`,
      ])
    }

    {
      const { page } = await t.open('smoother.html', { reducedMotion: 'reduce' })
      await page.evaluate(() => window.__fx.create())
      await page.evaluate(() => window.scrollTo(0, 1500))
      await sleep(100)
      const s = await state(page)
      t.check('reduced motion at load: native mode, triggers track', () => [
        s.stamp === 'smoother' && !s.wrapperFixed && s.effects === 0 && s.speedY === 0 && s.contentTop === -1500 &&
          s.progress === 0.5,
        show(s),
      ])
    }

    {
      const { page } = await t.open('smoother.html')
      await page.evaluate(() => window.__fx.create())
      await page.evaluate(() => window.__fx.stop())
      await page.mouse.move(500, 300)
      const wheel = async (ms) => {
        const y0 = await page.evaluate(() => window.scrollY)
        await page.mouse.wheel(0, 400)
        await sleep(ms)
        return Math.round((await page.evaluate(() => window.scrollY)) - y0)
      }
      const moved = []
      for (const reducedMotion of ['reduce', 'no-preference']) {
        await page.emulateMedia({ reducedMotion })
        await sleep(100)
        moved.push(await wheel(500))
      }
      await page.evaluate(() => window.__fx.start())
      const released = await wheel(500)
      t.check("a modal's stop() holds across both switches; start() releases it", () => [
        moved.every((d) => d === 0) && released > 0,
        `wheel while stopped moved ${moved.join(' / ')} px (reduce on / off) · after start(): ${released} px`,
      ])
    }
  },

  async anchors(t) {
    const { page } = await t.open('anchors.html')
    await page.waitForFunction(() => window.__fx && document.documentElement.dataset.scrollAuthority === 'lenis')
    const headerH = await page.evaluate(() => window.__fx.headerHeight())
    const historyBefore = await page.evaluate(() => history.length)
    await page.evaluate(() => {
      const trail = (window.__trail = [])
      const loop = () => {
        trail.push(window.scrollY)
        requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
    })
    await page.click('#link')
    // settled: scrollY off the top and unchanged for 30 frames (if it never moves, the checks say so)
    await page
      .waitForFunction(
        () => {
          const tail = window.__trail.slice(-30)
          return tail.length === 30 && tail[0] > 0 && tail.every((y) => y === tail[0])
        },
        null,
        { timeout: 10000 },
      )
      .catch(() => {})
    const r = await page.evaluate(() => ({
      top: document.getElementById('target').getBoundingClientRect().top,
      hash: location.hash,
      historyLength: history.length,
      steps: new Set(window.__trail).size - 1,
    }))
    t.check('a #target link under Lenis lands the target at --header-h (±2 px)', () => [
      Math.abs(r.top - headerH) <= 2 && r.steps > 1,
      `target top ${r.top.toFixed(1)} px, --header-h ${headerH} px; Lenis moved it over ${r.steps} frames`,
    ])
    t.check('the link pushes its hash', () => [
      r.hash === '#target' && r.historyLength === historyBefore + 1,
      `location.hash=${r.hash || '(none)'}, history.length ${historyBefore} -> ${r.historyLength}`,
    ])
  },

  async gate(t) {
    const read = (page) =>
      page.evaluate(() => {
        const html = document.documentElement
        const item = (id) => {
          const el = document.getElementById(id)
          const cs = getComputedStyle(el)
          return { opacity: cs.opacity, transform: cs.transform, animations: el.getAnimations().length }
        }
        const failsafe = document.getElementById('gated').getAnimations()[0]
        return {
          t: Math.round(performance.now()),
          gate: html.dataset.animation ?? null,
          ready: 'animationReady' in html.dataset,
          failsafe: 'animationFailsafe' in html.dataset,
          items: [item('gated'), item('inline')],
          events: window.__fx?.failsafeEvents ?? null,
          // when the failsafe animation (0s, 4s delay) began, on the page's clock
          started: failsafe && failsafe.startTime !== null ? Math.round(failsafe.startTime) : null,
        }
      })
    const visible = (s) => s.items.every((i) => i.opacity === '1' && i.transform === 'none')
    const hidden = (s) => s.items.every((i) => i.opacity === '0')
    const show = (s) =>
      `t=${s.t} ms gate=${s.gate} ready=${s.ready} failsafe=${s.failsafe} opacity=${s.items.map((i) => i.opacity).join('/')}` +
      ` transform=${s.items.map((i) => i.transform).join('/')}`

    {
      const { page } = await t.open('gate.html', { javaScriptEnabled: false })
      const s = await read(page)
      t.check('(a) JavaScript off: no gate, entrance items visible', () => [s.gate === null && visible(s), show(s)])
    }

    {
      const { page } = await t.open('gate.html')
      await untilPageTime(page, 3500)
      const early = await read(page)
      // 4.1 s on the failsafe's own clock, which starts with the page's first style pass, so a slow
      // first paint on a loaded CI runner can't eat the margin.
      await untilPageTime(page, (early.started ?? 0) + 4100)
      const fired = await read(page)
      t.check('(b) no engine: hidden until 4 s, then revealed and html[data-animation-failsafe] latched by ~4.1 s', () => [
        early.gate === 'on' && hidden(early) && !early.failsafe && early.started !== null && early.started < 1000 &&
          visible(fired) && fired.failsafe,
        `${show(early)} · ${show(fired)} · failsafe began at ${early.started} ms, animationend at ` +
          `${fired.events.map((e) => Math.round(e.t)).join('/')} ms`,
      ])
      await page.evaluate(() => window.__fx.markAnimationReady())
      await frames(page, 3)
      const late = await read(page)
      t.check('(c) markAnimationReady() after the failsafe: items stay visible (latched)', () => [
        late.ready && late.failsafe && visible(late) && late.items.every((i) => i.animations === 0),
        `${show(late)} animations=${late.items.map((i) => i.animations).join('/')}`,
      ])
    }

    {
      const { page } = await t.open('gate.html?ready=1000')
      await untilPageTime(page, 4500)
      const s = await read(page)
      t.check('(d) engine ready at 1 s: the failsafe never fires', () => [
        s.ready && !s.failsafe && hidden(s) && s.events.length === 0,
        `${show(s)} failsafe animationend events=${s.events.length}`,
      ])
    }
  },

  async print(t) {
    const { page } = await t.open('print.html')
    await page.waitForFunction(() => 'animationReady' in document.documentElement.dataset)
    const read = () =>
      page.evaluate(() => {
        const cs = (el) => getComputedStyle(el)
        return {
          pin: cs(document.querySelector('[data-scene-pin]')).position,
          items: [...document.querySelectorAll('[data-reveal-item]')].map((el) => ({ opacity: cs(el).opacity, transform: cs(el).transform })),
        }
      })
    const screen = await read()
    await page.emulateMedia({ media: 'print' })
    const printed = await read()
    const show = (s) => `pin ${s.pin}, items opacity ${s.items.map((i) => i.opacity).join('/')}`
    t.check('print: [data-scene-pin] is position: static and entrance items are visible', () => [
      screen.pin === 'sticky' && screen.items.every((i) => i.opacity === '0') &&
        printed.pin === 'static' && printed.items.every((i) => i.opacity === '1' && i.transform === 'none'),
      `screen: ${show(screen)} · print: ${show(printed)}`,
    ])
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

function onwarn(warning, warn) {
  // Motion and the React blocks open with 'use client', meaningless outside a server-components bundler.
  if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
  if (warning.code === 'SOURCEMAP_ERROR' && /\.tsx? \(1:0\)/.test(warning.message)) return
  warn(warning)
}

async function serve() {
  await build({
    root: fixtures,
    configFile: false,
    logLevel: 'warn',
    publicDir: false,
    esbuild: { jsx: 'automatic' },
    plugins: [
      {
        name: 'gate-script',
        transformIndexHtml: {
          order: 'pre',
          handler: (html) => html.replace('<!--gate-script-->', `<script>${GATE_SCRIPT}</script>`),
        },
      },
    ],
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      rollupOptions: { input: Object.fromEntries(PAGES.map((p) => [p, join(fixtures, `${p}.html`)])), onwarn },
    },
  })
  const server = await preview({
    root: fixtures,
    configFile: false,
    logLevel: 'warn',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0, strictPort: false },
  })
  return server
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const groups = args.only ?? Object.keys(GROUPS)
  open.server = await serve()
  const base = `http://127.0.0.1:${open.server.httpServer.address().port}`

  let failures = 0
  const line = (ok, browser, group, name, detail) => {
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${browser.padEnd(8)}  ${group.padEnd(13)}  ${name}${detail ? `  (${detail})` : ''}`)
  }

  for (const name of args.browsers) {
    open.browser = await ENGINES[name].launch()
    for (const group of groups) {
      const contexts = []
      const errors = []
      const t = {
        async open(path, options = {}) {
          const context = await open.browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: 'no-preference', ...options })
          contexts.push(context)
          const page = await context.newPage()
          page.on('pageerror', (e) => errors.push(`${path}: ${e.message}`))
          await page.goto(`${base}/${path}`, { waitUntil: 'load' })
          return { page }
        },
        check(checkName, verdict) {
          let ok = false
          let detail
          try {
            ;[ok, detail] = verdict()
          } catch (err) {
            detail = err.message
          }
          line(ok, name, group, checkName, detail)
        },
      }
      try {
        await GROUPS[group](t)
      } catch (err) {
        line(false, name, group, 'ran to completion', err.message.split('\n')[0])
      } finally {
        for (const context of contexts) await context.close().catch(() => {})
      }
      const unique = [...new Set(errors)]
      line(unique.length === 0, name, group, 'no uncaught errors in the page', unique.length ? `${errors.length}x: ${unique.slice(0, 3).join(' | ')}` : '')
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
console.log(failures ? `\n${failures} check(s) failed` : '\nall foundation checks passed')
process.exit(failures ? 1 : 0)
