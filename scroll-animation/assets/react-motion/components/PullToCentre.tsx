'use client'

import { useEffect, useRef } from 'react'

import { ENGAGE_QUERY } from '../lib/constants'
import { createScrollPull } from '../lib/scrollPull'

/**
 * Attracts the scroll toward resting on this component's PARENT element, while
 * that parent is on screen. The mechanism, its tuning and the reasoning are all
 * in `lib/scrollPull.ts`; this is the mount point.
 *
 * "Rest" is the parent CENTRED when it fits the viewport, and TOP-ALIGNED when
 * it is taller — the name is for the common case, not the whole rule. See that
 * module's §Centre, or top when it does not fit.
 *
 * ## It is a client LEAF, so its host stays a server component
 *
 * Same contract as `Stage`/`StageItem`: drop it in and the section around it
 * does not need `'use client'`. It renders one `hidden` span, which generates no
 * box at all — not a flex item, not a grid item, nothing to disturb a
 * `justify-between` column or a `grid-cols-2` layout.
 *
 * The parent is the target because it is the box you can SEE while placing this,
 * with no selector to keep in sync and no attribute contract to honour. Put it
 * as the first child of whatever should centre:
 *
 * ```tsx
 * <div className="lg:fluid-h-900 relative …">
 *   <PullToCentre clamp="[data-scrub-stage]" />
 *   …
 * </div>
 * ```
 *
 * ## Engagement, and why the ratio alone is not enough
 *
 * The pull runs while the target covers `threshold` of ITSELF *or* `threshold`
 * of the VIEWPORT. The self-ratio is the simpler rule; the viewport rule is
 * what keeps it meaningful for a target taller than the screen, where a
 * self-ratio is measuring the wrong thing — a content-driven section below the
 * engage breakpoint can run past a phone's viewport, so 45% of itself arrives
 * later than 45% of the screen. The observer carries a second threshold for
 * exactly that crossing, derived from the measured height so it collapses back
 * to one threshold whenever the target fits the screen.
 *
 * Re-observed on resize, because both the derived threshold and the target's
 * height are viewport-dependent.
 */

/**
 * How much must be visible to engage — MOBILE-FIRST, like a Tailwind class.
 *
 * 45% is a reviewed desktop value, and it is wrong below the engage
 * breakpoint. On a desktop the section is exactly one viewport, so 45%
 * visible means it is already halfway in and the remaining travel is short.
 * On a phone the section can be TALLER than the screen, so the viewport rule
 * below engages once 45% of the SCREEN is covered — with the section's top
 * potentially still hundreds of pixels down a tall phone, barely past the
 * midpoint. Left at one number, the well grabbed on the way in and on the way
 * back up, well before the reader had committed to the section.
 *
 * 0.72 puts the crossing at roughly three quarters in on a phone: far enough
 * that the reader has clearly arrived, close enough that the pull still has
 * somewhere to go.
 */
const DEFAULT_THRESHOLD = 0.72
const DEFAULT_THRESHOLD_LG = 0.45

interface PullToCentreProps {
  /**
   * Selector for an ancestor whose own scroll range bounds the attractor. Use
   * `[data-scrub-stage]` inside a pinned scene — without it a target shorter
   * than the viewport asks to rest outside the pin. See the lib docblock.
   */
  clamp?: string
  /**
   * Share of the target (or of the viewport) that must be visible to engage,
   * below the engage breakpoint. See `DEFAULT_THRESHOLD` — the two
   * breakpoints genuinely differ, because only one of them has sections
   * taller than the screen.
   */
  threshold?: number
  /** The same, from the engage breakpoint up. */
  thresholdLg?: number
  /** Escape hatch: mount the component, run nothing. */
  disabled?: boolean
}

export function PullToCentre({
  clamp,
  threshold = DEFAULT_THRESHOLD,
  thresholdLg = DEFAULT_THRESHOLD_LG,
  disabled = false
}: PullToCentreProps) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const target = ref.current?.parentElement
    if (!target || disabled) return

    // Read LIVE, not latched: this observer is already rebuilt on resize, so
    // unlike `Stage`'s one-shot reveal there is nothing to freeze. A window
    // dragged across the breakpoint gets the right threshold on the next frame.
    const active = () => (window.matchMedia(ENGAGE_QUERY).matches ? thresholdLg : threshold)

    const clampEl = clamp ? target.closest(clamp) : null
    const pull = createScrollPull({
      target,
      clamp: clampEl instanceof HTMLElement ? clampEl : null
    })

    // The self-ratio that corresponds to the viewport being `threshold` covered.
    // Equal to `threshold` whenever the target fits the screen, smaller when it
    // does not — which is the only case where the two rules disagree.
    const viewportThreshold = (t: number) => {
      const h = target.offsetHeight
      const vh = window.innerHeight
      if (h <= 0 || vh <= 0) return t
      return Math.min(t, (vh * t) / h)
    }

    let io: IntersectionObserver | null = null

    const observe = () => {
      io?.disconnect()
      const t = active()
      const thresholds = [...new Set([0, viewportThreshold(t), t])].sort((a, b) => a - b)
      io = new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting) {
            pull.stop()
            return
          }
          const vh = entry.rootBounds?.height ?? window.innerHeight
          const engaged =
            entry.intersectionRatio >= t || (vh > 0 && entry.intersectionRect.height >= vh * t)
          if (engaged) pull.start()
          else pull.stop()
        },
        { threshold: thresholds }
      )
      io.observe(target)
    }
    observe()

    // Coalesced: a window drag is one re-observe per frame, not one per event.
    let raf = 0
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(observe)
    }
    window.addEventListener('resize', schedule, { passive: true })

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', schedule)
      io?.disconnect()
      pull.destroy()
    }
  }, [clamp, threshold, thresholdLg, disabled])

  // `hidden` generates no box, so this is inert in any layout context.
  return <span ref={ref} hidden aria-hidden="true" />
}
