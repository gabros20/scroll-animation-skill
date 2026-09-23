import gsap from 'gsap'
import { fluidValue, fluidEnd } from './fluid'
// page styles: .hero { padding: calc(120 * var(--fluid)); }
gsap.to('.peel', { x: fluidValue(600), scrollTrigger: { trigger: '.hero', end: fluidEnd(1800), scrub: true, invalidateOnRefresh: true } })
gsap.to('.peel', { xPercent: 100, '--scene-p': 1 })
