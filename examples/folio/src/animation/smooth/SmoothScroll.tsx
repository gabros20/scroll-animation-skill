'use client'
/**
 * smooth/SmoothScroll.tsx — the scroll authority for one React route.
 *
 * Put it in the layout of the routes it governs (a route group), not the root layout: the reading route can stay
 * native while the home route smooths. It starts in a layout effect and destroys itself in that effect's cleanup,
 * which also runs when Next hides the route with <Activity> (Cache Components keeps up to 3 routes alive), so a
 * hidden route never keeps a Lenis instance or a stale `data-scroll-authority` stamp.
 *
 *   // app/(expressive)/layout.tsx
 *   import gsap from 'gsap'; import { ScrollTrigger } from 'gsap/ScrollTrigger'
 *   <SmoothScroll authority="lenis" driver={gsapDriver(gsap, ScrollTrigger)}>{children}</SmoothScroll>
 *
 *   // app/(reading)/layout.tsx
 *   <SmoothScroll authority="native">{children}</SmoothScroll>
 *
 * The driver is read once, when the authority starts: pass a stable value (module scope or useMemo).
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'

import { nativeHandle, registerHandle, unregisterHandle } from './authority'
import { createSmoothScroll, rafDriver, type Driver, type SmoothScrollOptions } from './lenis'

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface SmoothScrollProps {
  authority: 'native' | 'lenis'
  driver?: Driver
  lenis?: SmoothScrollOptions['lenis']
  anchors?: boolean
  children?: ReactNode
}

export function SmoothScroll({ authority, driver, lenis, anchors, children }: SmoothScrollProps) {
  // Latest props for the authority effect, without restarting the authority when a driver object is recreated.
  // Written in an effect, never during render (react-hooks/refs).
  const config = useRef({ driver, lenis, anchors })
  useIsomorphicLayoutEffect(() => {
    config.current = { driver, lenis, anchors }
  })

  useIsomorphicLayoutEffect(() => {
    if (authority === 'native') {
      const native = nativeHandle()
      registerHandle(native)
      return () => {
        native.destroy()
        unregisterHandle(native)
      }
    }
    const { driver: d, lenis: l, anchors: a } = config.current
    const handle = createSmoothScroll({ driver: d ?? rafDriver(), lenis: l, anchors: a })
    return () => handle.destroy()
  }, [authority])

  return <>{children}</>
}
