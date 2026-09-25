// S4c — R3F: which scroll value does the render use, relative to the DOM's?
//
// A DOM box and an R3F plane placed from the box's cached rect + current
// scroll (the scroll-rig pattern). Lenis is driven by gsap.ticker in every
// mode, so only the canvas frameloop changes:
//
// ?mode=advance        <Canvas frameloop="never">, advance() from gsap.ticker right after Lenis
//       demand         <Canvas frameloop="demand">, invalidate() on Lenis scroll
//       always         <Canvas frameloop="always"> (R3F's own rAF loop), reference
//       demand-autoraf frameloop="demand", Lenis on its own rAF (autoRaf: true), invalidate() on scroll
//
// The plane records, at render time, the scroll value it used; the
// end-of-frame recorder compares it with the DOM's scrollTop for that frame.
import { advance, Canvas, invalidate, useFrame, useThree } from '@react-three/fiber'
import gsap from 'gsap'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import { useLayoutEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { createRecorder, frameKey, scrollTop } from './lib/rec.js'

const mode = new URLSearchParams(location.search).get('mode') ?? 'advance'
const BOX = { top: 1400, height: 200 }

let lenis
if (mode === 'demand-autoraf') {
  lenis = new Lenis({ autoRaf: true })
} else {
  lenis = new Lenis({ autoRaf: false })
  gsap.ticker.add((time) => lenis.raf(time * 1000))
  gsap.ticker.lagSmoothing(0)
}
if (mode === 'advance') gsap.ticker.add((time) => advance(time * 1000))
if (mode === 'demand' || mode === 'demand-autoraf') lenis.on('scroll', () => invalidate())

const renders = { n: 0, last: null }

function Plane() {
  const mesh = useRef(null)
  const rect = useRef({ top: 0, height: 0 })
  const { size } = useThree()
  useLayoutEffect(() => {
    const el = document.getElementById('box')
    const measure = () => {
      const r = el.getBoundingClientRect()
      rect.current = { top: r.top + scrollTop(), height: r.height }
    }
    measure()
    addEventListener('resize', measure)
    return () => removeEventListener('resize', measure)
  }, [])
  useFrame(() => {
    const used = scrollTop()
    // pixel space camera: y up, origin at the viewport centre
    const screenTop = rect.current.top - used
    mesh.current.position.y = size.height / 2 - (screenTop + rect.current.height / 2)
    renders.n++
    renders.last = { t: frameKey(), used, lenis: lenis.animatedScroll, n: renders.n }
  })
  return (
    <mesh ref={mesh} scale={[200, 200, 1]}>
      <planeGeometry />
      <meshBasicMaterial color="red" />
    </mesh>
  )
}

function App() {
  const frameloop = mode === 'advance' ? 'never' : mode === 'always' ? 'always' : 'demand'
  return (
    <>
      <div style={{ height: BOX.top }} />
      <div id="box" style={{ height: BOX.height, width: 200, marginLeft: 20, background: 'rgba(0,0,255,.3)' }} />
      <div style={{ height: 4000 }} />
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}>
        <Canvas
          frameloop={frameloop}
          orthographic
          camera={{ position: [0, 0, 100], zoom: 1 }}
          gl={{ antialias: false }}
          onCreated={() => (window.__s4c.ready = true)}
        >
          <Plane />
        </Canvas>
      </div>
    </>
  )
}

const css = document.createElement('style')
css.textContent = 'html, body { margin: 0; } html { scroll-behavior: auto; }'
document.head.appendChild(css)
window.__s4c = { mode, renders, lenis, ready: false }
createRoot(document.getElementById('root')).render(<App />)

window.__s4c.rec = createRecorder((t) => ({
  t,
  y: scrollTop(),
  ly: lenis.animatedScroll,
  rt: renders.last?.t ?? null,
  used: renders.last?.used ?? null,
  rn: renders.n
}))
window.__s4c.webgl = () => {
  const c = document.querySelector('canvas')
  const gl = c?.getContext('webgl2') || c?.getContext('webgl')
  const dbg = gl?.getExtension('WEBGL_debug_renderer_info')
  return gl ? { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) } : null
}
