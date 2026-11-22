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
 * ScrollSmoother: pass the handle's factory, so this file imports no GSAP. It renders the wrapper and the content
 * element ScrollSmoother needs around the children; fixed UI (the header) stays outside this component.
 *
 *   import { ScrollSmoother } from 'gsap/ScrollSmoother'
 *   const smoother = () => createSmoother(ScrollSmoother, { smooth: 1 })      // smooth/smoother.ts; module scope
 *   <SmoothScroll authority="smoother" create={smoother}>{children}</SmoothScroll>
 *
 * The smoother starts in this component's layout effect, after the page's own (children first): ScrollSmoother
 * rebinds the triggers made before it, and no entrance plays before the lifecycle's `running` anyway.
 *
 * Route changes: render <PageLifecycle route={usePathname()} /> once in the root layout (react/PageLifecycle.tsx).
 * It needs no position in the tree. <RouteChange> below is the 2.1 component, kept so existing sites build.
 *
 * @deprecated <RouteChange>: it must wrap the page (a layout effect that has to run after the router's), which a
 * pathname reader can't do under Cache Components, and rendered before the page it syncs to the old scroll position.
 * Migrate: delete it, render <PageLifecycle route={usePathname()} /> in its own <Suspense> anywhere in the root
 * layout, and keep each GSAP route's onRouteRefresh(ScrollTrigger.refresh) as it is. A page that wrapped its content
 * in <RouteChange route={useSearchParams().toString()}> calls page.remeasure() in an effect keyed on them instead.
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'

import { nativeHandle, registerHandle, unregisterHandle, type SmoothScrollHandle } from './authority'
import { createSmoothScroll, rafDriver, type Driver, type SmoothScrollOptions } from './lenis'
import { routeChanged, SETTLE_MS, watchRouteSettle } from './route'

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface SmoothScrollProps {
  authority: 'native' | 'lenis' | 'smoother'
  /** 'smoother': creates the handle, `() => createSmoother(ScrollSmoother, options)`. Read once, when the authority starts. */
  create?: () => SmoothScrollHandle
  driver?: Driver
  lenis?: SmoothScrollOptions['lenis']
  anchors?: boolean
  children?: ReactNode
}

export function SmoothScroll({ authority, create, driver, lenis, anchors, children }: SmoothScrollProps) {
  // Latest props for the authority effect, without restarting the authority when a driver object is recreated.
  // Written in an effect, never during render (react-hooks/refs).
  const config = useRef({ create, driver, lenis, anchors })
  useIsomorphicLayoutEffect(() => {
    config.current = { create, driver, lenis, anchors }
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
    const { create: c, driver: d, lenis: l, anchors: a } = config.current
    if (authority === 'smoother') {
      if (!c) throw new Error('[scroll-animation] <SmoothScroll authority="smoother"> needs `create`: () => createSmoother(ScrollSmoother)')
      const smoother = c()
      return () => smoother.destroy()
    }
    const handle = createSmoothScroll({ driver: d ?? rafDriver(), lenis: l, anchors: a })
    return () => handle.destroy()
  }, [authority])

  if (authority === 'smoother') {
    return (
      <div id="smooth-wrapper">
        <div id="smooth-content">{children}</div>
      </div>
    )
  }
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

/** @deprecated Use <PageLifecycle> (react/PageLifecycle.tsx); see this file's header for the migration. */
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
