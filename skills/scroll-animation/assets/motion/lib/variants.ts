import type { Variants } from 'motion/react'

/**
 * Page-load entrance variants — a shared vocabulary fitted to a brand motion
 * reference capture.
 *
 * The reference's entire vocabulary is `translateY` + `opacity` on one curve.
 * There is no scale, no mask beyond line boxes, no spring, no blur (the
 * softness in the reference render is camera motion blur, not a designed
 * filter). Keep it that way — the economy is the style.
 *
 * ## Distances live in CSS variables
 *
 * Every offset reads `var(--hero-*)` — the DOM attribute contract's tier-1
 * responsive pattern: callers vary the distance per breakpoint with a plain
 * CSS utility and zero JS, and Motion resolves the variable from computed
 * style at animation start.
 *
 *     <StageItem variant="drop" className="[--hero-drop:-96px] lg:[--hero-drop:-120px]">
 *
 * The variable carries the SIGNED offset. `drop` and `settle` start ABOVE
 * their resting place (negative) and travel down; `lift` starts below and
 * travels up. That opposition is the reference's signature: an eyebrow
 * descends while a title rises, so the two converge on their design gap
 * rather than sliding in as one block.
 */
export const entranceVariants = {
  /** A header-weight element: enters from clear of the viewport top and
   * settles. No fade. */
  drop: {
    hidden: { y: 'var(--hero-drop, -96px)' },
    visible: { y: 0 }
  },

  /** An eyebrow-weight element: a short descent against a title's rise. No
   * fade. */
  settle: {
    hidden: { y: 'var(--hero-settle, -24px)' },
    visible: { y: 0 }
  },

  /**
   * `settle` plus the fade — the pair `liftFade` is to `lift`.
   *
   * For a hero whose eyebrow arrives with its title rather than merely
   * landing against it. Skip the fade where a page-load veil is already
   * covering the whole composition (`StageVeil` does that work); reach for
   * this on a veil-less arrival, where the descent alone reads as the chip
   * sliding rather than arriving.
   *
   * Same caveat as `liftFade`: `opacity: 0` is what gets server-rendered, so
   * the element is invisible until the stage can start. Fine for a chip or a
   * label; think twice before putting it on body copy.
   */
  settleFade: {
    hidden: { y: 'var(--hero-settle, -24px)', opacity: 0 },
    visible: { y: 0, opacity: 1 }
  },

  /** CTA / partner marks: rise into place. No fade — movement only. */
  lift: {
    hidden: { y: 'var(--hero-lift, 32px)' },
    visible: { y: 0 }
  },

  /**
   * Rise AND fade — a headline treatment, and the supporting labels.
   *
   * This is what the reference's title lines actually do, and it is worth
   * being explicit that it is NOT a masked/clip-path reveal: measured cap
   * height is a constant 94-95px in every frame of the reference, so the type
   * is never cut by a line box. Whole lines translate and fade.
   *
   * Pair it with `transitions.entranceFade` so the opacity runs short and
   * late against the long movement — see that token for why.
   */
  liftFade: {
    hidden: { y: 'var(--hero-lift, 32px)', opacity: 0 },
    visible: { y: 0, opacity: 1 }
  },

  /**
   * A bar growing out of its own base — a comparison chart's candles.
   *
   * **`scaleY`, deliberately not `height`.** `height` is a layout property:
   * animating it reflows the whole row on every frame. `scaleY` is
   * GPU-composited and, on a plain filled rect with no content inside, pixel
   * identical.
   *
   * If a `--bar-*` variable already carries the layout height, this only
   * rides on top of what that already resolved.
   *
   * Requires `origin-bottom` on the element, or it grows from the middle.
   */
  growY: {
    hidden: { scaleY: 0 },
    visible: { scaleY: 1 }
  },

  /**
   * The same move on the other axis — a bar filling from its own left edge.
   * `scaleX` rather than `width` for exactly `growY`'s reason, and it carries
   * `growY`'s constraint too: the element must be `origin-left`, or the fill
   * opens outward from its own middle and reads as two bars.
   */
  growX: {
    hidden: { scaleX: 0 },
    visible: { scaleX: 1 }
  }
} as const satisfies Record<string, Variants>

export type EntranceVariant = keyof typeof entranceVariants

/**
 * The load overlay.
 *
 * INVERTED on purpose: its `hidden` state is the OPAQUE one. It has to share
 * the stage's `hidden`/`visible` state names to receive variant propagation,
 * and the stage's "hidden" is the moment the page is covered.
 *
 * `transitionEnd` drops it out of the compositing tree once it has faded, so a
 * full-viewport layer isn't left behind for the rest of the session.
 */
export const veilVariants: Variants = {
  hidden: { opacity: 1 },
  visible: { opacity: 0, transitionEnd: { visibility: 'hidden' } }
}
