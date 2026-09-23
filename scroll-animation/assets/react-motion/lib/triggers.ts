/**
 * Where a scroll-triggered reveal fires — the site's two trigger lines.
 *
 * Both are IntersectionObserver `rootMargin` strings, passed to `Stage`'s
 * `margin` (or `useInView`'s). A negative bottom value pulls the detection
 * box's bottom edge UP by that fraction of the viewport, so the line sits
 * that far above the bottom of the screen and an element fires when its top
 * crosses it. The convention reads like GSAP's `start: 'top <n>%'`.
 *
 * Keep the numbers here rather than per section. They are a single editorial
 * decision about pacing, and eight copies of one decision drift.
 */

/**
 * The reveal line for every below-the-fold section: 80% of the viewport
 * height (`rootMargin` bottom −20%).
 *
 * An earlier editorial default was −35% (line at 65%). That waited until
 * content was ~a third on screen; on tall heroes and dense product pages it
 * read late. −20% fires sooner — still above the raw bottom edge, still one
 * site-wide constant. Do not re-copy this string into individual sections.
 */
export const REVEAL_TRIGGER = '0px 0px -20% 0px'

/**
 * For the LAST group on a page — typically the footer. Plain visibility, no
 * offset.
 *
 * A negative bottom margin draws the trigger line inside the viewport, so
 * something has to scroll ACROSS it. Everything mid-page does. The final
 * screenful cannot: the scroll runs out first, and whatever is still below
 * the line when the page bottoms out is starved forever. Measured on the
 * reference build at 1440×900 with `REVEAL_TRIGGER`'s predecessor, nine
 * footer items never fired; on a 1400px viewport the nav columns starved too,
 * because the taller the viewport the further down the page that line
 * reaches.
 *
 * So the terminal group trades the offset away. It reads a touch earlier than
 * the sections above it, which is the correct side to err on — a reveal that
 * plays slightly early is a preference, one that never plays is a bug.
 */
export const PAGE_END_TRIGGER = '0px'

/**
 * For a group whose RESTING position is below an inset line.
 *
 * The second way the trap above bites, and it is not the end of the page. A
 * scroll well (`scrollPull.ts`) gives a section a resting scroll position, and
 * a section taller than the viewport rests with its TOP at the viewport top —
 * so whatever sits low in that section is parked below the screen's midpoint
 * and stays there. Nothing scrolls across an inset line at a place the page
 * comes to rest, so the reveal is starved exactly where the composition is
 * meant to read whole.
 *
 * Measured on the reference build's stat grid at its resting position, which
 * is the case this exists for. Its top, as a fraction of the viewport:
 *
 * ```
 *   1440x900   40%   fires on a 45%-line trigger — desktop is fine
 *    768x1024  58%   starved
 *    402x874   63%
 *    360x780   77%
 *    375x667   90%   past REVEAL_TRIGGER's line at 80% — the default is not enough
 *    360x640   94%
 * ```
 *
 * So the offset has to go entirely, for the same reason and with the same
 * trade as `PAGE_END_TRIGGER`: it reads a touch early, and a reveal that
 * plays slightly early is a preference where one that never plays is a bug.
 * Identical value, deliberately separate name — these are two different
 * editorial facts and merging them would hide whichever one changed.
 */
export const AT_REST_TRIGGER = '0px'
