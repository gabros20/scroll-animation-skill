/**
 * scroll-well.ts — a recipe (advanced): a section that pulls the page's scroll to its resting position while it holds
 * most of the view, with no animation library. `createScrollWell(target, options)` → a handle. gsap/scroll-well.ts
 * runs it on GSAP's ticker and motion/ScrollWell.tsx on Motion's frame loop; a page with neither calls it as it is.
 * One file to adapt in place.
 *
 *   const well = createScrollWell(document.getElementById('feature')!)     well.suspend()   well.destroy()
 *   suspendScrollWells()        just before a programmatic smooth scroll of your own (a router jump, scrollIntoView)
 *
 * - Read this first: it moves the reader's scroll. Use it on a composition meant to be seen whole (a pinned render's
 *   acts, a one-screen feature), never on running text, and only where the page scrolls natively. CSS scroll snap is
 *   the cheap alternative, and weaker: its `proximity` radius is the browser's (about a third of a viewport in
 *   Chromium) and it settles with a browser-paced dart. A spring fired at a crossing was tried as well: it needed
 *   velocity tracking and veto budgets, and still read as "the page waits for you to stop, then grabs you".
 * - Gravity, not a snap. While it is engaged, every frame adds one step toward rest to the scroll position as it is,
 *   the reader's input already applied, so it never overwrites or cancels a scroll: it only adds a little. The step is
 *   an exponential ease (`tauS`) between a speed floor and a ceiling: quick far out, gentle close in, and it lands
 *   instead of crawling.
 * - The reader always wins, by one rule. Scroll the well didn't write is the reader's, and `releaseAwayPx` of it away
 *   from rest releases the well for the rest of the visit; scroll toward rest pays that back. A wheel notch out, a
 *   scrollbar drag, a key, a swipe and a fly-by all fall out of that. A finger on the glass pauses the writes, not the
 *   loop, so the count still sees a deliberate swipe out and nothing is yanked back when the finger lifts.
 * - One overshoot is forgiven per visit, because a flicked arrival coasts past rest with no hand on it: a release that
 *   goes quiet for `reclaimQuietMs` within `reclaimPx` of rest resumes the pull, once. Arriving spends it: once the
 *   target has rested for RESTED_QUIET_MS, a later departure is a decision, not a tail.
 * - Rest: a target that fits the viewport rests centred. A taller one rests anywhere it fills the view (from its top at
 *   the viewport's top to its bottom at the viewport's bottom), and outside that band the well reaches for the nearer
 *   edge: arriving downwards lands its top, arriving upwards its bottom, and reading through the middle is never
 *   touched. One rule at every size, since at exactly one viewport tall the band is the centre. Measured on the
 *   reference build: centring rested a tall section's top 54 px above a 402x874 screen, and a flat top-align hauled a
 *   reader coming back up to the section all the way to its top.
 * - The clamp: inside a pinned scene the rest is bounded to the scene's range wrapper, so its two ends land on the
 *   scene's progress 0 and 1. Unclamped, a copy layer shorter than the viewport asked to rest 150 px above the pin at
 *   1440x1200, with the previous section showing over the render. `clamp` defaults to the nearest [data-scene-root].
 * - Engaged while the target covers `threshold` of itself or of the viewport (the viewport rule keeps a target taller
 *   than the screen meaningful): 0.45 from DESKTOP_QUERY up and 0.72 below it, where sections run taller than the
 *   screen and 0.45 grabbed readers before they had committed to the section. Read live: resizing across the
 *   breakpoint takes the other threshold.
 * - Lengths and speeds are reference px on the layout scale, spent through scaledPx (scale.ts; plain px when the
 *   layout isn't scaled). A flat length is a different share of the composition at every window: a flat reclaimPx of
 *   260 was 53% of the band at 1440x900 and 73% at 1280x650. `epsilonPx` (a rest threshold) and the times (gesture
 *   timing) don't scale.
 * - The viewport height is a snapshot per visit, refreshed only by a resize that isn't browser chrome (a width change,
 *   or a height change of CHROME_HEIGHT_RATIO or more). Read live, iOS's toolbar moves the target under the pull, and a
 *   pull upwards shows the toolbar again, which moves it again: a feedback loop.
 * - Every write is `behavior: 'instant'`, so a page with `scroll-behavior: smooth` doesn't queue a smooth scroll per
 *   frame. The flip side: each write cancels any smooth scroll the well didn't start. Measured: an anchor click from
 *   the top landed 900 px short of its target, every time, with a well in between. So the well suspends its writes
 *   for same-page anchor clicks (capture phase) and `hashchange`, for a time scaled to the jump (a 5.2k px smooth jump
 *   took 1196 ms in Chromium), ended early by `scrollend` or by SUSPEND_STILL_MS without a scroll. Any other smooth
 *   scroll it didn't start (a router, scrollIntoView, the authority's scrollTo) needs `suspend()` or
 *   suspendScrollWells() just before it.
 * - One well pulls at a time: the first to engage owns the page until it lets go, and the next waits its turn.
 * - Native scrolling only: Lenis and ScrollSmoother own the scroll position (one scroll authority per page), so under
 *   either it pulls nothing and warns once. It reads <html data-scroll-authority> each time it engages and on every
 *   frame it pulls, so an authority started after it (a route's SmoothScroll, whose effect runs after its children's)
 *   still stops it.
 * - Reduced motion, live: no pull, and turning it on mid-visit stops the pull at once.
 * - destroy() removes every listener, observer and frame callback. The page stays where it is.
 */
