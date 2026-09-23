import { ENGAGE_QUERY } from './config'

/**
 * A continuous attractor for scroll: while it runs, the page is nudged a
 * fraction of the way toward centring one box, every frame. Ported
 * wholesale from the reference build's `lib/motion/scrollPull.ts` — that
 * module was already framework-free, so nothing here changed but the
 * import of the shared breakpoint query.
 *
 * ## Gravity, not a snap
 *
 * That is the whole mental model. There is no trigger moment, no settle
 * gate, no animation with a start and an end — a running pull simply
 * attracts the scroll for as long as its owner keeps it running.
 *
 * The nudge is ADDITIVE: each frame reads `window.scrollY` as it currently
 * is (visitor input already applied) and writes `y + step`. So the pull can
 * never overwrite, cancel or out-argue a scroll — it only ever adds a
 * little on top. `step` is an exponential ease (`tauS`) between a speed
 * floor and a ceiling, so it is quick when far out, gentle when close, and
 * always lands rather than crawling.
 *
 * ## The visitor always wins, by one rule instead of five
 *
 * Motion the pull did NOT write is the visitor's, and `releaseAwayPx` of it
 * directed away from centre releases the pull for the rest of the visit —
 * the loop goes quiet and only watches. Motion toward centre pays that
 * meter back down. A wheel notch out, a scrollbar drag, a keypress, a
 * finger swipe and a fly-by all fall out of that one line of arithmetic.
 *
 * The one exception is the inertia tail: a flicked arrival coasts past
 * centre with nobody's hand on it, which is away-motion by the arithmetic
 * above, so every trackpad arrival would park slightly off. The well
 * therefore forgives ONE overshoot per visit: a release that goes quiet
 * (`reclaimQuietMs`) within `reclaimPx` of rest resumes the pull. Once
 * only, and only near rest — a visitor who scrolled off and stopped to
 * read is never argued with. And ARRIVING SPENDS IT: once the target has
 * come to rest there is nothing left to forgive, and a later departure is a
 * decision, not a tail.
 *
 * A finger on the glass suspends the WRITE but not the loop: pulling
 * against a live drag would slide the page out from under the finger,
 * while the away-meter still has to see the drag or a deliberate swipe out
 * would be yanked back on lift-off. Under `prefers-reduced-motion` the loop
 * never starts.
 *
 * ## Every length is on `--fluid`
 *
 * The tuning numbers below are REFERENCE px — what they measure on a
 * 1440×900 viewport — spent multiplied by the fluid scale's own unit
 * (`fluid.config.json`), so a threshold means the same fraction of the
 * composition at every window. A flat px value does not: it silently
 * tightens as the window shrinks.
 *
 * ## `behavior: 'instant'` is load-bearing
 *
 * If a host page sets `scroll-behavior: smooth` on `html`, every frame of
 * this loop would otherwise queue a smooth animation against the one
 * before it. The explicit `instant` on each write keeps the pull a direct
 * position write regardless of that setting.
 *
 * That protects the well's OWN writes from `smooth`, but not the reverse:
 * an unrelated smooth scroll (a header anchor link, a router hash jump)
 * that passes through the target gets cancelled one rAF at a time by this
 * loop's `instant` writes and never arrives — measured, a `#menu` anchor
 * click from the top landed 900px short, every time, on a page whose well
 * sat between the click and the target. `suspend()` pauses writes (not the
 * loop) for a bounded window so a programmatic/smooth scroll can run
 * uncontested; a capture-phase `click` on same-page hash anchors and
 * `hashchange` call it automatically, and it is exposed on the returned
 * controller for a caller driving its own scroll. Both automatic triggers
 * read the anchor TARGET's rect at click/hashchange time and scale the
 * suspension to that jump's distance (`SUSPEND_FALLBACK_MIN_MS`..
 * `SUSPEND_FALLBACK_MAX_MS`), since a flat 1200ms measured tight against a
 * real ~5.2k-reference-px smooth jump (1196ms in Chromium). It clears on the
 * earliest of `scrollend`, `scrollY` going still for `SUSPEND_STABLE_MS`
 * (works even where `scrollend` is unsupported), or that distance-scaled
 * fallback timeout (Safari does not fire `scrollend` as of this writing).
 *
 * ## One rest state, or an interval of them
 *
 * A target that FITS the viewport has exactly one position worth resting
 * at: the centre. A target that does NOT fit has a whole band of them —
 * every scroll position from "its top at the viewport top" to "its bottom
 * at the viewport bottom" shows the target and nothing else, so inside
 * that band the pull produces zero error and does nothing, and outside it
 * reaches for the nearer edge. This is ONE rule at every breakpoint, not a
 * mobile special case: a section exactly one viewport tall has zero slack,
 * so the band collapses to a point and it IS the old centre-always rule.
 *
 * ## The clamp
 *
 * `clamp` bounds the attractor to an ancestor's own scroll range, which is
 * what makes this safe to point at a box inside a pinned scene
 * (`scrubStage.ts`). Without it, a target shorter than the viewport wants a
 * resting scroll position outside the pin entirely. Clamped to the pin's
 * own range wrapper, the two ends land exactly on the pin's p=0 and p=1.
 *
 * ## The viewport height is a SNAPSHOT
 *
 * A mobile browser can collapse its chrome WHILE the page scrolls, which
 * changes `innerHeight` without changing anything about the layout the
 * target's rect is measured in. Read live, the attractor would move under
 * the pull — and worse, a pull scrolling up re-reveals the chrome, which
 * shrinks the viewport, which moves the target up again: a feedback loop.
 * So the height is captured per visit and refreshed only on a resize that
 * is not chrome collapsing (any width change, or a height change too large
 * to be chrome).
 *
 * ## One well at a time
 *
 * A page may hold several of these. Two attractors writing the same scroll
 * in the same frame is nonsense, so ownership is a module-level token: the
 * first to claim it holds it until it stops, and a refused claim is queued
 * rather than dropped.
 */

