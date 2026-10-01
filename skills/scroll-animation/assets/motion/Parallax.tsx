'use client'
/**
 * motion/Parallax.tsx — a recipe: an element that drifts against the scroll on Motion (React) routes, with the speed
 * of gsap/parallax.ts. One file to adapt in place.
 *
 *   <Parallax speed={0.15}><img src="…" alt="…" /></Parallax>     a div; as="figure" (or span, section, aside)
 *
 * - When: a Motion route that needs the drift where CSS scroll timelines don't run: Firefox (no view() yet) and under
 *   Lenis in Safari, which draws a CSS timeline a frame behind the page. Otherwise `data-scroll-fx="parallax"`
 *   (css/scroll-effects.css) is cheaper: no JavaScript, and the compositor runs it. Never under ScrollSmoother:
 *   Motion's useScroll reads the unsmoothed scroll there (spike S2).
 * - The speed is a fraction of the element's pass: the scroll from its top meeting the viewport's bottom edge to its
 *   bottom leaving the top edge. It drifts speed × pass over it, centred, so it sits at its layout position when it is
 *   centred in the viewport. Positive lags behind the page and reads as further away; negative runs ahead. Keep it
 *   within ±0.2: large depth differences are a vestibular trigger (references/accessibility.md §7).
 * - Progress is useScroll on the element itself over that pass, read in useMotionValueEvent, and the transform is
 *   written by hand. Bound through `style`, a scroll-linked transform goes to a native timeline whose keyframes stop at
 *   the input range, and the element drifts back outside it (spike S3). useScroll measures the layout box, so the
 *   drift never shifts its own progress.
 * - Smoothed once: a spring on native routes, the raw scroll under Lenis, which already smooths. It reads the page's
 *   authority after it mounts (getScrollAuthority(): the route's SmoothScroll stamp, or a site's own Lenis). It is
 *   placed at once on mount, never glided in.
 * - Reduced motion (live, useReducedMotionLive): no drift and nothing inline.
 * - One writer: the component owns its element's `transform`. Style the element through className, never with a
 *   transform of its own, and put Reveal, a scene or any other mover on a wrapper. Unmount and Next's Activity hide
 *   take the transform off.
 */
import { useMotionValueEvent, useScroll, useSpring } from 'motion/react'
import { useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from 'react'

import { getScrollAuthority } from '../smooth/authority'
import { useReducedMotionLive } from './useReducedMotionLive'

/** The whole pass, as useScroll offsets. A module constant: a fresh array each render would resubscribe. */
const PASS = ['start end', 'end start'] as const satisfies [string, string]
/** The native-scroll smoothing: over-damped, so the drift settles without overshooting. */
const SPRING = { stiffness: 170, damping: 34, restDelta: 0.0001 }

export interface ParallaxProps {
  /** A fraction of the pass, −0.2 … 0.2. Default 0.1. */
  speed?: number
  as?: 'div' | 'figure' | 'span' | 'section' | 'aside'
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

export function Parallax({ speed = 0.1, as: Tag = 'div', className, style, children }: ParallaxProps) {
  const ref = useRef<HTMLElement | null>(null)
  const attach = useCallback((el: HTMLElement | null) => {
    ref.current = el
  }, [])
  const reduced = useReducedMotionLive()
  const { scrollYProgress } = useScroll({ target: ref, offset: PASS })
  const smoothed = useSpring(0, SPRING)
  /** Null until mounted; then whether to smooth here (native scrolling) or not (the authority already smooths). */
  const smooth = useRef<boolean | null>(null)

  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    if (reduced || !ref.current) return
    if (smooth.current) smoothed.set(p)
    else if (smooth.current === false) place(ref.current, speed, p)
  })
  useMotionValueEvent(smoothed, 'change', (p) => {
    if (!reduced && ref.current && smooth.current) place(ref.current, speed, p)
  })

  useEffect(() => {
    smooth.current = getScrollAuthority() === 'native'
    return () => {
      smooth.current = null
    }
  }, [])

  // Placed at once: on mount, when reduced motion turns off and when the speed changes. The progress comes from the
  // layout box (the cleanup took the transform off), because useScroll may not have measured yet.
  useEffect(() => {
    const el = ref.current
    if (!el || reduced) return
    const box = el.getBoundingClientRect()
    const p = Math.min(1, Math.max(0, (window.innerHeight - box.top) / (window.innerHeight + box.height)))
    smoothed.jump(p)
    place(el, speed, p)
    return () => {
      el.style.removeProperty('transform')
    }
  }, [reduced, speed, smoothed])

  return (
    <Tag ref={attach} className={className} style={style}>
      {children}
    </Tag>
  )
}

/** The one writer: the drift at progress `p` of the element's pass. */
function place(el: HTMLElement, speed: number, p: number) {
  const y = speed * (window.innerHeight + el.offsetHeight) * (p - 0.5)
  el.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`
}
