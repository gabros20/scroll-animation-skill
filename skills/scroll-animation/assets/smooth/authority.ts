/**
 * smooth/authority.ts — who owns scrolling on this page, stamped where anything can read it.
 *
 * Exactly one authority per page: `native`, `lenis` or `smoother` (GSAP ScrollSmoother). The owner stamps
 * `<html data-scroll-authority="…">` while it runs and removes the stamp when it stops, so a route that is hidden
 * (Next's Activity) or left (a client navigation) can't leave a stale owner behind. `verify` and devtools read the
 * stamp; code reads `getScrollAuthority()` and `currentSmoothScroll()`. A Lenis the skill didn't start (a site's own)
 * stamps nothing, but Lenis marks the root with its own `lenis` class, so getScrollAuthority() reads that too.
 *
 * Placements. The authority smooths the reader's input and nothing else. A scroll it did not cause (the router's
 * jump to the top or a hash, the browser's back/forward restore, an anchor, find-in-page, a focus scroll) is a
 * placement: the handle takes it up at once (adopt()), never gliding toward it. followPlacements() decides which is
 * which, with no call from the route and no frame count:
 * - Lenis writes the scroll position itself, so a scroll event whose position is not the one it last wrote is
 *   foreign: a placement.
 * - ScrollSmoother leaves the native scroll to the browser, so position can't tell. There a scroll is a placement
 *   when no scroll input (wheel, touch, a scroll key) came in the last INTENT_MS, or when a visit began in the last
 *   VISIT_WINDOW_MS (page.ts: a reader who flicks the wheel and clicks a link has recent input, and the router's
 *   jump is still a placement). The handle's own animated scrollTo is neither.
 * - Both adopt once more two frames after a visit begins: a route change that doesn't move the scroll still changes
 *   the page's height.
 * Measured in Chromium (tests/route-hygiene.mjs, the placement and traverse checks); WebKit and Firefox not run.
 * A scrollbar drag fires no input event, so under ScrollSmoother the content follows the thumb unsmoothed.
 */
import { prefersReducedMotion } from '../config'

export type ScrollAuthority = 'native' | 'lenis' | 'smoother'

export interface SmoothScrollHandle {
  /** Who scrolls right now. A Lenis handle reads `native` while reduced motion is on: Lenis is gone until it's off. */
  authority: ScrollAuthority
  /**
   * Scroll to an element, a selector or a y position, through whoever owns scrolling. Element targets land like a native
   * anchor jump: below the page's `scroll-padding-top` (the fixed header) and the target's `scroll-margin-top`.
   * `offset` then shifts the landing (negative leaves more room above), the same under every owner.
   */
  scrollTo(target: string | number | Element, options?: { offset?: number; immediate?: boolean }): void
  /** Freeze page scrolling (a modal is open) and give it back. */
  stop(): void
  start(): void
  /**
   * Something other than the reader's input moved the page (the router, a back/forward restore, an anchor): take up
   * that position at once and drop any smoothing still in flight. followPlacements() calls it; you rarely do.
   */
  adopt(): void
  /** @deprecated The 2.1 name of adopt(); smooth/route.ts's routeChanged() still calls it. */
  sync(): void
  destroy(): void
}

let current: SmoothScrollHandle | null = null

export function stampAuthority(authority: ScrollAuthority): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.scrollAuthority = authority
}

export function clearAuthority(authority: ScrollAuthority): void {
  if (typeof document === 'undefined') return
  const html = document.documentElement
  if (html.dataset.scrollAuthority === authority) delete html.dataset.scrollAuthority
}

export function getScrollAuthority(): ScrollAuthority {
  if (typeof document === 'undefined') return 'native'
  const html = document.documentElement
  const v = html.dataset.scrollAuthority
  if (v === 'lenis' || v === 'smoother') return v
  // No stamp: a site's own Lenis still owns the scroll. (A ScrollSmoother started by hand leaves no mark: start it
  // with createSmoother, which stamps.)
  return !v && html.classList.contains('lenis') ? 'lenis' : 'native'
}

/** The page's live handle (its `authority` says who scrolls now), or null when no authority is running. */
export function currentSmoothScroll(): SmoothScrollHandle | null {
  return current
}

/** @internal Registers the page's one handle; a second live handle is a bug (two smoothers). */
export function registerHandle(handle: SmoothScrollHandle): void {
  if (current && current !== handle && typeof console !== 'undefined') {
    console.warn(
      `[scroll-animation] a ${current.authority} scroll authority is still running while a ${handle.authority} one starts: ` +
        'destroy the first (one scroll authority per page).',
    )
  }
  current = handle
}

/** @internal */
export function unregisterHandle(handle: SmoothScrollHandle): void {
  if (current === handle) current = null
}

