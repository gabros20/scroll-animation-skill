// harness.mjs: the browser suites' shared library. One cause sits behind the suites' flakes: two readings taken at
// different times, with a fixed sleep between them. Everything here waits on a condition instead, read in the page
// once per animation frame, and returns the reading it settled on, so an assertion never straddles frames.
//
//   launch(type, options)          a Playwright browser; HARNESS_CHROME runs Chromium on an installed Chrome
//   isFaviconMiss(msg)             the one console error a branded Chrome adds: its own /favicon.ico request, a 404
//   frames(page, n)                n animation frames in the page
//   until(page, fn, arg, opts)     fn(arg) in the page once per frame until truthy: elapsed ms, or null on timeout
//   settle(page, read, opts)       read(arg) in the page once per frame until unchanged for `frames` frames in a row
//                                  (with `when`: only once the expected change has begun)
//   snapshot(page, fn, arg)        the scroll position, the page's clock and fn(arg) from ONE evaluate
//   scrollToProgress(page, root, p, opts)  scroll a range wrapper to progress p, then wait for the scroll to end
//   clock: installClock, pauseClock, seekAnimations: time as a subject (Playwright's clock; WAAPI/CSS animations)
//   hold(ms)                       a fixed wait; the lint rule allows it only under a `fixed-wait: <reason>` comment
//
// Browser choice: HARNESS_CHROME is a Chromium channel (`chrome`, `chrome-beta`, `msedge`) or an executable's path,
// for a machine without Playwright's own browsers:
//   HARNESS_CHROME=chrome npm run test:rail -- --browsers chromium
//   HARNESS_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     npm run test:rail -- --browsers chromium
// Unset, every suite launches Playwright's bundled browsers, as CI does.

/** The launch options HARNESS_CHROME adds for a Chromium launch (none for WebKit and Firefox, or when it is unset). */
export function chromeOptions(type, env = process.env) {
  const chrome = env.HARNESS_CHROME?.trim()
  if (!chrome || type.name() !== 'chromium') return {}
  return chrome.includes('/') || chrome.includes('\\') ? { executablePath: chrome } : { channel: chrome }
}

/** Launches `type` (Playwright's chromium, webkit or firefox) with HARNESS_CHROME applied to Chromium. */
export function launch(type, options = {}) {
  return type.launch({ ...chromeOptions(type), ...options })
}

/**
 * True for the one console error a branded Chrome adds that Playwright's bundled Chromium does not: the browser's
 * own request for /favicon.ico, answered 404 by a fixture server that has none. Matched by its URL path and its exact
 * text, so every other 404 (a missing fixture asset) still fails a suite's "no console errors" check.
 */
export function isFaviconMiss(msg) {
  if (msg.type() !== 'error') return false
  if (!msg.text().startsWith('Failed to load resource: the server responded with a status of 404')) return false
  try {
    return new URL(msg.location().url).pathname === '/favicon.ico'
  } catch {
    return false
  }
}

/**
 * A fixed wait. Only for what is about time itself (an observation window that must see nothing happen, a browser's
 * own timer the page cannot observe, input paced like a hand). The lint rule (tests/lib/eslint-no-fixed-wait.mjs)
 * reports every call that has no `fixed-wait: <reason>` comment on its line or the line above.
 */
export function hold(ms) {
  // fixed-wait: this is the one implementation every annotated call goes through
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Waits `n` animation frames in the page. */
export function frames(page, n = 1) {
  return page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve))
  }, n)
}

/** Polls `fn(arg)` in the page once per animation frame until it returns truthy. Resolves with the elapsed ms, or
 * null on timeout (never throws on a timeout, so a check can report what it saw instead). */
export async function until(page, fn, arg, { timeout = 5000 } = {}) {
  const t0 = Date.now()
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 'raf' })
    return Date.now() - t0
  } catch (err) {
    if (/Timeout|timeout/.test(err.message)) return null
    throw err
  }
}

/**
 * Reads `read(arg)` in the page once per animation frame until its value (compared as JSON) is unchanged for `frames`
 * frames in a row. Resolves with `{ value, ms, settled }`: the reading it settled on (or the last one, with
 * `settled: false`, after `timeout` ms). `read` runs in the page, so it may only use `arg` and the page's globals
 * (an arrow or function expression, not a method). A settle can't tell "not changed yet" from "done": after an action
 * whose effect lands a few frames late (a media query change, a debounced refresh), pass `when`, a page function of
 * the reading that is true once the effect has begun; the run only counts from there. `min` frames are read before
 * the run counts at all. `fromNode: true` polls from Node every ~16 ms instead (a frame's worth, `frames` reads in a
 * row), for a page whose requestAnimationFrame is itself under test: the in-page poll would add to its count.
 */
export function settle(page, read, { arg, frames: still = 3, timeout = 5000, min = 0, when, fromNode = false } = {}) {
  if (fromNode) return settleFromNode(page, read, { arg, still, timeout, min, when })
  const src = `(async ([arg, still, timeout, min]) => {
    const read = ${read.toString()}
    const when = ${when ? when.toString() : '() => true'}
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
    const t0 = performance.now()
    let last = JSON.stringify(await read(arg))
    let run = 0
    let seen = 0
    while (performance.now() - t0 < timeout) {
      await frame()
      const value = await read(arg)
      const now = JSON.stringify(value)
      seen++
      run = now === last && when(value, arg) ? run + 1 : 0
      last = now
      if (run >= still && seen >= min) return { value, ms: Math.round(performance.now() - t0), settled: true }
    }
    return { value: last === undefined ? undefined : JSON.parse(last), ms: Math.round(performance.now() - t0), settled: false }
  })(${JSON.stringify([arg ?? null, still, timeout, min])})`
  // A string expression, not a function: `read` arrives as source, so the page's CSP (no eval) never applies.
  return page.evaluate(src)
}

