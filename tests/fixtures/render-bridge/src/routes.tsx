// routes.html: a canvas route (a: the Motion scene with the 3d skill's SceneCanvas) and a plain route (b), swapped by
// a minimal client router the way Next does it (Phase 4, spike S9): commit the new route, put the scroll at the top
// in a layout effect, then routeChanged(). The route that is left unmounts. Native scrolling, StrictMode.
//
// window.__rb: go('a'|'b'), the live WebGL contexts, and per mount of route a its conductor's live listeners and its
// log (renders, the rehydrates the bridge's route refresh asked for).
import './probe'

import { StrictMode, useCallback, useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { nativeHandle, registerHandle } from '../../../../skills/scroll-animation/assets/smooth/authority'
import { routeChanged } from '../../../../skills/scroll-animation/assets/smooth/route'
import { contextStats, countListeners, createRecorder, scrollTop } from './probe'
import { ACTS, MotionScene, createLog, type Log, type SceneProbe } from './scene'
import { createConductor } from './vendor-3d/conductor'

registerHandle(nativeHandle())

interface Mount {
  log: Log
  listeners: { input: number; tick: number }
  scene: SceneProbe | null
}
const mounts: Mount[] = []
let go: (route: 'a' | 'b') => void = () => {}

function RouteA() {
  const [mount] = useState(() => {
    const conductor = createConductor({ chapters: Array.from({ length: ACTS }, (_, i) => ({ id: `c${i}` })), damping: 5.5 })
    return { conductor, log: createLog(), listeners: countListeners(conductor), scene: null as SceneProbe | null }
  })
  // Not in the initialiser: StrictMode calls that twice and keeps one.
  useLayoutEffect(() => {
    if (!mounts.includes(mount)) mounts.push(mount)
  }, [mount])
  const expose = useCallback(
    (scene: SceneProbe) => {
      mount.scene = scene
    },
    [mount],
  )
  return (
    <>
      <div id="intro">
        <h1>Route a</h1>
      </div>
      <MotionScene conductor={mount.conductor} log={mount.log} canvas="webgl" expose={expose} />
      <div id="outro" />
    </>
  )
}

function RouteB() {
  return <div className="plain">Route b</div>
}

function App() {
  const [route, setRoute] = useState<'a' | 'b'>('a')
  const [navs, setNavs] = useState(0)
  useLayoutEffect(() => {
    go = (next) => {
      setRoute(next)
      setNavs((n) => n + 1)
    }
    window.__rb.ready = true
  }, [])
  useLayoutEffect(() => {
    if (navs === 0) return
    window.scrollTo(0, 0)
    routeChanged({ settle: 0 })
  }, [navs])
  return route === 'a' ? <RouteA /> : <RouteB />
}

declare global {
  interface Window {
    __rb: Record<string, unknown> & { ready: boolean }
  }
}

const latest = () => mounts.at(-1)
createRecorder(() => ({ y: scrollTop() }), 1)
window.__rb = {
  ready: false,
  go: (route: 'a' | 'b') => go(route),
  contexts: contextStats,
  mounts: () => mounts.map((m) => ({ renders: m.log.renders, ticks: m.log.ticks, listeners: { ...m.listeners }, rehydrates: m.log.rehydrates.map((r) => r.reason) })),
  drawn: () => latest()?.log.drawn ?? [],
  rangePx: () => latest()?.scene?.rangePx() ?? 1,
  shiftAbove: (px: number) => {
    const el = document.getElementById('intro')
    if (el) el.style.paddingTop = `${px}px`
  },
  routeChanged: () => routeChanged({ settle: 0 }),
  jump: (y: number) => window.scrollTo(0, y),
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
