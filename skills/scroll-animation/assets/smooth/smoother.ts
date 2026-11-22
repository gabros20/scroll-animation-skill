/**
 * smooth/smoother.ts — GSAP ScrollSmoother as the page's scroll authority.
 *
 * ScrollSmoother moves the page by transforming `#smooth-content` inside a fixed `#smooth-wrapper`. That buys zero
 * sync code with ScrollTrigger and the `data-speed` / `data-lag` effects (including `data-speed="auto"` for an image
 * that parallaxes inside its frame). It costs: `position: sticky` and `position: fixed` inside the content stop working
 * (pin with ScrollTrigger; keep fixed UI such as the header OUTSIDE the wrapper), and CSS scroll/view timelines inside
 * the content never progress. Choose it for GSAP-only pages; read references/scroll-authority.md first.
 *
 *   <body>
 *     <header class="site-header">…</header>          <!-- fixed UI stays outside -->
 *     <div id="smooth-wrapper"><div id="smooth-content">…page…</div></div>
 *   </body>
 *
 *   import gsap from 'gsap'; import { ScrollTrigger } from 'gsap/ScrollTrigger'; import { ScrollSmoother } from 'gsap/ScrollSmoother'
 *   gsap.registerPlugin(ScrollTrigger, ScrollSmoother)
 *   const scroll = createSmoother(ScrollSmoother, { smooth: 1, effects: true })
 *
 * Reduced motion (followed live): ScrollSmoother's native mode, `smooth: 0`, with effects off: the wrapper is a plain
 * block, nothing is transformed, no data-speed / data-lag, and the handle's scrollTo jumps. The smoother itself stays,
 * because the page's ScrollTriggers are bound to its wrapper. Smooth once: ScrollTrigger scrubs under ScrollSmoother
 * use `scrub: true`.
 *
 * Touch-only screens (ScrollTrigger.isTouch 1) get the same native mode without smoothTouch, but effects still run,
 * written from the main thread as the page scrolls natively. Every ScrollTrigger reads the wrapper, a proxy the
 * smoother's own trigger sets to the window's scroll first in each update, so triggers fire as on a native page.
 *
 * A page loaded with a hash (`/page#section`) lands on it: the browser's own fragment jump races the smoother (the
 * body has no scroll height until the first refresh, and a refresh puts back the scroll it recorded), so it would
 * stay at the top. The handle owns the landing, once, right after the first refresh.
 *
 * A link to a hash on another page (a client navigation) lands on it too. A router lands a fragment with
 * scrollIntoView() (Next does), which here scrolls the fixed wrapper or the page against content that is still
 * transformed to the old position: the page ended somewhere else (measured: the target 1150 px above the viewport).
 * So when a push visit begins with a hash, the handle puts the wrapper's own scroll back to 0 and lands the page on
 * the target itself, below scroll-padding-top like a native anchor, and once more after the visit's refresh. The
 * wrapper is put back whenever anything scrolls it (a focus scroll does), the page moved by that much instead.
 */
// gsap's index declares its plugin modules: 'gsap/ScrollTrigger' has no types of its own. A type-only import, not a
// triple-slash reference (eslint-config-next forbids those).
import type {} from 'gsap'
// No new bytes: ScrollSmoother runs only with ScrollTrigger registered, and this is the specifier gsap/setup.ts and
// the usage above register. Register it from `gsap/ScrollTrigger` too: another path (`gsap/dist/…`) is a second copy,
// whose `refresh` never fires here, and the hash landing silently never happens.
import { ScrollTrigger } from 'gsap/ScrollTrigger'

import { REDUCED_MOTION_QUERY } from '../config'
import {
  anchorInset,
  clearAuthority,
  followPlacements,
  markOwnScroll,
  nativeHandle,
  registerHandle,
  stampAuthority,
  unregisterHandle,
  type SmoothScrollHandle,
} from './authority'

