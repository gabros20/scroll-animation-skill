/**
 * view-transitions.ts: a page change through the View Transitions API, guarded, with no engine. css/view-transitions.css
 * is what the transition looks like (the root crossfade, vt-morph, vt-forward / vt-back, vt-none, the anchored
 * header); this file decides whether one runs. React projects use React's <ViewTransition> with the same CSS; this is
 * for vanilla pages and anything without React's component.
 *
 *   await transition(() => renderArticle(slug), { types: ['forward'] })    the DOM is updated when it resolves
 *   transition(update).finished                                             the animation is over (never rejects)
 *
 *   mountCrossDocumentTransitions()        a multi-page site, on every page, from a render-blocking script:
 *                                          <script type="module" blocking="render" src="…">; with
 *                                          css/view-transitions-mpa.css imported on every page
 *
 * - transition(update) runs `update` inside document.startViewTransition when it can, and directly, with no transition,
 *   when it can't: no API, reduced motion (read live, at each call), a hidden tab (the browser would skip it anyway),
 *   or a transition already running (ours, React's, the browser's own). A second call never starts a second transition
 *   or aborts the first: its update runs at once (or right after the first's, if the browser hasn't run that yet, so
 *   the last call wins), and the running transition carries on. Either way the
 *   promise resolves once `update` has, and rejects only with `update`'s own error. A transition the browser aborts
 *   (two elements with one view-transition-name, the tab hidden mid-way) still runs `update` and resolves; nothing
 *   surfaces as an unhandled AbortError or InvalidStateError.
 * - types (`:active-view-transition-type()`): `forward` and `back` pick the CSS's slides. Browsers that take only an
 *   update callback (Safari 18.0–18.1, Firefox 144–146) still transition, without the types.
 * - The scroll authority: Lenis keeps a target position of its own, so a smooth scroll still under way when `update`
 *   jumps the page (to the top of a new article) would carry on toward the old page's target, and ScrollSmoother's
 *   content would glide to the new position over its catch-up. After `update`, the page's handle
 *   (currentSmoothScroll()) syncs: it takes up wherever `update` left the scroll, at once, and measures the new page,
 *   so no catch-up runs. A Lenis the site started itself has no handle: end `update` with `lenis.resize()` and
 *   `lenis.scrollTo(window.scrollY, { immediate: true })`. `update` scrolls before it resolves; a scroll it leaves to
 *   a later frame lands after the new snapshot.
 * - mountCrossDocumentTransitions() gives each cross-document transition its direction when the new page is revealed
 *   (`pagereveal`): `back` for a history step to an earlier entry, `forward` for links and forward steps, none on a
 *   reload. It reads navigation.activation, and the navigation timing entry where there is no Navigation API (that
 *   tells a history step but not its direction: `back`). It has to run before the page's first frame, hence the
 *   render-blocking script; a script that runs later finds the reveal over and the page simply crossfades. `pageswap`
 *   (the old page) gets nothing: the old document's types never reach the new one, and the snapshot is the browser's.
 *   Firefox has no cross-document transitions yet: there, and on any page without the CSS opt-in, it does nothing.
 * - SSR-safe: nothing touches document or window until a function runs.
 */
import { prefersReducedMotion } from './config'
import { currentSmoothScroll } from './smooth/authority'

export type Update = () => void | Promise<void>

export interface TransitionOptions {
  /** View-transition types for `:active-view-transition-type()`: `forward` or `back` select the CSS's slides. */
  types?: string[]
}

export interface TransitionPromise extends Promise<void> {
  /** Resolves when the transition's animations end, at once when none ran. Never rejects. */
  finished: Promise<void>
}

export type Direction = 'forward' | 'back'

/** What this file reads beyond TypeScript 5.9's DOM lib: the running transition and a type set that can be added to. */
interface TypedTransition extends ViewTransition {
  types: ViewTransition['types'] & { add(type: string): unknown }
}
type ActiveDocument = Document & { activeViewTransition?: ViewTransition | null }
type NavigationWindow = Window & { navigation?: { activation?: NavigationActivation | null } }

