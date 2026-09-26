import { pinnedScene } from '../animation/gsap/pinned-scene'

// A ScrollSmoother page: the scene pins through ScrollTrigger itself (pin: 'gsap'), no pin: true of its own.
export function mountHero(root: HTMLElement) {
  return pinnedScene(root.querySelector('[data-scene-root]')!, { pin: 'gsap' })
}
