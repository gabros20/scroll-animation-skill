'use client'

import { useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react'
import { useCallback, useEffect, useRef, type ReactNode } from 'react'

/**
 * Fades its children out as they scroll up out of the viewport.
 *
 * Built for copy that sits over a pinned `ScrubStage` render: without it a
 * headline and a wordmark stay legible while the video is playing its middle
 * act underneath, so the two compete for the same frame. An empty section
 * exists to give the render a clear view — this is what actually clears it.
 *
 * It fades the GROUP, not each element against its own position. That is the
 * right unit here: the copy and the wordmark are one composition and should
 * leave as one, and per-element ranges would have a small element — a
 * wordmark that is only, say, 46px tall — fading across 46px of scroll, which
 * snaps rather than fades.
 *
 * ## Why this writes `style.opacity` by hand instead of binding a MotionValue
 *
 * The obvious version is `<m.div style={{ opacity }}>`, and it is BROKEN here.
 * Motion hands a scroll-linked property to the browser as a native, hardware
 * accelerated timeline when it can. Measured on the reference build, that
 * produced a real WAAPI animation with keyframes at exactly this component's
 * `from`/`to`:
 *
 * ```
 *   offset 0.10 -> opacity 1
 *   offset 0.35 -> opacity 0      duration 1000ms, fill both, running
 * ```
 *
 * The browser's native view range for THIS element is not the range `useScroll`
 * computes in JS, because the element sits under a `-mt-[100svh]` that overlaps
 * a sticky sibling inside `ScrubStage`. So the two agree while the fade
 * descends and then diverge: past `to` the native timeline ran backwards and
 * the copy faded back IN, reaching full opacity again over the next 600px —
 * on top of the render it exists to clear.
 *
 * The JS value was correct throughout (it clamps to 0 and stays there); only the
 * accelerated path disagreed. Writing the property directly keeps the JS value
 * authoritative. It costs one style write per scroll frame on one node, which is
 * what the bound version costs anyway.
 *
 * The entrance is a separate concern and stays with `Stage` — this only owns the
 * exit. They compose because they touch different things: `Stage` moves and
 * fades the ITEMS on their own tick, this fades the GROUP on scroll. An item
 * that has finished its entrance sits at opacity 1, and this multiplies over it.
 */

/**
 * `start start` is the moment the element's top reaches the viewport top — for a
 * full-height section, when it is filling the screen. `end start` is when its
 * bottom passes that same line, i.e. fully gone. So progress is exactly "how far
 * out of frame is it".
 */
const EXIT_OFFSET = ['start start', 'end start'] as const satisfies [string, string]

interface FadeOnExitProps {
  children: ReactNode
  className?: string
  /** Progress at which the fade starts. Below this the group is untouched. */
  from?: number
  /** Progress at which it is fully gone. */
  to?: number
}

/**
 * Per-breakpoint tuning goes through these, not through props.
 *
 * The tier-1 responsive convention (see the README): the VALUE responds via a
 * plain CSS utility setting a custom property, so there is no media listener,
 * no hydration flash, and no second element. The range genuinely differs by
 * breakpoint — on a phone the layer is a single narrow column and a wordmark
 * sits directly over the render, where on a laptop the copy is off to one
 * side and can hold much longer.
 *
 *   className="[--exit-to:0.15] lg:[--exit-to:0.35]"
 *
 * Read from computed style rather than parsed from the class, so a value set
 * anywhere up the cascade works, and re-read on resize because that is when the
 * breakpoint can change.
 */
const FROM_VAR = '--exit-from'
const TO_VAR = '--exit-to'

/**
 * The defaults are early, and deliberately so.
 *
 * The intuition is to hold the copy until the section is halfway gone, but the
 * progress here measures the WHOLE layer against its own height. On a layer
 * that is, say, 900px tall with a wordmark on its baseline, at 0.5 the top of
 * the layer has left but the wordmark is still sitting near the middle of the
 * screen, fully opaque, over a render that has already taken over the frame —
 * exactly the complaint this exists to fix.
 *
 * So: untouched for the first ~10% (about 90px of scroll on a 900px layer —
 * nothing fades while it is still being read), then gone by 35%, which is
 * roughly when the last element clears the upper third.
 */
export function FadeOnExit({ children, className, from = 0.1, to = 0.35 }: FadeOnExitProps) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: EXIT_OFFSET })

  // The props are the fallback; the custom properties win when set. A ref
  // because the write path reads it per scroll frame and must never re-render.
  const rangeRef = useRef<[number, number]>([from, to])

  const write = useCallback(
    (progress: number) => {
      const el = ref.current
      if (!el) return
      if (reduced) {
        el.style.opacity = '1'
        return
      }
      const [start, end] = rangeRef.current
      const span = end - start
      const k = span <= 0 ? (progress >= end ? 1 : 0) : (progress - start) / span
      el.style.opacity = String(1 - (k < 0 ? 0 : k > 1 ? 1 : k))
    },
    [reduced]
  )

  // Only fires while the value is actually moving: `scrollYProgress` clamps to
  // 0/1 outside the range, so this goes quiescent the moment the section is
  // nowhere near the viewport.
  useMotionValueEvent(scrollYProgress, 'change', write)

  // Also the first paint, which has no scroll event to react to, and a
  // reduced-motion visitor, who must be left fully opaque rather than wherever
  // the last write landed.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const style = getComputedStyle(el)
      const start = Number.parseFloat(style.getPropertyValue(FROM_VAR))
      const end = Number.parseFloat(style.getPropertyValue(TO_VAR))
      rangeRef.current = [Number.isFinite(start) ? start : from, Number.isFinite(end) ? end : to]
      write(scrollYProgress.get())
    }
    read()
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [from, to, reduced, write, scrollYProgress])

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
