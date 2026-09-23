import type { useScroll } from 'motion/react'

/**
 * The one spring every scroll-driven effect should pass through.
 *
 * This is where a site's "smoothness" should live, and deliberately NOT on
 * the scrollbar. Reach for a scroll-smoothing library (Lenis and similar) and
 * you inherit its lerp reshaping the native velocity curve that scroll-linked
 * effects read — it can mis-route velocity-sensitive branching in anything
 * downstream, and it buys nothing on iOS. Motion has no smooth-scroll API
 * either, by design.
 *
 * So the momentum goes on the OUTPUTS: parallax layers, pinned scenes and any
 * scroll-linked transform read as weighted and eased, while the scroll itself
 * stays native — scrollbar, keyboard, trackpad, iOS touch, find-in-page,
 * anchor links and screen readers all behave. Visitors judge smoothness by
 * what they watch; what they drive should stay theirs.
 *
 * Tune here, once. Raising `damping` makes the whole page feel heavier.
 */
export const scrollSpring = {
  stiffness: 120,
  damping: 30,
  restDelta: 0.001,
  /**
   * Required, not optional — the Motion docs call it out for exactly this
   * case. Without it the spring animates up from 0 on mount, so a page
   * restored mid-scroll visibly slides into position instead of just being
   * there.
   */
  skipInitialAnimation: true
} as const

/**
 * `useScroll`'s offset pair, derived from the hook rather than restated —
 * Motion does not export it by name and a hand-written union would rot.
 *
 * Declare offsets as module-level constants of this type. The array has to be
 * mutable to satisfy the hook, so `as const` is out; a module constant gives
 * the stable identity that `as const` would otherwise have provided, which
 * keeps the subscription from churning on every render.
 */
export type ScrollOffset = NonNullable<NonNullable<Parameters<typeof useScroll>[0]>['offset']>

/**
 * `scrollSpring` widened. The token itself is `as const` so its literals are
 * documentation, but anything that can be RETUNED (a dev tool's live slider)
 * needs the plain numeric shape.
 */
export interface ScrollSpringConfig {
  stiffness: number
  damping: number
  restDelta: number
  skipInitialAnimation: boolean
}
