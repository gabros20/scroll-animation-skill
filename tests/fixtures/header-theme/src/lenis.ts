// Lenis on its own requestAnimationFrame driver (the page has no animation engine): it smooths the real scroll position.
import { createSmoothScroll, rafDriver } from '../../../../skills/scroll-animation/assets/smooth/lenis'
import { start } from './harness'

createSmoothScroll({ driver: rafDriver() })
start()
