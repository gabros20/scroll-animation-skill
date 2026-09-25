/**
 * smooth/lenis.ts — Lenis as the page's scroll authority, driven by ONE clock.
 *
 * Lenis smooths the REAL scroll position (it calls scrollTo every tick; no transformed wrapper), so position: sticky,
 * IntersectionObserver and Motion's scroll tracking keep working. Its cost: CSS scroll-snap doesn't (use lenis/snap),
 * Safari runs it at 60 fps at most (30 in Low Power Mode) where native scroll would use ProMotion's 120 Hz, and it
 * doesn't scroll over iframes. Read references/scroll-authority.md before choosing it.
 *
 * One clock: Lenis never runs its own requestAnimationFrame here (autoRaf: false). A driver hands it the frame of
 * whatever else animates the page, so the smoothed position and everything that reads it land in the same frame:
 *
 *   import gsap from 'gsap'; import { ScrollTrigger } from 'gsap/ScrollTrigger'
 *   createSmoothScroll({ driver: gsapDriver(gsap, ScrollTrigger) })     // GSAP pages: ticker → Lenis → ScrollTrigger
 *
 *   import { frame, cancelFrame } from 'motion'
 *   createSmoothScroll({ driver: motionDriver(frame, cancelFrame) })    // Motion pages
 *
 *   createSmoothScroll({ driver: rafDriver() })                         // neither
 *
 * Smooth once: under Lenis, GSAP scrubs use `scrub: true` and Motion reads raw `useScroll()`; a second smoothing stage
 * on top makes motion feel late. Reduced motion (followed live): no Lenis; the page scrolls natively.
 */
import Lenis, { type LenisOptions } from 'lenis'

import { REDUCED_MOTION_QUERY } from '../config'
import {
  clearAuthority,
  nativeHandle,
  registerHandle,
  stampAuthority,
  unregisterHandle,
  type SmoothScrollHandle,
} from './authority'

/** Hooks Lenis to a frame source; returns the detach function. */
export type Driver = (lenis: Lenis) => () => void

interface GsapLike {
  ticker: {
    add(cb: (time: number, deltaTime: number, frame: number) => void): unknown
    remove(cb: (time: number, deltaTime: number, frame: number) => void): unknown
    lagSmoothing(threshold: number, adjustedLag?: number): void
  }
}
interface ScrollTriggerLike {
  update(): void
}

/**
 * GSAP's ticker drives Lenis, then ScrollTrigger reads the new position in the same frame (measured: 0 frames late in
 * Chromium and WebKit; without the `scroll` hookup ScrollTrigger is exactly 1 frame behind, S4a). `lagSmoothing(0)` stops
 * GSAP from skipping elapsed time after a stall, which would otherwise make Lenis jump. The tick function is stored so
 * `ticker.remove` removes the function that was added (removing `lenis.raf` instead is a common, silent leak).
 * `destroy()` restores GSAP's DEFAULT lag smoothing (500, 33): GSAP has no getter, so a page that set its own value
 * must set it again after destroying the authority.
 */
export function gsapDriver(gsap: GsapLike, ScrollTrigger: ScrollTriggerLike): Driver {
  return (lenis) => {
    const tick = (time: number) => lenis.raf(time * 1000)
    const onScroll = () => ScrollTrigger.update()
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)
    const off = lenis.on('scroll', onScroll)
    return () => {
      gsap.ticker.remove(tick)
      gsap.ticker.lagSmoothing(500, 33)
      off()
    }
  }
}

type FrameCallback = (data: { timestamp: number }) => void
interface MotionFrameLike {
  setup(cb: FrameCallback, keepAlive?: boolean): unknown
}

/**
 * Motion's frameloop drives Lenis: `motionDriver(frame, cancelFrame)` with both imported from 'motion'.
 *
 * Measured (docs/research/spikes-2026-09.md, S4b): Motion re-measures `useScroll` only on a window `scroll` event, and
 * the browser dispatches that event in the frame AFTER Lenis's scrollTo, so driving Lenis from `frame.update` leaves
 * every `useScroll` value exactly one frame behind. Running Lenis in `frame.setup` (before Motion's read step) and
 * dispatching `scroll` on each Lenis scroll puts the read in the same frame: 0 frames late in Chromium and WebKit.
 * This leans on Motion's current internals; tests/foundation.mjs catches a regression.
 */
