'use client'

import { m } from 'motion/react'
import { useState, type CSSProperties, type ReactNode } from 'react'

import { ENGAGE_QUERY } from '../lib/constants'
import { transitions } from '../lib/transitions'
import { entranceVariants, veilVariants, type EntranceVariant } from '../lib/variants'
import { cx } from '../lib/cx'

/**
 * `Stage` / `StageItem` / `StageVeil` — the PAGE-LOAD entrance system.
 *
 * One of the two timing models. A stage is TRIGGERED: it fires once and then
 * plays on its own clock, so scrolling faster or slower changes nothing and
 * scrolling back replays nothing. A scrubbed scene (`ScrubStage`) is the
 * other — a pure function of scroll offset, reversible in both directions.
 *
 * Reach for a stage when the moment belongs to the content (a page-load
 * arrival, a reveal on first sight) and for a scrubbed scene when the reader
 * should drive it.
 *
 * ## How it is wired
 *
 * `Stage` sets `initial="hidden" animate="visible"` and animates NOTHING of
 * its own. Motion propagates those state names down through React context, so
 * every `StageItem` beneath it moves on the same tick without being handed an
 * `animate` prop — and plain server-rendered markup in between (wrapper divs,
 * a bare `<h1>`) does not break the chain, because context flows through
 * non-motion elements. That is what lets the section around a `Stage` stay a
 * SERVER component: only the animated leaves are client components, so
 * partner SVGs and images never enter the client bundle.
 *
 * A `StageItem` must therefore not be given its own `initial`/`animate` — that
 * would sever it from the stage and it would fire on its own schedule.
 *
 * ## Why the initial state is safe to server-render
 *
 * Motion writes the `hidden` variant's styles into the SSR HTML, so the
 * offset state is in the markup rather than being applied after hydration.
 * There is no flash of the settled layout. The cost is that the animation
 * cannot START until React hydrates — which is exactly what `StageVeil` is
 * for: it covers that window, so the entrance is never seen half-played on a
 * main thread that is still busy. It plays on an idle one or not at all.
 */

// `aside` is here for the same reason `ul` is: a sidebar whose contents
// stagger IS the stage, and wrapping it in a bare `div` to say so puts an
// empty element in the layout for no one's benefit — and costs the landmark,
// which is the one thing an `aside` is actually for.
const STAGE_TAGS = {
  div: m.div,
  section: m.section,
  header: m.header,
  main: m.main,
  aside: m.aside,
  ul: m.ul
}
// `h1`/`h2` are here for the same reason `ul` is on the stage: a heading that
// rises IS the item, and without them every animated heading needs either a
// `span` inside it or a `div` around it. Building several sections in
// parallel produced both, which is how this got noticed.
const ITEM_TAGS = { div: m.div, span: m.span, p: m.p, li: m.li, h1: m.h1, h2: m.h2 }

interface StageProps {
  children: ReactNode
  className?: string
  /**
   * Element to render. Pick the one the layout already needs — a stage should
   * not add a wrapper. `ul` is here for exactly that reason: a list whose items
   * stagger is a stage, and wrapping it in a bare `div` to say so puts an empty
   * element in the layout for no one's benefit. `StageItem` already renders `li`.
   */
  as?: keyof typeof STAGE_TAGS
  /**
   * When the stage runs.
   *
   * - `'mount'` — immediately, for a section already on screen at page load
   *   (a hero). Pairs with `StageVeil`.
   * - `'view'` — when the stage itself reaches the viewport, for everything
   *   below the fold.
   *
   * Both drive the same `hidden`→`visible` states, so every `StageItem` and
   * every variant works identically under either trigger. That is the point:
   * one vocabulary for the whole page, not a load system and a scroll system
   * that drift apart.
   */
  trigger?: 'mount' | 'view'
  /**
   * `'view'` only: how much of the stage must be visible to fire.
   *
   * Defaults to `'some'` — ANY part of it — because the trigger line is set by
   * `margin` instead. A fractional amount is a trap on tall content: `0.6` of an
   * element taller than the viewport can never be satisfied, so the reveal never
   * fires. That is the same element stacking into a tall column on mobile.
   */
  amount?: 'some' | 'all' | number
  /**
   * `'view'` only: shrinks the detection box, so the stage must be properly on
   * screen rather than merely touching the bottom edge.
   *
   * The default pulls the bottom up 20% of the viewport — GSAP's
   * `start: 'top 80%'`, which is the convention this reads like. Must be a
   * static string; Motion re-reads it as an IntersectionObserver rootMargin.
   */
  margin?: string
  /**
   * `'view'` only: `margin` from the engage breakpoint up, when one line
   * cannot serve both.
   *
   * `margin` stays the mobile-first base, exactly like a Tailwind class. Reach
   * for this ONLY when a group's position in the frame genuinely differs by
   * breakpoint — a shared editorial line belongs in `lib/triggers.ts`, and
   * eight sections each inventing a pair is the drift that file prevents.
   *
   * The case it exists for is a group whose RESTING position falls below the
   * line on one breakpoint. A negative bottom margin draws the trigger inside
   * the viewport, so something has to scroll ACROSS it — and where a section
   * comes to rest (a scroll well, or the end of the page) nothing ever does.
   * `triggers.ts` describes the same trap for a footer.
   *
   * Resolved ONCE, on mount. Motion reads `viewport` when it builds the
   * observer and a later change does not rebuild it, so this deliberately does
   * not track resize: a reveal is a one-shot, and the breakpoint at the moment
   * it could fire is the one that matters. It affects no markup, so there is
   * nothing for hydration to mismatch.
   */
  marginLg?: string
  /** `'view'` only: replay each time it re-enters. Off by default — reveals latch. */
  repeat?: boolean
  /**
   * Passed straight through, for the same reason `StageItem` takes `id`: an
   * animated element is still a document element. A stage is told to render the
   * element the layout already needs, so when that element is the one carrying
   * the group semantics — e.g. a filter row that is a `role="group"` of buttons —
   * the alternative is a bare wrapper around the stage whose only job is to say
   * what the stage already is.
   */
  role?: string
  'aria-label'?: string
}

