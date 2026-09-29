/**
 * gsap/colour-track.ts — a recipe: a page colour that hands over from section to section in step with the scroll, on
 * GSAP pages. `colourTrack(root, options)` → a handle. One file to adapt in place.
 *
 *   <section data-colour-track="#f4efe6">…</section>              any CSS colour
 *   <section data-colour-track="oklch(0.3 0.06 255)">…</section>
 *   <section data-colour-track="var(--paper)">…</section>         a var() resolves on the target: define it on :root
 *
 *   const track = colourTrack(routeRoot)    // { target: document.body, property: 'background-color', start, end }
 *   track.refresh()   track.destroy()
 *
 * - When: the colour has to blend in step with the scroll. A hard change per section is cheaper and often better:
 *   each section painting its own background costs nothing, and a CSS transition on the target, switched by the
 *   section under a probe line, is what header-theme.ts does for the header.
 * - The target (default <body>) gets --track-a (the colour being left), --track-b (the colour arriving) and --track-p
 *   (0 → 1 across the handover), and its background-color becomes
 *   `color-mix(in oklch, var(--track-a), var(--track-b) calc(var(--track-p) * 100%))`. The blend runs in OKLCH, never
 *   RGB, so its midpoints keep their lightness and chroma instead of going muddy. `property: null` writes only the
 *   variables, for a rule of your own on the target; another property name takes the blend instead.
 * - A handover runs while the next section's top edge travels from `start` to `end` (ScrollTrigger positions, default
 *   'top 75%' → 'top 25%'). Between handovers the colour holds; before the first it is the first section's, past the
 *   last the last one's. One writer: every write comes from one scroll position, however many handovers there are.
 *   Colours are read as they are written, so changing data-colour-track on a section (a theme switch) takes effect on
 *   the next scroll or refresh().
 * - The three variables are registered (CSS.registerProperty) as non-inheriting, so a write on <body> restyles <body>
 *   alone, not every element under it. A registration can't be undone: destroy() leaves it, harmlessly. To read the
 *   variables lower in the tree, set `inherits: true` below, knowing every write then restyles the target's subtree.
 * - Cost: background-color is a paint, not a composite, so the target repaints on every frame of a handover. Budget it
 *   (references/performance.md) and keep the target to the element that needs the colour.
 * - Scrubbed and smoothed once: 0.5 s of catch-up under native scrolling, none under Lenis or ScrollSmoother, which
 *   already smooth. It reads the page's authority as it builds (getScrollAuthority(): the stamp, or a site's own
 *   Lenis), so create it after the route's authority, and after the page's pinned scenes under ScrollSmoother, where
 *   they pin through ScrollTrigger.
 * - Reduced motion (live, gsap.matchMedia(MOTION_CONDITIONS)): a colour change isn't movement, so the track stays,
 *   but it follows the scroll exactly, with no catch-up easing. The triggers live outside that build: GSAP 3.15 throws
 *   the reader to the top when a ScrollTrigger is created or killed during a matchMedia rebuild.
 * - A browser without color-mix(), or fewer than two sections: it does nothing, and the page's own colour stands.
 * - destroy() removes the triggers, the variables and the blend, and puts back the target's own inline values.
 */
import { getScrollAuthority } from '../smooth/authority'
import { MOTION_CONDITIONS, ScrollTrigger, gsap, setupGsap, type MotionConditions } from './setup'

export interface ColourTrackOptions {
  /** The element that takes the colour. Default document.body. */
  target?: HTMLElement
  /** The property that takes the blend. Default 'background-color'; null writes only the variables. */
  property?: string | null
  /** Where the next section's top edge starts a handover, as a ScrollTrigger start. Default 'top 75%'. */
  start?: string
  /** Where it ends one. Default 'top 25%'. */
  end?: string
  /** Seconds of catch-up, or true to follow the scroll exactly. Default: 0.5 under native scrolling, else true. */
  scrub?: number | true
}

export interface ColourTrackHandle {
  /** Re-measures the handovers and re-reads every colour. */
  refresh(): void
  destroy(): void
}

/** Seconds of catch-up under native scrolling: the one smoothing stage there. */
const NATIVE_SCRUB = 0.5
const BLEND = 'color-mix(in oklch, var(--track-a), var(--track-b) calc(var(--track-p) * 100%))'
const VARIABLES = [
  { name: '--track-a', syntax: '<color>', initialValue: 'transparent' },
  { name: '--track-b', syntax: '<color>', initialValue: 'transparent' },
  { name: '--track-p', syntax: '<number>', initialValue: '0' },
]

