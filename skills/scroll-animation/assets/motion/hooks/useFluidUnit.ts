'use client'

import { useMotionValue, type MotionValue } from 'motion/react'
import { useEffect } from 'react'

import { fluidUnits, onFluidChange, type FluidUnit } from '../lib/fluid'

/**
 * A fluid unit as a MotionValue (CSS px per drawn px), updated when the
 * viewport, the scale or `--fluid-zoom` changes. Combine it with scroll
 * progress so a drawn distance scales with the layout:
 *
 *   const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
 *   const f = useFluidUnit()
 *   const x = useTransform(() => scrollYProgress.get() * 600 * f.get())
 *   <m.div style={{ x }} />
 *
 * `useTransform` with a function re-runs when either value changes, so a
 * resize mid-scroll re-scales the distance without a remount. It is 1 on the
 * server and on the first client render, then the measured value from the
 * first effect: keep scroll-linked distances out of the SSR frame (start
 * them at progress 0), or the first paint jumps.
 *
 * For a distance that must stay correct with no JS at all between resizes,
 * the CSS-variable pattern needs no unit in JS: write progress to
 * `--scene-p` and let CSS multiply (`references/fluid-interop.md` §3).
 */
export function useFluidUnit(unit: FluidUnit = 'fluid'): MotionValue<number> {
  const value = useMotionValue(1)
  useEffect(() => {
    const read = () => value.set(fluidUnits()[unit])
    read()
    return onFluidChange(read)
  }, [unit, value])
  return value
}
