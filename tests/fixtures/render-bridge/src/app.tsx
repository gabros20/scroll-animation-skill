// scene.html: one pinned scene with a canvas, under StrictMode (double effects), on one authority.
//
//   ?engine=motion|gsap      our <PinnedScene> + usePinnedSceneRender, or pinnedScene() + pinnedSceneRender
//   &auth=native|lenis       nativeHandle, or Lenis on the engine's clock (gsapDriver / motionDriver)
//   &canvas=webgl|dom        the 3d skill's SceneCanvas (frameloop="never"), or the no-WebGL stand-in
//   &nowebgl=1               getContext('webgl*') returns null (probe.ts): SceneCanvas's poster path
//   &damping=5.5|null        the conductor's damping (default: 5.5 native, null under Lenis, the 3d skill's rule)
//   &y=N                     scroll to N in the first commit, before any frame: a mid-page load where the browser
//                            doesn't restore one (Playwright's WebKit reloads at the top)
//
// window.__rb is what tests/render-bridge.mjs reads and drives.
import './probe'

import { cancelFrame, frame as motionFrame } from 'motion/react'
import { StrictMode, useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { ScrollTrigger, gsap, setupGsap } from '../../../../skills/scroll-animation/assets/gsap/setup'
import { progressFromRect } from '../../../../skills/scroll-animation/assets/scene'
import { nativeHandle, registerHandle } from '../../../../skills/scroll-animation/assets/smooth/authority'
import { createSmoothScroll, gsapDriver, motionDriver } from '../../../../skills/scroll-animation/assets/smooth/lenis'
import { routeChanged } from '../../../../skills/scroll-animation/assets/smooth/route'
import type { SmoothScrollHandle } from '../../../../skills/scroll-animation/assets/smooth/authority'
import { contextStats, countListeners, createRecorder, fakeHidden, frame, scrollTop } from './probe'
import { ACTS, GsapScene, MotionScene, createLog, type SceneProbe } from './scene'
import { createConductor } from './vendor-3d/conductor'

const q = new URLSearchParams(location.search)
const engine = q.get('engine') === 'gsap' ? 'gsap' : 'motion'
const auth = q.get('auth') === 'lenis' ? 'lenis' : 'native'
const canvas = q.get('canvas') === 'dom' ? 'dom' : 'webgl'
const dampingParam = q.get('damping')
const damping = dampingParam === null ? (auth === 'native' ? 5.5 : null) : dampingParam === 'null' ? null : Number(dampingParam)

// GSAP's ticker callbacks, live: a destroyed bridge must leave none.
const ticker = { live: 0 }
if (engine === 'gsap' || auth === 'lenis') {
  setupGsap()
  const add = gsap.ticker.add.bind(gsap.ticker)
  const remove = gsap.ticker.remove.bind(gsap.ticker)
  const seen = new Set<unknown>()
  gsap.ticker.add = ((cb: Parameters<typeof add>[0], ...rest: unknown[]) => {
    const out = (add as (...a: unknown[]) => unknown)(cb, ...rest)
    if (!seen.has(cb)) (seen.add(cb), ticker.live++)
    return out
  }) as typeof gsap.ticker.add
  gsap.ticker.remove = ((cb: Parameters<typeof remove>[0]) => {
    if (seen.delete(cb)) ticker.live--
    return remove(cb)
  }) as typeof gsap.ticker.remove
}

// The authority first: the bridge's tick is added after its driver.
let handle: SmoothScrollHandle
if (auth === 'lenis') {
  handle = createSmoothScroll({
    driver: engine === 'gsap' ? gsapDriver(gsap, ScrollTrigger) : motionDriver(motionFrame, cancelFrame),
  })
} else {
  handle = nativeHandle()
  registerHandle(handle)
}
const tickerBaseline = ticker.live

const conductor = createConductor({ chapters: Array.from({ length: ACTS }, (_, i) => ({ id: `c${i}` })), damping })
const listeners = countListeners(conductor)
const log = createLog()
const probe: { scene: SceneProbe | null; requestRender: () => void } = { scene: null, requestRender: () => {} }
let setMounted: (on: boolean) => void = () => {}

function App() {
  const [mounted, mount] = useState(true)
  useLayoutEffect(() => {
    const y = q.get('y')
    if (y !== null) window.scrollTo(0, Number(y))
  }, [])
  useEffect(() => {
    setMounted = mount
    window.__rb.ready = true
  }, [])
  const expose = useCallback((scene: SceneProbe, requestRender: () => void) => {
    probe.scene = scene
    probe.requestRender = requestRender
  }, [])
  const Scene = engine === 'gsap' ? GsapScene : MotionScene
  return (
    <>
      <div id="shift" />
      <div id="intro">
        <h1>
          render-bridge: {engine} · {auth} · {canvas}
        </h1>
      </div>
      {mounted && <Scene conductor={conductor} log={log} canvas={canvas} expose={expose} />}
      <div id="outro" />
    </>
  )
}

const root = () => probe.scene?.root() ?? null
const rec = createRecorder(() => {
  const el = root()
  const r = el?.getBoundingClientRect()
  return {
    t: performance.now(),
    y: scrollTop(),
    truth: r ? progressFromRect(r.top, r.height, innerHeight) : null,
    range: probe.scene?.rangePx() ?? 1,
    rf: log.last?.f ?? null,
    ue: log.last?.e ?? null,
    us: log.last?.s ?? null,
    rn: log.renders,
    ticks: log.ticks,
    exact: conductor.state.exact,
    reduced: conductor.state.reduced,
    awake: probe.scene?.awake() ?? false,
  }
})

declare global {
  interface Window {
    __rb: Record<string, unknown> & { ready: boolean }
  }
}

let lose: { loseContext(): void; restoreContext(): void } | null = null
window.__rb = {
  params: { engine, auth, canvas, damping },
  ready: false,
  log,
  rec,
  frame,
  conductor: () => ({ ...conductor.state }),
  listeners,
  ticker: () => ({ live: ticker.live, baseline: tickerBaseline }),
  contexts: contextStats,
  scene: () =>
    probe.scene && { awake: probe.scene.awake(), reduced: probe.scene.reduced(), p: probe.scene.progress(), rangePx: probe.scene.rangePx() },
  geometry: () => {
    const r = root()!.getBoundingClientRect()
    return { top: r.top + scrollTop(), height: r.height, vh: innerHeight, rangePx: probe.scene!.rangePx() }
  },
  truth: () => {
    const r = root()?.getBoundingClientRect()
    return r ? progressFromRect(r.top, r.height, innerHeight) : null
  },
  jump: (y: number) => handle.scrollTo(y, { immediate: true }),
  shiftAbove: (px: number) => {
    document.getElementById('shift')!.style.height = `${px}px`
  },
  routeChanged: () => routeChanged({ settle: 0 }),
  requestRender: () => probe.requestRender(),
  fakeHidden,
  unmount: () => setMounted(false),
  remount: () => setMounted(true),
  loseContext: () => {
    // Keep the extension: a lost context's getExtension() returns null.
    lose = (log.gl?.getContext().getExtension('WEBGL_lose_context') as typeof lose) ?? null
    lose?.loseContext()
    return !!lose
  },
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
