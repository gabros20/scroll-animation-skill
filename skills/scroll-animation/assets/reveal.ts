/**
 * reveal.ts: triggered entrances with no animation library. An IntersectionObserver at the trigger line marks an
 * item data-reveal-state="shown", and css/reveal.css transitions it from its resting state on the measured curves.
 * The same markup runs on gsap/reveal.ts, and motion/Reveal.tsx renders it.
 *
 *   <section data-reveal="view">                  "view" (default): each item reveals as it crosses the line
 *     <h2 data-reveal-item>…</h2>                   data-reveal-effect: rise (default) | fade | clip | scale-in
 *     <p data-reveal-item data-reveal-effect="fade">…</p>
 *   </section>
 *   <header data-reveal="mount">…</header>        "mount": reveals at once, for content on screen at load
 *
 *   const stop = mountReveals(routeRoot)          on a route's show; stop() on its hide or teardown
 *
 * - Group options, as attributes on the [data-reveal] element; items with no group take the defaults.
 *   - data-reveal-margin: the trigger line as an IntersectionObserver rootMargin (TRIGGERS.reveal, the top crossing
 *     80% of the viewport). The page's last group, or one that comes to rest below the line, takes TRIGGERS.pageEnd
 *     ("0px"): an inset line nothing scrolls across starves it forever. Never a fractional threshold: a fraction of an
 *     element taller than the viewport is never visible.
 *   - data-reveal-stagger: seconds between items that cross together, in document order (MOTION.lineStagger).
 *   - data-reveal-replay: reveal again on every return. An item resets only once it is entirely out of view, so
 *     the reset is never seen. Without it a reveal plays once.
 * - Triggered, not scrubbed: once an item crosses the line, the entrance runs on its own clock, and scrolling speed
 *   or direction changes nothing.
 * - The failsafe (css/animation.css): if it already revealed the page, every item is marked shown and nothing is
 *   hidden or replayed. mountReveals marks the engine ready (markAnimationReady), which switches the failsafe off.
 * - Reduced motion, live: css/reveal.css drops the resting state under `reduce`, so everything is visible at rest,
 *   and this marks every item shown. Turning it off later doesn't hide what is already shown.
 * - Next's Activity: mount on show and stop on hide. stop() lands every running reveal on its end state, and a
 *   re-mount skips what is already shown, so hide and show never replay an entrance. Pass the route's root, never
 *   `document`: a hidden route's DOM stays in the document.
 * - Never on the LCP element: its resting state waits for this script. An above-the-fold hero animates from CSS at
 *   first paint (SplitWords) instead.
 * - Items need a box (not display: contents) for the observer to see them. Content added later needs its own
 *   mountReveals.
 */
import { MOTION, REDUCED_MOTION_QUERY, TRIGGERS, failsafeFired, markAnimationReady } from './config'

interface GroupOptions {
  trigger: 'mount' | 'view'
  margin: string
  stagger: number
  replay: boolean
}

/** The properties css/reveal.css transitions: a reveal is done when none of them is still transitioning. */
const REVEAL_PROPERTIES = ['opacity', 'transform', 'clip-path']

export function mountReveals(root: ParentNode): () => void {
  markAnimationReady()
  const reduce = window.matchMedia(REDUCED_MOTION_QUERY)
  let stop = start(root, reduce.matches)
  // A rebuild on every change: stop() lands running reveals, and the next start skips what is shown.
  const onChange = () => {
    stop()
    stop = start(root, reduce.matches)
  }
  reduce.addEventListener('change', onChange)
  return () => {
    reduce.removeEventListener('change', onChange)
    stop()
  }
}

