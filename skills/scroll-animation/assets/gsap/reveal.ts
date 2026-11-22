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
 *   reveal(routeRoot, { entrance: true })         also publishes the page's entrance signal (entrance-signal.ts)
 *
 * - Group attributes: data-reveal-margin (the trigger line as a rootMargin; TRIGGERS.reveal, the top crossing 80%
 *   of the viewport; TRIGGERS.pageEnd for the last group or one that rests below the line), data-reveal-stagger
 *   (seconds between items that cross together; MOTION.lineStagger) and data-reveal-replay (reveal again on every
 *   return, reset only once the item is entirely out of view). `options` sets the defaults for groups that don't say.
 * - ScrollTrigger.batch, one trigger per item: items that cross together play as one staggered batch in document
 *   order, and an item further down (a column stacked on a phone) waits for its own arrival. An item plays only if it
 *   is on screen as it would start; otherwise its trigger stays. So items above the view at load, or jumped past (a
 *   reload's restored scroll position, an anchor), reveal when the reader scrolls back up to them, and items a client
 *   navigation's scroll carried below the fold wait for the reader.
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
 * - While a group plays it carries data-reveal-playing (css/reveal.css §5), dropped when its last item lands. GSAP's
 *   own force3D: 'auto' already layers a moving item for the tween; the marker is there so every engine reads the
 *   same, and so a check can see the group play.
 * - `entrance: true` publishes the entrance signal on <html> from the `mount` groups (GSAP tweens are not WAAPI, so
 *   trackEntrance can't see them): running as they start, tail once the last item has run TAIL_AT of its move,
 *   settled when the last lands, or at once under reduced motion or the failsafe. A destroy() publishes nothing (React's
 *   StrictMode destroys and rebuilds in development): an entrance torn down mid-way leaves consumers to their
 *   timeouts. One publisher per scope.
 * - An item's `transform` is GSAP's while it reveals. Its own `translate`, `rotate` and `scale` keep working: GSAP
 *   folds them into the transform for the length of the entrance and they are handed back when it lands.
 */
import { MOTION, TRIGGERS, failsafeFired } from '../config'
import { TAIL_AT, arrivesSettled, claimEntrance, entranceHeld, publishEntrance, whenEntranceOpen } from '../entrance-signal'
import {
  EASES,
  MOTION_CONDITIONS,
  ScrollTrigger,
  gsap,
  lineFromMargin,
  setupGsap,
  type MotionConditions,
} from './setup'

export interface RevealOptions {
  /** 'view' (default): each item as it crosses the line. 'mount': at once. */
  trigger?: 'mount' | 'view'
  /** The trigger line as an IntersectionObserver rootMargin. Default TRIGGERS.reveal. */
  margin?: string
  /** Seconds between items that cross together. Default MOTION.lineStagger. */
  stagger?: number
  /** Reveal again on every return. Default false: a reveal plays once. */
  replay?: boolean
  /** Publish the page's entrance signal (entrance-signal.ts) on <html> from the `mount` groups. */
  entrance?: boolean
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
  const running = new Map<HTMLElement, { timeline: gsap.core.Timeline; inline: string[]; styled: boolean }>()
  // The entrance signal: the mount items still in flight, and the tail's delayed call.
  const entering = new Set<HTMLElement>()
  let tail: gsap.core.Tween | null = null
  let destroyed = false

  /** The group is data-reveal-playing while any of its items is in `running`. */
  function markPlaying(el: HTMLElement) {
    const group = el.closest('[data-reveal]')
    if (!group) return
    const busy = Array.from(running.keys()).some((item) => item.closest('[data-reveal]') === group)
    if (busy) group.setAttribute('data-reveal-playing', '')
    else group.removeAttribute('data-reveal-playing')
  }

  function play(batch: HTMLElement[]): number {
    const indices = new Map<Group, number>()
    let last = -1
    for (const el of batch.sort(documentOrder)) {
      if (isShown(el) || running.has(el)) continue
      const group = groupOf(el)
      const index = indices.get(group) ?? 0
      indices.set(group, index + 1)
      const inline = WRITTEN.map((property) => el.style.getPropertyValue(property))
      const styled = el.hasAttribute('style')
      running.set(el, { timeline: entrance(el, index * group.stagger, () => land(el)), inline, styled })
      markPlaying(el)
      last = Math.max(last, index * group.stagger)
    }
    return last
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
    markPlaying(el)
    entry.timeline.kill()
    gsap.set(el, { clearProps: 'transform,opacity,clipPath' })
    WRITTEN.forEach((property, i) => {
      if (entry.inline[i]) el.style.setProperty(property, entry.inline[i])
      else el.style.removeProperty(property)
    })
    // Emptied, the style attribute stays: dropped where there was none.
    if (!entry.styled && el.getAttribute('style') === '') el.removeAttribute('style')
  }

  /** css/reveal.css's shown state is the entrance's end values, with nothing inline. */
  function land(el: HTMLElement) {
    el.setAttribute('data-reveal-state', 'shown')
    release(el)
    if (entering.delete(el) && !entering.size) {
      tail?.kill()
      if (!destroyed) publishEntrance('settled')
    }
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
      if (options.entrance) publishEntrance('settled')
      return
    }
    if (options.entrance) claimEntrance()
    // Out of the context's record: its revert would timeline.revert() them (see release). And only once the page
    // lifecycle's hold lifts (at once on a page that isn't held): a mount item never plays under a route transition.
    const cancelOpen = whenEntranceOpen(() => context.ignore(() => {
      if (destroyed) return
      // Back or forward: the reader returns to a page they have seen, so the mount groups land without playing.
      if (arrivesSettled()) {
        for (const [group, els] of byGroup) if (group.trigger === 'mount') els.forEach(land)
        if (options.entrance) publishEntrance('settled')
        return
      }
      let last = -1
      for (const [group, els] of byGroup) if (group.trigger === 'mount') last = Math.max(last, play(els))
      if (!options.entrance) return
      for (const [group, els] of byGroup) if (group.trigger === 'mount') els.filter((el) => running.has(el)).forEach((el) => entering.add(el))
      if (!entering.size) return publishEntrance('settled')
      publishEntrance('running')
      tail = gsap.delayedCall(last + TAIL_AT * MOTION.entrance.duration, () => publishEntrance('tail'))
    }))
    // A revert (reduced motion changing, destroy) lands every reveal in flight: triggered means shown.
    return () => {
      cancelOpen()
      Array.from(running.keys()).forEach(land)
    }
  })

  // The triggers live outside the build, for the handle's life. GSAP 3.15 zeroes the page's recorded scroll when the
  // last ScrollTrigger on it is killed during a matchMedia revert (or one is created during a rebuild), and the
  // refresh after the change then leaves the reader at the top: measured on a page whose only triggers were these.
  const triggers: ScrollTrigger[] = []
  const opens: Array<() => void> = []
  for (const [group, els] of byGroup) {
    if (group.trigger === 'mount') continue
    const watched = group.replay ? els : els.filter((el) => !isShown(el))
    if (!watched.length) continue
    // Entering from either side reveals, and only an item on screen plays: a callback is no proof of arrival.
    // ScrollTrigger fires the callbacks of every trigger a jump passes (limitCallbacks is off by default): iOS Safari
    // restoring a reload's scroll position after the triggers exist, an anchor, a scrollTo. And on a client
    // navigation the page's useGSAP runs before Next places the scroll (in an ancestor's layout effect), so the
    // triggers are created at the previous page's scrollY: an item in that band starts active, one above it fires
    // onEnterBack on the jump to the top, and either would play below the fold. An item off screen keeps its trigger
    // and reveals when the reader reaches it.
    // Held by the page lifecycle (a route transition, the scroll not placed yet): the same triggers are asked again
    // when the hold lifts, and the on-screen test then reads the placed page.
    const enter = (_batch: Element[], batchTriggers: ScrollTrigger[]) => {
      if (entranceHeld()) {
        opens.push(whenEntranceOpen(() => !destroyed && enter(_batch, batchTriggers.filter((trigger) => triggers.includes(trigger)))))
        return
      }
      const arrived = batchTriggers.filter((trigger) => onScreen(trigger.trigger as HTMLElement))
      if (!settled) play(arrived.map((trigger) => trigger.trigger as HTMLElement))
      if (!group.replay) arrived.forEach((trigger) => trigger.kill())
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
      destroyed = true
      tail?.kill()
      opens.forEach((cancel) => cancel())
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

const isShown = (el: Element) => el.getAttribute('data-reveal-state') === 'shown'

/** Some of the item is inside the viewport now (a smoother's transform included). */
function onScreen(el: Element): boolean {
  const { top, bottom } = el.getBoundingClientRect()
  return bottom > 0 && top < window.innerHeight
}

function documentOrder(a: Node, b: Node) {
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
}
