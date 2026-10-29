'use client'
/**
 * smooth/SmoothScroll.tsx — the scroll authority for one React route.
 *
 * Put it in the layout of the routes it governs (a route group), not the root layout: the reading route can stay
 * native while the home route smooths. It starts in a layout effect and destroys itself in that effect's cleanup,
 * which also runs when Next hides the route with <Activity> (Cache Components keeps up to 3 routes alive), so a
 * hidden route never keeps a Lenis instance or a stale `data-scroll-authority` stamp.
 *
 *   // app/(expressive)/layout.tsx, through a client component: the GSAP routes register their refresh here
 *   import gsap from 'gsap'; import { ScrollTrigger } from 'gsap/ScrollTrigger'
 *   useGSAP(() => onRouteRefresh(ScrollTrigger.refresh))       // smooth/route.ts; unregistered when the route goes
 *   <SmoothScroll authority="lenis" driver={gsapDriver(gsap, ScrollTrigger)}>{children}</SmoothScroll>
 *
 *   // app/(reading)/layout.tsx
 *   <SmoothScroll authority="native">{children}</SmoothScroll>
 *
 * The driver is read once, when the authority starts: pass a stable value (module scope or useMemo).
 *
 * <RouteChange> runs smooth/route.ts once per client navigation. Wrap the ROOT layout's children in it (a client
 * component, since it reads the route), so it outlives every route and its layout effect runs after theirs. It
 * imports no GSAP: the refreshes come from the routes that registered one, so a Reading route loads none.
 *
 *   'use client'   // components/route-scroll.tsx, rendered by app/layout.tsx around {children}
 *   import { usePathname } from 'next/navigation'
 *   export function RouteScroll({ children }) {
 *     return <RouteChange route={usePathname()}>{children}</RouteChange>
 *   }
 *
 * After the change, and after a fresh load, it keeps re-measuring for `settle` ms as streamed content lands
 * (smooth/route.ts). A page whose content follows its search params wraps that content in its own
 * <RouteChange route={useSearchParams().toString()}>.
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'

import { nativeHandle, registerHandle, unregisterHandle } from './authority'
import { createSmoothScroll, rafDriver, type Driver, type SmoothScrollOptions } from './lenis'
import { routeChanged, SETTLE_MS, watchRouteSettle } from './route'

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

export interface RouteChangeProps {
  /**
   * The route's identity, usePathname() in Next. Each change runs routeChanged() once; the first render (a fresh load,
   * which ScrollTrigger refreshes itself) only watches its streamed content land (watchRouteSettle()).
   */
  route: string
  /**
   * Runs with the routes' registered refreshes (onRouteRefresh), each function once. Read when the route changes, so
   * it needn't be stable. Prefer registering from the GSAP routes: a refresh passed here loads GSAP on every route.
   */
  refresh?: () => void
  /** Milliseconds to keep re-measuring as the route's content lands; 0 turns the watch off. */
  settle?: number
  children?: ReactNode
}

export function RouteChange({ route, refresh, settle = SETTLE_MS, children }: RouteChangeProps) {
  const latest = useRef({ refresh, settle })
  useIsomorphicLayoutEffect(() => {
    latest.current = { refresh, settle }
  })
  // The route last handled: a fresh load is ScrollTrigger's own refresh, and StrictMode's second effect isn't a change.
  const handled = useRef(route)
  // The cleanup ends the settle watch: at the next change, or when this unmounts.
  useIsomorphicLayoutEffect(() => {
    if (handled.current === route) return watchRouteSettle(latest.current)
    handled.current = route
    return routeChanged(latest.current)
  }, [route])

  return <>{children}</>
}