/**
 * Every LENGTH below is a REFERENCE px — the value at 1440×900 — and is
 * spent multiplied by the fluid scale's own unit.
 *
 * `epsilonPx`, `reclaimQuietMs` and `tauS` deliberately do NOT scale:
 * `epsilonPx` is a rest threshold ("closer than anyone can see"), which is
 * an absolute fact about screens, not a length in the composition; the two
 * durations are gesture timing, which does not get faster because the
 * window is shorter.
 */
const DEFAULTS = {
  /** Time constant of the pull, seconds. Bigger is lazier. */
  tauS: 0.35,
  /** Ceiling on the pull, reference px/s — without it the exponential opens
   * far too fast from a large error ("the sped-up snap" this design avoids). */
  maxSpeed: 800,
  /** Floor on the pull, reference px/s — an exponential alone has an
   * infinite tail; this lands the last few px in a third of a second. */
  minSpeed: 120,
  /** Close enough to centre to stop writing (the loop keeps watching). */
  epsilonPx: 1.5,
  /** Visitor-driven scroll AWAY from centre that releases the pull for the
   * rest of the visit. Roughly half a wheel notch. */
  releaseAwayPx: 60,
  /** The well forgives ONE overshoot per visit if the page goes quiet this
   * long, within `reclaimPx` of centre — an inertia tail, not intent. */
  reclaimQuietMs: 450,
  /** How close to centre a release has to land to be read as an overshoot
   * rather than a deliberate departure. */
  reclaimPx: 320
} as const

/**
 * A resize whose width is unchanged and whose height moved less than this
 * fraction is browser chrome, not a new viewport.
 */
const CHROME_HEIGHT_RATIO = 0.25

/** A backgrounded tab resumes with a huge dt; clamp so it cannot land a
 * full jump on the first frame back. */
const MAX_FRAME_MS = 64

/** How still the page must be, while already at rest, before the visit
 * counts as ARRIVED and spends its one forgiveness. */
const RESTED_QUIET_MS = 200

