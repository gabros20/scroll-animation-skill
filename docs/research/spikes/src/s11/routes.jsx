// S11 Q4 — routes: a canvas route (/a: our Motion PinnedScene + the 3d skill's SceneCanvas) and a plain route (/b),
// swapped by a minimal client router inside our <RouteChange> (smooth/SmoothScroll.tsx), the Phase 4 contract.
//
// ?keep=unmount|activity   unmount the route that is left, or keep it under React <Activity mode="hidden"> (what
//                          Next's Cache Components does with up to 3 routes)
//  &vt=0|1                 swap inside document.startViewTransition (old snapshot held 4 s, new one hidden)
//  &loop=demand|always|advance   SceneCanvas frameloop; advance = 'never' + advance() from gsap.ticker (bridge-owned)
//  &bridgeRefresh=0|1      the canvas route registers a bridge re-derive through onRouteRefresh
//
// The router does what S9 measured Next doing: commit the new route, then place the scroll (top, or the saved
// position on back) in a layout effect inside <RouteChange>, whose own layout effect then runs routeChanged().
import './contexts.js'
import '@sa/css/scene.css'

import { advance, useThree } from '@react-three/fiber'
import { Activity, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'

import { PinnedScene } from '@sa/motion/PinnedScene'
import { gsap } from '@sa/gsap/setup'
import { nativeHandle, registerHandle } from '@sa/smooth/authority'
import { RouteChange } from '@sa/smooth/SmoothScroll'
import { onRouteRefresh } from '@sa/smooth/route'
import { progressFromRect } from '@sa/scene'

import { bindReducedMotion, createConductor } from './vendor-3d/conductor'
import { ConductorDriver, SceneCanvas } from './vendor-3d/r3f/SceneCanvas'
import { contextStats } from './contexts.js'
import { createRecorder, frame, scrollTop } from './rec.js'

const q = new URLSearchParams(location.search)
const keep = q.get('keep') ?? 'unmount'
const vt = q.get('vt') === '1'
const loop = q.get('loop') ?? 'demand'
const bridgeRefresh = q.get('bridgeRefresh') === '1'
const ACTS = 4

const css = document.createElement('style')
css.textContent = `
html, body { margin: 0; } html { scroll-behavior: auto; }
body { font: 16px/1.4 system-ui, sans-serif; background: #f4f1ea; }
.act { height: 100vh; box-sizing: border-box; padding: 40px; }
.poster { position: absolute; inset: 0; background: #2a6f4e; }
#intro { height: 600px; } #outro { height: 1200px; background: #ddd; }
.plain { height: 3000px; padding: 40px; background: #eee; }
::view-transition-old(root) { animation: 4s linear both s11-hold; }
::view-transition-new(root) { animation: 4s linear both s11-hide; }
@keyframes s11-hold { from, to { opacity: 1 } }
@keyframes s11-hide { from, to { opacity: 0 } }
`
document.head.appendChild(css)

registerHandle(nativeHandle())

// ---- logs --------------------------------------------------------------------------------------------------
const L = {
  renders: 0,
  rendersBy: { a: 0 },
  nav: 0,
  afterNav: [],
  conductor: null,
  root: null,
  gl: null,
  frameloop: null,
  mounts: 0,
  rehydrates: []
}

function Stage({ conductor }) {
  const mesh = useRef(null)
  const gl = useThree((s) => s.gl)
  const fl = useThree((s) => s.frameloop)
  useEffect(() => void (L.gl = gl), [gl])
  useEffect(() => void (L.frameloop = fl), [fl])
  return (
    <>
      <color attach="background" args={['#203040']} />
      <mesh ref={mesh} scale={[2.2, 2.2, 2.2]}>
        <boxGeometry />
        <meshBasicMaterial color="#ff8800" />
      </mesh>
      <Suspense fallback={null}>
        <ConductorDriver
          conductor={conductor}
          onFrame={(st) => {
            if (mesh.current) mesh.current.rotation.y = st.smooth * Math.PI * 2
            L.renders++
            if (L.afterNav.length < 400) {
              const r = L.root?.getBoundingClientRect()
              L.afterNav.push({
                nav: L.nav,
                f: frame.no,
                exact: st.exact,
                smooth: st.smooth,
                y: scrollTop(),
                truth: r && r.height ? progressFromRect(r.top, r.height, innerHeight) : null,
                connected: !!L.root?.isConnected,
                visible: !!L.root && L.root.offsetParent !== null
              })
            }
          }}
        />
      </Suspense>
    </>
  )
}

function RouteA() {
  // one conductor per mount, as a route would create it
  const [A] = useState(() => createConductor({ chapters: Array.from({ length: ACTS }, (_, i) => ({ id: `c${i}` })), damping: 5.5 }))
  const scene = useRef(null)
  useLayoutEffect(() => {
    L.conductor = A
    L.root = scene.current?.root ?? null
  })
  useEffect(() => {
    L.mounts++
    const offs = [bindReducedMotion(A)]
    if (bridgeRefresh) offs.push(onRouteRefresh(() => scene.current?.rehydrate('route')))
    if (loop === 'advance') {
      const cb = (time) => advance(time * 1000)
      gsap.ticker.add(cb)
      offs.push(() => gsap.ticker.remove(cb))
    }
    return () => offs.forEach((off) => off())
  }, [A])
  return (
    <>
      <div id="intro">
        <h1>Route A: a canvas scene</h1>
      </div>
      <PinnedScene
        ref={scene}
        pinned={
          <SceneCanvas frameloop={loop === 'advance' ? 'never' : loop} poster={<div className="poster" />} camera={{ position: [0, 0, 6], fov: 50 }}>
            <Stage conductor={A} />
          </SceneCanvas>
        }
        onProgress={(p) => A.setExact(p)}
        onRehydrate={(st) => {
          L.rehydrates.push({ nav: L.nav, f: frame.no, reason: st.reason, p: st.p })
          A.setExact(st.p)
          A.settle()
        }}
      >
        {Array.from({ length: ACTS }, (_, i) => (
          <section className="act" key={i}>
            <h2>Act {i + 1}</h2>
          </section>
        ))}
      </PinnedScene>
      <div id="outro" />
    </>
  )
}

function RouteB() {
  return (
    <div className="plain">
      <h1>Route B: text</h1>
    </div>
  )
}

function ScrollPlacer({ y }) {
  useLayoutEffect(() => {
    window.scrollTo(0, y)
  }, [y])
  return null
}

function App() {
  const [nav, setNav] = useState({ path: 'a', y: 0, n: 0 })
  const current = useRef(nav)
  current.current = nav
  const saved = useRef({ a: 0, b: 0 })
  useEffect(() => {
    window.__s11r.go = (to, { restore = false } = {}) => {
      const from = current.current.path
      saved.current[from] = scrollY
      const y = restore ? saved.current[to] : 0
      L.nav++
      const swap = () => flushSync(() => setNav({ path: to, y, n: current.current.n + 1 }))
      if (vt && document.startViewTransition) {
        const t = document.startViewTransition(swap)
        return t.updateCallbackDone.then(() => 'vt')
      }
      swap()
      return 'sync'
    }
    window.__s11r.ready = true
  }, [])
  const routes =
    keep === 'activity' ? (
      <>
        <Activity mode={nav.path === 'a' ? 'visible' : 'hidden'}>
          <RouteA />
        </Activity>
        <Activity mode={nav.path === 'b' ? 'visible' : 'hidden'}>
          <RouteB />
        </Activity>
      </>
    ) : nav.path === 'a' ? (
      <RouteA />
    ) : (
      <RouteB />
    )
  return (
    <RouteChange route={nav.path}>
      {routes}
      <ScrollPlacer key={nav.n} y={nav.y} />
    </RouteChange>
  )
}

const rec = createRecorder(() => ({ t: performance.now(), y: scrollTop(), rn: L.renders }))

window.__s11r = {
  params: { keep, vt, loop, bridgeRefresh },
  ready: false,
  L,
  rec,
  frame,
  contexts: contextStats,
  state: () => {
    const sc = document.querySelector('[data-scene-mode]')
    const r = L.root?.getBoundingClientRect()
    return {
      renders: L.renders,
      // gl.render() calls (three's counter): counts frames R3F renders even when no useFrame is subscribed
      glFrames: L.gl?.info.render.frame ?? null,
      frameloop: L.frameloop,
      sceneMode: sc?.getAttribute('data-scene-mode') ?? null,
      sceneReady: sc?.getAttribute('data-scene-ready') ?? null,
      canvasDisplayed: !!document.querySelector('canvas') && document.querySelector('canvas').offsetParent !== null,
      y: scrollTop(),
      exact: L.conductor?.state.exact ?? null,
      smooth: L.conductor?.state.smooth ?? null,
      truth: r && r.height ? progressFromRect(r.top, r.height, innerHeight) : null,
      contexts: contextStats(),
      mounts: L.mounts
    }
  }
}

createRoot(document.getElementById('root')).render(<App />)
