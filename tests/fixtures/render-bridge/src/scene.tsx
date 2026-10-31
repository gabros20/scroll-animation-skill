// The pieces both pages share: a scene (our Motion <PinnedScene> or GSAP pinnedScene(), four one-viewport acts)
// whose pin holds the poster and the canvas slot (css/scene.css), fed into a conductor (the 3d skill's, vendored)
// through render-bridge.ts. The slot holds either the 3d skill's SceneCanvas (vendored) running frameloop="never",
// advanced by the bridge, or `dom`: no WebGL, the bridge's render ticks the conductor and writes a label (the core's
// gating and timing in any browser).
//
// What a render drew is logged where it is drawn: the mesh's onAfterRender (WebGL) or the label write (dom), with
// the frame number, so the harness can tell the frame a render landed in. The mesh takes its pose from the
// conductor's state when it mounts as well as on every tick, so a render before ConductorDriver has subscribed still
// draws the scene's pose, never three's default one.
import { advance, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import type { Mesh } from 'three'

import { pinnedSceneRender } from '../../../../skills/scroll-animation/assets/gsap/pinned-scene-render'
import { pinnedScene } from '../../../../skills/scroll-animation/assets/gsap/pinned-scene'
import { ScrollTrigger } from '../../../../skills/scroll-animation/assets/gsap/setup'
import { PinnedScene } from '../../../../skills/scroll-animation/assets/motion/PinnedScene'
import type { PinnedSceneHandle } from '../../../../skills/scroll-animation/assets/motion/usePinnedScene'
import { usePinnedSceneRender } from '../../../../skills/scroll-animation/assets/motion/usePinnedSceneRender'
import type { RenderBridgeOptions } from '../../../../skills/scroll-animation/assets/render-bridge'
import { progressFromRect, type SceneRehydrate } from '../../../../skills/scroll-animation/assets/scene'
import { onRouteRefresh } from '../../../../skills/scroll-animation/assets/smooth/route'
import { frame } from './probe'
import type { Conductor, ConductorState } from './vendor-3d/conductor'
import { ConductorDriver, SceneCanvas } from './vendor-3d/r3f/SceneCanvas'

export const ACTS = 4

export interface Drawn {
  f: number
  /** exact and smooth progress the frame was drawn with */
  e: number
  s: number
  truth: number | null
  ticked: boolean
}

export interface Log {
  renders: number
  ticks: number
  drawn: Drawn[]
  last: Drawn | null
  rehydrates: { reason: string; f: number; p: number; reduced: boolean }[]
  gl: { getContext(): WebGLRenderingContext | WebGL2RenderingContext } | null
}

export const createLog = (): Log => ({ renders: 0, ticks: 0, drawn: [], last: null, rehydrates: [], gl: null })

/** The engines' handles, normalised for the harness (Motion: methods; GSAP: `awake`/`reduced` properties). */
export interface SceneProbe {
  root(): HTMLElement | null
  awake(): boolean
  reduced(): boolean
  rangePx(): number
  progress(): number
}

export interface SceneProps {
  conductor: Conductor
  log: Log
  canvas: 'webgl' | 'dom'
  /** Receives the scene's normalised handle and the bridge's requestRender once they exist. */
  expose(probe: SceneProbe, requestRender: () => void): void
}

function truthNow(root: HTMLElement | null) {
  if (!root) return null
  const r = root.getBoundingClientRect()
  return progressFromRect(r.top, r.height, window.innerHeight)
}

function record(log: Log, root: () => HTMLElement | null, state: Pick<ConductorState, 'exact' | 'smooth'>, ticked: boolean) {
  const entry = { f: frame.no, e: state.exact, s: state.smooth, truth: truthNow(root()), ticked }
  log.last = entry
  if (log.drawn.length < 2000) log.drawn.push(entry)
}

/** The bridge's render for the page's canvas: R3F's advance() in seconds, or the dom stand-in. */
export function renderFor(canvas: 'webgl' | 'dom', conductor: Conductor, log: Log, root: () => HTMLElement | null) {
  let last = 0
  return (ms: number) => {
    log.renders++
    if (canvas === 'webgl') return advance(ms / 1000)
    const st = conductor.tick(last ? (ms - last) / 1000 : 0)
    last = ms
    log.ticks++
    const label = document.querySelector<HTMLElement>('[data-dom-render]')
    if (label) label.textContent = st.exact.toFixed(4)
    record(log, root, st, true)
  }
}

function pose(mesh: Mesh, st: Pick<ConductorState, 'exact' | 'smooth'>, ticked: boolean) {
  mesh.rotation.y = st.smooth * Math.PI * 2
  mesh.position.x = (st.smooth - 0.5) * 3
  mesh.userData = { e: st.exact, s: st.smooth, ticked }
}

function Stage({ conductor, log, root, requestRender }: { conductor: Conductor; log: Log; root: () => HTMLElement | null; requestRender: () => void }) {
  const mesh = useRef<Mesh>(null)
  const gl = useThree((s) => s.gl)
  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    pose(m, conductor.state, false)
    m.onAfterRender = () => record(log, root, { exact: m.userData.e, smooth: m.userData.s }, m.userData.ticked)
  }, [conductor, log, root])
  useEffect(() => {
    log.gl = gl
    // The canvas exists only now (three loads lazily): render until ConductorDriver ticks.
    requestRender()
  }, [gl, log, requestRender])
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
            log.ticks++
            if (mesh.current) pose(mesh.current, st, true)
          }}
        />
      </Suspense>
    </>
  )
}

