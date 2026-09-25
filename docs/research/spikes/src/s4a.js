// S4a — GSAP: is Lenis -> ScrollTrigger -> scrubbed tween one tick?
//
// ?mode=ticker     gsap.ticker drives lenis.raf, lagSmoothing(0), lenis.on('scroll', ScrollTrigger.update)
//       autoraf    Lenis on its own rAF (autoRaf: true), no ticker hookup, no scroll hookup
//       autoraf-on Lenis on its own rAF + lenis.on('scroll', ScrollTrigger.update)
//       native     no Lenis (baseline)
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import { createRecorder, scrollTop, txOf } from './lib/rec.js'

gsap.registerPlugin(ScrollTrigger)
const mode = new URLSearchParams(location.search).get('mode') ?? 'ticker'

const css = document.createElement('style')
css.textContent = `
  html, body { margin: 0; background: #fff; }
  html { scroll-behavior: auto; }
  #track { position: relative; margin-top: 900px; height: 1800px; background: #eef; }
  #box { position: fixed; top: 100px; left: 20px; width: 80px; height: 80px; background: red; }
  .tail { height: 1500px; }
`
document.head.appendChild(css)
document.getElementById('root').innerHTML = '<div id="track"><div id="box"></div></div><div class="tail"></div>'

let lenis = null
if (mode === 'ticker') {
  lenis = new Lenis({ autoRaf: false })
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add((time) => lenis.raf(time * 1000))
  gsap.ticker.lagSmoothing(0)
} else if (mode === 'autoraf' || mode === 'autoraf-on') {
  lenis = new Lenis({ autoRaf: true })
  if (mode === 'autoraf-on') lenis.on('scroll', ScrollTrigger.update)
}

const tween = gsap.to('#box', {
  x: 400,
  ease: 'none',
  scrollTrigger: { trigger: '#track', start: 'top bottom', end: 'bottom top', scrub: true }
})
const st = tween.scrollTrigger
const box = document.getElementById('box')

const rec = createRecorder((t) => ({
  t,
  y: scrollTop(),
  ly: lenis ? lenis.animatedScroll : null,
  stP: st.progress,
  x: txOf(box),
  gx: gsap.getProperty(box, 'x')
}))

window.__s4a = { mode, rec, lenis, st, info: () => ({ start: st.start, end: st.end, vh: innerHeight }) }
