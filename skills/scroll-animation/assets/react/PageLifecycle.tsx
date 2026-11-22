'use client'
/**
 * react/PageLifecycle.tsx: the page lifecycle's route adapter for React (page.ts). It renders nothing and wraps
 * nothing, so it can sit anywhere under the root layout: before the page, after it, in its own <Suspense>.
 *
 *   'use client'   // components/lifecycle.tsx
 *   import { usePathname } from 'next/navigation'
 *   export function Lifecycle() {
 *     return <PageLifecycle route={usePathname()} />
 *   }
 *
 *   // app/layout.tsx, anywhere in <body>. With Cache Components a pathname reader needs its own boundary:
 *   <Suspense fallback={null}><Lifecycle /></Suspense>
 *
 * - Render one, in the root layout, so it is mounted for the first load: the first route it sees is the load.
 * - `route` is the visit's identity: the pathname. Each change is one visit (page.begin(), then page.placed()). A
 *   page whose content follows its search params calls page.remeasure() when they change; it is the same visit.
 * - begin() runs in an insertion effect. React runs every insertion effect of a commit in its mutation phase, before
 *   any layout effect anywhere in the tree (react-dom 19.3 canary as compiled into next@16.3.6:
 *   commitMutationEffectsOnFiber), so the visit is `pending` and held before a block's useLayoutEffect or useGSAP
 *   creates an entrance, wherever this component sits.
 * - placed() runs in a passive effect: every layout effect of the commit has run by then, the router's scroll
 *   (Next places it in a layout effect of an ancestor of the page) included. Under a React <ViewTransition> passive
 *   effects wait for the transition to finish (same source: startViewTransition's `finished` handler), so the
 *   lifecycle's two-frame fallback places first; either order gives one refresh.
 * - It never scrolls and never syncs the authority: the authority follows the router by its own rule
 *   (smooth/authority.ts).
 *
 * Other routers call the same two functions from their own hooks: page.begin() after the swap and before the new
 * page's blocks mount (Astro `astro:after-swap`, SvelteKit `afterNavigate`, a vanilla router after its swap).
 *
 * Keep if you rewrite: begin() before the commit's layout effects; nothing here reads or writes the scroll position.
 */
import { useEffect, useInsertionEffect } from 'react'

import { page } from '../page'

export interface PageLifecycleProps {
  /** The route's identity: usePathname() in Next. */
  route: string
}

// The route the last visit began for. Module-level, not a ref: rendered once in the root layout it never remounts,
// but if it ever does (its boundary re-mounted, a copy rendered below the root layout against the rule) a ref
// would start equal to the new route and that navigation would begin no visit. The first value is the load (the
// lifecycle's own `load` visit); StrictMode's second effect isn't a navigation.
let lastRoute: string | undefined

export function PageLifecycle({ route }: PageLifecycleProps) {
  useInsertionEffect(() => {
    if (lastRoute === route) return
    const first = lastRoute === undefined
    lastRoute = route
    if (!first) page.begin()
  }, [route])
  useEffect(() => {
    // On the first render this starts the lifecycle (the `load` visit) and its settle watch.
    page.placed()
  }, [route])
  return null
}
