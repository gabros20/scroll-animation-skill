// S1 — do CSS view()/scroll(root) timelines track Lenis-smoothed scroll?
//
// ?mode=native|lenis   ?read=all|timing|style (what the end-of-frame sampler reads)
//
// Lane 1 (x 20..480): view() subjects. Red boxes animate `transform`
// (compositor-eligible), green boxes animate `left` (main thread).
// Lane 2 (x 520..980): position:fixed scroll(root) boxes. Blue animates
// `transform`, yellow animates `left`.
// Every box travels 400px over its timeline, so painted x is a direct progress
// readout for the screencast pass. The scroll(root) boxes run ROOT_ITERS
// iterations over the page so one painted px is ~1 scroll px (one iteration
// over the whole page would make one px ~8 scroll px, too coarse to see a
// one-frame lag).
// Controls (magenta in lane 1, cyan in lane 2) are positioned by JS in the same
// callback that moves the scroll, so they are in sync by construction: if the
// screencast shows them late, the screencast is not a faithful readout.
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import { createRecorder, scrollTop, txOf } from './lib/rec.js'

const q = new URLSearchParams(location.search)
const mode = q.get('mode') ?? 'native'
const read = q.get('read') ?? 'all'

const DOC_H = 4400
const ROOT_ITERS = 8
const RED = [
  [900, 60],
  [1500, 70],
  [2100, 80],
  [2700, 90],
  [3300, 100]
]
const MAGENTA = [
  [1050, 62],
  [1650, 72],
  [2250, 82],
  [2850, 92],
  [3450, 102]
]
const GREEN = [
  [1200, 65],
  [1800, 75],
  [2400, 85],
  [3000, 95],
  [3600, 105]
]

const css = document.createElement('style')
css.textContent = `
  html, body { margin: 0; background: #fff; }
  html { scroll-behavior: auto; }
  body { position: relative; }
  .spacer { height: ${DOC_H}px; }
  @keyframes tx { from { transform: translateX(0) } to { transform: translateX(400px) } }
  @keyframes lx { from { left: 20px } to { left: 420px } }
  @keyframes lx2 { from { left: 520px } to { left: 920px } }
  .box { position: absolute; width: 60px; }
  .red { left: 20px; background: rgb(255,0,0); animation: tx auto linear both; animation-timeline: view(); }
  .green { left: 20px; background: rgb(0,200,0); animation: lx auto linear both; animation-timeline: view(); }
  .blue { position: fixed; top: 100px; left: 520px; width: 60px; height: 40px; background: rgb(0,0,255);
          animation: tx auto linear ${ROOT_ITERS} both; animation-timeline: scroll(root); }
  .magenta { left: 20px; background: rgb(255,0,255); }
  .cyan { position: fixed; top: 300px; left: 520px; width: 60px; height: 40px; background: rgb(0,255,255); }
  .yellow { position: fixed; top: 200px; left: 520px; width: 60px; height: 40px; background: rgb(255,220,0);
          animation: lx2 auto linear ${ROOT_ITERS} both; animation-timeline: scroll(root); }
`
document.head.appendChild(css)

const mk = (cls, [top, h]) => {
  const el = document.createElement('div')
  el.className = `box ${cls}`
  el.style.top = `${top}px`
  el.style.height = `${h}px`
  document.body.appendChild(el)
  return el
}
const spacer = document.createElement('div')
spacer.className = 'spacer'
document.body.appendChild(spacer)
const reds = RED.map((b) => mk('red', b))
const greens = GREEN.map((b) => mk('green', b))
const magentas = MAGENTA.map((b) => mk('magenta', b))
const cyan = document.createElement('div')
cyan.className = 'cyan'
document.body.append(cyan)
const blue = document.createElement('div')
blue.className = 'blue'
const yellow = document.createElement('div')
yellow.className = 'yellow'
document.body.append(blue, yellow)

// The controls' geometry is the CSS timelines' geometry, computed in JS from
// the scroll offset of this frame.
let vh = 0
let maxScroll = 1
const measure = () => {
  vh = document.documentElement.clientHeight
  maxScroll = document.scrollingElement.scrollHeight - vh
}
const writeControls = () => {
  const y = scrollTop()
  magentas.forEach((el, k) => {
    const [top, h] = MAGENTA[k]
    const p = Math.min(1, Math.max(0, (y + vh - top) / (vh + h)))
    el.style.transform = `translateX(${p * 400}px)`
  })
  const total = ROOT_ITERS * Math.min(1, Math.max(0, y / maxScroll))
  const frac = total >= ROOT_ITERS ? 1 : total - Math.floor(total)
  cyan.style.transform = `translateX(${frac * 400}px)`
}
measure()
addEventListener('resize', measure)

let lenis = null
if (mode === 'lenis') {
  lenis = new Lenis({ autoRaf: false })
  const raf = (t) => {
    lenis.raf(t)
    writeControls()
    requestAnimationFrame(raf)
  }
  requestAnimationFrame(raf)
} else {
  const raf = () => {
    writeControls()
    requestAnimationFrame(raf)
  }
  requestAnimationFrame(raf)
}

const prog = (el) => el.getAnimations()[0]?.effect.getComputedTiming().progress ?? null
// unwrapped: completed iterations + progress in the current one
const total = (el) => {
  const t = el.getAnimations()[0]?.effect.getComputedTiming()
  return t ? t.currentIteration + t.progress : null
}
const leftOf = (el) => parseFloat(getComputedStyle(el).left)
const wantTiming = read === 'all' || read === 'timing'
const wantStyle = read === 'all' || read === 'style'

const rec = createRecorder((t) => {
  const row = { t, y: scrollTop(), ph: window.__phase ?? '' }
  if (lenis) row.ly = lenis.animatedScroll
  if (wantTiming) {
    row.pr = reds.map(prog)
    row.pg = greens.map(prog)
    row.pb = total(blue)
    row.py = total(yellow)
  }
  if (wantStyle) {
    row.xr = reds.map(txOf)
    row.xg = greens.map((el) => leftOf(el) - 20)
    row.xb = txOf(blue)
    row.xy = leftOf(yellow) - 520
  }
  return row
})

window.__s1 = {
  mode,
  rec,
  lenis,
  layout: () => ({
    timeOrigin: performance.timeOrigin,
    rootIters: ROOT_ITERS,
    vh: document.documentElement.clientHeight,
    vw: document.documentElement.clientWidth,
    maxScroll: document.scrollingElement.scrollHeight - document.documentElement.clientHeight,
    red: reds.map((el) => [el.offsetTop, el.offsetHeight]),
    green: greens.map((el) => [el.offsetTop, el.offsetHeight]),
    magenta: magentas.map((el) => [el.offsetTop, el.offsetHeight]),
    timeline: {
      red: reds[0].getAnimations()[0]?.timeline?.constructor?.name ?? null,
      blue: blue.getAnimations()[0]?.timeline?.constructor?.name ?? null
    },
    frameKeyMatchesRaf: null
  })
}

// Check once that document.timeline.currentTime equals the rAF timestamp.
requestAnimationFrame((t) => {
  window.__frameKeyCheck = { raf: t, timeline: document.timeline.currentTime }
})
