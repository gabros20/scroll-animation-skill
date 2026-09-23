import gsap from 'gsap'

import { EASE_NAMES, registerEases } from './eases'

/**
 * `[data-count-up="<value>"]` — a number that counts up when it first
 * reaches the viewport. Port of `CountUp`.
 *
 * TRIGGERED, like the rest of the entrance system, and deliberately its own
 * mechanism rather than a `[data-stage-item]`: a stage variant animates
 * *style*, this animates *text*.
 *
 * ## Why it writes `textContent` instead of anything reactive
 *
 * The whole point of doing this outside a framework's render loop is that a
 * frame of counting costs nothing but a string write on one node — there is
 * no state to update and no re-render to schedule.
 *
 * The static HTML must already hold the FINAL value in `data-count-up`
 * (and, ideally, as the element's own text, for crawlers and no-JS
 * visitors). This module only ever rewinds the node to "0" once the
 * animation is about to run, on the client — never before.
 */
export interface CountUpOptions {
  /** Seconds. Long enough to read as counting, short enough not to hold the eye. */
  duration?: number
  /**
   * Fraction of the element that must be visible before it starts. Defaults
   * to `0.6`, a plain fraction — which looks like the same trap `stage.ts`
   * deliberately avoids (`threshold: 0`, ANY part visible, because a
   * fractional threshold is unsatisfiable for a stage group taller than the
   * viewport). It is safe here specifically because a count-up element is a
   * single short inline number: it can never be taller than the viewport,
   * so "60% visible" can always be satisfied and the trap's actual failure
   * mode — a tall element whose fraction never resolves — cannot occur.
   * `initStages` wraps arbitrary, often tall, content and has no such
   * guarantee, which is why it uses `threshold: 0` plus a margin trigger
   * line instead. Do not copy this default onto anything that might wrap
   * something taller than a line of text.
   */
  amount?: number
}

export interface CountUpController {
  destroy(): void
}

export function initCountUps(root: ParentNode = document, options: CountUpOptions = {}): CountUpController {
  registerEases()
  const duration = options.duration ?? 1.2
  const amount = options.amount ?? 0.6
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const els = Array.from(root.querySelectorAll<HTMLElement>('[data-count-up]'))
  const observers: IntersectionObserver[] = []
  const tweens: gsap.core.Tween[] = []

  for (const el of els) {
    const value = Number.parseFloat(el.dataset.countUp ?? '')
    if (!Number.isFinite(value)) continue

    const run = () => {
      if (reduced) {
        // Reduced motion gets the figure, not the performance — withholding
        // it would be a content change, not a motion one.
        el.textContent = String(value)
        return
      }
      const counter = { n: 0 }
      el.textContent = '0'
      tweens.push(
        gsap.to(counter, {
          n: value,
          duration,
          ease: EASE_NAMES.entrance, // the same curve as the page-load move
          onUpdate: () => {
            el.textContent = String(Math.round(counter.n))
          }
        })
      )
    }

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting) return
        run()
        io.disconnect()
      },
      { threshold: amount }
    )
    io.observe(el)
    observers.push(io)
  }

  return {
    destroy() {
      observers.forEach((io) => io.disconnect())
      tweens.forEach((t) => t.kill())
    }
  }
}
