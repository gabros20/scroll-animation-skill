// Lenis on its own requestAnimationFrame driver, through the block's createSmoothScroll (so currentSmoothScroll() is
// its handle). The driver also exposes the Lenis instance as window.__lenis for the checks.
import type Lenis from 'lenis'

import { createSmoothScroll, rafDriver } from '../../../../skills/scroll-animation/assets/smooth/lenis'
import { start } from './harness'

createSmoothScroll({
  driver: (lenis: Lenis) => {
    ;(window as unknown as { __lenis: Lenis }).__lenis = lenis
    return rafDriver()(lenis)
  },
})
start()
