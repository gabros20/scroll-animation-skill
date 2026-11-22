/**
 * entrance-signal.ts: the entrance's clock on the DOM, so everything costly on a busy hero (a live canvas, video, a
 * loop strip, embeds) can wait for it instead of guessing a time. Engine-free; it imports no consumer and no consumer
 * imports it: the attributes and the event are the whole interface. page.ts (the page lifecycle) is built on it and
 * owns the phase per visit when a page runs it; without page.ts this file works alone, as in 2.1.
 *
 *   <html data-entrance="running">                  server HTML, a CSS entrance that plays at first paint
 *   <html data-entrance="pending">                  server HTML, an entrance a script starts (a JS reveal, a loader)
 *                                                   absent: "no entrance", consumers start at once
 *   publishEntrance('running')                      on <html>, or publishEntrance(phase, routeRoot)
 *   const stop = trackEntrance(heroEl)              CSS and WAAPI entrances (css/split.css, reveal.ts): running now,
 *                                                   settled once every finite animation under heroEl has finished
 *   addEventListener('entrance:phase', (e) => e.detail)     { phase, visit, kind }; bubbles; the attribute is set first
 *
 * - Phases, in order: pending → running → tail → settled. A phase never goes backwards within a visit: publishing
 *   one at or before the current is a no-op, so two publishers can't rewind each other. Only page.ts starts a new
 *   visit, which restarts the phase. `tail` is optional and may be skipped.
 * - What page.ts writes beside the phase, all on <html>: `data-visit` (a counter) and `data-visit-kind` (load, push,
 *   traverse, restore); `data-entrance-held` while it holds the entrance (a route transition, a loader, fonts); `data-visit-placed`
 *   once the router has placed the scroll;
 *   `data-entrance-started`, performance.now() at `running`. A block reads them here: entranceHeld(),
 *   whenEntranceOpen(fn), arrivesSettled(), entranceStartedAt().
 * - Held: the lifecycle publishes `running` itself when the holds release. A block that plays an entrance waits with
 *   whenEntranceOpen(); a phase published during the hold is published when it lifts.
 * - One publisher per visit, and one flag for it: `data-entrance-claimed`. A block that publishes on <html>
 *   (trackEntrance, `{ entrance: true }`, Reveal's `entrance`) sets it, and the lifecycle then writes no `tail` or
 *   `settled` of its own. With the flag unset the lifecycle tracks the page's own animations.
 * - `tail`: the display type is within about 1 px of rest. On CURVES.entrance a move of up to 100 px is within 1 px at
 *   TAIL_AT (0.8) of its duration (the curve's y reaches 0.99 there), so trackEntrance's default is that fraction of
 *   the last-ending animation. A shorter move gets there sooner (40 px: 0.7); a later tail is the safe side.
 * - Reduced motion, or the failsafe already fired (css/animation.css): `settled` at once, nothing else. No JavaScript:
 *   the server's phase stays, and the consumers' own timeouts cover it.
 * - The clocks: this file's timers run on the animation's own clock (its start time on document.timeline; Reveal's and
 *   GSAP's start with their moves), never on a guess. A consumer's timeout counts from the entrance's start,
 *   entranceStartedAt(): the lifecycle's stamp at `running`, else first contentful paint, else navigation start. Not
 *   from navigation start alone: that includes the network, and on a slow phone it ends mid-entrance.
 * - What waits on it is the hero budget (references/lifecycle.md, "The hero budget"): only compositor work while
 *   `running`; costly starts queue on `settled`, one per task (page.afterSettled).
 */
import { REDUCED_MOTION_QUERY, failsafeFired } from './config'

export type EntrancePhase = 'pending' | 'running' | 'tail' | 'settled'

const ORDER: readonly EntrancePhase[] = ['pending', 'running', 'tail', 'settled']

/** The fraction of the last-ending animation at which a move of up to 100 px on CURVES.entrance is within 1 px. */
export const TAIL_AT = 0.8

/** The scope's current phase, or null when it has no entrance. */
export function readEntrance(scope?: Element): EntrancePhase | null {
  if (typeof document === 'undefined') return null
  const value = (scope ?? document.documentElement).getAttribute('data-entrance')
  return ORDER.includes(value as EntrancePhase) ? (value as EntrancePhase) : null
}

/** How long a consumer waits for `settled` before starting anyway, counted from entranceStartedAt(). */
export const ENTRANCE_TIMEOUT_MS = 2500

export interface EntranceDetail {
  phase: EntrancePhase
  /** The lifecycle's visit counter and kind; 0 and 'load' on a page that doesn't run page.ts. */
  visit: number
  kind: string
}

const root = () => document.documentElement