/**
 * How long `suspend()` pauses writes for when the browser never reports
 * `scrollend` (Safari, as of this writing), if nothing clears it sooner.
 *
 * A flat 1200ms was measured tight: a smooth `#menu` jump of ~5.2k reference
 * px on a real page took 1196ms in Chromium, and Safari's own smooth-scroll
 * pacing is not guaranteed to be faster. A jump this long resuming the well
 * mid-flight is the exact bug `suspend()` exists to prevent — so the two
 * automatic triggers (the capture-phase anchor click and `hashchange`) scale
 * the fallback with how far the target actually is: `max(SUSPEND_FALLBACK_MIN_MS,
 * distancePx * SUSPEND_FALLBACK_DISTANCE_FACTOR)`, capped at
 * `SUSPEND_FALLBACK_MAX_MS` so a broken/very distant target can't suspend the
 * well indefinitely. See `references/scroll-scenes.md` §8.
 *
 * `SUSPEND_STABLE_MS` is the second, browser-agnostic half of the fix: while
 * suspended, a small watcher ends the suspension as soon as `scrollY` has
 * gone unchanged for that long, so a fast jump doesn't sit out the rest of a
 * conservative fallback window even on Safari.
 */
const SUSPEND_FALLBACK_MIN_MS = 1200
const SUSPEND_FALLBACK_MAX_MS = 4000
/** Reference px→ms slope for the distance-scaled fallback above. */
const SUSPEND_FALLBACK_DISTANCE_FACTOR = 0.35
/** How long scrollY must sit still, while suspended, to end the suspension
 * early — see `SUSPEND_FALLBACK_MIN_MS`'s docblock. */
const SUSPEND_STABLE_MS = 150

/** `max(SUSPEND_FALLBACK_MIN_MS, distancePx * SUSPEND_FALLBACK_DISTANCE_FACTOR)`,
 * capped at `SUSPEND_FALLBACK_MAX_MS`. */
const suspendMsForDistance = (distancePx: number) =>
  Math.min(
    SUSPEND_FALLBACK_MAX_MS,
    Math.max(SUSPEND_FALLBACK_MIN_MS, Math.abs(distancePx) * SUSPEND_FALLBACK_DISTANCE_FACTOR)
  )

/**
 * Read the fluid scale's own unit — 1 at the reference viewport, a flat 1
 * below the engage breakpoint.
 *
 * Reads the resolved `--fluid` custom property by asking layout to resolve
 * it (`calc(1000 * var(--fluid, 1px))` on a hidden probe element, divided
 * back down) rather than parsing `getComputedStyle`'s string value: `--fluid`
 * is an unregistered custom property, so its computed value is the literal
 * unparsed token string, and `parseFloat` on that is `NaN`.
 *
 * This port does not depend on the `fluid-design` skill. The `1px` fallback
 * in the calc means a project with no `--fluid` declared anywhere resolves
 * this probe to exactly `1`, so every threshold below is unscaled — not a
 * crash, not an accidental 0.
 */
let probe: HTMLElement | null = null
const readFluid = (): number => {
  if (!probe || !probe.isConnected) {
    probe = document.createElement('div')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText =
      'position:fixed;top:-9999px;left:0;width:0;height:calc(1000 * var(--fluid, 1px));pointer-events:none;'
    document.body.appendChild(probe)
  }
  const v = probe.getBoundingClientRect().height / 1000
  return Number.isFinite(v) && v > 0 ? v : 1
}

export interface ScrollPullOptions {
  /** The box to centre in the viewport. */
  target: HTMLElement
  /** Bound the attractor to this ancestor's own scroll range — see §The
   * clamp. Pass the element, or `null`/omit for an unbounded pull. */
  clamp?: HTMLElement | null
  tauS?: number
  maxSpeed?: number
  minSpeed?: number
  epsilonPx?: number
  releaseAwayPx?: number
  reclaimQuietMs?: number
  reclaimPx?: number
}

export interface ScrollPull {
  /** Begin (or resume) attracting. Idempotent. */
  start(): void
  /** Stop attracting and reset the visit — the next `start` is a fresh visit. */
  stop(): void
  /**
   * Pause writes (not the loop) for `ms` (default `SUSPEND_FALLBACK_MIN_MS`),
   * or until `scrollend` fires or `scrollY` has been stable for
   * `SUSPEND_STABLE_MS`, whichever is sooner. Call before driving a
   * programmatic or smooth scroll of your own through this pull's target —
   * see §`behavior: 'instant'` is load-bearing. The two automatic triggers
   * (anchor click, `hashchange`) instead pass a distance-scaled `ms` — see
   * `suspendMsForDistance`. Safe to call repeatedly; each call only extends
   * the suspension, never shortens it.
   */
  suspend(ms?: number): void
  /** Stop, drop listeners, release ownership. */
  destroy(): void
}

