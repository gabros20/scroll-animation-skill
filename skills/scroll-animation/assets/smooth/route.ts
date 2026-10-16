/**
 * smooth/route.ts — what a client-side route change owes the page's scroll: one call, after the new route's blocks
 * mounted and the router placed the scroll (the top, a hash target, a back/forward restore).
 *
 *   import { ScrollTrigger } from 'gsap/ScrollTrigger'
 *   routeChanged({ refresh: () => ScrollTrigger.refresh() })     // GSAP pages; Motion-only and CSS pages pass none
 *
 * React: <RouteChange route={usePathname()} refresh={…}> around the root layout's children (SmoothScroll.tsx). Its
 * layout effect runs after every effect inside it: the route's useGSAP blocks, Next's scroll, the route's
 * SmoothScroll. Vanilla: call it after the swap and the router's scroll, then mount() the new route, which refreshes
 * once itself (so pass no refresh there).
 *
 * Measured in Chromium, WebKit and Firefox, Next 16.3.6, with and without Cache Components and a React
 * <ViewTransition> (docs/research/spikes-2026-09.md, S9):
 * - The router owns the position, and nothing here scrolls. Next scrolls a link to the top or to its hash target
 *   (under scroll-padding-top), and leaves back/forward to the browser's own restoration, which lands exactly under
 *   native scrolling and Lenis: keep `history.scrollRestoration` at 'auto'. The authority takes up the router's
 *   position at once (handle.sync()), never smoothing toward it.
 * - Lenis lives on across a navigation between two routes of one Lenis layout. Clicked mid-glide, it keeps gliding
 *   toward the old route's target and overrides the router: the new route lands at its bottom, and the next one far
 *   down. sync() ends the glide. A route that starts or stops Lenis has no glide to carry over.
 * - Refresh once, never per block. A block created on the new route measures itself as it is created, in page
 *   order; a trigger the navigation doesn't re-create (one in a persistent layout, a reading progress with
 *   `end: 'max'`) keeps the previous route's numbers until something refreshes it.
 */
import { currentSmoothScroll } from './authority'

export interface RouteChangeOptions {
  /** Re-measure the page's scroll-linked triggers once: `() => ScrollTrigger.refresh()` on GSAP pages. */
  refresh?: () => void
}

export function routeChanged(options: RouteChangeOptions = {}): void {
  currentSmoothScroll()?.sync()
  options.refresh?.()
}
