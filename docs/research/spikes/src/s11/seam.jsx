// S11 — the render seam: an R3F canvas (the 3d skill's SceneCanvas + ConductorDriver, vendored) inside OUR pinned
// scene (skills/scroll-animation/assets, imported as @sa), under our scroll authority.
//
// Three conductors (vendor-3d/conductor.ts) watch the same range wrapper:
//   A  fed by our scene: onProgress → setExact(p | band), onRehydrate → setExact + settle()  (the bridge candidate)
//      ticked by ConductorDriver inside the canvas, so A's render log is "the value the canvas rendered with"
//   B  the 3d skill's adapter for the engine: motion → useMotionScrollConductor, gsap → attachScrollTrigger
//   C  the 3d skill's native adapter (attachNativeScroll)
// B and C are never ticked: only their `exact` is compared.
//
// ?engine=motion|gsap            our PinnedScene (Motion) or pinnedScene() (GSAP)
//  &auth=native|lenis-gsap|lenis-motion   our authority: nativeHandle, or createSmoothScroll with gsapDriver/motionDriver
//  &canvas=1|0                   mount the canvas (0 for the WebKit runs of Q1)
//  &loop=demand|always|advance   SceneCanvas's frameloop; advance = frameloop 'never' + advance() from &tick
//  &tick=gsap|raf|scroll|motion-update|motion-render|motion-postrender
//  &gate=0|1                     advance only while our scene is awake and the page visible
//  &damping=null|5.5             A's damping (default: 5.5 native, null under Lenis: the 3d skill's rule 3)
//  &feed=p|band                  what A is fed
//  &bridgeRefresh=0|1            register a bridge re-derive through onRouteRefresh
//  &dirty=0|1                    advance only when A got input since the last render or is still smoothing
//  &mountRender=1|0              (dirty) the canvas asks for a render when its renderer is created
import './contexts.js'
import 'lenis/dist/lenis.css'
import '@sa/css/scene.css'

import { advance, useThree } from '@react-three/fiber'
import { cancelFrame, frame as mframe } from 'motion'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { createRoot } from 'react-dom/client'

import { PinnedScene } from '@sa/motion/PinnedScene'
import { pinnedScene } from '@sa/gsap/pinned-scene'
import { ScrollTrigger, gsap, setupGsap } from '@sa/gsap/setup'
import { nativeHandle, registerHandle } from '@sa/smooth/authority'
import { createSmoothScroll, gsapDriver, motionDriver } from '@sa/smooth/lenis'
import { onRouteRefresh, routeChanged } from '@sa/smooth/route'
import { progressFromRect } from '@sa/scene'

import { bindReducedMotion, createConductor, createLvhProbe } from './vendor-3d/conductor'
import { attachNativeScroll } from './vendor-3d/adapters/native'
import { attachScrollTrigger } from './vendor-3d/adapters/gsap'
import { useMotionScrollConductor } from './vendor-3d/adapters/motion'
import { ConductorDriver, SceneCanvas } from './vendor-3d/r3f/SceneCanvas'
import { contextStats } from './contexts.js'
import { clamp01, createRecorder, frame, scrollTop } from './rec.js'

const q = new URLSearchParams(location.search)
const engine = q.get('engine') ?? 'motion'
const auth = q.get('auth') ?? 'native'
const canvasOn = q.get('canvas') !== '0'
const loop = q.get('loop') ?? 'demand'
const tick = q.get('tick') ?? 'gsap'
const gate = q.get('gate') === '1'
const dampingParam = q.get('damping')
const damping = dampingParam == null ? (auth === 'native' ? 5.5 : null) : dampingParam === 'null' ? null : Number(dampingParam)
const feed = q.get('feed') ?? 'p'
const bridgeRefresh = q.get('bridgeRefresh') === '1'
const dirtyOnly = q.get('dirty') === '1'
const mountRender = q.get('mountRender') !== '0'
const ACTS = 4

const css = document.createElement('style')
css.textContent = `
html, body { margin: 0; } html { scroll-behavior: auto; overflow-anchor: none; }
body { font: 16px/1.4 system-ui, sans-serif; background: #f4f1ea; }
.act { height: 100vh; box-sizing: border-box; padding: 40px; }
.act h2 { margin: 0; background: rgba(255,255,255,.7); display: inline-block; padding: 4px 8px; }
.poster { position: absolute; inset: 0; background: #2a6f4e; }
#intro { height: 600px; } #outro { height: 2400px; background: #ddd; }
`
document.head.appendChild(css)

// ---- the authority (one per page, created before anything reads scroll) -------------------------------------
if (engine === 'gsap' || auth === 'lenis-gsap') setupGsap()
let handle
if (auth === 'lenis-gsap') handle = createSmoothScroll({ driver: gsapDriver(gsap, ScrollTrigger) })
else if (auth === 'lenis-motion') handle = createSmoothScroll({ driver: motionDriver(mframe, cancelFrame) })
else registerHandle((handle = nativeHandle()))