interface ScrollSmootherInstance {
  scrollTo(target: unknown, smooth?: boolean, position?: string): void
  paused(value: boolean): unknown
  kill(): void
  /** Where the content is drawn (the smoothed position), as a scroll offset. */
  scrollTop(): number
}
interface ScrollSmootherStatic {
  create(vars: Record<string, unknown>): ScrollSmootherInstance
  refresh(safe?: boolean): void
}

export interface SmootherOptions {
  /** Seconds of catch-up. 1 is GSAP's documented default feel. */
  smooth?: number
  /** Turn on `data-speed` / `data-lag`. */
  effects?: boolean
  /** Touch smoothing; false keeps native touch scrolling (recommended). */
  smoothTouch?: number | false
  wrapper?: string | Element
  content?: string | Element
}

export function createSmoother(ScrollSmoother: ScrollSmootherStatic, options: SmootherOptions = {}): SmoothScrollHandle {
  if (typeof window === 'undefined') return nativeHandle()

  const reduced = window.matchMedia(REDUCED_MOTION_QUERY)
  const content = options.content ?? '#smooth-content'
  const create = () =>
    ScrollSmoother.create({
      wrapper: options.wrapper ?? '#smooth-wrapper',
      content,
      smooth: reduced.matches ? 0 : (options.smooth ?? 1),
      effects: !reduced.matches && (options.effects ?? false),
      smoothTouch: reduced.matches ? false : (options.smoothTouch ?? false),
      autoResize: false,
    })
  let smoother = create()
  let paused = false

  // A reduced-motion change re-creates the smoother in the other mode. Every ScrollTrigger on the page is bound to the
  // wrapper, so killing the smoother alone would strand them; a new one on the same wrapper rebinds them (GSAP's own
  // path for triggers made before the smoother), and the reader stays where they were.
  const followReducedMotion = () => {
    smoother.kill()
    smoother = create()
    if (paused) smoother.paused(true)
  }
  reduced.addEventListener('change', followReducedMotion)

  // Replaces ScrollSmoother's autoResize, which refreshes only the smoother's own trigger: one that lands in the first
  // 0.5 s after creation replays the scroll from the top while the page is scrolled (GSAP 3.15; a reload mid-page, a
  // reduced-motion switch), and the page's other triggers keep stale positions. A full refresh has neither problem.
  // Safe (`refresh(true)`): mid-scroll it waits for the scroll to end, so a lazy image decoding under the reader's
  // finger never re-measures the page, or re-pins a pin, while they scroll.
  let resizeTimer = 0
  const resizeObserver = new ResizeObserver(() => {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => ScrollSmoother.refresh(true), 200)
  })
  const contentEl = typeof content === 'string' ? document.querySelector(content) : content
  if (contentEl) resizeObserver.observe(contentEl)
  stampAuthority('smoother')

  // The hash landing, after the first refresh (ScrollTrigger dispatches `refresh` once it has put the recorded scroll
  // back), as an immediate jump with the same landing as a native anchor (the handle's scrollTo).
  let destroyed = false
  const landOnHash = () => {
    ScrollTrigger.removeEventListener('refresh', landOnHash)
    const el = hashTarget()
    if (el && !destroyed) handle.scrollTo(el, { immediate: true })
  }
  if (hashTarget()) ScrollTrigger.addEventListener('refresh', landOnHash)

  // The wrapper is a clipped, fixed box: nothing should scroll it, but scrollIntoView() and focus can.
  const wrapperEl = typeof options.wrapper === 'object' ? options.wrapper : document.querySelector(options.wrapper ?? '#smooth-wrapper')
  const resetWrapper = (): number => {
    const moved = wrapperEl?.scrollTop ?? 0
    if (wrapperEl && (moved || wrapperEl.scrollLeft)) {
      wrapperEl.scrollTop = 0
      wrapperEl.scrollLeft = 0
    }
    return moved
  }
  // A push visit that began with a hash still owes its landing (page.ts dispatches `entrance:phase` per visit).
  let hashOwed = false
  let lastVisit = document.documentElement.getAttribute('data-visit')
  const relandOnRefresh = () => {
    ScrollTrigger.removeEventListener('refresh', relandOnRefresh)
    const el = hashTarget()
    if (el && !destroyed) handle.scrollTo(el, { immediate: true })
  }
  const onVisit = (event: Event) => {
    const detail = (event as CustomEvent<{ visit?: number; kind?: string }>).detail
    const visit = String(detail?.visit ?? '')
    if (visit === lastVisit) return
    lastVisit = visit
    ScrollTrigger.removeEventListener('refresh', relandOnRefresh)
    hashOwed = detail?.kind === 'push' && !!hashTarget()
  }
  document.addEventListener('entrance:phase', onVisit)
  const onWrapperScroll = () => {
    if (hashOwed) return handle.adopt()
    const moved = resetWrapper()
    if (moved) smoother.scrollTo(window.scrollY + moved, false)
  }
  wrapperEl?.addEventListener('scroll', onWrapperScroll, { passive: true })

  const handle: SmoothScrollHandle = {
    authority: 'smoother',
    scrollTo(target, opts = {}) {
      const animate = !opts.immediate && !reduced.matches
      if (animate) markOwnScroll()
      if (typeof target === 'number') {
        smoother.scrollTo(target + (opts.offset ?? 0), animate)
      } else {
        // "<element edge> <viewport edge>": the element's top lands `inset - offset` px below the viewport's top, the
        // same landing as a native anchor jump (scroll-padding-top + scroll-margin-top), shifted by `offset`.
        const inset = anchorInset(target) - (opts.offset ?? 0)
        const el = typeof target === 'string' ? document.querySelector(target) : target
        smoother.scrollTo(el ?? target, animate, `top ${inset}px`)
      }
    },
    stop() {
      paused = true
      smoother.paused(true)
    },
    start() {
      paused = false
      smoother.paused(false)
    },
    adopt() {
      resetWrapper()
      const el = hashOwed ? hashTarget() : null
      if (el) {
        // The visit's hash: the landing is this handle's, now and once more when the visit's refresh has measured
        // the new page.
        hashOwed = false
        handle.scrollTo(el, { immediate: true })
        ScrollTrigger.addEventListener('refresh', relandOnRefresh)
        return
      }
      // The content eases toward the native scroll over `smooth` seconds; a placement jumps it there instead
      // (`scrollTo(y, false)` jumps, and works while paused). Only when it is somewhere else: the jump writes the scroll
      // back, and in Firefox a scroll written while back or forward's restore is still pending (the page left was too
      // short for the position) cancels the restore. The adopt two frames after a traverse began found the content
      // where the scroll was, wrote it anyway, and the reader stayed where the page they left was. Measured in
      // Chromium, WebKit and Firefox: tests/route-hygiene.mjs F4 and F5.
      if (Math.abs(smoother.scrollTop() - window.scrollY) < 1) return
      smoother.scrollTo(window.scrollY, false)
    },
    sync() {
      handle.adopt()
    },
    destroy() {
      destroyed = true
      stopFollowing()
      document.removeEventListener('entrance:phase', onVisit)
      wrapperEl?.removeEventListener('scroll', onWrapperScroll)
      ScrollTrigger.removeEventListener('refresh', relandOnRefresh)
      ScrollTrigger.removeEventListener('refresh', landOnHash)
      reduced.removeEventListener('change', followReducedMotion)
      window.clearTimeout(resizeTimer)
      resizeObserver.disconnect()
      smoother.kill()
      clearAuthority('smoother')
      unregisterHandle(handle)
    },
  }
  const stopFollowing = followPlacements(handle)
  registerHandle(handle)
  return handle
}

/** The element the URL's fragment names, if any. */
function hashTarget(): HTMLElement | null {
  const raw = window.location.hash.slice(1)
  if (!raw) return null
  try {
    return document.getElementById(decodeURIComponent(raw))
  } catch {
    // A malformed escape: try it as written.
    return document.getElementById(raw)
  }
}
