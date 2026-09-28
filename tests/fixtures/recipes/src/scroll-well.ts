// scroll-well.html: gsap/scroll-well.ts on native scrolling (the page scrolls smoothly, html.smooth), ?core the
// engine-free core on requestAnimationFrame, and ?lenis the GSAP well under Lenis on GSAP's ticker, where it must
// pull nothing.
import { expose } from './harness'
import { ScrollTrigger, gsap, setupGsap } from '../../../../skills/scroll-animation/assets/gsap/setup'
import { scrollWell } from '../../../../skills/scroll-animation/assets/gsap/scroll-well'
import { createScrollWell, type ScrollWellHandle } from '../../../../skills/scroll-animation/assets/scroll-well'
import { createSmoothScroll, gsapDriver } from '../../../../skills/scroll-animation/assets/smooth/lenis'
import { gsapCensus } from './census'
import { wellProbe } from './scroll-well-probe'

setupGsap()
const query = new URLSearchParams(location.search)
// Lenis writes the scroll position itself: a smooth scroll-behavior would turn every write into an animation.
if (query.has('lenis')) createSmoothScroll({ driver: gsapDriver(gsap, ScrollTrigger) })
else document.documentElement.classList.add('smooth')
const make = (el: HTMLElement) => (query.has('core') ? createScrollWell(el) : scrollWell(el))

expose<ScrollWellHandle[]>({
  create: () => Array.from(document.querySelectorAll<HTMLElement>('[data-scroll-well]'), make),
  destroy: (wells) => wells.forEach((well) => well.destroy()),
  census: gsapCensus,
  extras: wellProbe(),
})
