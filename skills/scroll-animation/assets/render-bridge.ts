/**
 * render-bridge.ts — a real-time canvas inside a pinned scene: the scene's exact progress feeds the canvas's
 * conductor (one measurement, the pin's), and the canvas renders on the scroll authority's own tick, only when there
 * is something new to show. Engine-free and DOM-light; it imports no three, R3F or 3d file. The adapters own the tick:
 * motion/usePinnedSceneRender.ts (Motion `frame.render`) and gsap/pinned-scene-render.ts (`gsap.ticker`).
 *
 *   const bridge = createRenderBridge(scene, conductor, { render: (ms) => advance(ms / 1000) })
 *   onProgress: bridge.onProgress     onRehydrate: bridge.onRehydrate      the scene's two events
 *   tick: bridge.frame(ms)            once per frame, AFTER the authority's driver, on the same clock (the
 *                                     adapters keep that order whatever the mount order)
 *   bridge.requestRender()            a canvas created later (lazy three, a remount): render until it ticks
 *   bridge.destroy()                  idempotent; the bridge is inert afterwards
 *
 * Measured in spike S11 (docs/research/spikes-2026-09.md, Chromium + SwiftShader, WebKit):
 * - Feed from the scene, attach no 3d scroll adapter. The scene's p agrees with the rect to 0.44 px; the adapters are
 *   150 px off for 2–20 frames after a resize, 300 px off for good after a layout shift above the range, and the
 *   native one is 1 frame late under Lenis on gsap.ticker. Exact progress, not the band: the conductor's chapters do
 *   the pacing (holds belong to media that scrubs).
 * - Render on the authority's tick, never on the canvas's own loop: R3F's `demand` loop is 1 frame late in every frame
 *   on Motion pages and every other frame on GSAP + Lenis pages; `advance()` from gsap.ticker or Motion's
 *   `frame.render` is 0 frames late under native, Lenis and Motion. A page's own rAF loop is 1 frame late on Motion.
 *   The canvas runs `frameloop="never"`, so its own off-screen and hidden-tab pause no longer applies: this gates.
 * - Render only when dirty: conductor input since the last render, smooth still settling (`!state.settled`), or not
 *   yet primed. Advancing every tick costs 60 renders/s at rest, and 60/s off-screen and hidden without the gate; this
 *   costs 0 at rest and 0 there.
 * - No sweep: progress that arrives before the scene's first rehydrate or while the bridge is gated lands settled
 *   (smooth = exact), so a reload, a wake or a tab return draws the scroll position, never a glide from 0 or from
 *   where the scene was left: a reload's first progress event can reach the bridge before the scene's mount rehydrate.
 *   Nothing renders before that rehydrate: that event can carry the position from before the browser restored the
 *   scroll (Firefox, Lenis started in a layout: one frame drawn at 0 on a reload mid-scene).
 * - Priming: a canvas can render before the conductor's driver (ConductorDriver, lazy) has subscribed, which presents
 *   the scene's default pose. So after a mount, a resume (the gate opening again), a rehydrate or requestRender() the
 *   bridge keeps rendering until one render has ticked the conductor (its `subscribe` fired), PRIME_FRAMES at most:
 *   a canvas that never mounts (no WebGL, the poster) costs nothing after that. A canvas that mounts later than that
 *   calls requestRender() once it exists.
 * - Reduced motion, live: the bridge follows the SCENE's reduced state (bindReducedMotion's snap would be overwritten
 *   by the next setExact): setReduced(true), the hold (`hold`, default 0), settle(), one render, scroll ignored.
 *   Turning it off rehydrates from scroll. Unmount the canvas meanwhile (no context, no work) and let the poster be
 *   the scene; css/scene.css hides a canvas that stays mounted.
 * - Routes: while it lives the bridge registers `onRouteRefresh(() => scene.rehydrate('route'))` (a layout shift
 *   above the range on a Motion route is otherwise missed until the next scroll); destroy() unregisters it.
 *   ScrollTrigger.refresh stays the GSAP route's own registration.
 *
 * R3F: `render: (ms) => advance(ms / 1000)`. `advance` takes R3F's clock units, seconds, and ConductorDriver damps
 * with the delta it derives; with more than one canvas on the page, advance this canvas's root alone:
 * `advance(ms / 1000, true, store.getState())`. Three without R3F: tick the conductor inside `render`, then
 * `renderer.render(scene, camera)` (priming waits for a tick).
 */
