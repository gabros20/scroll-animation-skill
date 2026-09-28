// What tests/recipes.mjs reads and drives on both scroll-well pages. The pages scroll smoothly (html.smooth), as the
// sites the well's anchor suspension exists for do, so every scroll here says `instant`, or goes through the page's
// authority.
import { currentSmoothScroll } from '../../../../skills/scroll-animation/assets/smooth/authority'
import { suspendScrollWells } from '../../../../skills/scroll-animation/assets/scroll-well'
import { frames } from './harness'

const el = (id: string) => document.getElementById(id)!
const round = (v: number) => Math.round(v * 10) / 10

/** Scrolls at once to document position `y`, through the page's authority. */
function toScroll(y: number) {
  const scroll = currentSmoothScroll()
  if (scroll) scroll.scrollTo(y, { immediate: true })
  else window.scrollTo({ top: y, behavior: 'instant' })
  return frames(2)
}

export function wellProbe() {
  return {
    y: () => Math.round(window.scrollY),
    view: () => window.innerHeight,
    /** An element's edges in the viewport. */
    box(id: string) {
      const r = el(id).getBoundingClientRect()
      return { top: round(r.top), bottom: round(r.bottom) }
    },
    /** Scrolls at once so the element's `edge` sits `at` px below the viewport's top edge. */
    place(id: string, at: number, edge: 'top' | 'bottom' = 'top') {
      return toScroll(window.scrollY + el(id).getBoundingClientRect()[edge] - at)
    },
    /** A smooth scroll of the page's own, `dy` px down, announced with suspendScrollWells() as a router jump would. */
    suspendedSmoothBy(dy: number) {
      suspendScrollWells()
      window.scrollTo({ top: window.scrollY + dy, behavior: 'smooth' })
    },
  }
}
