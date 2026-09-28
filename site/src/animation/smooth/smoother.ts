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
 * Reduced motion (followed live): ScrollSmoother's native mode, `smooth: 0`, the mode it also uses on touch screens
 * without smoothTouch: the wrapper is a plain block, nothing is transformed, no data-speed / data-lag effects, and the
 * handle's scrollTo jumps. The smoother itself stays, because the page's ScrollTriggers are bound to its wrapper.
 * Smooth once: ScrollTrigger scrubs under ScrollSmoother use `scrub: true`.
 */
import { REDUCED_MOTION_QUERY } from '../config'
import {
  anchorInset,
  clearAuthority,
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
  let resizeTimer = 0
  const resizeObserver = new ResizeObserver(() => {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => ScrollSmoother.refresh(), 200)
  })
  const contentEl = typeof content === 'string' ? document.querySelector(content) : content
  if (contentEl) resizeObserver.observe(contentEl)
  stampAuthority('smoother')

  const handle: SmoothScrollHandle = {
    authority: 'smoother',
    scrollTo(target, opts = {}) {
      const animate = !opts.immediate && !reduced.matches
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
    destroy() {
      reduced.removeEventListener('change', followReducedMotion)
      window.clearTimeout(resizeTimer)
      resizeObserver.disconnect()
      smoother.kill()
      clearAuthority('smoother')
      unregisterHandle(handle)
    },
  }
  registerHandle(handle)
  return handle
}
