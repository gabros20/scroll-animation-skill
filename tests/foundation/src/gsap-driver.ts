// gsapDriver: GSAP's ticker drives Lenis, then ScrollTrigger reads the new position in the same
// frame. S4a's geometry (a scrubbed tween across a 1800px track) and its end-of-frame recorder, so
// tests/foundation.mjs can count how many frames ScrollTrigger and the tween trail scrollTop.
import '../../../skills/scroll-animation/assets/css/animation.css'
import { gsap, ScrollTrigger, setupGsap } from '../../../skills/scroll-animation/assets/gsap/setup'
import { createSmoothScroll, gsapDriver } from '../../../skills/scroll-animation/assets/smooth/lenis'
import './page.css'
import { createRecorder, scrollTop, txOf } from './rec.js'

type TickerFn = (time: number, deltaTime: number, frame: number) => void
// GSAP exposes its listener list on the ticker; the types don't.
const ticker = gsap.ticker as typeof gsap.ticker & { _listeners: TickerFn[] }

const css = document.createElement('style')
css.textContent = `
  #track { position: relative; margin-top: 900px; height: 1800px; background: #eef; }
  #box { position: fixed; top: 100px; left: 20px; width: 80px; height: 80px; background: red; }
  .tail { height: 1500px; }
`
document.head.appendChild(css)
document.getElementById('root')!.innerHTML = '<div id="track"><div id="box"></div></div><div class="tail"></div>'

setupGsap()
const listenersBefore = ticker._listeners.slice()
const handle = createSmoothScroll({ driver: gsapDriver(gsap, ScrollTrigger) })
const driverTicks = ticker._listeners.filter((fn) => !listenersBefore.includes(fn))

const tween = gsap.to('#box', {
  x: 400,
  ease: 'none',
  scrollTrigger: { trigger: '#track', start: 'top bottom', end: 'bottom top', scrub: true },
})
const st = tween.scrollTrigger!
const box = document.getElementById('box')!

const rec = createRecorder((t: number) => ({ t, y: scrollTop(), stP: st.progress, x: txOf(box) }))

/**
 * Seconds the ticker's clock advances across a main-thread stall of `ms`: about the whole stall
 * under lagSmoothing(0), GSAP's adjustedLag (33 ms) under its default lagSmoothing(500, 33).
 */
async function tickerJump(ms: number): Promise<number> {
  const nextTick = () => new Promise<void>((resolve) => gsap.ticker.add(() => resolve(), true))
  await nextTick()
  await nextTick()
  const before = gsap.ticker.time
  const end = performance.now() + ms
  while (performance.now() < end) {
    // stall the main thread, as a long task would
  }
  await nextTick()
  return gsap.ticker.time - before
}

Object.assign(window, {
  __fx: {
    rec,
    handle,
    tickerJump,
    info: () => ({ start: st.start, end: st.end }),
    listeners: () => ({
      before: listenersBefore.length,
      now: ticker._listeners.length,
      added: driverTicks.length,
      stillThere: driverTicks.filter((fn) => ticker._listeners.includes(fn)).length,
    }),
  },
})