import { DESKTOP_QUERY, REDUCED_MOTION_QUERY } from './config'
import { onScaleChange, scaledPx } from './scale'
import { getScrollAuthority } from './smooth/authority'

/**
 * The measured tuning. Lengths and speeds are reference px, spent through scaledPx; `epsilonPx` and the times are
 * absolute.
 */
export const SCROLL_WELL = {
  /** Seconds: the pull closes about 63% of the distance left per `tauS`. Bigger is lazier. */
  tauS: 0.35,
  /** Reference px/s. With no ceiling the ease opens at about 1400 px/s from a 0.45 trigger: a yank, not a drift. */
  maxSpeed: 800,
  /** Reference px/s. An exponential alone never lands; the floor lands the last few px in about a third of a second. */
  minSpeed: 120,
  /** Absolute px: close enough to rest to stop writing (the loop keeps watching). */
  epsilonPx: 1.5,
  /**
   * Reference px of the reader's scroll away from rest that release the visit: about half a wheel notch, above the
   * pull's own dither and below one deliberate flick.
   */
  releaseAwayPx: 60,
  /** Milliseconds without a scroll after a release before the forgiven overshoot resumes the pull. */
  reclaimQuietMs: 450,
  /**
   * Reference px: a release that comes to rest this close is an overshoot; further out, a decision. It was 260, but a
   * hard flick coasts about 62% of the band out: 344 px on a 1998x1013 window against a 293 px radius, and 278 against
   * 260 on a phone, and both parked off rest.
   */
  reclaimPx: 320,
} as const

export type ScrollWellTuning = { [K in keyof typeof SCROLL_WELL]: number }

/** The share of the target, or of the viewport, that engages the well below DESKTOP_QUERY, and from it up. */
export const WELL_THRESHOLD = 0.72
export const WELL_DESKTOP_THRESHOLD = 0.45

/** A resize with the same width and a height change under this share of the height is browser chrome. */
const CHROME_HEIGHT_RATIO = 0.25
/** A tab that comes back from the background resumes with a huge frame time; one frame never moves further than this. */
const MAX_FRAME_MS = 64
/**
 * How long the target must rest before the visit counts as arrived and spends its forgiveness: longer than the gap
 * between input events inside any gesture (a wheel burst is about 16 ms, a slow creep about 90), shorter than
 * `reclaimQuietMs`. Zero error alone isn't arrival: a hard flick passes rest while the hand still moves, and spending
 * the forgiveness there cost the tail its correction (a 315 px overrun on a 2560x800 window).
 */
const RESTED_QUIET_MS = 200
/** A suspension without `scrollend` (Safari) lasts SUSPEND_MS_PER_PX per px of the jump, within these bounds. */
const SUSPEND_MIN_MS = 1200
const SUSPEND_MAX_MS = 4000
const SUSPEND_MS_PER_PX = 0.35
/** A suspension ends once the scroll position hasn't changed for this long. */
const SUSPEND_STILL_MS = 150

/**
 * The frame source: calls `tick` once per frame from the call until the returned function is called. The adapters
 * pass their engine's, so the well moves the page in the same frame as everything that reads it.
 */
export type WellClock = (tick: () => void) => () => void

/** requestAnimationFrame: the clock of a page with no animation engine. */
export const rafClock: WellClock = (tick) => {
  let id = requestAnimationFrame(function frame() {
    id = requestAnimationFrame(frame)
    tick()
  })
  return () => cancelAnimationFrame(id)
}

