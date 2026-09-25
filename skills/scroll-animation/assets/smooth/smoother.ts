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
 * Reduced motion: no smoother; the wrapper divs stay as plain blocks and the page scrolls natively.
 * Smooth once: ScrollTrigger scrubs under ScrollSmoother use `scrub: true`.
 */
import { prefersReducedMotion } from '../config'
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
  if (typeof window === 'undefined' || prefersReducedMotion()) {
    const native = nativeHandle()
    registerHandle(native)
    const destroy = native.destroy
    native.destroy = () => {
      destroy()
      unregisterHandle(native)
    }
    return native
  }

  const smoother = ScrollSmoother.create({
    wrapper: options.wrapper ?? '#smooth-wrapper',
    content: options.content ?? '#smooth-content',
    smooth: options.smooth ?? 1,
    effects: options.effects ?? false,
    smoothTouch: options.smoothTouch ?? false,
  })
  stampAuthority('smoother')

  const handle: SmoothScrollHandle = {
    authority: 'smoother',
    scrollTo(target, opts = {}) {
      if (typeof target === 'number') {
        smoother.scrollTo(target + (opts.offset ?? 0), !opts.immediate)
      } else {
        // "<element edge> <viewport edge>": the element's top lands `inset - offset` px below the viewport's top, the
        // same landing as a native anchor jump (scroll-padding-top + scroll-margin-top), shifted by `offset`.
        const inset = anchorInset(target) - (opts.offset ?? 0)
        const el = typeof target === 'string' ? document.querySelector(target) : target
        smoother.scrollTo(el ?? target, !opts.immediate, `top ${inset}px`)
      }
    },
    stop: () => void smoother.paused(true),
    start: () => void smoother.paused(false),
    destroy() {
      smoother.kill()
      clearAuthority('smoother')
      unregisterHandle(handle)
    },
  }
  registerHandle(handle)
  return handle
}
