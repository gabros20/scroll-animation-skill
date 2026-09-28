/**
 * gsap/reveal.ts: triggered entrances on GSAP pages: `reveal(root, options)` → a handle. The markup and
 * css/reveal.css are the engine-free path's (reveal.ts); GSAP plays each entrance on the measured eases instead of
 * a CSS transition.
 *
 *   <section data-reveal="view">                  "view" (default): each item reveals as it crosses the line
 *     <h2 data-reveal-item>…</h2>                   data-reveal-effect: rise (default) | fade | clip | scale-in
 *     <p data-reveal-item data-reveal-effect="fade">…</p>
 *   </section>
 *   <header data-reveal="mount">…</header>        "mount": reveals at once, for content on screen at load
 *
 *   const reveals = reveal(routeRoot)             reveals.destroy() on the route's hide or teardown
 *
 * - Group attributes: data-reveal-margin (the trigger line as a rootMargin; TRIGGERS.reveal, the top crossing 80%
 *   of the viewport; TRIGGERS.pageEnd for the last group or one that rests below the line), data-reveal-stagger
 *   (seconds between items that cross together; MOTION.lineStagger) and data-reveal-replay (reveal again on every
 *   return, reset only once the item is entirely out of view). `options` sets the defaults for groups that don't say.
 * - ScrollTrigger.batch, one trigger per item: items that cross together play as one staggered batch in document
 *   order, and an item further down (a column stacked on a phone) waits for its own arrival. Items above the view at
 *   load reveal when the reader scrolls back up to them.
 * - Each item tweens from its computed resting state (css/reveal.css) to rest: the move on EASES.entrance, the fade
 *   short and late against it (MOTION.entranceFade). When it lands the item is marked data-reveal-state="shown" and
 *   GSAP's inline writes are cleared, so nothing is left behind but the item's own styles.
 * - Built inside gsap.matchMedia(MOTION_CONDITIONS), so reduced motion is live: under `reduce` every item is marked
 *   shown and nothing moves (css/reveal.css shows it at rest), and a change reverts and rebuilds. A revert lands
 *   running reveals on their end state, and a build skips items already shown, so no entrance plays twice. The
 *   triggers stay outside the build (see below): a rebuild that kills or creates them throws the reader to the top.
 *   For the same reason, call reveal() outside your own gsap.matchMedia callbacks.
 * - The failsafe (css/animation.css): if it already revealed the page, every item is marked shown and nothing is
 *   hidden or replayed. setupGsap() marks the engine ready, which switches the failsafe off.
 * - In React, call it inside useGSAP(() => { const r = reveal(ref.current!); return () => r.destroy() }); on a
 *   vanilla page, in the route's mount(routeRoot). Pass the route's root, never `document`: Next's Activity keeps a
 *   hidden route's DOM in the document.
 * - Never on the LCP element: its resting state waits for this script. An above-the-fold hero animates from CSS at
 *   first paint (SplitWords) instead.
 * - An item's `transform` is GSAP's while it reveals. Its own `translate`, `rotate` and `scale` keep working: GSAP
 *   folds them into the transform for the length of the entrance and they are handed back when it lands.
 */
import { MOTION, TRIGGERS, failsafeFired } from '../config'
import { EASES, MOTION_CONDITIONS, ScrollTrigger, gsap, setupGsap, type MotionConditions } from './setup'

export interface RevealOptions {
  /** 'view' (default): each item as it crosses the line. 'mount': at once. */
  trigger?: 'mount' | 'view'
  /** The trigger line as an IntersectionObserver rootMargin. Default TRIGGERS.reveal. */
  margin?: string
  /** Seconds between items that cross together. Default MOTION.lineStagger. */
  stagger?: number
  /** Reveal again on every return. Default false: a reveal plays once. */
  replay?: boolean
}

export interface RevealHandle {
  /** Lands running reveals on their end state and removes every trigger. What is shown stays shown. */
  destroy(): void
}

interface Group {
  trigger: 'mount' | 'view'
  margin: string
  stagger: number
  replay: boolean
}