export interface ScrollWellOptions extends Partial<ScrollWellTuning> {
  /**
   * Bounds the rest to this ancestor's own scroll range: an element, a selector for `target.closest()`, or null for
   * none. Default '[data-scene-root]': inside a pinned scene the two ends land on its progress 0 and 1.
   */
  clamp?: HTMLElement | string | null
  /** The share of the target, or of the viewport, that must be visible to engage, below DESKTOP_QUERY. Default 0.72. */
  threshold?: number
  /** The same from DESKTOP_QUERY up. Default 0.45. */
  desktopThreshold?: number
  /** The frame source. Default rafClock. */
  clock?: WellClock
  /** Called in the same frame after each write, so an engine that reads the scroll reads the new position now. */
  onWrite?: () => void
}

export interface ScrollWellHandle {
  readonly target: HTMLElement
  /** The target holds enough of the view to engage the well. */
  readonly engaged: boolean
  /** The well's loop runs: engaged, holding the page, native scrolling and full motion. */
  readonly pulling: boolean
  /**
   * Pauses the writes (not the loop) for `ms` (default 1200), or until the scroll ends if that comes first. Call it
   * just before a programmatic smooth scroll of your own; a second call only ever extends the pause.
   */
  suspend(ms?: number): void
  /** Re-reads the viewport, the scale and the thresholds after a change no resize reports. */
  refresh(): void
  debug(): Record<string, unknown>
  destroy(): void
}

/** The well holding the page, and the wells waiting for it. */
let owner: symbol | null = null
const waiting = new Set<() => void>()
/** Every live well's suspend(), for suspendScrollWells(). */
const live = new Set<(ms?: number) => void>()

/** Pauses every live well's writes, as its handle's suspend() does: for code that scrolls and holds no handle. */
export function suspendScrollWells(ms?: number): void {
  live.forEach((suspend) => suspend(ms))
}