async function settleFromNode(page, read, { arg, still, timeout, min, when }) {
  const expr = (fn) => `(${fn.toString()})(...${JSON.stringify([arg ?? null])})`
  const readOnce = () => page.evaluate(expr(read))
  const t0 = Date.now()
  let value = await readOnce()
  let last = JSON.stringify(value)
  let run = 0
  let seen = 0
  while (Date.now() - t0 < timeout) {
    // fixed-wait: the poll interval of a condition loop (one frame's worth), not a guess
    await hold(16)
    value = await readOnce()
    const now = JSON.stringify(value)
    seen++
    run = now === last && (!when || when(value, arg)) ? run + 1 : 0
    last = now
    if (run >= still && seen >= min) return { value, ms: Date.now() - t0, settled: true }
  }
  return { value, ms: Date.now() - t0, settled: false }
}

/** One `page.evaluate` returning the scroll position, the page's clock and `fn(arg)`: a reading that never
 * straddles two frames. */
export function snapshot(page, fn, arg) {
  const src = `(async (arg) => {
    const fn = ${fn.toString()}
    return { scrollX, scrollY, t: performance.now(), value: await fn(arg) }
  })(${JSON.stringify(arg ?? null)})`
  return page.evaluate(src)
}

/**
 * Scrolls a range wrapper (`root`, a selector) to progress `p` and waits for the scroll to end: `scrollend`, or the
 * position unchanged for 3 frames where scrollend never fires (a smoother, an engine without it). The range is the
 * scene's: the wrapper's height less the ruler, its [data-scene-pin]'s box when it has one, else the viewport.
 * `via` scrolls through the page's authority (Lenis, ScrollSmoother): a page function of the target y.
 * Resolves with `{ y, ms, ended }`.
 */
export function scrollToProgress(page, root, p, { via, timeout = 5000 } = {}) {
  const scroll = via ? via.toString() : '(y) => window.scrollTo({ top: y, behavior: "instant" })'
  const src = `(async ([root, p, timeout]) => {
    const scroll = ${scroll}
    const el = document.querySelector(root)
    if (!el) throw new Error('scrollToProgress: no element matches ' + root)
    const pin = el.querySelector('[data-scene-pin]')
    const ruler = pin ? pin.getBoundingClientRect().height : innerHeight
    const top = el.getBoundingClientRect().top + scrollY
    const y = Math.round(top + p * Math.max(0, el.getBoundingClientRect().height - ruler))
    const t0 = performance.now()
    let ended = false
    const onEnd = () => (ended = true)
    addEventListener('scrollend', onEnd, { once: true })
    await scroll(y)
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
    let last = scrollY
    let still = 0
    while (!ended && still < 3 && performance.now() - t0 < timeout) {
      await frame()
      still = scrollY === last ? still + 1 : 0
      last = scrollY
    }
    removeEventListener('scrollend', onEnd)
    return { y, ms: Math.round(performance.now() - t0), ended }
  })(${JSON.stringify([root, p, timeout])})`
  return page.evaluate(src)
}

// ── time as the subject ─────────────────────────────────────────────────
// Playwright's clock (1.63: install, pauseAt, runFor, fastForward, resume) fakes Date, performance, the timers and
// requestAnimationFrame. Install it BEFORE navigation; time flows until paused. CSS animations and WAAPI run on the
// document timeline, which the clock does not touch: seekAnimations sets their currentTime instead. Media stays on
// real time.

/** Installs Playwright's clock on a page (or a context) before it navigates; time keeps flowing until paused. */
export function installClock(target, options = {}) {
  return target.clock.install(options)
}

/**
 * Pauses the installed clock `lead` ms ahead of the page's now: pauseAt can't go back, and time flows while the call
 * travels, so it aims a little ahead (the timers due in between fire once) and aims again if it was still too late.
 * From here only runFor/fastForward move it. Resolves with the time it paused at.
 */
export async function pauseClock(page, { lead = 50 } = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const at = (await page.evaluate(() => Date.now())) + lead
    try {
      await page.clock.pauseAt(at)
      return at
    } catch (err) {
      if (!/to the past/.test(err.message)) throw err
    }
  }
  throw new Error(`pauseClock: the page's clock ran past every pause point ${lead} ms ahead`)
}

/**
 * Sets the currentTime of the page's running animations whose name (CSS animationName, or the WAAPI id) matches
 * `name` to `ms` past their start (their delay included), and dispatches nothing itself: the browser fires
 * animationend on its next frame as it would at that time. They keep running from there, so a "not yet" read a frame
 * or two later needs a margin (seek well short of the moment, not 1 ms). Resolves with the number of animations moved.
 */
export function seekAnimations(page, name, ms) {
  return page.evaluate(
    ([pattern, to]) => {
      const re = new RegExp(pattern)
      const moved = document.getAnimations().filter((a) => re.test(a.animationName ?? a.id ?? ''))
      for (const a of moved) a.currentTime = to
      return moved.length
    },
    [name instanceof RegExp ? name.source : name, ms],
  )
}
