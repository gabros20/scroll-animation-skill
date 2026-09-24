import gsap from 'gsap'

import { MOTION, registerEases } from './eases'

/**
 * `[data-stage-veil]` — the opaque cover that holds the first beat of a page
 * load, so a `data-stage="mount"` entrance is never seen half-played on a
 * main thread that is still busy. Port of `StageVeil`.
 *
 * SELF-DRIVING, same as the React port: it does not wait to be told a stage
 * fired, it starts dissolving the instant `initFluidMotion` runs. It has to
 * out-rank a `position: fixed` header, and `z-index` only competes inside
 * the nearest stacking context — mount it as a direct child of `<body>`
 * (or as high as the layout allows) so nothing traps it underneath a
 * `position: sticky`/`fixed` ancestor that creates its own stacking context.
 *
 * ## The `<noscript>` rule is not optional
 *
 * This element is server-rendered (or static-HTML-authored) OPAQUE over the
 * whole viewport — `animation.gsap.css` gives it `opacity: 1`. Without this module
 * running there is nothing to fade it, so a no-JS visitor sees a permanently
 * blank page. Every page using this module must ship, verbatim, in the
 * document `<head>` or immediately after the veil element:
 *
 * ```html
 * <noscript><style>[data-stage-veil]{display:none}</style></noscript>
 * ```
 */
export interface VeilController {
  destroy(): void
}

export function initVeil(root: ParentNode = document): VeilController {
  registerEases()
  const veils = Array.from(root.querySelectorAll<HTMLElement>('[data-stage-veil]'))
  const tweens: gsap.core.Tween[] = []

  for (const el of veils) {
    tweens.push(
      gsap.to(el, {
        opacity: 0,
        duration: MOTION.veil.duration,
        delay: MOTION.veil.delay,
        ease: MOTION.veil.ease,
        onComplete: () => {
          // Drops it out of the compositing tree once faded, so a
          // full-viewport layer isn't left behind for the rest of the visit.
          el.style.visibility = 'hidden'
        }
      })
    )
  }

  return {
    destroy() {
      tweens.forEach((t) => t.kill())
    }
  }
}