/** @internal The event's detail, from what the lifecycle stamped on <html>. */
export function entranceDetail(phase: EntrancePhase): EntranceDetail {
  return {
    phase,
    visit: Number(root().getAttribute('data-visit')) || 0,
    kind: root().getAttribute('data-visit-kind') ?? 'load',
  }
}

/** Writes the phase on the scope (default <html>), then dispatches `entrance:phase`. Never backwards. */
export function publishEntrance(phase: EntrancePhase, scope?: Element): void {
  if (typeof document === 'undefined') return
  const el = scope ?? root()
  if (el !== root()) return write(el, phase)
  // On <html>, a publisher owns this visit's tail and settle. While the lifecycle holds the visit the phase is its
  // to open: what a publisher says meanwhile (a 2.1 block that doesn't wait) is said when the hold lifts, if the
  // visit is still the same one, in a microtask: the hold lifts inside the dispatch of `running`, and a write nested
  // there would reach that event's later listeners as a phase past `running` before they had heard `running`.
  if (phase !== 'pending') claimEntrance()
  if (phase !== 'pending' && entranceHeld()) {
    const visit = el.getAttribute('data-visit')
    whenEntranceOpen(() => queueMicrotask(() => el.getAttribute('data-visit') === visit && write(el, phase)))
    return
  }
  write(el, phase)
}

/**
 * @internal The lifecycle's own write on <html>: no claim, no hold. `restart` begins a new visit at an earlier
 * phase; `defer` dispatches the event in a microtask (a visit begins inside React's insertion effect, where a
 * listener must not set state). Blocks call publishEntrance.
 */
export function writeEntrance(phase: EntrancePhase, options: { restart?: boolean; defer?: boolean } = {}): void {
  if (typeof document === 'undefined') return
  if (options.restart) root().removeAttribute('data-entrance')
  write(root(), phase, options.defer)
}

function write(el: Element, phase: EntrancePhase, defer = false): void {
  const current = readEntrance(el)
  if (current && ORDER.indexOf(current) >= ORDER.indexOf(phase)) return
  el.setAttribute('data-entrance', phase)
  const event = new CustomEvent('entrance:phase', { bubbles: true, detail: entranceDetail(phase) })
  if (defer) queueMicrotask(() => el.dispatchEvent(event))
  else el.dispatchEvent(event)
}

/**
 * This visit's entrance has a publisher: the one flag the lifecycle checks before it writes `tail` or `settled`
 * itself. Publishing on <html> sets it; a block that will publish later calls it when it mounts.
 */
export function claimEntrance(): void {
  if (typeof document !== 'undefined') root().setAttribute('data-entrance-claimed', '')
}

/** @internal True once a block claimed this visit's entrance. */
export function entranceClaimed(): boolean {
  return typeof document !== 'undefined' && root().getAttribute('data-entrance-claimed') !== null
}

/** True while the page lifecycle holds entrances: placement, a route transition, fonts, a loader. */
export function entranceHeld(): boolean {
  return typeof document !== 'undefined' && root().getAttribute('data-entrance-held') !== null
}

/**
 * True for what mounts with a visit that arrives settled: back, forward or a bfcache restore (page.ts), until the
 * visit is placed. The reader is back where they were, so a `mount` entrance lands without playing. What mounts
 * later in that visit (a tab, a dialog, a lazy section) plays; a reveal at its line always plays on arrival.
 */
export function arrivesSettled(): boolean {
  if (typeof document === 'undefined') return false
  const kind = root().getAttribute('data-visit-kind')
  return (kind === 'traverse' || kind === 'restore') && root().getAttribute('data-visit-placed') === null
}

/**
 * Runs `fn` now, or once the lifecycle's hold lifts (its next `entrance:phase`). Returns the cancel. Every block
 * that plays an entrance starts through it, so nothing plays under a route transition or before the scroll is placed.
 */
export function whenEntranceOpen(fn: () => void): () => void {
  if (!entranceHeld()) {
    fn()
    return () => {}
  }
  const el = root()
  const onPhase = () => {
    if (entranceHeld()) return
    el.removeEventListener('entrance:phase', onPhase)
    fn()
  }
  el.addEventListener('entrance:phase', onPhase)
  return () => el.removeEventListener('entrance:phase', onPhase)
}

/**
 * performance.now() at which this visit's entrance started: the lifecycle's stamp, else first contentful paint (a
 * CSS entrance starts there), else 0 (navigation start). A consumer's timeout counts from it.
 */