import type { SceneRehydrate } from './scene'
import { onRouteRefresh } from './smooth/route'

/** Renders without a conductor tick after which a priming bridge gives up until the next input, resume or request. */
export const PRIME_FRAMES = 120

/** The scene, as both engines' handles map to it (Motion's are methods, GSAP's `awake` and `reduced` properties). */
export interface RenderScene {
  awake(): boolean
  reduced(): boolean
  rehydrate(reason?: string): void
}

/** The part of the 3d skill's conductor (assets/web/conductor.ts) the bridge drives, typed structurally. */
export interface RenderConductor {
  readonly state: { readonly settled: boolean; readonly reduced: boolean }
  setExact(progress: number): void
  settle(): void
  setReduced(reduced: boolean): void
  /** Synchronous, whenever exact changes. */
  onInput(listener: () => void): () => void
  /** After every tick. */
  subscribe(listener: () => void): () => void
}

export interface RenderBridgeOptions {
  /** Draw one frame at `ms` (the tick's timestamp, milliseconds): R3F `(ms) => advance(ms / 1000)`. */
  render: (ms: number) => void
  /** Progress the conductor holds under reduced motion, read at each rehydrate. Default 0 (the head). */
  hold?: number
}

export interface RenderBridgeDebug {
  renders: number
  dirty: boolean
  priming: number
  gated: boolean
  destroyed: boolean
}

export interface RenderBridge {
  /** The scene's onProgress: exact progress to the conductor (ignored under reduced motion). */
  onProgress(p: number): void
  /** The scene's onRehydrate: setExact + settle (or the reduced-motion hold), then render once. */
  onRehydrate(state: Pick<SceneRehydrate, 'p' | 'reduced'>): void
  /** Call once per frame from the authority's tick. Renders only after the first rehydrate, awake, visible, dirty. */
  frame(ms: number): void
  /** Render until the conductor ticks (a canvas that exists only now). */
  requestRender(): void
  debug(): RenderBridgeDebug
  destroy(): void
}

const pageHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

export function createRenderBridge(
  scene: RenderScene,
  conductor: RenderConductor,
  options: RenderBridgeOptions,
): RenderBridge {
  let input = false
  let ticked = false
  // The last render ticked the conductor: only then can `!settled` converge, so only then does it keep frames coming.
  let ticking = false
  let priming = PRIME_FRAMES
  // Starts gated: the first frame that passes the gate is a resume, and primes.
  let gated = true
  // No rehydrate yet.
  let fresh = true
  let renders = 0
  let destroyed = false

  const prime = () => {
    priming = PRIME_FRAMES
  }
  const offInput = conductor.onInput(() => {
    input = true
  })
  const offTick = conductor.subscribe(() => {
    ticked = true
  })
  const offRoute = onRouteRefresh(() => scene.rehydrate('route'))

  const dirty = () => input || priming > 0 || (ticking && !conductor.state.settled)

  return {
    onProgress(p) {
      if (destroyed || scene.reduced()) return
      conductor.setExact(p)
      // Nothing on screen to move from: before the first rehydrate (a reload's first progress event can come first)
      // and while gated (asleep, hidden), smooth lands on exact instead of sweeping from a stale value.
      if (fresh || gated) conductor.settle()
    },
    onRehydrate(state) {
      if (destroyed) return
      fresh = false
      if (state.reduced) {
        conductor.setReduced(true)
        conductor.setExact(options.hold ?? 0)
      } else {
        if (conductor.state.reduced) conductor.setReduced(false)
        conductor.setExact(state.p)
      }
      conductor.settle()
      prime()
    },
    frame(ms) {
      if (destroyed) return
      // Before the scene's first rehydrate the progress may predate the browser's scroll restoration: draw nothing.
      if (fresh || !scene.awake() || pageHidden()) {
        gated = true
        return
      }
      if (gated) {
        gated = false
        prime()
      }
      if (!dirty()) return
      input = false
      ticked = false
      renders++
      options.render(ms)
      ticking = ticked
      if (ticked) priming = 0
      else if (priming > 0) priming--
    },
    requestRender() {
      if (!destroyed) prime()
    },
    debug: () => ({ renders, dirty: dirty(), priming, gated, destroyed }),
    destroy() {
      if (destroyed) return
      destroyed = true
      offInput()
      offTick()
      offRoute()
    },
  }
}