// ---- conductors --------------------------------------------------------------------------------------------
const chapters = Array.from({ length: ACTS }, (_, i) => ({ id: `c${i}` }))
const A = createConductor({ chapters, damping })
const B = createConductor({ chapters, damping: null })
const C = createConductor({ chapters, damping: null })

// the normalised scene handle (the two engines' handles differ: functions vs getters)
const S = {
  h: null,
  progress: () => S.h?.progress() ?? NaN,
  band: () => S.h?.band() ?? NaN,
  awake: () => (S.h ? (engine === 'motion' ? S.h.awake() : S.h.awake) : false),
  reduced: () => (S.h ? (engine === 'motion' ? S.h.reduced() : S.h.reduced) : false),
  rangePx: () => S.h?.rangePx() ?? 1,
  root: () => S.h?.root ?? null,
  events: { awake: [], rehydrate: [] }
}

// The bridge candidate: our scene → conductor A.
const bridge = {
  onProgress: (p, h) => A.setExact(feed === 'band' ? h.band() : p),
  onRehydrate: (st) => {
    S.events.rehydrate.push({ f: frame.no, reason: st.reason, p: st.p, band: st.band, reduced: st.reduced })
    A.setExact(feed === 'band' ? st.band : st.p)
    A.settle()
  },
  onAwake: (awake) => S.events.awake.push({ f: frame.no, awake, y: scrollTop() })
}

// ---- render log --------------------------------------------------------------------------------------------
const R = { n: 0, last: null, boot: [], frameloop: null, gl: null, mode: null, dirty: true }
function logRender(st) {
  R.n++
  R.last = { f: frame.no, exact: st.exact, smooth: st.smooth, n: R.n }
  if (R.boot.length < 300) {
    const r = S.root()?.getBoundingClientRect()
    R.boot.push({ f: frame.no, exact: st.exact, smooth: st.smooth, y: scrollTop(), truth: r ? progressFromRect(r.top, r.height, innerHeight) : null })
  }
}

function Stage() {
  const mesh = useRef(null)
  const gl = useThree((s) => s.gl)
  const fl = useThree((s) => s.frameloop)
  useEffect(() => {
    R.gl = gl
    if (mountRender) R.dirty = true
  }, [gl])
  useEffect(() => void (R.frameloop = fl), [fl])
  return (
    <>
      <color attach="background" args={['#203040']} />
      <mesh ref={mesh} scale={[2.2, 2.2, 2.2]}>
        <boxGeometry />
        <meshBasicMaterial color="#ff8800" />
      </mesh>
      <Suspense fallback={null}>
        <ConductorDriver
          conductor={A}
          onFrame={(st) => {
            if (mesh.current) {
              mesh.current.rotation.y = st.smooth * Math.PI * 2
              mesh.current.position.x = (st.smooth - 0.5) * 3
            }
            logRender(st)
          }}
        />
      </Suspense>
    </>
  )
}

function Canvas3D() {
  if (!canvasOn) return null
  return (
    <SceneCanvas frameloop={loop === 'advance' ? 'never' : loop} poster={<div className="poster" />} camera={{ position: [0, 0, 6], fov: 50 }}>
      <Stage />
    </SceneCanvas>
  )
}

// advance() from the authority's tick (loop=advance)
function useAdvanceTick() {
  useEffect(() => {
    if (!canvasOn || loop !== 'advance') return
    const off = A.onInput(() => (R.dirty = true))
    const go = (ms) => {
      if (gate && (!S.awake() || document.hidden)) return
      if (dirtyOnly && !R.dirty && A.state.settled) return
      R.dirty = false
      advance(ms)
    }
    if (tick === 'gsap') {
      const cb = (time) => go(time * 1000)
      gsap.ticker.add(cb)
      return () => (gsap.ticker.remove(cb), off())
    }
    if (tick.startsWith('motion-')) {
      const step = { 'motion-update': 'update', 'motion-render': 'render', 'motion-postrender': 'postRender' }[tick]
      const cb = ({ timestamp }) => go(timestamp)
      mframe[step](cb, true)
      return () => (cancelFrame(cb), off())
    }
    if (tick === 'raf') {
      let id = 0
      const l = (t) => {
        go(t)
        id = requestAnimationFrame(l)
      }
      id = requestAnimationFrame(l)
      return () => (cancelAnimationFrame(id), off())
    }
    if (tick === 'scroll') {
      const cb = () => go(performance.now())
      addEventListener('scroll', cb, { passive: true })
      return () => (removeEventListener('scroll', cb), off())
    }
  }, [])
}

function Acts() {
  return Array.from({ length: ACTS }, (_, i) => (
    <section className="act" key={i}>
      <h2>Act {i + 1}</h2>
    </section>
  ))
}

function MotionEngine({ wrapper }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    S.h = ref.current
  })
  useMotionScrollConductor(B, wrapper)
  return (
    <PinnedScene ref={ref} pinned={<Canvas3D />} onProgress={bridge.onProgress} onRehydrate={bridge.onRehydrate} onAwake={bridge.onAwake}>
      <Acts />
    </PinnedScene>
  )
}