export function entranceStartedAt(): number {
  if (typeof document === 'undefined') return 0
  const stamped = Number.parseFloat(root().getAttribute('data-entrance-started') ?? '')
  if (Number.isFinite(stamped)) return stamped
  const paint = typeof performance !== 'undefined' ? performance.getEntriesByName?.('first-contentful-paint')[0] : undefined
  return paint ? paint.startTime : 0
}

/**
 * CSS and WAAPI entrances: publishes running, then settled when every animation in root's subtree
 * (getAnimations({ subtree: true })) has finished; tail at `tailAt` (default TAIL_AT) of the longest.
 *
 * Counted: running, finite animations on the document timeline. Left out: loops (an infinite loop strip never
 * finishes), paused ones (a strip held until settled), scroll-driven ones (they finish only at the range's end) and
 * the failsafe's own 4 s animation. Animations that start later inside root (a staggered transition, a reveal that
 * crosses its line meanwhile) extend the entrance: settled waits until two frames pass with none left. stop() ends
 * the tracking and publishes nothing: React's StrictMode runs an effect's cleanup and the effect again in
 * development, and a settle there would start everything early. An entrance torn down mid-way leaves its consumers
 * to their timeouts.
 *
 * On <html> it is the visit's publisher (it claims), and under the lifecycle's hold it starts when the hold lifts.
 */
export function trackEntrance(root: Element, opts: { scope?: Element; tailAt?: number } = {}): () => void {
  const { scope, tailAt } = opts
  const onPage = !scope || scope === document.documentElement
  if (onPage) claimEntrance()
  return trackAnimations(root, (phase) => publishEntrance(phase, scope), tailAt, onPage)
}

/**
 * @internal The tracker itself, publishing through `publish`: trackEntrance's, and the lifecycle's own (which
 * writes only while no block has claimed the entrance).
 */
export function trackAnimations(
  root: Element,
  publish: (phase: EntrancePhase) => void,
  tailAt = TAIL_AT,
  waitForHold = false,
): () => void {
  if (window.matchMedia(REDUCED_MOTION_QUERY).matches || failsafeFired()) {
    publish('settled')
    return () => {}
  }
  let live = true
  let tailTimer = 0
  let frame = 0
  let tailScheduled = false

  const settle = () => {
    if (!live) return
    live = false
    clearTimeout(tailTimer)
    cancelAnimationFrame(frame)
    publish('settled')
  }

  // Two frames first: an animation started by this frame's style change exists only after it.
  const afterTwoFrames = (fn: () => void) => {
    frame = requestAnimationFrame(() => (frame = requestAnimationFrame(fn)))
  }

  const check = () => {
    if (!live) return
    const running = entranceAnimations(root)
    if (!running.length) return settle()
    if (!tailScheduled) {
      tailScheduled = true
      // A start time exists only once an animation is ready: a fresh one is still pending two frames in.
      Promise.allSettled(running.map((a) => a.ready)).then(() => {
        const at = tailTime(running, tailAt)
        const now = document.timeline.currentTime
        if (!live || at === null || typeof now !== 'number') return
        tailTimer = window.setTimeout(() => live && publish('tail'), Math.max(0, at - now))
      })
    }
    // A cancelled animation rejects `finished`; either way it no longer holds the entrance.
    Promise.allSettled(running.map((a) => a.finished)).then(() => live && afterTwoFrames(check))
  }
  const cancelOpen = (waitForHold ? whenEntranceOpen : now)(() => {
    if (!live) return
    publish('running')
    afterTwoFrames(check)
  })

  return () => {
    live = false
    cancelOpen()
    clearTimeout(tailTimer)
    cancelAnimationFrame(frame)
  }
}

const now = (fn: () => void) => (fn(), () => {})

function entranceAnimations(root: Element): Animation[] {
  return root.getAnimations({ subtree: true }).filter((a) => {
    if (a.playState !== 'running' || a.timeline !== document.timeline) return false
    if (typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation && a.animationName.startsWith('animation-failsafe')) return false
    const end = a.effect?.getComputedTiming().endTime
    return typeof end === 'number' && Number.isFinite(end)
  })
}

/** Document-timeline ms at which the last-ending animation reaches `fraction` of its active duration. */
function tailTime(animations: Animation[], fraction: number): number | null {
  let last: { end: number; at: number } | null = null
  for (const a of animations) {
    const timing = a.effect?.getComputedTiming()
    const start = a.startTime
    if (!timing || typeof start !== 'number' || typeof timing.endTime !== 'number') continue
    const active = typeof timing.activeDuration === 'number' ? timing.activeDuration : 0
    const delay = timing.delay ?? 0
    const rate = a.playbackRate || 1
    const end = start + timing.endTime / rate
    if (!last || end > last.end) last = { end, at: start + (delay + fraction * active) / rate }
  }
  return last?.at ?? null
}
