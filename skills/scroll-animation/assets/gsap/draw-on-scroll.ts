/**
 * gsap/draw-on-scroll.ts — a recipe: SVG strokes that draw as the reader scrolls, on GSAP pages, with DrawSVGPlugin
 * (in the gsap package, free since 3.13). `drawOnScroll(root, options)` → a handle. One file to adapt in place.
 *
 *   <svg viewBox="0 0 600 120" aria-hidden="true">               or role="img" with a <title>, if it means something
 *     <path data-draw d="…" fill="none" stroke="currentColor" />
 *   </svg>
 *
 *   const lines = drawOnScroll(routeRoot)      // { start, end, scrub }     lines.destroy()
 *
 * - When: a route that already runs GSAP. Without it, the plugin-free version is a few lines of CSS: give each shape
 *   pathLength="1", so its length is 1 whatever its geometry, and drive stroke-dashoffset with a variable, animated by
 *   a view() timeline where scroll-driven animations run. Its static state is fully drawn, like this recipe's:
 *
 *     @property --draw { syntax: '<number>'; inherits: true; initial-value: 1 }
 *     .drawn [pathLength] { stroke-dasharray: 1; stroke-dashoffset: calc(1 - var(--draw)) }
 *     @keyframes draw-in { from { --draw: 0 } }
 *     @supports (animation-timeline: view()) {
 *       @media screen and (prefers-reduced-motion: no-preference) {
 *         .drawn { animation: draw-in linear both; animation-timeline: view(); animation-range: entry 20% cover 50% }
 *       }
 *     }
 *
 * - Every [data-draw] shape (a path, line, polyline, polygon, rect or ellipse) draws over its <svg>'s pass: from
 *   the svg's top at `start` (default 'top 80%') to its bottom at `end` (default 'bottom 50%'), so a tall line's
 *   drawing tip travels from 80% to 50% down the viewport, ahead of the reader. Shapes in one svg draw one after
 *   another in document order, each for a share of the pass as long as its stroke, so the pen moves at one speed.
 * - Stroke only: drawSVG writes stroke-dasharray and stroke-dashoffset, and a fill shows at once. Keep it below the
 *   fold: above it, the first frame shows the stroke fully drawn until this script runs.
 * - GSAP's documented caveats: Firefox occasionally measures a <path> short, so it stops a little before its end at
 *   '100%' (give the path more anchors, or draw to '102%'), and iOS Safari can draw a <rect>'s stroke wrong (use a
 *   <path> or <polyline>).
 * - Scrubbed and smoothed once: 0.5 s of catch-up under native scrolling (what `scrub: 0.5` gives, on the expo ease
 *   ScrollTrigger's scrub uses, through gsap.quickTo on the progress), none under Lenis or ScrollSmoother, which
 *   already smooth. It reads <html data-scroll-authority> as it builds, so create it after the route's scroll
 *   authority.
 * - Reduced motion (live, gsap.matchMedia(MOTION_CONDITIONS)): fully drawn, nothing inline. So is every shape without
 *   JavaScript and in print. The triggers live outside that build: GSAP 3.15 throws the reader to the top when a
 *   ScrollTrigger is created or killed during a matchMedia rebuild. For the same reason, call drawOnScroll() outside
 *   your own gsap.matchMedia callbacks.
 * - One writer: stroke-dasharray and stroke-dashoffset on each shape are the recipe's. destroy() removes every trigger
 *   and tween and puts back the shapes' inline styles.
 */
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'

import { getScrollAuthority } from '../smooth/authority'
import { MOTION_CONDITIONS, ScrollTrigger, gsap, setupGsap, type MotionConditions } from './setup'

export interface DrawOnScrollOptions {
  /** Where the svg's top edge starts the drawing, as a ScrollTrigger start. Default 'top 80%'. */
  start?: string
  /** Where its bottom edge finishes it. Default 'bottom 50%'. */
  end?: string
  /** Seconds of catch-up, or true to follow the scroll exactly. Default: 0.5 under native scrolling, else true. */
  scrub?: number | true
}

export interface DrawOnScrollHandle {
  destroy(): void
}

/** Seconds of catch-up under native scrolling: the one smoothing stage there. */
const NATIVE_SCRUB = 0.5