const noop = () => {}

/** The transition this file started and that is still running. */
let running: ViewTransition | null = null
/** That transition's update, while it hasn't run yet: the browser runs it once the old page is captured. */
let pending: Promise<void> | null = null

/** Run `update` as a view transition when one can run, otherwise directly. Resolves when the DOM is updated. */
export function transition(update: Update, options: TransitionOptions = {}): TransitionPromise {
  const vt = canStart() ? start(update, options.types) : null
  if (!vt) {
    // Behind an update of ours that is still waiting for the capture, this one runs right after it (before the new
    // state is captured), so the last call still wins; otherwise it runs now.
    const updated = pending ? pending.then(() => run(update), () => run(update)) : run(update)
    return Object.assign(updated, { finished: updated.then(noop, noop) })
  }
  running = vt
  const updated = vt.updateCallbackDone
  pending = updated
  const settled = () => {
    if (pending === updated) pending = null
  }
  updated.then(settled, settled)
  // An aborted transition rejects `ready`, but the update still runs and `updateCallbackDone` carries only its outcome:
  // the rejection is nothing the caller has to handle.
  vt.ready.catch(noop)
  const finished = vt.finished.then(noop, noop).then(() => {
    if (running === vt) running = null
  })
  return Object.assign(updated, { finished })
}

/**
 * The direction of the navigation that loaded (or restored) this document: `back` for a history step to an earlier
 * entry, `forward` otherwise, null for a reload or when it can't be told.
 */
export function navigationDirection(): Direction | null {
  if (typeof window === 'undefined') return null
  const activation = (window as NavigationWindow).navigation?.activation
  if (activation) {
    if (activation.navigationType === 'reload') return null
    if (activation.navigationType !== 'traverse') return 'forward'
    const from = activation.from?.index ?? -1
    if (from < 0) return null
    return activation.entry.index < from ? 'back' : 'forward'
  }
  const entry = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined
  if (!entry || entry.type === 'reload') return null
  return entry.type === 'back_forward' ? 'back' : 'forward'
}

/** Give every cross-document transition into this page its direction as a type. Returns the cleanup. */
export function mountCrossDocumentTransitions(): () => void {
  if (typeof window === 'undefined' || !('onpagereveal' in window)) return noop
  const onReveal = (event: PageRevealEvent) => {
    const vt = event.viewTransition
    if (!vt) return
    // An inbound transition the browser aborts (the new page lost its opt-in) rejects all three, and nobody else holds them.
    vt.updateCallbackDone.catch(noop)
    vt.ready.catch(noop)
    vt.finished.catch(noop)
    // css/view-transitions-mpa.css opts in under no-preference only; a page that opted in without it is held to it here.
    if (prefersReducedMotion()) return vt.skipTransition()
    const direction = navigationDirection()
    if (direction) (vt as TypedTransition).types?.add(direction)
  }
  window.addEventListener('pagereveal', onReveal)
  return () => window.removeEventListener('pagereveal', onReveal)
}

function canStart(): boolean {
  if (typeof document === 'undefined' || typeof document.startViewTransition !== 'function') return false
  if (prefersReducedMotion() || document.visibilityState === 'hidden') return false
  return !running && !(document as ActiveDocument).activeViewTransition
}

function start(update: Update, types: string[] | undefined): ViewTransition | null {
  const callback = () => run(update)
  try {
    // The options form arrived with types: Chromium 125, Safari 18.2, Firefox 147.
    const withOptions = typeof ViewTransition !== 'undefined' && 'types' in ViewTransition.prototype
    return withOptions
      ? document.startViewTransition({ update: callback, types: types ?? [] })
      : document.startViewTransition(callback)
  } catch {
    return null
  }
}

async function run(update: Update): Promise<void> {
  await update()
  // A smoothing authority takes up where `update` left the page, at once (the header comment says why).
  currentSmoothScroll()?.sync()
}
