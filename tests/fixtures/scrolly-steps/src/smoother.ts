// ScrollSmoother: the content moves by transform while window.scrollY runs ahead of it, and sticky never sticks inside
// #smooth-content, so the graphic is pinned with ScrollTrigger (no pin spacing: the section keeps its height; GSAP's pin
// spacer takes the graphic's grid placement). The header stays outside the wrapper, where position: fixed still works.
import { ScrollSmoother } from 'gsap/ScrollSmoother'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

import { setupGsap } from '../../../../skills/scroll-animation/assets/gsap/setup'
import { createSmoother } from '../../../../skills/scroll-animation/assets/smooth/smoother'
import { start } from './harness'

setupGsap({ plugins: [ScrollSmoother] })
createSmoother(ScrollSmoother, { smooth: 1 })
start()
const root = document.querySelector<HTMLElement>('[data-scrolly]')!
ScrollTrigger.create({
  trigger: root.querySelector('[data-scrolly-graphic]'),
  pin: true,
  pinSpacing: false,
  start: 'top top+=64',
  endTrigger: root,
  end: 'bottom bottom',
})
