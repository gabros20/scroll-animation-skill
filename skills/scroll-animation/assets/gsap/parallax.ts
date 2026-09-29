/**
 * gsap/parallax.ts — a recipe: elements that drift against the scroll on GSAP pages. `parallax(root, options)` → a
 * handle. One file to adapt in place.
 *
 *   <figure data-parallax data-parallax-speed="0.15">…</figure>      −0.2 … 0.2: a fraction of its pass (below)
 *
 *   const layers = parallax(routeRoot)       layers.refresh()   layers.destroy()
 *
 * - When: a route that already runs GSAP and needs the drift where CSS scroll timelines don't run: Firefox (no view()
 *   yet), under ScrollSmoother (view() never progresses there; its own `data-speed` is the other choice) and under
 *   Lenis in Safari, which draws a CSS timeline a frame behind the page. Otherwise `data-scroll-fx="parallax"`
 *   (css/scroll-effects.css) is cheaper: no JavaScript, and the compositor runs it. Never both on one element, and
 *   never on an element something else moves (a reveal, a pin, a scene): put it on a wrapper or on the media inside.
 * - The speed is a fraction of the element's pass: the scroll from its top meeting the viewport's bottom edge to its
 *   bottom leaving the top edge (the viewport's height plus its own). It drifts speed × pass over it, centred, so it
 *   sits at its layout position when it is centred in the viewport and moves at (1 − speed) × the page's speed.
 *   Positive lags behind the page and reads as further away; negative runs ahead. Keep it within ±0.2: large depth
 *   differences are a vestibular trigger (references/accessibility.md §7). data-parallax-speed wins over `speed`.
 * - The drift is written by hand as the `translate` property, in percent of the element's own height (GSAP's yPercent),
 *   from a pass re-measured at every ScrollTrigger refresh with the drift taken off, so the drift never shifts its own
 *   trigger. `translate` composes with the element's own `transform`, which keeps applying.
 * - Scrubbed and smoothed once: 0.5 s of catch-up under native scrolling (what `scrub: 0.5` gives, on the expo ease
 *   ScrollTrigger's scrub uses, through gsap.quickTo on the progress), none under Lenis or ScrollSmoother, which
 *   already smooth. It reads the page's authority as it builds (getScrollAuthority(): the stamp, or a site's own
 *   Lenis), so create it after the route's scroll authority. An element in view at load starts part-way through its pass, already drifted. It prints at its layout
 *   position.
 * - Reduced motion (live, gsap.matchMedia(MOTION_CONDITIONS)): no drift; every element sits at its layout position
 *   with nothing inline. The triggers live outside that build: GSAP 3.15 throws the reader to the top when a
 *   ScrollTrigger is created or killed during a matchMedia rebuild. For the same reason, call parallax() outside your
 *   own gsap.matchMedia callbacks.
 * - One writer: `translate` on each [data-parallax] element is the recipe's while it runs; its own inline translate
 *   comes back when it stops. destroy() removes every trigger and tween and leaves the element as the page wrote it.
 * - React: inside useGSAP(() => { const p = parallax(ref.current!); return () => p.destroy() }). On Motion routes, use
 *   motion/Parallax.tsx, which takes the same speed.
 */
import { getScrollAuthority } from '../smooth/authority'
import { MOTION_CONDITIONS, ScrollTrigger, gsap, setupGsap, type MotionConditions } from './setup'

export interface ParallaxOptions {
  /** For elements without data-parallax-speed. Default 0.1. */
  speed?: number
  /** Seconds of catch-up, or true to follow the scroll exactly. Default: 0.5 under native scrolling, else true. */
  scrub?: number | true
}

export interface ParallaxHandle {
  /** Re-reads every speed and re-measures: call it after changing data-parallax-speed. */
  refresh(): void
  /** Removes every trigger and tween; the elements are back at their layout positions. */
  destroy(): void
}

/** Seconds of catch-up under native scrolling: the one smoothing stage there. */
const NATIVE_SCRUB = 0.5