/** The single writer. See §One well at a time. */
let owner: symbol | null = null
const waiting = new Set<() => void>()

export function createScrollPull(options: ScrollPullOptions): ScrollPull {
  const { target, clamp = null } = options
  const tauS = options.tauS ?? DEFAULTS.tauS
  const maxSpeed = options.maxSpeed ?? DEFAULTS.maxSpeed
  const minSpeed = options.minSpeed ?? DEFAULTS.minSpeed
  const epsilonPx = options.epsilonPx ?? DEFAULTS.epsilonPx
  const releaseAwayPx = options.releaseAwayPx ?? DEFAULTS.releaseAwayPx
  const reclaimQuietMs = options.reclaimQuietMs ?? DEFAULTS.reclaimQuietMs
  const reclaimPx = options.reclaimPx ?? DEFAULTS.reclaimPx

  const id = Symbol('scroll-pull')
  const abort = new AbortController()
  const { signal } = abort
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

  let wanted = false
  let touching = false
  let released = false
  let frame = 0
  let lastFrame = 0
  let ownY = -1
  let awayPx = 0
  let lastMove = 0
  let reclaims = 0
  /** `performance.now()` timestamp writes stay paused until. 0 = not suspended. */
  let suspendedUntil = 0
  /** Listener for the `scrollend` that would end a suspension early. */
  let scrollendAbort: AbortController | null = null
  /** rAF handle for the scrollY-stability watcher; 0 when not running. */
  let stabilityFrame = 0

  let vw = window.innerWidth
  let vh = window.innerHeight
  let scaled = { maxSpeed, minSpeed, releaseAway: releaseAwayPx, reclaim: reclaimPx }

  const remeasureViewport = () => {
    const w = window.innerWidth
    const h = window.innerHeight
    const chromeOnly = w === vw && Math.abs(h - vh) < vh * CHROME_HEIGHT_RATIO
    vw = w
    if (!chromeOnly) vh = h

    const fluid = readFluid()
    scaled = {
      maxSpeed: maxSpeed * fluid,
      minSpeed: minSpeed * fluid,
      releaseAway: releaseAwayPx * fluid,
      reclaim: reclaimPx * fluid
    }
  }
  remeasureViewport()

  /** Signed px the page must scroll for the target to sit at rest. */
  const offset = (): number => {
    const r = target.getBoundingClientRect()
    const y = window.scrollY
    const top = y + r.top
    const slack = r.height - vh
    let want = slack > 0 ? Math.min(Math.max(y, top), top + slack) : top + slack / 2
    if (clamp) {
      const c = clamp.getBoundingClientRect()
      const cTop = y + c.top
      const travel = Math.max(0, clamp.offsetHeight - vh)
      want = Math.min(Math.max(want, cTop), cTop + travel)
    }
    return want - y
  }

  function step(now: number) {
    frame = 0
    const dt = Math.min(now - lastFrame, MAX_FRAME_MS) / 1000
    lastFrame = now

    // Suspended: a programmatic/smooth scroll may be in flight through this
    // target. Skip the write AND the away/reclaim bookkeeping — that scroll
    // is not visitor motion to react to — but keep the loop alive so it
    // resumes exactly where it left off once the suspension clears.
    if (now < suspendedUntil) {
      ownY = window.scrollY
      frame = requestAnimationFrame(step)
      return
    }

    const y = window.scrollY
    const err = offset()

    if (ownY >= 0) {
      const moved = y - ownY
      if (moved !== 0) {
        lastMove = now
        if (Math.sign(moved) === Math.sign(err)) awayPx = Math.max(0, awayPx - Math.abs(moved))
        else awayPx += Math.abs(moved)
        if (awayPx > scaled.releaseAway) {
          released = true
          awayPx = 0
        }
      }
    }

    if (!released && Math.abs(err) <= epsilonPx && now - lastMove > RESTED_QUIET_MS) reclaims = 1

    if (
      released &&
      reclaims === 0 &&
      now - lastMove > reclaimQuietMs &&
      Math.abs(err) > epsilonPx &&
      Math.abs(err) < scaled.reclaim
    ) {
      released = false
      reclaims = 1
    }

    if (!released && !touching && Math.abs(err) > epsilonPx) {
      const ease = err * (1 - Math.exp(-dt / tauS))
      const ceiling = scaled.maxSpeed * dt
      const floor = Math.min(Math.abs(err), scaled.minSpeed * dt)
      const magnitude = Math.min(Math.max(Math.abs(ease), floor), ceiling)
      window.scrollTo({ top: y + Math.sign(err) * magnitude, behavior: 'instant' })
    }

    ownY = window.scrollY
    frame = requestAnimationFrame(step)
  }

  const claim = () => {
    if (!wanted || frame || reduced.matches) return
    if (owner && owner !== id) {
      waiting.add(claim)
      return
    }
    owner = id
    remeasureViewport()
    lastFrame = performance.now()
    lastMove = lastFrame
    ownY = -1
    awayPx = 0
    released = false
    reclaims = 0
    frame = requestAnimationFrame(step)
  }

  const start = () => {
    wanted = true
    claim()
  }

  const stop = () => {
    wanted = false
    waiting.delete(claim)
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    ownY = -1
    awayPx = 0
    if (owner !== id) return
    owner = null
    const pending = [...waiting]
    waiting.clear()
    for (const resume of pending) resume()
  }

  /**
   * Pause writes for `ms` (or until `scrollend`/scrollY-stability, whichever
   * is sooner). See the `ScrollPull.suspend` docblock.
   */
  const suspend = (ms = SUSPEND_FALLBACK_MIN_MS) => {
    suspendedUntil = Math.max(suspendedUntil, performance.now() + ms)
    if ('onscrollend' in window) {
      scrollendAbort?.abort()
      scrollendAbort = new AbortController()
      window.addEventListener(
        'scrollend',
        () => {
          suspendedUntil = 0
        },
        { once: true, signal: scrollendAbort.signal }
      )
    }
    watchStability()
  }

  /**
   * While suspended, ends the suspension as soon as `scrollY` has gone
   * unchanged for `SUSPEND_STABLE_MS` — the browser-agnostic half of the
   * fix, since it does not depend on `scrollend` support. Idempotent.
   */
  const watchStability = () => {
    if (stabilityFrame) return
    let lastY = window.scrollY
    let lastChangeAt = performance.now()
    const tick = () => {
      const now = performance.now()
      if (now >= suspendedUntil) {
        stabilityFrame = 0
        return
      }
      const y = window.scrollY
      if (y !== lastY) {
        lastY = y
        lastChangeAt = now
      } else if (now - lastChangeAt >= SUSPEND_STABLE_MS) {
        suspendedUntil = 0
        stabilityFrame = 0
        return
      }
      stabilityFrame = requestAnimationFrame(tick)
    }
    stabilityFrame = requestAnimationFrame(tick)
  }

  // Anchor navigation is the common source of a smooth scroll this loop did
  // not initiate. Capture phase so this fires before any click handler on
  // the anchor itself might call preventDefault(); `hashchange` also
  // catches a browser back/forward that lands on a hash with no click.
  //
  // Both listeners compute the jump distance from the anchor target's OWN
  // rect (at the moment of the click/hashchange, before any scroll has
  // started) and scale the fallback suspension to it — see
  // `suspendMsForDistance`'s docblock on `SUSPEND_FALLBACK_MIN_MS`.
  const suspendForHash = (hash: string) => {
    const id = hash.slice(1)
    const anchorTarget = id ? document.getElementById(id) : null
    const distancePx = anchorTarget ? anchorTarget.getBoundingClientRect().top : 0
    suspend(suspendMsForDistance(distancePx))
  }
  window.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || !a.hash) return
      const isHashOnly = (a.getAttribute('href') ?? '').startsWith('#')
      const isSamePathHash = a.pathname === window.location.pathname && a.search === window.location.search
      if (isHashOnly || isSamePathHash) suspendForHash(a.hash)
    },
    { capture: true, passive: true, signal }
  )
  window.addEventListener('hashchange', () => suspendForHash(window.location.hash), { passive: true, signal })

  window.addEventListener('touchstart', () => { touching = true }, { passive: true, signal })
  window.addEventListener('touchend', () => { touching = false }, { passive: true, signal })
  window.addEventListener('resize', remeasureViewport, { passive: true, signal })

  return {
    start,
    stop,
    suspend,
    destroy: () => {
      stop()
      scrollendAbort?.abort()
      if (stabilityFrame) cancelAnimationFrame(stabilityFrame)
      stabilityFrame = 0
      abort.abort()
    }
  }
}

