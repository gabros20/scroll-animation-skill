// Same-page anchors under Lenis: createSmoothScroll's default `anchors: true` takes a #hash click,
// scrolls through Lenis so the target clears the fixed header (--header-h), and pushes the hash.
import '../../../skills/scroll-animation/assets/css/animation.css'
import { HEADER_HEIGHT_VAR } from '../../../skills/scroll-animation/assets/config'
import { createSmoothScroll, rafDriver } from '../../../skills/scroll-animation/assets/smooth/lenis'
import './page.css'

const handle = createSmoothScroll({ driver: rafDriver() })

/** The header variable in px, resolved by layout the way a browser would size an element with it. */
function headerHeight(): number {
  const probe = document.createElement('div')
  probe.style.cssText = `position:absolute;visibility:hidden;height:var(${HEADER_HEIGHT_VAR})`
  document.body.appendChild(probe)
  const h = probe.getBoundingClientRect().height
  probe.remove()
  return h
}

Object.assign(window, { __fx: { handle, headerHeight } })