let registered = false

export function colourTrack(root: ParentNode, options: ColourTrackOptions = {}): ColourTrackHandle {
  const sections = Array.from(root.querySelectorAll<HTMLElement>('[data-colour-track]'))
  if (sections.length < 2 || !CSS.supports('color', 'color-mix(in oklch, red, blue 50%)')) {
    return { refresh() {}, destroy() {} }
  }
  setupGsap()
  if (!registered) {
    registered = true
    for (const variable of VARIABLES) {
      try {
        CSS.registerProperty({ ...variable, inherits: false })
      } catch {
        // Registered already (by the page, or another copy): that registration stands.
      }
    }
  }

  const target = options.target ?? document.body
  const property = options.property === undefined ? 'background-color' : options.property
  const names = [...VARIABLES.map((variable) => variable.name), ...(property ? [property] : [])]
  // What the page wrote itself, put back instead of cleared.
  const hadStyle = target.hasAttribute('style')
  const authored = names.map((name) => [target.style.getPropertyValue(name), target.style.getPropertyPriority(name)])
  if (property) target.style.setProperty(property, BLEND)

  /** The values written, in VARIABLES order: each is written only when it changes. */
  const written = ['', '', '']
  const put = (i: number, value: string) => {
    if (written[i] === value) return
    written[i] = value
    target.style.setProperty(VARIABLES[i]!.name, value)
  }
  const colour = (i: number) => sections[i]!.getAttribute('data-colour-track')?.trim() || 'transparent'

  /** The track at scroll position `y`: the handover it falls in (or holds after) and how far through it. */
  const write = (y: number) => {
    let i = handovers.length - 1
    let p = 1
    for (let h = 0; h < handovers.length; h++) {
      const { start, end } = handovers[h]!
      if (y >= end) continue
      i = h
      p = end > start ? Math.min(1, Math.max(0, (y - start) / (end - start))) : 0
      break
    }
    put(0, colour(i))
    put(1, colour(i + 1))
    put(2, String(Math.round(p * 10000) / 10000))
  }

  /** Set by each build: moves the track to a scroll position, `now` skipping the catch-up. Null between builds. */
  let move: ((y: number, now?: boolean) => void) | null = null
  /** The build's catch-up, if it has one. */
  let follow: gsap.QuickToFunc | null = null

  // One trigger per handover, on the section arriving, for the handle's life (see the header). A trigger refreshes as
  // it is created, before any build: `move` is still null then.
  const handovers = sections.slice(1).map((section) =>
    ScrollTrigger.create({
      trigger: section,
      start: options.start ?? 'top 75%',
      end: options.end ?? 'top 25%',
      onUpdate: (self) => move?.(self.scroll()),
      onRefresh: (self) => move?.(self.scroll(), true),
    }),
  )

  const mm = gsap.matchMedia()
  mm.add(MOTION_CONDITIONS, (context) => {
    const reduce = (context.conditions as MotionConditions).reduce
    const scrub = reduce ? true : (options.scrub ?? (getScrollAuthority() === 'native' ? NATIVE_SCRUB : true))
    if (scrub === true) {
      move = write
    } else {
      // The catch-up a numeric `scrub` gives, on the scroll position: every handover eases on one value, so none fight.
      const position = { y: handovers[0]!.scroll() }
      const to = unrecorded(context, () =>
        gsap.quickTo(position, 'y', { duration: scrub, ease: 'expo', onUpdate: () => write(position.y) }),
      )
      move = (y, now) => (now ? to(y, y) : to(y))
      follow = to
    }
    move(handovers[0]!.scroll(), true)
    return () => {
      follow?.tween.kill()
      follow = null
      move = null
    }
  })

  return {
    refresh() {
      ScrollTrigger.refresh()
    },
    destroy() {
      mm.revert()
      handovers.forEach((trigger) => trigger.kill())
      names.forEach((name, i) => {
        const [value, priority] = authored[i]!
        if (value) target.style.setProperty(name, value, priority)
        else target.style.removeProperty(name)
      })
      if (!hadStyle && target.getAttribute('style') === '') target.removeAttribute('style')
      written.fill('')
    },
  }
}

/**
 * Makes a tween outside the build's record. A matchMedia revert replays recorded tweens with their events on, so a
 * catch-up tween's onUpdate would write its stale start value one last time; this one is killed in the cleanup instead.
 */
function unrecorded<T>(context: gsap.Context, make: () => T): T {
  let made: T | undefined
  context.ignore(() => {
    made = make()
  })
  return made as T
}