/**
 * `[data-pull-to-centre]` mount — port of `PullToCentre`. The marker element
 * is inert (mount it as any child of the box that should be attracted; its
 * PARENT is the target, exactly like the React version's "drop it in as the
 * first child" convention):
 *
 * ```html
 * <div class="lg:fluid-h-900 relative …">
 *   <span data-pull-to-centre data-clamp="[data-scrub-stage]" hidden aria-hidden="true"></span>
 *   …
 * </div>
 * ```
 *
 * `data-clamp` is a selector for an ancestor whose own scroll range bounds
 * the attractor — use `[data-scrub-stage]` inside a pinned scene.
 * `data-threshold` / `data-threshold-lg` override the engagement fraction
 * (self-ratio OR viewport-ratio, whichever is easier to satisfy — see the
 * engagement note below); defaults match the reference build's reviewed
 * values.
 */

const DEFAULT_THRESHOLD = 0.72
const DEFAULT_THRESHOLD_LG = 0.45

export interface PullToCentreController {
  destroy(): void
}

export function initPullToCentre(root: ParentNode = document): PullToCentreController {
  const markers = Array.from(root.querySelectorAll<HTMLElement>('[data-pull-to-centre]'))
  const teardowns: Array<() => void> = []

  for (const marker of markers) {
    const target = marker.parentElement
    if (!target) continue

    const threshold = Number.parseFloat(marker.dataset.threshold ?? '') || DEFAULT_THRESHOLD
    const thresholdLg = Number.parseFloat(marker.dataset.thresholdLg ?? '') || DEFAULT_THRESHOLD_LG
    const clampSelector = marker.dataset.clamp

    // Read LIVE, not latched — this observer is already rebuilt on resize.
    const active = () => (window.matchMedia(ENGAGE_QUERY).matches ? thresholdLg : threshold)

    const clampEl = clampSelector ? target.closest<HTMLElement>(clampSelector) : null
    const pull = createScrollPull({ target, clamp: clampEl })

    // The self-ratio corresponding to the viewport being `t` covered. Equal
    // to `t` whenever the target fits the screen, smaller when it does not
    // — the only case the two engagement rules disagree.
    const viewportThreshold = (t: number) => {
      const h = target.offsetHeight
      const vh = window.innerHeight
      if (h <= 0 || vh <= 0) return t
      return Math.min(t, (vh * t) / h)
    }

    let io: IntersectionObserver | null = null

    const observe = () => {
      io?.disconnect()
      const t = active()
      const thresholds = [...new Set([0, viewportThreshold(t), t])].sort((a, b) => a - b)
      io = new IntersectionObserver(
        (entries) => {
          const entry = entries[0]
          if (!entry || !entry.isIntersecting) {
            pull.stop()
            return
          }
          const vh = entry.rootBounds?.height ?? window.innerHeight
          const engaged =
            entry.intersectionRatio >= t || (vh > 0 && entry.intersectionRect.height >= vh * t)
          if (engaged) pull.start()
          else pull.stop()
        },
        { threshold: thresholds }
      )
      io.observe(target)
    }
    observe()

    let raf = 0
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(observe)
    }
    window.addEventListener('resize', schedule, { passive: true })

    teardowns.push(() => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', schedule)
      io?.disconnect()
      pull.destroy()
    })
  }

  return {
    destroy() {
      teardowns.forEach((fn) => fn())
    }
  }
}
