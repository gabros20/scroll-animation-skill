// stepped.html: gsap/stepped-sections.ts on native scrolling. The recipe reaches Observer through ScrollTrigger.
import { expose } from './harness'
import { setupGsap } from '../../../../skills/scroll-animation/assets/gsap/setup'
import {
  steppedSections,
  type SteppedSectionsHandle,
} from '../../../../skills/scroll-animation/assets/gsap/stepped-sections'
import { gsapCensus } from './census'

setupGsap()

const deck = document.getElementById('deck')!
document.addEventListener('click', (event) => {
  if ((event.target as Element).closest('a')) event.preventDefault()
})
const top = (el: Element) => Math.round(el.getBoundingClientRect().top + window.scrollY)

expose<SteppedSectionsHandle>({
  create: () => steppedSections(deck, { duration: 0.5 }),
  destroy: (handle) => handle.destroy(),
  census: gsapCensus,
  extras: {
    y: () => Math.round(window.scrollY),
    max: () => document.documentElement.scrollHeight - window.innerHeight,
    view: () => window.innerHeight,
    /** Each section's top, document px. */
    tops: () => Array.from(deck.querySelectorAll('[data-step]'), top),
    /** Where an element sits in the viewport. */
    rect(id: string) {
      const box = document.getElementById(id)!.getBoundingClientRect()
      return { top: Math.round(box.top), bottom: Math.round(box.bottom) }
    },
    focused: () => document.activeElement?.id || document.activeElement?.tagName || null,
  },
})