/** What DrawSVGPlugin draws: a path or one of the basic shapes. */
type Shape = SVGPathElement | gsap.SVGPrimitive

interface Drawing {
  svg: SVGSVGElement
  shapes: Shape[]
  /** Draws to progress `p` of the pass; `now` skips the catch-up. Null while no full-motion build runs. */
  apply: ((p: number, now?: boolean) => void) | null
}

export function drawOnScroll(root: ParentNode, options: DrawOnScrollOptions = {}): DrawOnScrollHandle {
  setupGsap({ plugins: [DrawSVGPlugin] })
  const drawings = new Map<SVGSVGElement, Drawing>()
  for (const shape of Array.from(root.querySelectorAll<Shape>('[data-draw]'))) {
    const svg = shape.ownerSVGElement
    if (!svg) continue
    const drawing = drawings.get(svg) ?? { svg, shapes: [], apply: null }
    drawing.shapes.push(shape)
    drawings.set(svg, drawing)
  }
  const list = Array.from(drawings.values())
  // GSAP reverts inline styles by emptying them, which leaves an empty style attribute: dropped where there was none.
  const unstyled = list.flatMap((drawing) => drawing.shapes).filter((shape) => !shape.hasAttribute('style'))

  // One trigger per svg, for the handle's life (see the header). A trigger refreshes as it is created.
  const triggers = list.map((drawing) =>
    ScrollTrigger.create({
      trigger: drawing.svg,
      start: options.start ?? 'top 80%',
      end: options.end ?? 'bottom 50%',
      onUpdate: (self) => drawing.apply?.(self.progress),
      onRefresh: (self) => drawing.apply?.(self.progress, true),
    }),
  )

  const mm = gsap.matchMedia()
  mm.add(MOTION_CONDITIONS, (context) => {
    if ((context.conditions as MotionConditions).reduce) return
    const scrub = options.scrub ?? (getScrollAuthority() === 'native' ? NATIVE_SCRUB : true)
    const followers: gsap.QuickToFunc[] = []
    list.forEach((drawing, i) => {
      // One pen: each shape takes a share of the timeline as long as its stroke. Every fromTo renders its start at
      // once, so a shape whose turn hasn't come is undrawn, not left fully drawn.
      const timeline = gsap.timeline({ paused: true })
      for (const shape of drawing.shapes) {
        const length = Math.max(1, DrawSVGPlugin.getLength(shape))
        timeline.fromTo(shape, { drawSVG: '0%' }, { drawSVG: '100%', duration: length, ease: 'none' })
      }
      // The catch-up a numeric `scrub` gives, on a plain value that drives the timeline. A tween on the timeline itself
      // could revert after it and draw the strokes again.
      const progress = { p: triggers[i].progress }
      const follow =
        scrub === true
          ? null
          : unrecorded(context, () =>
              gsap.quickTo(progress, 'p', {
                duration: scrub,
                ease: 'expo',
                onUpdate: () => timeline.totalProgress(progress.p),
              }),
            )
      if (follow) followers.push(follow)
      drawing.apply = (p, now = false) => {
        if (!follow) timeline.totalProgress(p)
        else if (now) follow(p, p)
        else follow(p)
      }
      drawing.apply(triggers[i].progress, true)
    })
    // Printed fully drawn, then back where the scroll is.
    const print = () => list.forEach((drawing) => drawing.apply?.(1, true))
    const unprint = () => list.forEach((drawing, i) => drawing.apply?.(triggers[i].progress, true))
    window.addEventListener('beforeprint', print)
    window.addEventListener('afterprint', unprint)
    // The strokes' tweens revert with the build, which puts the shapes' inline styles back: fully drawn.
    return () => {
      window.removeEventListener('beforeprint', print)
      window.removeEventListener('afterprint', unprint)
      followers.forEach((follow) => follow.tween.kill())
      list.forEach((drawing) => (drawing.apply = null))
      for (const shape of unstyled) if (shape.getAttribute('style') === '') shape.removeAttribute('style')
    }
  })

  return {
    destroy() {
      mm.revert()
      triggers.forEach((trigger) => trigger.kill())
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
