/**
 * entrance-signal.ts: the page-load entrance's clock, published once on the DOM, so everything costly on a busy hero
 * (a live canvas, video, a loop strip, embeds) can wait for it instead of guessing a time. Engine-free; it imports no
 * consumer, and no consumer imports it: the attribute and the event are the whole interface, as with render-bridge.ts.
 *
 *   <html data-entrance="pending">                  the author writes it into the server HTML when the page has a
 *                                                   load entrance; absent means "no entrance": consumers start at once
 *   publishEntrance('running')                      on <html>, or publishEntrance(phase, routeRoot)
 *   const stop = trackEntrance(heroEl)              CSS and WAAPI entrances (css/split.css, reveal.ts): running now,
 *                                                   settled once every finite animation under heroEl has finished
 *   addEventListener('entrance:phase', (e) => e.detail.phase)     bubbles from the scope; the attribute is already set
 *
 * - Phases, in order: pending → running → tail → settled. A phase never goes backwards: publishing one at or before the
 *   current is a no-op, so two publishers can't rewind each other (but the first to settle wins: one publisher per
 *   scope, the entrance's last group). `tail` is optional and may be skipped.
 * - `tail`: the display type is within about 1 px of rest. On CURVES.entrance a move of up to 100 px is within 1 px at
 *   TAIL_AT (0.8) of its duration (the curve's y reaches 0.99 there), so trackEntrance's default is that fraction of
 *   the last-ending animation. A shorter move gets there sooner (40 px: 0.7); a later tail is the safe side.
 * - Reduced motion, or the failsafe already fired (css/animation.css): `settled` at once, nothing else. No JavaScript:
 *   the server's `pending` stays, and the consumers' own timeouts cover it.
 * - The other engines publish from their blocks: motion/Reveal.tsx (`entrance`), gsap/reveal.ts and reveal.ts
 *   (`{ entrance: true }`). What waits on it is the hero budget (references/performance.md §14): only compositor work
 *   while `running`; costly starts queue on `settled`, one per task.
 * - Client-side navigation keeps <html>, and a settled scope never runs again: a route with its own entrance publishes
 *   on its route root instead (the scope argument), and its consumers read that.
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

/** Writes the phase on the scope (default <html>), then dispatches `entrance:phase`. Never backwards. */
export function publishEntrance(phase: EntrancePhase, scope?: Element): void {
  if (typeof document === 'undefined') return
  const el = scope ?? document.documentElement
  const current = readEntrance(el)
  if (current && ORDER.indexOf(current) >= ORDER.indexOf(phase)) return
  el.setAttribute('data-entrance', phase)
  el.dispatchEvent(new CustomEvent('entrance:phase', { bubbles: true, detail: { phase } }))
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
 */
export function trackEntrance(root: Element, opts: { scope?: Element; tailAt?: number } = {}): () => void {
  const { scope, tailAt = TAIL_AT } = opts
  if (window.matchMedia(REDUCED_MOTION_QUERY).matches || failsafeFired()) {
    publishEntrance('settled', scope)
    return () => {}
  }
  publishEntrance('running', scope)
  let live = true
  let tailTimer = 0
  let frame = 0
  let tailScheduled = false

  const settle = () => {
    if (!live) return
    live = false
    clearTimeout(tailTimer)
    cancelAnimationFrame(frame)
    publishEntrance('settled', scope)
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
        tailTimer = window.setTimeout(() => live && publishEntrance('tail', scope), Math.max(0, at - now))
      })
    }
    // A cancelled animation rejects `finished`; either way it no longer holds the entrance.
    Promise.allSettled(running.map((a) => a.finished)).then(() => live && afterTwoFrames(check))
  }
  afterTwoFrames(check)

  return () => {
    live = false
    clearTimeout(tailTimer)
    cancelAnimationFrame(frame)
  }
}

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