function Pinned({ canvas, conductor, log, root, requestRender }: Omit<SceneProps, 'expose'> & { root: () => HTMLElement | null; requestRender: () => void }) {
  return (
    <>
      <div data-scene-poster="" className="poster" />
      <div data-scene-canvas="">
        {canvas === 'webgl' ? (
          // SceneCanvas types frameloop as 'always' | 'demand'; 'never' passes through to R3F (spike S11).
          <SceneCanvas frameloop={'never' as 'demand'} camera={{ position: [0, 0, 6], fov: 50 }}>
            <Stage conductor={conductor} log={log} root={root} requestRender={requestRender} />
          </SceneCanvas>
        ) : (
          <div data-dom-render="" className="dom-render" />
        )}
      </div>
    </>
  )
}

export function Acts(): ReactNode {
  return Array.from({ length: ACTS }, (_, i) => (
    <section className="act" key={i}>
      <h2>Act {i + 1}</h2>
    </section>
  ))
}

function logRehydrate(log: Log, s: SceneRehydrate) {
  log.rehydrates.push({ reason: s.reason, f: frame.no, p: s.p, reduced: s.reduced })
}

export function MotionScene({ conductor, log, canvas, expose }: SceneProps) {
  const ref = useRef<PinnedSceneHandle>(null)
  const root = useRef(() => ref.current?.root ?? null).current
  const optionsRef = useRef<RenderBridgeOptions | null>(null)
  if (!optionsRef.current) optionsRef.current = { render: renderFor(canvas, conductor, log, root) }
  const bridge = usePinnedSceneRender(conductor, optionsRef.current)
  useLayoutEffect(() => {
    const h = ref.current
    if (!h) return
    expose({ root: () => h.root, awake: h.awake, reduced: h.reduced, rangePx: h.rangePx, progress: h.progress }, bridge.requestRender)
  }, [bridge, expose])
  return (
    <PinnedScene
      ref={ref}
      onProgress={bridge.onProgress}
      onRehydrate={(s, h) => {
        logRehydrate(log, s)
        bridge.onRehydrate(s, h)
      }}
      pinned={<Pinned canvas={canvas} conductor={conductor} log={log} root={root} requestRender={bridge.requestRender} />}
    >
      <Acts />
    </PinnedScene>
  )
}

export function GsapScene({ conductor, log, canvas, expose }: SceneProps) {
  const el = useRef<HTMLDivElement>(null)
  const request = useRef<() => void>(() => {})
  const root = useRef(() => el.current).current
  useLayoutEffect(() => {
    const node = el.current
    if (!node) return
    const render = pinnedSceneRender(conductor, { render: renderFor(canvas, conductor, log, root) })
    const scene = pinnedScene(node, {
      onProgress: render.onProgress,
      onRehydrate: (s, h) => {
        logRehydrate(log, s)
        render.onRehydrate(s, h)
      },
    })
    request.current = render.requestRender
    const off = onRouteRefresh(ScrollTrigger.refresh)
    expose(
      { root: () => node, awake: () => scene.awake, reduced: () => scene.reduced, rangePx: scene.rangePx, progress: scene.progress },
      render.requestRender,
    )
    return () => {
      off()
      render.destroy()
      scene.destroy()
      request.current = () => {}
    }
  }, [canvas, conductor, expose, log, root])
  return (
    <div ref={el} data-scene-root="">
      <div data-scene-pin="">
        <Pinned canvas={canvas} conductor={conductor} log={log} root={root} requestRender={() => request.current()} />
      </div>
      <div data-scene-content="">
        <Acts />
      </div>
    </div>
  )
}
