/**
 * pages/clock-steps.ts — `/guide/`'s scrollytelling section: scrolly-steps.ts (the agnostic core) picks the step at
 * the middle of the viewport, css/scrolly.css keeps the panel sticky beside the steps, and guide.css colours the
 * active clock from data-scrolly-active, at once and in every mode. GSAP adds the one movement: a paused timeline with
 * a label per step slides the marker to the active clock (task 53's snippet).
 *
 * - The core is mounted outside gsap.matchMedia: its own query switches the layout, and a rebuild must not leave it
 *   sticky. The timeline is built per matchMedia build, on desktop with no reduced motion only. Phones read the steps
 *   stacked with no panel to drive, and under reduced motion the marker isn't drawn (guide.css): the colour says
 *   which clock, and nothing moves or carries a transform.
 * - The core's first report on every mount (previous null: a load, a reload mid-page, a #fragment) seeks; a real
 *   step change tweens on MOTION.route.
 * - mount() calls it inside the route's gsap.context, which records the matchMedia; destroy() stops the core and
 *   reverts the timeline's inline styles.
 */
import { DESKTOP_QUERY, MOTION, REDUCED_MOTION_QUERY } from '../animation/config'
import { EASES, gsap } from '../animation/gsap/setup'
import { mountScrollySteps } from '../animation/scrolly-steps'

export function clockSteps(section: HTMLElement): { destroy(): void } {
  const marker = section.querySelector<HTMLElement>('.clock-panel__marker')!
  const clocks = section.querySelectorAll('[data-clock]').length
  let go: ((label: string, seek: boolean) => void) | null = null
  const scrolly = mountScrollySteps(section, {
    onStep: ({ index, previous }) => go?.(`s${index}`, previous === null),
  })

  const mm = gsap.matchMedia()
  mm.add({ desktop: DESKTOP_QUERY, reduce: REDUCED_MOTION_QUERY }, (context) => {
    const { desktop, reduce } = context.conditions!
    if (!desktop || reduce) return
    // One clock per row, the marker a row tall: label s<i> has it on row i.
    const tl = gsap.timeline({ paused: true }).addLabel('s0')
    for (let i = 1; i < clocks; i++) {
      tl.to(marker, { yPercent: i * 100, duration: MOTION.route.duration, ease: EASES[MOTION.route.curve] }).addLabel(`s${i}`)
    }
    tl.seek(`s${scrolly.active}`)
    context.add('go', (label: string, seek: boolean) =>
      seek ? tl.seek(label) : tl.tweenTo(label, { duration: MOTION.route.duration, ease: 'none' }),
    )
    go = context.go
    return () => {
      go = null
    }
  })

  return {
    destroy() {
      scrolly.destroy()
      mm.revert()
    },
  }
}