export function createScrollWell(target: HTMLElement, options: ScrollWellOptions = {}): ScrollWellHandle {
  const tune: ScrollWellTuning = {
    tauS: options.tauS ?? SCROLL_WELL.tauS,
    maxSpeed: options.maxSpeed ?? SCROLL_WELL.maxSpeed,
    minSpeed: options.minSpeed ?? SCROLL_WELL.minSpeed,
    epsilonPx: options.epsilonPx ?? SCROLL_WELL.epsilonPx,
    releaseAwayPx: options.releaseAwayPx ?? SCROLL_WELL.releaseAwayPx,
    reclaimQuietMs: options.reclaimQuietMs ?? SCROLL_WELL.reclaimQuietMs,
    reclaimPx: options.reclaimPx ?? SCROLL_WELL.reclaimPx,
  }
  const threshold = options.threshold ?? WELL_THRESHOLD
  const desktopThreshold = options.desktopThreshold ?? WELL_DESKTOP_THRESHOLD
  const clock = options.clock ?? rafClock
  const clamp = resolveClamp(target, options.clamp === undefined ? '[data-scene-root]' : options.clamp)
  const id = Symbol('scroll-well')
  const reduce = window.matchMedia(REDUCED_MOTION_QUERY)
  const desktop = window.matchMedia(DESKTOP_QUERY)

  let destroyed = false
  let warned = false
  /** The observer's verdict: the target holds enough of the view. */
  let engaged = false
  /** Stops the loop; null while it doesn't run. */
  let stopClock: (() => void) | null = null
  /** A finger is on the glass: the loop watches and writes nothing. */
  let touching = false
  /** The reader scrolled away on purpose: no pull until the next visit (or the one forgiven overshoot). */
  let released = false
  let lastFrame = 0
  /** Where the well left the page last frame; -1 before its first frame. */
  let ownY = -1
  /** The reader's scroll away from rest, paid back by scroll toward it. */
  let awayPx = 0
  /** When the reader last moved the page. */
  let lastMove = 0
  /** The visit's one forgiven overshoot, spent at 1. */
  let reclaims = 0
  /** performance.now() until which writes are paused; 0 when they aren't. */
  let suspendedUntil = 0
  let offScrollEnd: (() => void) | null = null
  let stillFrame = 0
  let layoutFrame = 0
  let io: IntersectionObserver | null = null

  // The visit's viewport snapshot and the tuning's lengths at the current scale.
  let vw = window.innerWidth
  let vh = window.innerHeight
  let scaled = { maxSpeed: 0, minSpeed: 0, releaseAway: 0, reclaim: 0 }
  const rescale = () => {
    scaled = {
      maxSpeed: scaledPx(tune.maxSpeed),
      minSpeed: scaledPx(tune.minSpeed),
      releaseAway: scaledPx(tune.releaseAwayPx),
      reclaim: scaledPx(tune.reclaimPx),
    }
  }
  /** `fresh` at the start of a visit; otherwise a height change that looks like browser chrome keeps the snapshot. */
  const measureViewport = (fresh: boolean) => {
    const w = window.innerWidth
    const h = window.innerHeight
    const chrome = !fresh && w === vw && Math.abs(h - vh) < vh * CHROME_HEIGHT_RATIO
    vw = w
    if (!chrome) vh = h
  }
  rescale()

  /** Signed px the page must scroll for the target to be at rest. */
  const offset = () => {
    const y = window.scrollY
    const box = target.getBoundingClientRect()
    const top = y + box.top
    // How much taller than the viewport the target is. Below 0 it fits and rests centred (top + slack / 2). Above 0,
    // every position in [top, top + slack] fills the view with it: the scroll clamped into that band is no change
    // inside it and the nearer edge outside. The two meet at 0.
    const slack = box.height - vh
    let want = slack > 0 ? Math.min(Math.max(y, top), top + slack) : top + slack / 2
    if (clamp) {
      const start = y + clamp.getBoundingClientRect().top
      want = Math.min(Math.max(want, start), start + Math.max(0, clamp.offsetHeight - vh))
    }
    return want - y
  }

  const warn = () => {
    if (warned) return
    warned = true
    console.warn('[scroll-animation] the scroll well pulls nothing under Lenis or ScrollSmoother: they own the scroll')
  }

  function step() {
    const now = performance.now()
    const dt = Math.min(now - lastFrame, MAX_FRAME_MS) / 1000
    lastFrame = now
    if (getScrollAuthority() !== 'native') {
      warn()
      halt()
      return
    }
    // Suspended: a smooth scroll the well didn't start may be passing through. It is neither written against nor
    // counted as the reader's, and the pull resumes from wherever it leaves the page.
    if (now < suspendedUntil) {
      ownY = window.scrollY
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
    if (!released && Math.abs(err) <= tune.epsilonPx && now - lastMove > RESTED_QUIET_MS) reclaims = 1
    if (
      released &&
      reclaims === 0 &&
      now - lastMove > tune.reclaimQuietMs &&
      Math.abs(err) > tune.epsilonPx &&
      Math.abs(err) < scaled.reclaim
    ) {
      released = false
      reclaims = 1
    }
    if (!released && !touching && Math.abs(err) > tune.epsilonPx) {
      const ease = err * (1 - Math.exp(-dt / tune.tauS))
      const ceiling = scaled.maxSpeed * dt
      const floor = Math.min(Math.abs(err), scaled.minSpeed * dt)
      const magnitude = Math.min(Math.max(Math.abs(ease), floor), ceiling)
      window.scrollTo({ top: y + Math.sign(err) * magnitude, behavior: 'instant' })
      options.onWrite?.()
    }
    ownY = window.scrollY
  }

  /** Starts a visit if the well may pull: engaged, full motion, native scrolling, and the page free. */
  function claim() {
    if (!engaged || stopClock || destroyed || reduce.matches) return
    if (getScrollAuthority() !== 'native') {
      warn()
      return
    }
    if (owner && owner !== id) {
      waiting.add(claim)
      return
    }
    owner = id
    measureViewport(true)
    rescale()
    lastFrame = lastMove = performance.now()
    ownY = -1
    awayPx = 0
    released = false
    reclaims = 0
    stopClock = clock(step)
  }

  /** Ends the visit and hands the page to a waiting well; the next claim is a fresh visit. */
  function halt() {
    waiting.delete(claim)
    stopClock?.()
    stopClock = null
    ownY = -1
    awayPx = 0
    if (owner !== id) return
    owner = null
    const next = Array.from(waiting)
    waiting.clear()
    next.forEach((resume) => resume())
  }

  const engage = (on: boolean) => {
    engaged = on
    if (on) claim()
    else halt()
  }

  function observe() {
    io?.disconnect()
    const limit = desktop.matches ? desktopThreshold : threshold
    const height = target.offsetHeight
    const view = window.innerHeight
    // The share of the target at which it covers `limit` of the viewport: `limit` itself when it fits, less when it
    // is taller. The observer fires at both.
    const viewRatio = height > 0 && view > 0 ? Math.min(limit, (view * limit) / height) : limit
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1]
        if (!entry || io !== observer) return
        const rootHeight = entry.rootBounds?.height ?? window.innerHeight
        engage(
          entry.isIntersecting &&
            (entry.intersectionRatio >= limit - 0.001 ||
              (rootHeight > 0 && entry.intersectionRect.height >= rootHeight * limit - 0.5)),
        )
      },
      { threshold: Array.from(new Set([0, viewRatio, limit])).sort((a, b) => a - b) },
    )
    io = observer
    observer.observe(target)
  }

  // Both the viewport and the target's height set the thresholds: re-observe once per frame of changes.
  const relayout = () => {
    cancelAnimationFrame(layoutFrame)
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0
      measureViewport(false)
      rescale()
      observe()
    })
  }
  const resizeObserver = new ResizeObserver(relayout)

  function suspend(ms = SUSPEND_MIN_MS) {
    if (destroyed) return
    suspendedUntil = Math.max(suspendedUntil, performance.now() + ms)
    if ('onscrollend' in window && !offScrollEnd) {
      window.addEventListener('scrollend', endSuspension)
      offScrollEnd = () => window.removeEventListener('scrollend', endSuspension)
    }
    watchStill()
  }
  function endSuspension() {
    suspendedUntil = 0
    offScrollEnd?.()
    offScrollEnd = null
    cancelAnimationFrame(stillFrame)
    stillFrame = 0
  }
  /** Ends a suspension once the scroll position has sat still for SUSPEND_STILL_MS, with or without `scrollend`. */
  function watchStill() {
    if (stillFrame) return
    let lastY = window.scrollY
    let changedAt = performance.now()
    const tick = () => {
      stillFrame = 0
      const now = performance.now()
      const y = window.scrollY
      if (y !== lastY) {
        lastY = y
        changedAt = now
      }
      if (now >= suspendedUntil || now - changedAt >= SUSPEND_STILL_MS) endSuspension()
      else stillFrame = requestAnimationFrame(tick)
    }
    stillFrame = requestAnimationFrame(tick)
  }
  /** An anchor jump: suspended for a time scaled to its distance, read from the target before it starts. */
  const suspendForHash = (hash: string) => {
    let name = hash.slice(1)
    try {
      name = decodeURIComponent(name)
    } catch {
      // A malformed escape: look the raw name up.
    }
    const to = name ? document.getElementById(name) : null
    const distance = Math.abs(to ? to.getBoundingClientRect().top : 0)
    suspend(Math.min(SUSPEND_MAX_MS, Math.max(SUSPEND_MIN_MS, distance * SUSPEND_MS_PER_PX)))
  }

  // Capture phase: before a handler on the link can prevent the default. `hashchange` also catches back and forward.
  const onClick = (event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!link || !link.hash) return
    const hashOnly = (link.getAttribute('href') ?? '').startsWith('#')
    const samePage = link.pathname === location.pathname && link.search === location.search
    if (hashOnly || samePage) suspendForHash(link.hash)
  }
  const onHashChange = () => suspendForHash(location.hash)
  const onTouchStart = () => {
    touching = true
  }
  const onTouchEnd = (event: TouchEvent) => {
    touching = event.touches.length > 0
  }
  const onReduce = () => (reduce.matches ? halt() : claim())
  const onDesktop = () => relayout()

  window.addEventListener('click', onClick, { capture: true, passive: true })
  window.addEventListener('hashchange', onHashChange)
  window.addEventListener('touchstart', onTouchStart, { passive: true })
  window.addEventListener('touchend', onTouchEnd, { passive: true })
  window.addEventListener('touchcancel', onTouchEnd, { passive: true })
  window.addEventListener('resize', relayout)
  reduce.addEventListener('change', onReduce)
  desktop.addEventListener('change', onDesktop)
  const offScale = onScaleChange(rescale)
  resizeObserver.observe(target)
  live.add(suspend)
  observe()

  return {
    target,
    get engaged() {
      return engaged
    },
    get pulling() {
      return stopClock !== null
    },
    suspend,
    refresh() {
      if (destroyed) return
      measureViewport(false)
      rescale()
      observe()
    },
    debug: () => ({
      engaged,
      pulling: stopClock !== null,
      released,
      reclaims,
      touching,
      suspended: suspendedUntil > performance.now(),
      rest: Math.round(offset() * 10) / 10,
      viewport: vh,
      clamp: !!clamp,
    }),
    destroy() {
      if (destroyed) return
      destroyed = true
      engaged = false
      halt()
      live.delete(suspend)
      io?.disconnect()
      io = null
      resizeObserver.disconnect()
      cancelAnimationFrame(layoutFrame)
      endSuspension()
      offScale()
      window.removeEventListener('click', onClick, { capture: true })
      window.removeEventListener('hashchange', onHashChange)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
      window.removeEventListener('resize', relayout)
      reduce.removeEventListener('change', onReduce)
      desktop.removeEventListener('change', onDesktop)
    },
  }
}

function resolveClamp(target: HTMLElement, clamp: HTMLElement | string | null): HTMLElement | null {
  if (typeof clamp === 'string') return target.closest<HTMLElement>(clamp)
  return clamp
}
