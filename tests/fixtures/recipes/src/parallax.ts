// parallax.html: gsap/parallax.ts on native scrolling, or under Lenis on GSAP's ticker with ?lenis.
import { expose } from './harness'
import { ScrollTrigger, gsap, setupGsap } from '../../../../skills/scroll-animation/assets/gsap/setup'
import { parallax, type ParallaxHandle } from '../../../../skills/scroll-animation/assets/gsap/parallax'
import { createSmoothScroll, gsapDriver } from '../../../../skills/scroll-animation/assets/smooth/lenis'
import { gsapCensus } from './census'
import { parallaxProbe, toScroll } from './parallax-probe'

setupGsap()
if (new URLSearchParams(location.search).has('lenis')) createSmoothScroll({ driver: gsapDriver(gsap, ScrollTrigger) })

const main = document.querySelector('main')!
expose<ParallaxHandle>({
  create: () => parallax(main),
  destroy: (handle) => handle.destroy(),
  census: gsapCensus,
  extras: { ...parallaxProbe([0.2, -0.15]), toScroll },
})