function GsapEngine() {
  const root = useRef(null)
  useLayoutEffect(() => {
    const s = pinnedScene(root.current, { onProgress: bridge.onProgress, onRehydrate: bridge.onRehydrate, onAwake: bridge.onAwake })
    S.h = s
    const b = attachScrollTrigger(B, { wrapper: root.current })
    return () => {
      b.destroy()
      s.destroy()
    }
  }, [])
  return (
    <div ref={root} data-scene-root="">
      <div data-scene-pin="">
        <Canvas3D />
      </div>
      <div data-scene-content="">
        <Acts />
      </div>
    </div>
  )
}

function App() {
  // the 3d motion adapter takes a ref; ours is the scene's root
  const wrapper = useMemo(() => ({ get current() { return S.root() } }), [])
  useAdvanceTick()
  useEffect(() => {
    const c = attachNativeScroll(C, { wrapper: S.root() })
    const unbind = bindReducedMotion(A)
    const offs = []
    if (engine === 'gsap') offs.push(onRouteRefresh(ScrollTrigger.refresh))
    if (bridgeRefresh) offs.push(onRouteRefresh(() => S.h?.rehydrate('route')))
    window.__s11.ready = true
    return () => {
      c.destroy()
      unbind()
      offs.forEach((off) => off())
    }
  }, [])
  return (
    <>
      <div id="shift" />
      <div id="intro">
        <h1>S11 seam: {engine} · {auth} · {canvasOn ? loop : 'no canvas'}</h1>
      </div>
      {engine === 'motion' ? <MotionEngine wrapper={wrapper} /> : <GsapEngine />}
      <div id="outro" />
    </>
  )
}

// ---- recorder ----------------------------------------------------------------------------------------------
const lvh = createLvhProbe()
const rec = createRecorder(
  () => {
    const root = S.root()
    const r = root?.getBoundingClientRect()
    const vh = innerHeight
    const L = lvh.read()
    const sceneCanvas = document.querySelector('[data-scene-mode]')
    return {
      t: performance.now(),
      y: scrollTop(),
      truth: r ? progressFromRect(r.top, r.height, vh) : null,
      truthLvh: r ? clamp01(-r.top / Math.max(1, r.height - L)) : null,
      top: r?.top,
      h: r?.height,
      range: S.rangePx(),
      sp: S.progress(),
      band: S.band(),
      a: A.state.exact,
      as: A.state.smooth,
      ar: A.state.reduced,
      b: B.state.exact,
      c: C.state.exact,
      rf: R.last?.f ?? null,
      ue: R.last?.exact ?? null,
      us: R.last?.smooth ?? null,
      rn: R.n,
      awake: S.awake(),
      fl: R.frameloop,
      sm: sceneCanvas?.getAttribute('data-scene-mode') ?? null,
      sr: sceneCanvas?.getAttribute('data-scene-ready') ?? null,
      vis: document.visibilityState
    }
  },
  { boot: true }
)

window.__s11 = {
  params: { engine, auth, canvasOn, loop, tick, gate, damping, feed, bridgeRefresh, dirtyOnly, mountRender },
  ready: false,
  rec,
  A,
  B,
  C,
  S,
  R,
  handle,
  frame,
  contexts: contextStats,
  jump: (y) => handle.scrollTo(y, { immediate: true }),
  shiftAbove: (px) => {
    document.getElementById('shift').style.height = `${px}px`
  },
  routeChanged: () => routeChanged(),
  geometry: () => {
    const r = S.root().getBoundingClientRect()
    return { top: r.top + scrollY, height: r.height, vh: innerHeight, lvh: lvh.read(), rangePx: S.rangePx() }
  },
  webgl: () => {
    const gl = R.gl?.getContext()
    if (!gl) return null
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    return { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), version: gl.getParameter(gl.VERSION) }
  },
  loseContext: () => {
    // keep the extension: a lost context's getExtension() returns null
    window.__s11._ext = R.gl?.getContext().getExtension('WEBGL_lose_context')
    window.__s11._ext?.loseContext()
  },
  restoreContext: () => window.__s11._ext?.restoreContext(),
  pageshows: [],
  // Headless pages are never hidden (another tab in front leaves them 'visible'): this overrides the two getters and
  // fires the event, so it exercises the listeners only. A real hidden tab also stops rAF.
  fakeHidden: (hidden) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    document.dispatchEvent(new Event('visibilitychange'))
  },
  // Playwright's Chromium and WebKit reload on goBack (persisted: false), so a bfcache return is synthesised
  fakePageShow: () => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
}
addEventListener('pageshow', (e) => {
  window.__s11.pageshows.push({ f: frame.no, persisted: e.persisted, y: scrollTop(), rn: R.n })
  // a bfcache restore logs its renders afresh
  if (e.persisted) R.boot = []
})

createRoot(document.getElementById('root')).render(<App />)
