/**
 * pages/guide.ts — `/guide/`, the Reading page. Native scrolling, stamped by smooth/authority.ts's nativeHandle. mount()
 * creates the entrances, the one split heading and the five clocks' scrollytelling section in page order; the header's
 * ink is page chrome. The reading-progress bar and the parallax figure are css/scroll-effects.css on CSS timelines,
 * and need no script at all. Navigations to and from / are cross-document view transitions (pages/transitions.ts).
 */
import { mount } from '../animation/gsap/mount'
import { reveal } from '../animation/gsap/reveal'
import { splitReveal } from '../animation/gsap/split-reveal'
import { mountHeaderTheme } from '../animation/header-theme'
import { nativeHandle } from '../animation/smooth/authority'
import { clockSteps } from './clock-steps'
import { expose, recorded } from './debug'

const authority = nativeHandle()
mountHeaderTheme(document.querySelector<HTMLElement>('[data-header]')!)

const unmount = mount(
  document.querySelector('main')!,
  recorded({
    '[data-split-reveal]': (el) => splitReveal(el),
    '[data-reveal]': (el) => reveal(el),
    '[data-scrolly]': (el) => clockSteps(el),
  }),
)
expose(authority, unmount)