/** The inline properties an entrance writes, counting the translate, rotate and scale GSAP sets to none. */
const WRITTEN = ['transform', 'translate', 'rotate', 'scale', 'opacity', 'clip-path']

export function reveal(root: ParentNode, options: RevealOptions = {}): RevealHandle {
  setupGsap()
  const items = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal-item]'))
  const groups = new Map<Element | null, Group>()
  const groupOf = (el: Element) => {
    const group = el.closest('[data-reveal]')
    let read = groups.get(group)
    if (!read) groups.set(group, (read = readGroup(group, options)))
    return read
  }
  // Reveals in flight, with the item's own inline values from before GSAP touched it. Tracked here, not left to the
  // matchMedia context: a batch plays them from a callback, after the build has returned.
  const running = new Map<HTMLElement, { timeline: gsap.core.Timeline; inline: string[] }>()

  function play(batch: HTMLElement[]) {
    const indices = new Map<Group, number>()
    for (const el of batch.sort(documentOrder)) {
      if (isShown(el) || running.has(el)) continue
      const group = groupOf(el)
      const index = indices.get(group) ?? 0
      indices.set(group, index + 1)
      const inline = WRITTEN.map((property) => el.style.getPropertyValue(property))
      running.set(el, { timeline: entrance(el, index * group.stagger, () => land(el)), inline })
    }
  }

  /**
   * Stops an entrance and hands the item back as it was before it. Not timeline.revert(): GSAP folds the item's own
   * translate, rotate and scale into the transform it starts from (the resting offset included) and would write that
   * back inline, leaving a landed item stuck at its resting offset. clearProps drops GSAP's inline writes and its
   * cached transform, so a replay reads the resting state again.
   */
  function release(el: HTMLElement) {
    const entry = running.get(el)
    if (!entry) return
    running.delete(el)
    entry.timeline.kill()
    gsap.set(el, { clearProps: 'transform,opacity,clipPath' })
    WRITTEN.forEach((property, i) => {
      if (entry.inline[i]) el.style.setProperty(property, entry.inline[i])
      else el.style.removeProperty(property)
    })
  }

  /** css/reveal.css's shown state is the entrance's end values, with nothing inline. */
  function land(el: HTMLElement) {
    el.setAttribute('data-reveal-state', 'shown')
    release(el)
  }

  function reset(el: HTMLElement) {
    release(el)
    el.removeAttribute('data-reveal-state')
  }

  const byGroup = new Map<Group, HTMLElement[]>()
  for (const el of items) {
    const group = groupOf(el)
    byGroup.set(group, [...(byGroup.get(group) ?? []), el])
  }

  // Under reduced motion, or once the failsafe revealed the page, every item is shown and nothing plays.
  let settled = false
  const mm = gsap.matchMedia()
  mm.add(MOTION_CONDITIONS, (context) => {
    settled = (context.conditions as MotionConditions).reduce || failsafeFired()
    if (settled) {
      items.forEach(land)
      return
    }
    // Out of the context's record: its revert would timeline.revert() them (see release).
    context.ignore(() => {
      for (const [group, els] of byGroup) if (group.trigger === 'mount') play(els)
    })
    // A revert (reduced motion changing, destroy) lands every reveal in flight: triggered means shown.
    return () => Array.from(running.keys()).forEach(land)
  })

  // The triggers live outside the build, for the handle's life. GSAP 3.15 zeroes the page's recorded scroll when the
  // last ScrollTrigger on it is killed during a matchMedia revert (or one is created during a rebuild), and the
  // refresh after the change then leaves the reader at the top: measured on a page whose only triggers were these.
  const triggers: ScrollTrigger[] = []
  for (const [group, els] of byGroup) {
    if (group.trigger === 'mount') continue
    const watched = group.replay ? els : els.filter((el) => !isShown(el))
    if (!watched.length) continue
    // Entering from either side reveals: an item above the view at load reveals on the way back up.
    const enter = (batch: Element[], batchTriggers: ScrollTrigger[]) => {
      if (!settled) play(batch as HTMLElement[])
      if (!group.replay) batchTriggers.forEach((trigger) => trigger.kill())
    }
    triggers.push(...ScrollTrigger.batch(watched, { ...lineFromMargin(group.margin), onEnter: enter, onEnterBack: enter }))
    if (group.replay) {
      // Reset only once the item is entirely out of view, so the reset is never seen.
      const leave = (batch: Element[]) => {
        if (!settled) (batch as HTMLElement[]).forEach(reset)
      }
      triggers.push(...ScrollTrigger.batch(watched, { start: 'top bottom', end: 'bottom top', onLeave: leave, onLeaveBack: leave }))
    }
  }

  return {
    destroy() {
      mm.revert()
      triggers.forEach((trigger) => trigger.kill())
    },
  }
}

