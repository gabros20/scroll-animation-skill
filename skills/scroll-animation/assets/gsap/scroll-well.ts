/**
 * gsap/scroll-well.ts — a recipe (advanced): scroll-well.ts on a GSAP page. `scrollWell(target, options)` → the
 * well's handle. What it does, its tuning, its limits and why are in scroll-well.ts: read that first.
 *
 *   <section data-scroll-well>…</section>        the target: a composition meant to be seen whole
 *
 *   mount(routeRoot, { '[data-scroll-well]': (el) => scrollWell(el) })                          a vanilla page
 *   useGSAP(() => { const well = scrollWell(ref.current!); return () => well.destroy() })        React
 *
 * - It runs on GSAP's ticker, and after each write it calls ScrollTrigger.update(), so scrubbed tweens and pinned
 *   scenes read the new position in the same tick. ScrollTrigger otherwise updates on the frame after the `scroll`
 *   event a programmatic scroll fires: a frame late (spike S4a measured the same for Lenis; smooth/lenis.ts's
 *   gsapDriver makes the same call).
 * - Inside a pinned scene it clamps to the scene's [data-scene-root] by itself; `clamp: null` turns that off.
 * - Native scrolling only: under Lenis or ScrollSmoother it pulls nothing and warns (it reads
 *   <html data-scroll-authority> each time it engages).
 * - Reduced motion (live) is the core's: no pull. It creates no ScrollTrigger and no tween, so a gsap.context or
 *   gsap.matchMedia around it has nothing to revert: destroy() is the cleanup.
 * - A programmatic smooth scroll of your own needs `well.suspend()` (or suspendScrollWells() from scroll-well.ts) just
 *   before it; anchor clicks and `hashchange` suspend it by themselves.
 */
import { createScrollWell, type ScrollWellHandle, type ScrollWellOptions, type WellClock } from '../scroll-well'
import { ScrollTrigger, gsap, setupGsap } from './setup'

export type { ScrollWellHandle }
export type ScrollWellGsapOptions = Omit<ScrollWellOptions, 'clock' | 'onWrite'>

/** GSAP's ticker as the well's clock. */
const tickerClock: WellClock = (tick) => {
  const onTick = () => tick()
  gsap.ticker.add(onTick)
  return () => gsap.ticker.remove(onTick)
}

const updateTriggers = () => ScrollTrigger.update()

export function scrollWell(target: HTMLElement, options: ScrollWellGsapOptions = {}): ScrollWellHandle {
  setupGsap()
  return createScrollWell(target, { ...options, clock: tickerClock, onWrite: updateTriggers })
}
