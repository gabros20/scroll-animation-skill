// A GSAP page driving its own timeline from the core's onStep: the usage snippet the reference shows, as written there.
// The core mounts once, outside gsap.matchMedia (its own query switches the layout); the timeline is built inside it,
// per breakpoint and reduced-motion setting, and seeks to the step the core is on. A step's first report on every mount
// (previous null) seeks; later ones tween, except under reduced motion. window.__gsap exposes the timeline.
import { gsap } from 'gsap'

import { DESKTOP_QUERY, REDUCED_MOTION_QUERY } from '../../../../skills/scroll-animation/assets/config'
import { setupGsap } from '../../../../skills/scroll-animation/assets/gsap/setup'
import { mountScrollySteps } from '../../../../skills/scroll-animation/assets/scrolly-steps'

declare global {
  interface Window {
    __gsap: { tl: gsap.core.Timeline | null; seeks: string[]; tweens: string[] }
  }
}

setupGsap()
const section = document.querySelector<HTMLElement>('[data-scrolly]')!
const dot = document.querySelector<HTMLElement>('#state-0 .art')!
window.__gsap = { tl: null, seeks: [], tweens: [] }

// ── the snippet ──
let go: ((label: string, seek: boolean) => void) | null = null
const scrolly = mountScrollySteps(section, { onStep: ({ index, previous }) => go?.(`s${index}`, previous === null) })
const mm = gsap.matchMedia()
mm.add({ desktop: DESKTOP_QUERY, reduce: REDUCED_MOTION_QUERY }, (context) => {
  const { desktop, reduce } = context.conditions!
  if (!desktop) return
  const tl = gsap.timeline({ paused: true }).addLabel('s0')
  for (let i = 1; i <= 5; i++) tl.to(dot, { x: i * 20, duration: 1, ease: 'none' }).addLabel(`s${i}`)
  tl.seek(`s${scrolly.active}`)
  context.add('go', (label: string, seek: boolean) => (seek || reduce ? tl.seek(label) : tl.tweenTo(label, { duration: 0.6 })))
  go = (label, seek) => {
    window.__gsap[seek || reduce ? 'seeks' : 'tweens'].push(label)
    context.go(label, seek)
  }
  window.__gsap.tl = tl
  return () => {
    go = null
    window.__gsap.tl = null
  }
})

// The harness's controls, for the checks.
Object.assign(window, {
  __fx: {
    scrollTo: (y: number, immediate = true) => window.scrollTo({ top: y, behavior: immediate ? 'instant' : 'smooth' }),
  },
})