/** Trigger line at 80% of the viewport height. See `margin`. */
const VIEW_MARGIN = '0px 0px -20% 0px'

export function Stage({
  children,
  className,
  as = 'div',
  trigger = 'mount',
  amount = 'some',
  margin = VIEW_MARGIN,
  marginLg,
  repeat = false,
  role,
  'aria-label': ariaLabel
}: StageProps) {
  const Component = STAGE_TAGS[as]

  const [resolvedMargin] = useState(() =>
    marginLg && typeof window !== 'undefined' && window.matchMedia(ENGAGE_QUERY).matches
      ? marginLg
      : margin
  )

  // Scope a stage to ONE group of elements that share a moment. A stage wrapping
  // a whole tall row fires when its top edge appears, playing the bottom of the
  // group off-screen — most visible on mobile, where side-by-side columns stack.
  const trigger_props =
    trigger === 'view'
      ? {
          whileInView: 'visible' as const,
          viewport: { once: !repeat, amount, margin: resolvedMargin }
        }
      : { animate: 'visible' as const }

  return (
    <Component
      className={className}
      role={role}
      aria-label={ariaLabel}
      initial="hidden"
      {...trigger_props}
    >
      {children}
    </Component>
  )
}

interface StageItemProps {
  /** Optional: a `growY` bar is a filled rect with nothing inside it. */
  children?: ReactNode
  className?: string
  /** Which shared entrance move this element performs. See `entranceVariants`. */
  variant: EntranceVariant
  /** Seconds after the stage starts. The reference staggers title lines by 0.067. */
  delay?: number
  as?: keyof typeof ITEM_TAGS
  /** For layout values that cannot be a class — e.g. a chart bar's resolved height. */
  style?: CSSProperties
  /**
   * Passed straight through. Here because an animated element is still a
   * document element: a heading that is the target of `aria-labelledby`, or an
   * anchor target, does not stop needing its `id` because it started moving.
   * Without it, a section would have to relabel itself with a literal
   * `aria-label` that duplicates the visible heading's text instead of
   * pointing at it — the version that goes stale when the copy changes.
   */
  id?: string
}

export function StageItem({
  children,
  className,
  variant,
  delay = 0,
  as = 'div',
  style,
  id
}: StageItemProps) {
  const Component = ITEM_TAGS[as]
  return (
    <Component
      // Marks this as content that is server-rendered HIDDEN. The root layout
      // should carry one `<noscript>` rule keyed off it that forces every stage
      // item visible — without JS nothing would ever run `whileInView`, and the
      // entire page below the fold would stay at opacity 0. See the README's
      // noscript snippet.
      data-stage-item=""
      id={id}
      className={className}
      style={style}
      variants={entranceVariants[variant]}
      // Opacity gets its own, much shorter transition, offset later than the
      // movement — the reference's fades are ~0.17s against a 1.30s move. The
      // per-line `delay` shifts both halves together so a stagger stays a
      // stagger. Harmless on variants that don't animate opacity: Motion
      // ignores transitions for values it isn't animating.
      transition={{
        ...transitions.entrance,
        delay,
        opacity: { ...transitions.entranceFade, delay: transitions.entranceFade.delay + delay }
      }}
    >
      {children}
    </Component>
  )
}

interface StageVeilProps {
  /** Background utility. Use the surface the section already paints beneath its art. */
  className?: string
}

/**
 * The opaque cover that holds the first beat of a page load.
 *
 * SELF-DRIVING — it sets its own `initial`/`animate` rather than inheriting a
 * stage's variants, so it can be mounted anywhere in the tree. That matters:
 * it has to out-rank a fixed/sticky header, and `z-index` only competes
 * inside the nearest stacking context. A veil that lives inside the hero
 * works only while that section creates no stacking context of its own — the
 * moment the hero becomes `sticky` (which does create one) its high z-index
 * gets trapped underneath the very nav it exists to cover. Mount it at page
 * level as a `fixed` sibling instead, where nothing can box it in.
 *
 * The `<noscript>` rule is a hard requirement, not a nicety: this element is
 * server-rendered opaque over the whole viewport, so without JS to fade it the
 * page would be permanently hidden. That is the single failure mode a
 * JS-driven veil has that a CSS one does not, and this closes it.
 */
export function StageVeil({ className }: StageVeilProps) {
  return (
    <>
      <noscript>
        <style>{`[data-stage-veil]{display:none}`}</style>
      </noscript>
      <m.div
        data-stage-veil=""
        aria-hidden="true"
        className={cx('pointer-events-none fixed inset-0 z-[70]', className)}
        variants={veilVariants}
        initial="hidden"
        animate="visible"
        transition={transitions.veil}
      />
    </>
  )
}
