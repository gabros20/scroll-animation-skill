'use client'

import { animate, useInView, useReducedMotion } from 'motion/react'
import { useEffect, useRef } from 'react'

/**
 * A number that counts up when it first reaches the viewport.
 *
 * TRIGGERED, like everything else in the entrance system — it fires once, plays
 * on its own clock and never replays. It is deliberately not a `StageItem`:
 * variants animate *style*, and this animates *text*, so it owns its own
 * `useInView` rather than inheriting the stage's hidden→visible state.
 *
 * ## Why it writes textContent instead of React state
 *
 * A `setState` per frame is a React render per frame — the one thing the motion
 * rules ban outright. `animate()` drives a plain number and the subscriber
 * writes into the node directly, so the whole count costs zero renders.
 *
 * The server renders the FINAL value, not zero. Crawlers, JS-disabled readers
 * and the pre-hydration frame all see the real figure; the count only ever
 * rewinds it to 0 once the animation is about to run, on the client. That
 * ordering is what stops the number flashing "0" on a slow main thread.
 */

interface CountUpProps {
  value: number
  className?: string
  /** Seconds. Long enough to read as counting, short enough not to hold the eye. */
  duration?: number
  /**
   * Fraction of the element that must be visible before it starts. Defaults
   * to `0.6`, a plain fraction — which looks like exactly the trap
   * `Stage`'s own `amount` prop warns against (`0.6` of an element taller
   * than the viewport can never be satisfied, so the reveal never fires).
   * It is safe here specifically because `CountUp`'s element is a single
   * short inline number: it can never be taller than the viewport, so
   * "60% visible" can always be satisfied and the trap's actual failure
   * mode — a tall element whose fraction never resolves — cannot occur.
   * `Stage` has no such guarantee (it wraps arbitrary, often tall, content),
   * which is why IT defaults to `'some'` plus a `margin` trigger line
   * instead. Do not copy this default onto `Stage` or any other component
   * that might wrap something taller than a line of text.
   */
  amount?: number
}

export function CountUp({ value, className, duration = 1.2, amount = 0.6 }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, amount })
  const reduced = useReducedMotion()

  useEffect(() => {
    const node = ref.current
    if (!node || !inView) return

    // Reduced motion gets the figure, not the performance. The number is the
    // argument this section is making — withholding it would be a content
    // change, not a motion one.
    if (reduced) {
      node.textContent = String(value)
      return
    }

    const controls = animate(0, value, {
      duration,
      ease: [0.15, 0.6, 0.2, 1], // `transitions.entrance` — one curve for the whole page load
      onUpdate: (latest) => {
        node.textContent = String(Math.round(latest))
      }
    })

    return () => controls.stop()
  }, [inView, value, duration, reduced])

  return (
    <span ref={ref} className={className}>
      {value}
    </span>
  )
}
