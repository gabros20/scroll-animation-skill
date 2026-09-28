// Lenis on GSAP's ticker, sticky pin: the rail's focus-follow scrolls through lenis.scrollTo.
import { ScrollTrigger, gsap, setupGsap } from '../../../../skills/scroll-animation/assets/gsap/setup'
import { createSmoothScroll, gsapDriver } from '../../../../skills/scroll-animation/assets/smooth/lenis'
import { mount } from './rail'

setupGsap()
createSmoothScroll({ driver: gsapDriver(gsap, ScrollTrigger) })
mount()
