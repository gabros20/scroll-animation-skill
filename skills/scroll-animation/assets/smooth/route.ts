/**
 * smooth/route.ts — what a client-side route change owes the page's scroll: one call, after the new route's blocks
 * mounted and the router placed the scroll (the top, a hash target, a back/forward restore).
 *
 *   routeChanged()                                      the authority syncs, the registered refreshes run once
 *   watchRouteSettle()                                  a fresh load: re-measure only as streamed content lands
 *
 *   // A GSAP route registers its refresh while it is shown (from its own layout):
 *   import { ScrollTrigger } from 'gsap/ScrollTrigger'
 *   const unregister = onRouteRefresh(ScrollTrigger.refresh)
 *   useGSAP(() => onRouteRefresh(ScrollTrigger.refresh))   React: useGSAP unregisters it when the layout goes
 *
 * React: <RouteChange route={usePathname()}> around the root layout's children (SmoothScroll.tsx). Its layout effect
 * runs after every effect inside it: the route's useGSAP blocks and registrations, Next's scroll, the route's
 * SmoothScroll. Registering keeps GSAP off the routes that never load it (the root layout imports none).
 * `routeChanged({ refresh })` still works, for a page that would rather pass it each time. Vanilla: call it after the
 * swap and the router's scroll, then mount() the new route, which refreshes once itself (so register nothing there,
 * and call routeSettled({ refresh: ScrollTrigger.refresh }) when the route's late content lands).
 *
 * What counts as a route change is the caller's key: the pathname. A page whose content changes with its search
 * params (a filter, a tab) is a new route each time they change: it renders its own <RouteChange
 * route={useSearchParams().toString()}> around its content. A search-param navigation keeps the page mounted, so
 * nothing else re-measures it (measured, Next 16.3.6).
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
 * - A streamed route commits twice or more: Next commits its loading.tsx (or a Suspense fallback) under the new
 *   pathname first, and the content lands later. Refreshed at the first commit, a layout-level `end: 'max'` measured
 *   the skeleton (0–64 against a fresh load's 0–3464) and a trigger below a streamed section kept its pre-stream
 *   start. So for `settle` ms after the change (SETTLE_MS) the page's height is watched (a ResizeObserver, debounced
 *   by SETTLE_DEBOUNCE_MS, never per frame), and each change that lands runs the refreshes again, without sync(): a
 *   reader may already be scrolling. Lenis follows the height itself (its own observer). Content that lands later,
 *   or a client fetch the route waits for, calls routeSettled() when it is in.
 * - A fresh load of a streamed route can miss it too: React reveals streamed content in batches, up to ~300 ms after
 *   its HTML arrived, so in Chromium it can land after `load`, when ScrollTrigger runs its own refresh. With the
 *   whole document in one piece, `end: 'max'` kept 0–64 against 0–3464 on every load (WebKit and Firefox hydrated
 *   after the reveal). So a fresh load watches too: watchRouteSettle() alone, which <RouteChange> runs on its first
 *   render; a vanilla page calls it after its first mount().
 * One watch runs at a time: a new one (the next change, a nested <RouteChange>) ends the one before and keeps the
 * height it last measured, so a change still pending refreshes once.
 */
import { currentSmoothScroll } from './authority'

/** How long after a route change its late content (streamed sections, images) still re-measures the page. */
export const SETTLE_MS = 5000
/** One refresh per burst of height changes. */
export const SETTLE_DEBOUNCE_MS = 150

export interface RouteChangeOptions {
  /** Re-measure the page's scroll-linked triggers: runs with the registered refreshes (each function once). */
  refresh?: () => void
  /** Milliseconds to keep re-measuring as the route's content lands (SETTLE_MS); 0 turns the watch off. */
  settle?: number
}

// Each registered function with its count: two registrations of one function run it once, and unregister apart.
const registered = new Map<() => void, number>()

/**
 * Re-measure on every route change while this is registered: `ScrollTrigger.refresh` from a GSAP route's layout.
 * Returns the unregister. One function registered twice runs once per change.
 */
export function onRouteRefresh(refresh: () => void): () => void {
  registered.set(refresh, (registered.get(refresh) ?? 0) + 1)
  let live = true
  return () => {
    if (!live) return
    live = false
    const count = (registered.get(refresh) ?? 1) - 1
    if (count > 0) registered.set(refresh, count)
    else registered.delete(refresh)
  }
}

function refreshAll(refresh: (() => void) | undefined): void {
  const run = new Set(registered.keys())
  if (refresh) run.add(refresh)
  for (const fn of run) fn()
}

/** The route's late content landed: run the refreshes once more, without touching the scroll. */
export function routeSettled(options: Pick<RouteChangeOptions, 'refresh'> = {}): void {
  refreshAll(options.refresh)
}

/** Sync the authority, refresh once, then watch the route settle. Returns the watch's stop (for the next change). */
export function routeChanged(options: RouteChangeOptions = {}): () => void {
  currentSmoothScroll()?.sync()
  refreshAll(options.refresh)
  return watch(options, true)
}

/**
 * For `settle` ms, run the refreshes again (never sync) each time the page's height changes, debounced. Nothing
 * runs now: a fresh load's own refresh (ScrollTrigger's, at `load`) or routeChanged()'s already did. Returns its stop.
 */
export function watchRouteSettle(options: RouteChangeOptions = {}): () => void {
  return watch(options, false)
}

// The watch running now, and the height its last refresh measured. A new watch (the next change, a nested
// <RouteChange> at the same commit) ends it and, unless it just refreshed, takes that height over: a height change
// the old watch hadn't refreshed yet still runs once, and two watches never refresh one change twice.
let watching: { stop: () => void; measured: number } | undefined

function watch({ refresh, settle = SETTLE_MS }: RouteChangeOptions, refreshed: boolean): () => void {
  const before = watching
  before?.stop()
  if (!(settle > 0) || typeof document === 'undefined' || typeof ResizeObserver === 'undefined') return () => {}
  const root = document.documentElement
  let pending: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    observer.disconnect()
    clearTimeout(pending)
    clearTimeout(end)
    if (watching === self) watching = undefined
  }
  // The observer's first report, and a refresh's own pin spacing, match `measured`: nothing runs for them.
  const self = { stop, measured: refreshed || !before ? root.scrollHeight : before.measured }
  const check = () => {
    pending = undefined
    if (root.scrollHeight === self.measured) return
    refreshAll(refresh)
    self.measured = root.scrollHeight
  }
  const observer = new ResizeObserver(() => {
    clearTimeout(pending)
    pending = setTimeout(check, SETTLE_DEBOUNCE_MS)
  })
  observer.observe(root)
  if (document.body) observer.observe(document.body)
  const end = setTimeout(stop, settle)
  watching = self
  return stop
}
