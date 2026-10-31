// Vendored by copy for spike S11 from ~/.claude/skills/3d/assets/web/adapters/motion.ts on 2026-10-30 (unchanged below this line).
'use client'
/**
 * adapters/motion.ts: feeds the conductor from Motion's `useScroll` (React + Motion repos).
 *
 * Owns: one hook that forwards window scroll into the conductor over the lvh pinned travel.
 * Must not: bind the scroll value to a `style` prop (Motion can hand it to a native timeline that
 * drifts back past the input range), add a `useSpring` (the conductor smooths), or measure a
 * sticky element (measure the range wrapper). Progress is computed here, not from a `useScroll`
 * offset, because offsets measure the visual viewport while the pin is 100lvh. Under Lenis, drive
 * Lenis from Motion's frame loop (`frame.setup`), see references/scroll-adapters.md.
 */
import { useEffect, useRef, type RefObject } from 'react'
import { useMotionValueEvent, useScroll } from 'motion/react'
import { createLvhProbe, type ConductorInput } from '../conductor'

export function useMotionScrollConductor(
  conductor: ConductorInput,
  wrapper: RefObject<HTMLElement | null>,
): void {
  const { scrollY } = useScroll()
  const geometry = useRef({ top: 0, range: 1 })

  const derive = (y: number): void => {
    conductor.setExact((y - geometry.current.top) / geometry.current.range)
  }

  useMotionValueEvent(scrollY, 'change', derive)

  // Measure (and re-measure) the wrapper; 'change' does not fire on mount or after a restore.
  useEffect(() => {
    const el = wrapper.current
    if (!el) return
    const lvh = createLvhProbe()
    let frame = 0
    const measure = (): void => {
      const rect = el.getBoundingClientRect()
      geometry.current.top = rect.top + window.scrollY
      geometry.current.range = Math.max(rect.height - lvh.read(), 1)
      derive(window.scrollY)
    }
    const schedule = (): void => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(el)
    window.addEventListener('pageshow', measure)
    void document.fonts?.ready.then(schedule)
    measure()
    conductor.settle()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('pageshow', measure)
      lvh.destroy()
    }
    // derive closes over a ref and the conductor only: stable per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conductor, wrapper])
}