/** Native scrolling as a handle, so callers can use one API whoever owns the page. */
export function nativeHandle(): SmoothScrollHandle {
  let stopped = false
  const handle: SmoothScrollHandle = {
    authority: 'native',
    scrollTo(target, options = {}) {
      const y = resolveY(target) - anchorInset(target) + (options.offset ?? 0)
      // A programmatic scroll is motion too: under reduced motion it jumps.
      window.scrollTo({ top: y, behavior: options.immediate || prefersReducedMotion() ? 'instant' : 'smooth' })
    },
    stop() {
      stopped = true
      document.documentElement.style.overflow = 'hidden'
    },
    start() {
      stopped = false
      document.documentElement.style.overflow = ''
    },
    // The native position is the position.
    adopt() {},
    sync() {},
    destroy() {
      // A handle that goes away never leaves the page locked.
      if (stopped) handle.start()
      clearAuthority('native')
    },
  }
  stampAuthority('native')
  return handle
}

/** Document y of a target, for handles that take numbers. */
export function resolveY(target: string | number | Element): number {
  if (typeof target === 'number') return target
  const el = typeof target === 'string' ? document.querySelector(target) : target
  if (!el) return window.scrollY
  return el.getBoundingClientRect().top + window.scrollY
}

/** The space an anchor jump leaves above an element target: the root's scroll-padding-top plus its scroll-margin-top. */
export function anchorInset(target: string | number | Element): number {
  if (typeof target === 'number') return 0
  const el = typeof target === 'string' ? document.querySelector(target) : target
  if (!el) return 0
  const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0
  return padding + margin
}

/** A scroll with no scroll input in this long is a placement (ScrollSmoother). */
export const INTENT_MS = 200
/** Every scroll this soon after a visit began is a placement, whatever the reader's hands were doing. */
export const VISIT_WINDOW_MS = 100

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])

let intentAt = -Infinity
let visitAt = -Infinity
let ownScrollTimer: ReturnType<typeof setTimeout> | undefined

/** @internal The handle's own animated scroll is running: its scroll events are not placements. */
export function markOwnScroll(): void {
  clearTimeout(ownScrollTimer)
  ownScrollTimer = setTimeout(() => (ownScrollTimer = undefined), INTENT_MS)
}

/** @internal True when a scroll event arriving now was not caused by the reader's input. */
export function isPlacement(now: number): boolean {
  return now - visitAt < VISIT_WINDOW_MS || now - intentAt > INTENT_MS
}

/**
 * @internal Makes the handle follow placements (see the header). `foreign`: true when the native position is not the
 * one the authority last wrote (Lenis); without it, the input rule decides (ScrollSmoother). Returns the stop.
 */
export function followPlacements(handle: SmoothScrollHandle, foreign?: () => boolean): () => void {
  let lastVisit = document.documentElement.getAttribute('data-visit')
  let frame = 0
  const intent = () => (intentAt = performance.now())
  const onKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    if (SCROLL_KEYS.has(event.key) && !target?.isContentEditable && !/^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) intent()
  }
  const onScroll = () => {
    const now = performance.now()
    if (foreign) {
      if (foreign()) handle.adopt()
    } else if (ownScrollTimer !== undefined) {
      markOwnScroll()
    } else if (isPlacement(now)) {
      handle.adopt()
    } else {
      // A scroll the input started is still the reader's while its events keep coming (a key's smooth scroll).
      intentAt = Math.max(intentAt, now - INTENT_MS / 2)
    }
  }
  // page.ts dispatches `entrance:phase` when a visit begins; the detail's visit is its counter.
  const onPhase = (event: Event) => {
    const visit = String((event as CustomEvent<{ visit?: number }>).detail?.visit ?? '')
    if (visit === lastVisit) return
    lastVisit = visit
    visitAt = performance.now()
    intentAt = -Infinity
    clearTimeout(ownScrollTimer)
    ownScrollTimer = undefined
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => handle.adopt())))
  }
  const passive = { passive: true, capture: true } as const
  for (const type of ['wheel', 'touchstart', 'touchmove'] as const) window.addEventListener(type, intent, passive)
  window.addEventListener('keydown', onKey, passive)
  window.addEventListener('scroll', onScroll, { passive: true })
  document.addEventListener('entrance:phase', onPhase)
  return () => {
    cancelAnimationFrame(frame)
    for (const type of ['wheel', 'touchstart', 'touchmove'] as const) window.removeEventListener(type, intent, passive)
    window.removeEventListener('keydown', onKey, passive)
    window.removeEventListener('scroll', onScroll)
    document.removeEventListener('entrance:phase', onPhase)
  }
}
