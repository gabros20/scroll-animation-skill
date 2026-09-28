'use client'
/**
 * motion/CountUp.tsx: a number that counts up once, when it comes into view, for Motion (React) routes. It renders the
 * engine-free markup (count-up.ts) and hands the core a driver: a MotionValue animated on Motion's frameloop, whose
 * changes write the number's text node.
 *
 *   <p className="stat">$<CountUp to={1280} />M</p>              a prefix or a suffix stays in your markup
 *   <CountUp to={98.6} />                                        fraction digits: `to`'s own (98.6 → 1)
 *   <CountUp to={12500.75} format={{ locale: 'de-DE' }} />       Intl.NumberFormat, en-US by default
 *   <CountUp from={1990} to={2026} format={{ grouping: false }} />
 *
 * - The server renders the final value, so readers without JavaScript, crawlers and the frame before hydration show the
 *   real number; the count rewinds it to `from` (default 0) only as it starts. The locale defaults to en-US, not the
 *   visitor's, because the server and the browser must print the same text.
 * - Like the engine-free path: it starts once about 60% of the number is visible, plays once for
 *   MOTION.entrance.duration on CURVES.entrance, and writes data-count-state (waiting → counting → done). Screen readers
 *   hear the final value throughout (count-up.ts). Reduced motion (read live), the failsafe and a hidden tab show the
 *   final value at once.
 * - No React state at all: the count writes the text node, and React never renders during it.
 * - Next's Activity: hiding the route lands a running count (effect cleanup), and showing it again never replays one
 *   that is done.
 * - Props are serializable, so a server component can render it. `format` takes locale, decimals and grouping.
 */
import { animate, useMotionValue } from 'motion/react'
import { useEffect, useRef } from 'react'

import { CURVES, MOTION } from '../config'
import { countFormat, watchCount, type CountFormat } from '../count-up'

export interface CountUpProps {
  /** The final value, rendered on the server. */
  to: number
  /** Where the count starts. Default 0. */
  from?: number
  format?: CountFormat
  className?: string
  id?: string
}

export function CountUp({ to, from = 0, format, className, id }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const value = useMotionValue(to)
  const { locale, decimals, grouping } = format ?? {}

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const numbers = countFormat({ locale, decimals, grouping }, to)
    return watchCount(
      el,
      () => ({ from, to, format: numbers }),
      (start, end, write, done) => {
        const off = value.on('change', write)
        value.jump(start)
        const controls = animate(value, end, {
          duration: MOTION.entrance.duration,
          ease: CURVES[MOTION.entrance.curve],
          onComplete: done,
        })
        return () => {
          controls.stop()
          off()
        }
      },
    )
  }, [value, from, to, locale, decimals, grouping])

  return (
    // The server's text stands if the browser's Intl data prints the number differently (a locale's space character):
    // the count restores exactly what was rendered.
    <span ref={ref} data-count-up="" className={className} id={id} suppressHydrationWarning>
      {countFormat({ locale, decimals, grouping }, to).format(to)}
    </span>
  )
}
