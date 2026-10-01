'use client'
/**
 * motion/ScrollWell.tsx — a recipe (advanced): scroll-well.ts for React routes. `<ScrollWell />` pulls the page's
 * scroll to rest on its PARENT element while the parent holds most of the view. What it does, its tuning, its limits
 * and why are in scroll-well.ts: read that first.
 *
 *   <section className="feature">          the target: a composition meant to be seen whole
 *     <ScrollWell />                        first child; inside a pinned scene it clamps to [data-scene-root]
 *     …
 *   </section>
 *
 * - A client leaf: it renders one `hidden` span, which generates no box (no flex or grid item), so the section around
 *   it stays a server component and its layout doesn't change. The target is the parent because that is the box you
 *   see while placing it: there is no selector to keep in sync.
 * - It runs on Motion's frame loop, in the setup step, and dispatches `scroll` after each write, so useScroll values (a
 *   PinnedScene's progress) read the new position in the same frame: Motion re-measures on `scroll`, which the browser
 *   fires a frame after a programmatic scroll. smooth/lenis.ts's motionDriver does the same (spike S4b).
 * - Props are serializable, so a server component can render it: `clamp` (a selector for the target's ancestor, or
 *   null for none; default '[data-scene-root]'), `threshold`, `desktopThreshold`, and `disabled` (renders the span and
 *   pulls nothing).
 * - Next's Activity: hiding the route runs the effect's cleanup, which destroys the well; showing it builds a new one.
 * - Native scrolling only, and nothing under reduced motion (live): the core's rules.
 * - A programmatic smooth scroll of your own (a router jump, scrollIntoView, the scroll authority's scrollTo) needs
 *   suspendScrollWells() from scroll-well.ts just before it; anchor clicks and `hashchange` suspend it by themselves.
 */
import { cancelFrame, frame } from 'motion/react'
import { useEffect, useRef } from 'react'

import { createScrollWell, type WellClock } from '../scroll-well'

/** Motion's frame loop as the well's clock: the setup step, before Motion reads anything. */
const motionClock: WellClock = (tick) => {
  const process = () => tick()
  frame.setup(process, true)
  return () => cancelFrame(process)
}

const notifyMotion = () => window.dispatchEvent(new Event('scroll'))

export interface ScrollWellProps {
  /** A selector for the parent's ancestor whose own scroll range bounds the rest, or null. Default '[data-scene-root]'. */
  clamp?: string | null
  /** The share of the parent, or of the viewport, that engages it below DESKTOP_QUERY. Default 0.72. */
  threshold?: number
  /** The same from DESKTOP_QUERY up. Default 0.45. */
  desktopThreshold?: number
  disabled?: boolean
}

export function ScrollWell({ clamp, threshold, desktopThreshold, disabled = false }: ScrollWellProps) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const target = ref.current?.parentElement
    if (!target || disabled) return
    const well = createScrollWell(target, { clamp, threshold, desktopThreshold, clock: motionClock, onWrite: notifyMotion })
    return () => well.destroy()
  }, [clamp, threshold, desktopThreshold, disabled])

  // `hidden` generates no box, so the span is inert in any layout.
  return <span ref={ref} hidden aria-hidden="true" />
}
