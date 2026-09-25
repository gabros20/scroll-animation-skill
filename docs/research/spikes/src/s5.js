// S5 — ScrollTrigger progress on a CSS sticky range wrapper (no pin) vs v1's
// getBoundingClientRect maths, in the same frame.
//
// ?mode=native | lenis (gsap.ticker drives Lenis, lenis.on('scroll', ScrollTrigger.update))
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import { clamp01, createRecorder, scrollTop } from './lib/rec.js'

gsap.registerPlugin(ScrollTrigger)
const mode = new URLSearchParams(location.search).get('mode') ?? 'native'

const css = document.createElement('style')
css.textContent = `
  html, body { margin: 0; background: #fff; }
  html { scroll-behavior: auto; }
  #above { height: 600px; background: #eee; }
  #wrapper { position: relative; height: 300vh; background: #eef; }
  #sticky { position: sticky; top: 0; height: 100lvh; background: #99f; }
  #tail { height: 100vh; }
`
document.head.appendChild(css)
document.getElementById('root').innerHTML =
  '<div id="above"></div><div id="wrapper"><div id="sticky"></div></div><div id="tail"></div>'

let lenis = null
if (mode === 'lenis') {
  lenis = new Lenis({ autoRaf: false })
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add((time) => lenis.raf(time * 1000))
  gsap.ticker.lagSmoothing(0)
}

const wrapper = document.getElementById('wrapper')
const st = ScrollTrigger.create({ trigger: wrapper, start: 'top top', end: 'bottom bottom' })

// v1's formula
const rectProgress = () => {
  const r = wrapper.getBoundingClientRect()
  return clamp01(-r.top / (r.height - innerHeight))
}
const refreshes = []
ScrollTrigger.addEventListener('refresh', () => refreshes.push(performance.now()))

const read = () => ({
  y: scrollTop(),
  st: st.progress,
  rect: rectProgress(),
  range: wrapper.getBoundingClientRect().height - innerHeight,
  stStart: st.start,
  stEnd: st.end
})
const rec = createRecorder((t) => ({ t, ...read() }))
window.__s5 = { mode, st, lenis, rec, read, refreshes, rectProgress, refresh: () => ScrollTrigger.refresh() }