function entrance(el: HTMLElement, delay: number, onComplete: () => void): gsap.core.Timeline {
  const timeline = gsap.timeline({ delay, onComplete })
  const move = { duration: MOTION.entrance.duration, ease: EASES.entrance }
  const effect = el.getAttribute('data-reveal-effect')
  if (effect === 'fade') return timeline.to(el, { opacity: 1, ...move })
  if (effect === 'clip') return timeline.to(el, { clipPath: openInset(el), ...move })
  timeline.to(el, effect === 'scale-in' ? { scale: 1, ...move } : { y: 0, ...move }, 0)
  return timeline.to(el, { opacity: 1, duration: MOTION.entranceFade.duration, ease: 'none' }, MOTION.entranceFade.delay)
}

/**
 * The computed resting clip with every inset at 0. GSAP tweens a string number by number, so the end has to match
 * the browser's serialisation of the start (`inset(100% 0px 0px)`, three values), not a four-value literal.
 */
function openInset(el: HTMLElement): string {
  return getComputedStyle(el).clipPath.replace(/-?\d*\.?\d+(?:e-?\d+)?/g, '0')
}

function readGroup(group: Element | null, defaults: RevealOptions): Group {
  const attr = group?.getAttribute('data-reveal')
  const trigger = attr === 'mount' || attr === 'view' ? attr : (defaults.trigger ?? 'view')
  const stagger = Number.parseFloat(group?.getAttribute('data-reveal-stagger') ?? '')
  return {
    trigger,
    margin: group?.getAttribute('data-reveal-margin') || defaults.margin || TRIGGERS.reveal,
    stagger: Number.isFinite(stagger) && stagger >= 0 ? stagger : (defaults.stagger ?? MOTION.lineStagger),
    replay: trigger === 'view' && (!!group?.hasAttribute('data-reveal-replay') || defaults.replay === true),
  }
}

/**
 * A rootMargin as ScrollTrigger positions: `start` where the item's top meets the bottom edge of the margin box,
 * `end` where its bottom leaves the top edge. TRIGGERS.reveal ('0px 0px -20% 0px') is start 'top 80%', end
 * 'bottom top', the same line an IntersectionObserver draws.
 */
function lineFromMargin(margin: string): { start: string; end: string } {
  const values = margin.trim().split(/\s+/)
  const top = values[0] ?? '0px'
  const bottom = values[2] ?? top
  return { start: `top ${edgeAt('bottom', bottom)}`, end: `bottom ${edgeAt('top', top)}` }
}

/** A viewport edge moved outward by a margin (the bottom edge down, the top edge up), as a ScrollTrigger position. */
function edgeAt(edge: 'top' | 'bottom', length: string): string {
  const match = /^(-?\d*\.?\d+)(px|%)?$/.exec(length)
  // Down the screen is positive.
  const offset = (match ? Number(match[1]) : 0) * (edge === 'bottom' ? 1 : -1)
  if (match?.[2] === '%') return `${(edge === 'bottom' ? 100 : 0) + offset}%`
  return offset === 0 ? edge : `${edge}${offset > 0 ? '+=' : '-='}${Math.abs(offset)}`
}

const isShown = (el: Element) => el.getAttribute('data-reveal-state') === 'shown'

function documentOrder(a: Node, b: Node) {
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
}
