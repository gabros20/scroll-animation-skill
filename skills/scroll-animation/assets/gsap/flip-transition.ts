/**
 * gsap/flip-transition.ts — a recipe: a change of view inside one route (a grid opening into a detail, a list
 * reordering, a filter) where the elements that survive the change glide from where they were to where they land,
 * with GSAP's Flip plugin (in the gsap package, free since 3.13). One file to adapt in place.
 *
 *   <ul class="work">
 *     <li data-flip-id="tide">…</li>          the same id before and after: the same element, or its re-render
 *   </ul>
 *
 *   await flipTransition(list, { change: () => list.classList.toggle('is-detail') })     resolves when it has landed
 *   const flip = flipTransition(list, { change })     flip.kill()     lands it at once (a route teardown)
 *
 * - What it does: records the box of every `[data-flip-id]` inside `root` (Flip.getState), runs `change()` (sync or
 *   async: a class, a re-render, a reorder), then animates each element from its recorded box to its new one
 *   (Flip.from). The targets are queried again after `change()`, so a framework that re-rendered new nodes with the
 *   same ids still flips; an element with no recorded box (it entered) fades in, one that left is simply gone.
 * - When, instead of a view transition (view-transitions.ts): the same element survives the change and keeps its
 *   state (a playing video, focus, a form's input); the change is inside one route; the elements sit in a scroll
 *   container (a view transition's snapshots fly above the page, unclipped by it); or the browser has no View
 *   Transitions API. A route change, or a change where old and new are different documents, is a view transition's job.
 * - Transform only: `scale: true` (the default) moves and resizes with translate and scale, on the compositor.
 *   `scale: false` animates width and height, which lays the page out every frame: only for content that must not
 *   stretch while its box changes shape (text that reflows), and say so where you set it. Under scale, content inside
 *   a box whose aspect ratio changes stretches mid-flight: flip the image and its caption as separate targets rather
 *   than one card around both, or keep the box's ratio.
 * - Never on a pinned or sticky ancestor, or inside a pinned scene: ScrollTrigger's pin swaps the element's position
 *   and wraps it in a spacer, and a sticky box moves with the scroll, so the recorded boxes are wrong by the time the
 *   flip plays. The boxes are viewport coordinates: a scroll during the 0.4 s puts a target off by the distance until
 *   it lands (GSAP's documented caveat for `absolute`).
 * - One at a time per root: a flip still running is landed (progress 1) and killed before the next records its boxes,
 *   so two never stack offsets, and its promise resolves. Flip.killFlipsOf() completes a flip on the same targets
 *   started elsewhere.
 * - Reduced motion (live, read at each call): `change()` only, nothing animates, nothing inline.
 * - Timing: MOTION.route (0.4 s on CURVES.disclosure), the route morph's, since this stands in for one.
 * - React: run it from an event handler, make the change synchronous (`change: () => flushSync(() => setOpen(true))`)
 *   so the new layout is in the DOM when Flip measures. Keep the returned flip and kill() it in the component's
 *   cleanup: useGSAP's contextSafe doesn't record it, because Flip.from runs after `change()` resolves, outside the
 *   call. Keep `data-flip-id` on the rendered elements; keys alone mean nothing to Flip.
 * - Leaves nothing: when a flip lands (or is killed), Flip clears the transforms it wrote and puts back each target's
 *   inline style, and the empty style attribute that leaves where there was none is dropped.
 */
import { Flip } from 'gsap/Flip'

import { MOTION, prefersReducedMotion } from '../config'
import { EASES, gsap, setupGsap } from './setup'

export interface FlipTransitionOptions {
  /** The change of view: a class, a reorder, a re-render. The new layout must be in the DOM when it resolves. */
  change: () => void | Promise<void>
  /** Which elements inside `root` to flip. Default '[data-flip-id]'. */
  targets?: string
  /** Translate and scale (true, default), or width and height (false: lays out every frame; see the header). */
  scale?: boolean
  /** position: absolute during the flip, for grid and flex layouts that shift as targets move (Flip's `absolute`). */
  absolute?: boolean | string
  /** A target and its descendant are both flipping: stop their offsets compounding (Flip's `nested`). */
  nested?: boolean
  /** Two different elements share an id (a thumbnail and the detail's hero): crossfade them. Needs `absolute`. */
  fade?: boolean
  /** Seconds. Default MOTION.route.duration. */
  duration?: number
  /** Default the route curve (EASES[MOTION.route.curve]). */
  ease?: string
}

export interface FlipTransition extends Promise<void> {
  /** Lands the flip at once and stops it. A flip that hasn't started yet (an async change) won't animate. */
  kill(): void
}

/** Lands the flip still running in each root, so the next one starts from where things really are. */
const running = new WeakMap<ParentNode, () => void>()

export function flipTransition(root: ParentNode, options: FlipTransitionOptions): FlipTransition {
  setupGsap({ plugins: [Flip] })
  const selector = options.targets ?? '[data-flip-id]'
  const duration = options.duration ?? MOTION.route.duration
  const ease = options.ease ?? EASES[MOTION.route.curve]
  let killed = false
  let land: (() => void) | null = null

  const run = async () => {
    const before = Array.from(root.querySelectorAll(selector))
    running.get(root)?.()
    if (before.length) Flip.killFlipsOf(before, true)
    if (prefersReducedMotion()) {
      await options.change()
      return
    }
    // Flip puts inline styles back by emptying them, and empties the body's after locking its scroll for the
    // measurement: an empty style attribute is dropped where there was none.
    const bare = (els: Element[]) => els.filter((el) => !el.hasAttribute('style'))
    const unstyled = bare([...before, document.body])
    const tidy = () => {
      for (const el of unstyled) if (el.getAttribute('style') === '') el.removeAttribute('style')
    }
    const state = Flip.getState(before)
    await options.change()
    if (killed) return
    const after = Array.from(root.querySelectorAll(selector))
    unstyled.push(...bare(after))
    await new Promise<void>((resolve) => {
      const flip = Flip.from(state, {
        targets: after,
        duration,
        ease,
        scale: options.scale ?? true,
        absolute: options.absolute ?? false,
        nested: options.nested ?? false,
        fade: options.fade ?? false,
        onEnter: (entering) =>
          gsap.fromTo(entering, { opacity: 0 }, { opacity: 1, duration, ease, clearProps: 'opacity' }),
        onComplete: resolve,
        onInterrupt: resolve,
      })
      // Landing it fires onComplete, which resolves the promise; Flip has cleaned up by the time progress() returns.
      land = () => {
        flip.progress(1).kill()
        tidy()
      }
      running.set(root, land)
    })
    if (running.get(root) === land) running.delete(root)
    // After Flip's own clean-up, which runs once the callbacks have.
    tidy()
  }

  return Object.assign(run(), {
    kill() {
      killed = true
      land?.()
    },
  })
}