interface Layer {
  el: HTMLElement
  /** The inline translate the page wrote itself, put back whenever the recipe lets go. */
  authored: string
  /** Moves the element to progress `p` of its pass; `now` skips the catch-up. Null while no full-motion build runs. */
  apply: ((p: number, now?: boolean) => void) | null
}

export function parallax(root: ParentNode, options: ParallaxOptions = {}): ParallaxHandle {
  setupGsap()
  const speedOf = (el: HTMLElement) => {
    const speed = Number.parseFloat(el.getAttribute('data-parallax-speed') ?? '')
    return Number.isFinite(speed) ? speed : (options.speed ?? 0.1)
  }

  const layers: Layer[] = Array.from(root.querySelectorAll<HTMLElement>('[data-parallax]'), (el) => ({
    el,
    authored: el.style.translate,
    apply: null,
  }))
  // The triggers live outside the build, for the handle's life (see the header). A trigger refreshes as it is created.
  const triggers = layers.map((layer) =>
    ScrollTrigger.create({
      trigger: layer.el,
      start: 'top bottom',
      end: 'bottom top',
      onUpdate: (self) => layer.apply?.(self.progress),
      onRefresh: (self) => layer.apply?.(self.progress, true),
    }),
  )
  // Measured with the drift taken off: 'refreshInit' comes before ScrollTrigger recalculates any start or end, and each
  // trigger's onRefresh writes the drift again once it has.
  const lift = () => {
    for (const layer of layers) if (layer.apply) put(layer.el, layer.authored)
  }
  ScrollTrigger.addEventListener('refreshInit', lift)

  const mm = gsap.matchMedia()
  mm.add(MOTION_CONDITIONS, (context) => {
    if ((context.conditions as MotionConditions).reduce) return
    const scrub = options.scrub ?? (getScrollAuthority() === 'native' ? NATIVE_SCRUB : true)
    const followers: gsap.QuickToFunc[] = []
    layers.forEach((layer, i) => {
      const { el } = layer
      const trigger = triggers[i]
      /** The one writer: the drift at progress `p`, speed × pass × (p − ½), in percent of the element's height. */
      const write = (p: number) => {
        const height = el.offsetHeight
        const drift = height ? ((speedOf(el) * (trigger.end - trigger.start) * (p - 0.5)) / height) * 100 : 0
        el.style.translate = `0 ${drift.toFixed(3)}%`
      }
      // The catch-up a numeric `scrub` gives, on a plain value: its tween never touches the element.
      const progress = { p: trigger.progress }
      const follow =
        scrub === true
          ? null
          : unrecorded(context, () =>
              gsap.quickTo(progress, 'p', { duration: scrub, ease: 'expo', onUpdate: () => write(progress.p) }),
            )
      if (follow) followers.push(follow)
      layer.apply = (p, now = false) => {
        if (!follow) write(p)
        else if (now) follow(p, p)
        else follow(p)
      }
      layer.apply(trigger.progress, true)
    })
    // Printed at their layout positions, then back where the scroll is.
    const print = () => layers.forEach((layer) => layer.apply?.(0.5, true))
    const unprint = () => layers.forEach((layer, i) => layer.apply?.(triggers[i].progress, true))
    window.addEventListener('beforeprint', print)
    window.addEventListener('afterprint', unprint)
    // The elements get their own translate back.
    return () => {
      window.removeEventListener('beforeprint', print)
      window.removeEventListener('afterprint', unprint)
      followers.forEach((follow) => follow.tween.kill())
      for (const layer of layers) {
        layer.apply = null
        put(layer.el, layer.authored)
      }
    }
  })

  return {
    refresh() {
      ScrollTrigger.refresh()
    },
    destroy() {
      mm.revert()
      ScrollTrigger.removeEventListener('refreshInit', lift)
      triggers.forEach((trigger) => trigger.kill())
    },
  }
}

/** The inline translate back to what the page wrote, or gone; an emptied style attribute goes with it. */
function put(el: HTMLElement, value: string) {
  if (value) el.style.translate = value
  else el.style.removeProperty('translate')
  if (el.getAttribute('style') === '') el.removeAttribute('style')
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
