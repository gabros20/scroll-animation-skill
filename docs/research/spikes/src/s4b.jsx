// S4b — Motion: can Motion's frame loop drive Lenis so useScroll lands in the same frame?
//
// ?mode=frame-update    frame.update(({ timestamp }) => lenis.raf(timestamp), true)   (the recipe under test)
//       autoraf         Lenis on its own rAF (autoRaf: true)
//       frame-setup     frame.setup(...) drives Lenis, and a synthetic window 'scroll' event is
//                       dispatched on each Lenis scroll so Motion measures in the SAME batch
//       native          no Lenis (baseline)
//
// Both values are written by hand (the non-accelerated path) to custom
// properties, and the end-of-frame recorder reads back what was written, i.e.
// what this frame paints.
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import { frame } from 'motion'
import { useMotionValueEvent, useScroll, useSpring } from 'motion/react'
import { useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { createRecorder, scrollTop } from './lib/rec.js'

const mode = new URLSearchParams(location.search).get('mode') ?? 'frame-update'

let lenis = null
if (mode === 'autoraf') {
  lenis = new Lenis({ autoRaf: true })
} else if (mode === 'frame-update') {
  lenis = new Lenis({ autoRaf: false })
  frame.update(({ timestamp }) => lenis.raf(timestamp), true)
} else if (mode === 'frame-setup') {
  lenis = new Lenis({ autoRaf: false })
  frame.setup(({ timestamp }) => lenis.raf(timestamp), true)
  // Motion's useScroll only measures on a window 'scroll' event, which the
  // browser dispatches a frame after Lenis's scrollTo. Dispatching one now,
  // from the setup step, queues Motion's read into this same batch.
  let dispatching = false
  lenis.on('scroll', () => {
    if (dispatching) return
    dispatching = true
    window.dispatchEvent(new Event('scroll'))
    dispatching = false
  })
}

function Probe() {
  const { scrollY } = useScroll()
  // Motion's scroll progress-bar recipe
  const spring = useSpring(scrollY, { stiffness: 100, damping: 30, restDelta: 0.001 })
  const raw = useRef(null)
  const sp = useRef(null)
  useMotionValueEvent(scrollY, 'change', (v) => raw.current?.style.setProperty('--v', String(v)))
  useMotionValueEvent(spring, 'change', (v) => sp.current?.style.setProperty('--v', String(v)))
  return (
    <>
      <div id="raw" ref={raw} />
      <div id="spring" ref={sp} />
      <div style={{ height: 6000, background: 'linear-gradient(#fff, #ccf)' }} />
    </>
  )
}

const css = document.createElement('style')
css.textContent = 'html, body { margin: 0; } html { scroll-behavior: auto; }'
document.head.appendChild(css)
createRoot(document.getElementById('root')).render(<Probe />)

const read = (id) => {
  const v = document.getElementById(id)?.style.getPropertyValue('--v')
  return v ? parseFloat(v) : null
}
const rec = createRecorder((t) => ({ t, y: scrollTop(), ly: lenis ? lenis.animatedScroll : null, raw: read('raw'), spring: read('spring') }))
window.__s4b = { mode, rec, lenis }