function start(root: ParentNode, reduced: boolean): () => void {
  const items = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal-item]'))
  if (reduced || failsafeFired()) {
    items.forEach(markShown)
    return () => {}
  }

  const groups = new Map<Element | null, GroupOptions>()
  const groupOf = (el: Element) => {
    const group = el.closest('[data-reveal]')
    let options = groups.get(group)
    if (!options) groups.set(group, (options = readGroup(group)))
    return options
  }
  const endings = new Map<HTMLElement, () => void>()
  const lines = new Map<string, IntersectionObserver>()

  /** Items that crossed together, staggered per group in document order. */
  function reveal(batch: HTMLElement[]) {
    const indices = new Map<GroupOptions, number>()
    for (const el of batch.sort(documentOrder)) {
      const group = groupOf(el)
      const index = indices.get(group) ?? 0
      indices.set(group, index + 1)
      show(el, index * group.stagger)
    }
  }

  function show(el: HTMLElement, delay: number) {
    el.setAttribute('data-reveal-transition', '')
    el.style.setProperty('--reveal-delay', `${delay}s`)
    el.setAttribute('data-reveal-state', 'shown')
    const settle = () => {
      if (!revealTransitions(el).length) land(el)
    }
    const onEnd = (event: TransitionEvent) => {
      if (event.target === el) settle()
    }
    el.addEventListener('transitionend', onEnd)
    el.addEventListener('transitioncancel', onEnd)
    // Nothing to transition (the values already match: a latched failsafe, a hidden ancestor): no event comes.
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(settle)))
    endings.set(el, () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('transitionend', onEnd)
      el.removeEventListener('transitioncancel', onEnd)
    })
  }

  /**
   * The end state: shown, no marker, no delay. A reveal cut off mid-way (stop, a reduced-motion change, a replay's
   * reset) is finished first: dropping the marker alone doesn't stop it, because a running transition whose end value
   * is unchanged keeps its duration.
   */
  function land(el: HTMLElement) {
    endings.get(el)?.()
    endings.delete(el)
    revealTransitions(el).forEach((transition) => transition.finish())
    el.removeAttribute('data-reveal-transition')
    el.style.removeProperty('--reveal-delay')
  }

  function reset(el: HTMLElement) {
    land(el)
    el.removeAttribute('data-reveal-state')
  }

  const gone = new IntersectionObserver((entries) => {
    for (const entry of latest(entries)) {
      if (!entry.isIntersecting && isShown(entry.target)) reset(entry.target as HTMLElement)
    }
  })

  const mounting: HTMLElement[] = []
  for (const el of items) {
    const group = groupOf(el)
    if (group.trigger === 'mount') {
      if (!isShown(el)) mounting.push(el)
      continue
    }
    if (isShown(el) && !group.replay) continue
    let line = lines.get(group.margin)
    if (!line) {
      const observer: IntersectionObserver = new IntersectionObserver(
        (entries) => {
          const crossed: HTMLElement[] = []
          for (const entry of latest(entries)) {
            const target = entry.target as HTMLElement
            if (!entry.isIntersecting || isShown(target)) continue
            crossed.push(target)
            if (!groupOf(target).replay) observer.unobserve(target)
          }
          if (crossed.length) reveal(crossed)
        },
        { rootMargin: group.margin },
      )
      lines.set(group.margin, (line = observer))
    }
    line.observe(el)
    if (group.replay) gone.observe(el)
  }
  if (mounting.length) {
    // A transition needs a computed before-state: resolve the resting style before flipping, in case the script
    // runs before the first style pass.
    for (const el of mounting) void getComputedStyle(el).opacity
    reveal(mounting)
  }

  return () => {
    lines.forEach((line) => line.disconnect())
    gone.disconnect()
    Array.from(endings.keys()).forEach(land)
  }
}

function readGroup(group: Element | null): GroupOptions {
  const trigger = group?.getAttribute('data-reveal') === 'mount' ? 'mount' : 'view'
  const stagger = Number.parseFloat(group?.getAttribute('data-reveal-stagger') ?? '')
  return {
    trigger,
    margin: group?.getAttribute('data-reveal-margin') || TRIGGERS.reveal,
    stagger: Number.isFinite(stagger) && stagger >= 0 ? stagger : MOTION.lineStagger,
    replay: trigger === 'view' && !!group?.hasAttribute('data-reveal-replay'),
  }
}

function markShown(el: HTMLElement) {
  el.removeAttribute('data-reveal-transition')
  el.style.removeProperty('--reveal-delay')
  el.setAttribute('data-reveal-state', 'shown')
}

const isShown = (el: Element) => el.getAttribute('data-reveal-state') === 'shown'

/** The reveal's own transitions still running (or waiting out their delay) on the item. */
function revealTransitions(el: HTMLElement): CSSTransition[] {
  return el
    .getAnimations()
    .filter(
      (a): a is CSSTransition =>
        a instanceof CSSTransition && REVEAL_PROPERTIES.includes(a.transitionProperty) && a.playState !== 'finished',
    )
}

/** One entry per target, the latest: a single callback can carry several for the same element. */
function latest(entries: IntersectionObserverEntry[]) {
  return new Map(entries.map((entry) => [entry.target, entry])).values()
}

function documentOrder(a: Node, b: Node) {
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
}