export function motionDriver(frame: MotionFrameLike, cancelFrame: (cb: FrameCallback) => void): Driver {
  return (lenis) => {
    const tick: FrameCallback = ({ timestamp }) => lenis.raf(timestamp)
    // Lenis handles its own synthetic `scroll` whenever it isn't mid-smoothing (keyboard, scrollbar, touch, restore,
    // and the reset that ends every smooth scroll) and emits again: without this guard that recurses until the stack
    // overflows.
    let dispatching = false
    const onScroll = () => {
      if (dispatching) return
      dispatching = true
      window.dispatchEvent(new Event('scroll'))
      dispatching = false
    }
    frame.setup(tick, true)
    const off = lenis.on('scroll', onScroll)
    return () => {
      cancelFrame(tick)
      off()
    }
  }
}

/** A plain requestAnimationFrame loop, for pages with no animation engine. */
export function rafDriver(): Driver {
  return (lenis) => {
    let id = 0
    const loop = (time: number) => {
      lenis.raf(time)
      id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }
}

export interface SmoothScrollOptions {
  driver: Driver
  /** Lenis options. `autoRaf` is always false (the driver is the clock); `anchors` is handled below. */
  lenis?: Omit<LenisOptions, 'autoRaf' | 'anchors'>
  /**
   * Same-page `#hash` links scroll through Lenis. They land below the page's `scroll-padding-top` (css/animation.css sets
   * it from --header-h) and the target's `scroll-margin-top`, like a native anchor jump. Default true.
   */
  anchors?: boolean
}

/**
 * Start Lenis (native scrolling under reduced motion) and return the page's scroll handle. Reduced motion is followed
 * live: when the visitor turns it on, Lenis is torn down and the page scrolls natively; off again, Lenis comes back
 * from the current position. The handle stays the same object, so callers never hold a dead one.
 */
export function createSmoothScroll(options: SmoothScrollOptions): SmoothScrollHandle {
  if (typeof window === 'undefined') return nativeHandle()

  const reduced = window.matchMedia(REDUCED_MOTION_QUERY)
  let lenis: Lenis | null = null
  let native: SmoothScrollHandle | null = null
  let detach = () => {}
  let offAnchors = () => {}
  // A modal's stop() holds across a switch.
  let stopped = false

  const startLenis = () => {
    native?.destroy()
    native = null
    lenis = new Lenis({ ...options.lenis, autoRaf: false, anchors: false })
    detach = options.driver(lenis)
    offAnchors = options.anchors === false ? () => {} : wireAnchors(lenis)
    stampAuthority('lenis')
    handle.authority = 'lenis'
    // A reload mid-page restores the native position before Lenis exists; start Lenis there, not at 0.
    lenis.scrollTo(window.scrollY, { immediate: true })
    if (stopped) lenis.stop()
  }
  const stopLenis = () => {
    if (lenis) {
      offAnchors()
      detach()
      lenis.destroy()
      lenis = null
      clearAuthority('lenis')
    }
    native = nativeHandle()
    handle.authority = 'native'
    if (stopped) native.stop()
  }

  const handle: SmoothScrollHandle = {
    authority: 'lenis',
    scrollTo(target, opts = {}) {
      // Lenis applies scroll-padding-top and scroll-margin-top to element targets; `offset` shifts further.
      if (lenis) lenis.scrollTo(target as never, { offset: opts.offset ?? 0, immediate: opts.immediate })
      else native?.scrollTo(target, opts)
    },
    stop() {
      stopped = true
      if (lenis) lenis.stop()
      else native?.stop()
    },
    start() {
      stopped = false
      if (lenis) lenis.start()
      else native?.start()
    },
    destroy() {
      reduced.removeEventListener('change', onReducedChange)
      if (lenis) {
        offAnchors()
        detach()
        lenis.destroy()
        lenis = null
        clearAuthority('lenis')
      }
      native?.destroy()
      native = null
      unregisterHandle(handle)
    },
  }

  const onReducedChange = () => (reduced.matches ? stopLenis() : startLenis())
  reduced.addEventListener('change', onReducedChange)
  if (reduced.matches) stopLenis()
  else startLenis()
  registerHandle(handle)
  return handle
}

function wireAnchors(lenis: Lenis): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
    const link = (event.target as Element | null)?.closest?.('a[href*="#"]') as HTMLAnchorElement | null
    if (!link || link.origin !== location.origin || link.pathname !== location.pathname || !link.hash) return
    const target = document.getElementById(decodeURIComponent(link.hash.slice(1)))
    if (!target) return
    event.preventDefault()
    // Lenis 1.3 subtracts the root's scroll-padding-top and the target's scroll-margin-top itself.
    lenis.scrollTo(target)
    history.pushState(null, '', link.hash)
  }
  document.addEventListener('click', onClick)
  return () => document.removeEventListener('click', onClick)
}
