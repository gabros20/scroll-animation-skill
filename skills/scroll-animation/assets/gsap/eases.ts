import gsap from 'gsap'
import { CustomEase } from 'gsap/CustomEase'

import { ENGAGE_PX, ENGAGE_QUERY } from './config'

// Re-exported for existing imports of `ENGAGE_QUERY` from this module (and
// `index.ts`'s barrel export) — the constant itself is declared once, in
// `./config`, not here. See that file's docblock for why, and for how to
// point it at a non-default `bands.desktop.minWidth`.
export { ENGAGE_PX, ENGAGE_QUERY }

/**
 * cubic-bezier(x1, y1, x2, y2) → a GSAP CustomEase path.
 *
 * A single cubic Bézier segment from (0,0) to (1,1) with control points
 * (x1,y1) and (x2,y2) is *exactly* what CSS's `cubic-bezier()` describes —
 * and it is also valid CustomEase path syntax (`M0,0 C x1,y1 x2,y2 1,1`),
 * since CustomEase's coordinate space is time 0..1 by progress 0..1, the
 * same space cubic-bezier() uses. So a measured CSS curve carries over to
 * GSAP verbatim, with no resampling or curve-fitting.
 */
function cubicBezierPath(x1: number, y1: number, x2: number, y2: number): string {
  return `M0,0,C${x1},${y1},${x2},${y2},1,1`
}

/** Names registered by `registerEases()` — pass these as a tween's `ease`. */
export const EASE_NAMES = {
  entrance: 'fluid-entrance',
  roll: 'fluid-roll',
  disclosure: 'fluid-disclosure'
} as const

let registered = false

/**
 * Registers the measured cubic-bezier curves below as named CustomEases.
 *
 * Idempotent and safe to call from every module that needs one of them —
 * `initFluidMotion` calls it once up front, so in practice this is a no-op
 * everywhere else, but nothing here depends on import order.
 */
export function registerEases(): void {
  if (registered) return
  registered = true
  gsap.registerPlugin(CustomEase)
  CustomEase.create(EASE_NAMES.entrance, cubicBezierPath(0.15, 0.6, 0.2, 1))
  CustomEase.create(EASE_NAMES.roll, cubicBezierPath(0, 0, 0.58, 1))
  CustomEase.create(EASE_NAMES.disclosure, cubicBezierPath(0.23, 1, 0.32, 1))
}

/**
 * The motion constants from `references/attribute-contract.md` §4 — identical in both engines. Keep
 * this the single source of these numbers; do not hand-copy one into a
 * component. Every duration/ease pair here was measured against a reference
 * capture (frame-by-frame ink-centroid tracking — see the reference build's
 * `references/motion-architecture.md` §8), not chosen by eye.
 */
export const MOTION = {
  /**
   * The page-load entrance curve — the movement half of a stage item.
   * Fitted frame-by-frame against a reference capture (29 samples, RMSE
   * 0.0017): a first-order exponential approach, no overshoot anywhere.
   */
  entrance: { duration: 1.3, ease: EASE_NAMES.entrance },
  /**
   * The opacity half of an entrance — deliberately NOT the movement's
   * timing. In the reference the moves run 1.30s while the fades take
   * ~0.17s and trail the move by ~0.13s, which is what makes a line-by-line
   * stagger visible at all: run opacity on the movement's duration instead
   * and every line is already legible before anything is uncovered.
   */
  entranceFade: { duration: 0.17, delay: 0.13, ease: 'none' as const },
  /**
   * The load overlay's dissolve. Measured at ~4 frames (0.13s) after a
   * 0.17s hold, essentially linear. The delay is the trick: content starts
   * moving underneath at t=0, so the veil lifts once it is already ~54%
   * travelled — the reveal reads as catching something mid-flight.
   */
  veil: { duration: 0.13, delay: 0.17, ease: 'none' as const },
  /**
   * A CTA label roll — fitted frame-by-frame against a reference capture
   * (200×76 @ 59.94fps, 17 sample points, RMS 0.48px). Every other
   * candidate curve tried fit visibly worse; do not swap this for a spring.
   */
  roll: { duration: 0.3, ease: EASE_NAMES.roll },
  /**
   * A disclosure panel opening or closing. The strong ease-out, not the
   * built-in one — built-in `ease-out` spends its back half creeping, which
   * reads as sluggish at this duration.
   */
  disclosure: { duration: 0.24, ease: EASE_NAMES.disclosure },
  /**
   * A positional indicator moving between the things it marks — a
   * critically damped spring (bounce 0) in the reference. GSAP ships no
   * spring-physics plugin, so there is no drop-in equivalent; `power3.out`
   * at the same duration is the closest non-overshooting stand-in and
   * should be retuned by ear per use rather than trusted as measured.
   */
  indicator: { duration: 0.35, ease: 'power3.out' as const },
  /** Seconds between staggered lines within one stage. */
  lineStagger: 0.067
} as const

/**
 * IntersectionObserver `rootMargin` strings — `references/attribute-contract.md` §4. Reads like
 * GSAP's `start: 'top 80%'` convention. Keep these here rather than per
 * call site; they are a single editorial decision about pacing.
 */
export const TRIGGERS = {
  /** Below-the-fold reveals: fires at 80% of the viewport height. */
  reveal: '0px 0px -20% 0px',
  /**
   * The page's last group (a footer), or any group whose RESTING scroll
   * position sits below an inset trigger line — nothing ever scrolls
   * across an inset line at a place the page comes to rest, so an offset
   * trigger there is starved permanently rather than merely late.
   */
  pageEnd: '0px',
  atRest: '0px'
} as const

/**
 * The one spring every scroll-driven effect in the reference build passes
 * through — kept here for parity even though GSAP tweens take a
 * duration/ease pair rather than stiffness/damping. Useful if a consumer
 * builds their own physics-based smoothing on top of a raw scroll read.
 */
export const SCROLL_SPRING = { stiffness: 120, damping: 30, restDelta: 0.001 } as const

/** Whether the visitor has asked the OS for reduced motion — checked live,
 * never cached, since every manual writer in this package re-reads it. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
