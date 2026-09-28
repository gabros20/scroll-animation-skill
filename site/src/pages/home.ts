/**
 * pages/home.ts — `/`, the Expressive page. ScrollSmoother owns scrolling (smooth/smoother.ts): the content moves
 * inside #smooth-wrapper and the fixed header stays outside it. mount() (gsap/mount.ts) creates every block on the
 * route from its markup, in page order; the header's ink is page chrome, outside the route's root.
 */
import { ScrollSmoother } from 'gsap/ScrollSmoother'

import { mountCountUps } from '../animation/count-up'
import { horizontalRail } from '../animation/gsap/horizontal-rail'
import { mount } from '../animation/gsap/mount'
import { reveal } from '../animation/gsap/reveal'
import { setupGsap } from '../animation/gsap/setup'
import { splitReveal } from '../animation/gsap/split-reveal'
import { mountHeaderTheme } from '../animation/header-theme'
import { createSmoother } from '../animation/smooth/smoother'
import { clocksScene } from './clocks'
import { expose, recorded } from './debug'

setupGsap({ plugins: [ScrollSmoother] })
// The authority comes first: every ScrollTrigger made after it binds to its wrapper.
const authority = createSmoother(ScrollSmoother, { smooth: 1, effects: true })
mountHeaderTheme(document.querySelector<HTMLElement>('[data-header]')!)

const unmount = mount(
  document.querySelector('main')!,
  recorded({
    // Sticky never sticks inside #smooth-content, so ScrollTrigger pins both scenes. A rail is a scene of its own.
    '[data-scene-root]:not([data-rail])': (el) => clocksScene(el),
    '[data-rail]': (el) => horizontalRail(el, { pin: 'gsap' }),
    '[data-split-reveal]': (el) => splitReveal(el),
    '[data-reveal]': (el) => reveal(el),
    '[data-count-ups]': (el) => mountCountUps(el),
  }),
)
expose(authority, unmount)
