import type { Transition } from 'motion/react'

/**
 * Where the measured curves in this file come from.
 *
 * Several of these are NOT chosen — they are fitted, frame-by-frame, against a
 * brand motion reference capture (a short reel of the entrance/hover moments
 * this system reproduces). Where a docblock below says "measured", the number
 * came from that process, not taste, and changing it re-opens work that was
 * already done once. Keep the number.
 */
export const transitions = {
  smooth: {
    duration: 0.6,
    ease: [0.25, 0.1, 0.25, 1]
  },
  fast: {
    duration: 0.2,
    ease: 'easeOut'
  },
  slow: {
    duration: 1,
    ease: [0.16, 1, 0.3, 1]
  },
  verySlow: {
    duration: 1.5,
    ease: [0.25, 0.1, 0.25, 1]
  },
  spring: {
    type: 'spring',
    stiffness: 100,
    damping: 15
  },
  gentleSpring: {
    type: 'spring',
    stiffness: 50,
    damping: 20
  },
  snappySpring: {
    type: 'spring',
    stiffness: 400,
    damping: 30
  },

  /**
   * The page-load entrance curve — MEASURED, not chosen.
   *
   * Fitted frame-by-frame against the reference build's brand motion capture:
   * 29 samples of the hero title's ink centroid, RMSE 0.0017. Every element in
   * that reference — header, eyebrow, title, CTA, partner row — shares this
   * one curve and this one duration, which is what makes the entrance read as
   * a single gesture rather than a pile of animations.
   *
   * It behaves like a first-order exponential approach (τ ≈ 0.27s): 54% of the
   * distance is covered in the first 0.20s, 90% by 0.60s, then a long quiet
   * tail. No overshoot anywhere in the reference — do not "improve" this into
   * a spring.
   */
  entrance: {
    duration: 1.3,
    ease: [0.15, 0.6, 0.2, 1]
  },

  /**
   * The opacity half of an entrance — deliberately NOT the movement's timing.
   *
   * In the reference the moves run 1.30s while the fades take ~0.17s, and the
   * fades TRAIL the move by ~0.13s. That offset is the whole reason a
   * line-by-line stagger is visible: the veil clears at 0.30s, and at exactly
   * that moment title line 1 is solid, line 2 is ~60% and line 3 is ~20%.
   * Measured against the reference at the same instant: 100% / 64% / 21%.
   *
   * Run opacity on the movement's 1.3s instead and every line is already
   * legible before the page is uncovered — the stagger still happens, but
   * nobody ever sees it.
   */
  entranceFade: {
    duration: 0.17,
    delay: 0.13,
    ease: 'linear'
  },

  /**
   * The load overlay's dissolve. Measured at 4 frames (~0.13s) after a 0.17s
   * hold, and essentially linear — the reference does not ease it.
   *
   * The delay is the whole trick: the content starts moving at t=0 underneath,
   * so the page is uncovered when it is already ~54% travelled and still
   * moving fast. That is what makes the reveal feel like catching something
   * mid-flight instead of watching an animation begin.
   */
  veil: {
    duration: 0.13,
    delay: 0.17,
    ease: 'linear'
  },

  /**
   * A label roll — MEASURED, not chosen, against a reference capture of a
   * button hover (200x76 @ 59.94fps): the label's vertical offset was
   * recovered by cross-correlating each frame's ink-contrast row profile
   * against the settled one, giving sub-pixel travel at 17 sample points.
   *
   *   t(ms)  0   17    50    83   117   150   200   250   284
   *   y(px)  0  5.0  12.75  20.0  28.0  35.0  43.0  49.0  51.0
   *
   * `ease-out` = cubic-bezier(0, 0, .58, 1) at 0.30s fits this to RMS 0.48px;
   * the measured initial slope of 1.75 is the curve's own 1/0.58 = 1.72. Every
   * other candidate tried (`ease`, `ease-in-out`, expo/quart-out, Material
   * standard) fit visibly worse — do not swap this for a spring.
   *
   * The colour invert underneath runs on the SAME curve and duration; that is
   * measured too, and it is what produces the low-contrast olive-on-olive
   * moment halfway through. Splitting them breaks the effect.
   */
  roll: {
    duration: 0.3,
    ease: [0, 0, 0.58, 1]
  },

  /**
   * A disclosure panel opening or closing — an accordion, and the token to
   * reuse for the next one.
   *
   * `height` is the animated property here, which is normally forbidden: it
   * costs layout on EVERY frame where a transform costs none. An accordion is
   * the sanctioned exception, because there is no transform that expresses
   * "the content below me moves down by exactly the height of what just
   * appeared" — a `scaleY` would squash the type and leave the document behind
   * it teleporting anyway.
   *
   * That cost is why this is 0.24s and not 0.4: a long height animation is
   * expensive as well as sluggish. It sits inside the 150–250ms band for a
   * dropdown-scale disclosure.
   *
   * The curve is the strong ease-out, not the built-in one. Built-in
   * `ease-out` (cubic-bezier(0, 0, .58, 1)) is too weak to read as decisive at
   * this duration — it spends its back half creeping. This one covers ~80% of
   * the distance in the first third, so the panel is effectively open while
   * the tail settles.
   *
   * Ease-OUT rather than ease-in-out for both directions, including the close:
   * the user has already decided by the time they tap, so the motion should
   * leave immediately and decelerate into place, never start slow.
   */
  disclosure: {
    duration: 0.24,
    ease: [0.23, 1, 0.32, 1]
  },

  /**
   * A positional INDICATOR moving between the things it marks — a tab
   * underline, an active-row marker, a table-of-contents chevron.
   *
   * A spring rather than a duration, because the distance is not fixed: the
   * same curve that feels right stepping to the next row is sluggish jumping
   * ten rows down after a fast scroll. A spring is scale-free, and it
   * retargets carrying velocity — which matters here, since scrolling can fire
   * a new target on nearly every frame.
   *
   * **`bounce: 0`, and that is the whole point of it being its own token.**
   * `snappySpring` (stiffness 400, damping 30) is underdamped — damping ratio
   * 0.75 — and measured on a 16px row it overshot the target by 10px before
   * settling: the marker visibly passed the row it was pointing at and came
   * back. Overshoot reads as life on a drawer or a drag; on something whose
   * entire job is to say WHICH ROW, it reads as pointing at the wrong one.
   *
   * `duration` on a spring is Motion's perceptual duration, not a clamp — the
   * spring still absorbs interruptions, this only sets how long an
   * uninterrupted settle takes.
   */
  indicator: {
    type: 'spring',
    duration: 0.35,
    bounce: 0
  }
} as const satisfies Record<string, Transition>
