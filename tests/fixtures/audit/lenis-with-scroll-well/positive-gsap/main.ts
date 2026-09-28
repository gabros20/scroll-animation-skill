import Lenis from 'lenis'
import { mount } from './animation/gsap/mount'
import { scrollWell } from './animation/gsap/scroll-well'

new Lenis({ autoRaf: true })
mount(document.querySelector('main')!, { '[data-scroll-well]': (el) => scrollWell(el) })
