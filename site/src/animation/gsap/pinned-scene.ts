/**
 * gsap/pinned-scene.ts — a pinned scene for GSAP pages: `pinnedScene(root, options)` → a handle.
 *
 *   <div data-scene-root>                     css/scene.css gives these their geometry
 *     <div data-scene-pin>…</div>
 *     <div data-scene-content>…acts…</div>
 *   </div>
 *
 *   const scene = pinnedScene(el, { onProgress: (p) => tl.progress(p) })   // a paused section timeline, say
 *   scene.onMode((mode) => …)   scene.progress()   scene.mode   scene.refresh()   scene.destroy()
 *
 * - `pin: 'sticky'` (default): CSS sticky geometry, identical to the React engine's, and a ScrollTrigger WITHOUT a pin
 *   on the range wrapper (start 'top top', end 'bottom bottom') as the progress source: no pin-spacer, no
 *   reparenting, the CSS reduced-motion collapse. Once refreshed its progress equals the wrapper's rect maths at every
 *   viewport, native or under Lenis (spike S5). This scene owns that freshness: a ResizeObserver on <body> refreshes
 *   ScrollTrigger after a layout change above the range, and a resume re-derives from the rect, never a stale value.
 * - `pin: 'gsap'`: ScrollTrigger pins the pin element (`pinSpacing: false`; the content's negative margin already
 *   cancels its height). For ScrollSmoother pages, where sticky can't work (spike S2).
 * - Reduced motion is live: the scene builds inside `gsap.matchMedia(MOTION_CONDITIONS)` (gsap/setup.ts), and a
 *   change reverts the build and runs it again. Reduced motion holds the head and no act goes inert. The sticky
 *   trigger lives outside that build: GSAP 3.15 drops the page's scroll position (the page jumps to the top) when a
 *   ScrollTrigger is created during a matchMedia rebuild. For the same reason, create the scene outside your own
 *   `gsap.matchMedia` callbacks.
 * - Modes (scene.ts) are written per transition to `data-scene-state` on the root; `[data-scene-act]`s other than the
 *   active one get `inert`. Awake/warm margins and the rehydrate triggers match the Motion engine's.
 * - Create scenes in page order (or give `refreshPriority`), so ScrollTrigger refreshes them top to bottom.
 * - In React, call it inside `useGSAP(() => { const s = pinnedScene(ref.current!); return () => s.destroy() })`;
 *   on a vanilla page, inside the route's `mount(routeRoot)`.
 */
import {
  ACT_HYSTERESIS,
  SCENE_HOLDS,
  SCENE_MARGINS,
  actFromProgress,
  bandProgress,
  isNear,
  progressFromRect,
  rangeFromHeight,
  sceneAt,
  sceneBounds,
  stepAct,
  stepMode,
  type SceneBounds,
  type SceneHolds,
  type SceneMode,
  type SceneRehydrate,
} from '../scene'
import { MOTION_CONDITIONS, ScrollTrigger, gsap, setupGsap, type MotionConditions } from './setup'

export interface PinnedSceneOptions extends Partial<SceneHolds> {
  /** 'sticky' (default) or 'gsap' (ScrollTrigger pins it: ScrollSmoother pages). */
  pin?: 'sticky' | 'gsap'
  warmMarginPx?: number
  wakeMarginPx?: number
  /** In acts. Default 0.1. */
  actHysteresis?: number
  refreshPriority?: number
  /** Every exact progress change: write scroll-linked styles here, or drive a paused timeline. */
  onProgress?: (p: number, scene: PinnedSceneHandle) => void
  onMode?: (mode: SceneMode, scene: PinnedSceneHandle) => void
  /** The wake margin was crossed: start or stop per-frame work. */
  onAwake?: (awake: boolean, scene: PinnedSceneHandle) => void
  /** Once per build, at the warm margin: start fetching media. */
  onWarm?: (scene: PinnedSceneHandle) => void
  /** The range was re-measured: re-read any geometry you cache. */
  onMeasure?: (scene: PinnedSceneHandle) => void
  onRehydrate?: (state: SceneRehydrate, scene: PinnedSceneHandle) => void
  onAct?: (act: number, scene: PinnedSceneHandle) => void
  /** Runs at the start of every matchMedia build with its conditions; may return a cleanup for its revert. */
  onBuild?: (conditions: MotionConditions, scene: PinnedSceneHandle) => void | (() => void)
}

export interface PinnedSceneHandle {
  readonly root: HTMLElement
  readonly pin: HTMLElement | null
  /** The progress source (null while no build is live). */
  readonly trigger: ScrollTrigger | null
  readonly mode: SceneMode
  /** The active act, 0 without acts. */
  readonly act: number
  readonly awake: boolean
  readonly reduced: boolean
  /** Exact progress, 0..1: logic reads this, never a smoothed copy. */
  progress(): number
  rangePx(): number
  bounds(): SceneBounds
  /** Position across the band (scene.ts), 0..1. */
  band(): number
  onMode(listener: (mode: SceneMode) => void): () => void
  onProgress(listener: (p: number) => void): () => void
  /** Re-measure after changing the scene's content yourself. */
  refresh(): void
  /** Re-derive everything from scroll on the next frame. */
  rehydrate(reason?: string): void
  debug(): Record<string, unknown>
  destroy(): void
}

export function pinnedScene(root: HTMLElement, options: PinnedSceneOptions = {}): PinnedSceneHandle {
  setupGsap()
  const own = (el: Element) => el.closest('[data-scene-root]') === root
  const pin = Array.from(root.querySelectorAll<HTMLElement>('[data-scene-pin]')).find(own) ?? null
  const pinMode = options.pin ?? 'sticky'
  const pinValue = pin?.getAttribute('data-scene-pin') ?? null
  const holds: SceneHolds = {
    headHoldPx: options.headHoldPx ?? SCENE_HOLDS.headHoldPx,
    tailLeadPx: options.tailLeadPx ?? SCENE_HOLDS.tailLeadPx,
    hysteresisRatio: options.hysteresisRatio ?? SCENE_HOLDS.hysteresisRatio,
  }
  const warmMarginPx = options.warmMarginPx ?? SCENE_MARGINS.warmMarginPx
  const wakeMarginPx = options.wakeMarginPx ?? SCENE_MARGINS.wakeMarginPx
  const actHysteresis = options.actHysteresis ?? ACT_HYSTERESIS

  const gsapPin = pinMode === 'gsap' && !!pin
  const state = { p: 0, mode: 'head' as SceneMode, act: 0, awake: false, reduced: false, rangePx: 1 }
  let trigger: ScrollTrigger | null = null
  let acts: HTMLElement[] = []
  let rehydrateFrame = 0
  let revertedAt: number | null = null
  let destroyed = false
  const modeListeners = new Set<(mode: SceneMode) => void>()
  const progressListeners = new Set<(p: number) => void>()

  const bounds = () => sceneBounds(state.rangePx, holds)

  const handle: PinnedSceneHandle = {
    root,
    pin,
    get trigger() {
      return trigger
    },
    get mode() {
      return state.mode
    },
    get act() {
      return state.act
    },
    get awake() {
      return state.awake
    },
    get reduced() {
      return state.reduced
    },
    progress: () => state.p,
    rangePx: () => state.rangePx,
    bounds,
    band: () => (state.reduced ? 0 : bandProgress(state.p, bounds())),
    onMode(listener) {
      modeListeners.add(listener)
      return () => {
        modeListeners.delete(listener)
      }
    },
    onProgress(listener) {
      progressListeners.add(listener)
      return () => {
        progressListeners.delete(listener)
      }
    },
    refresh() {
      measure()
      trigger?.refresh()
      rehydrate('refresh')
    },
    rehydrate: (reason = 'manual') => rehydrate(reason),
    debug: () => ({ ...state, p: +state.p.toFixed(4), acts: acts.length, trigger: !!trigger, pin: pinMode }),
    destroy() {
      if (destroyed) return
      destroyed = true
      mm.revert()
      if (!gsapPin) trigger?.kill()
      trigger = null
      modeListeners.clear()
      progressListeners.clear()
      root.removeAttribute('data-scene-state')
      if (pin && gsapPin) {
        if (pinValue === null) pin.removeAttribute('data-scene-pin')
        else pin.setAttribute('data-scene-pin', pinValue)
      }
    },
  }

  function setMode(next: SceneMode) {
    if (next === state.mode) return
    state.mode = next
    root.setAttribute('data-scene-state', next)
    options.onMode?.(next, handle)
    modeListeners.forEach((listener) => listener(next))
  }

  /** `inert` on every act but the active one; none under reduced motion (all of them read in flow). */
  function writeActs(active: number | null) {
    acts.forEach((el, i) => {
      const inert = active !== null && i !== active
      if (el.inert !== inert) el.inert = inert
    })
  }

  function setAct(next: number) {
    if (next === state.act) return
    state.act = next
    writeActs(next)
    options.onAct?.(next, handle)
  }

  function wake(next: boolean) {
    if (state.awake === next) return
    state.awake = next
    options.onAwake?.(next, handle)
    if (next) rehydrate('wake')
  }

  function measure() {
    state.rangePx = rangeFromHeight(root.offsetHeight, window.innerHeight)
    acts = Array.from(root.querySelectorAll<HTMLElement>('[data-scene-act]')).filter(own)
    options.onMeasure?.(handle)
  }

  function onProgress(p: number) {
    state.p = p
    if (!state.reduced) {
      if (p > 0 && p < 1) wake(true)
      setMode(stepMode(state.mode, p, bounds()))
      if (acts.length) setAct(stepAct(state.act, p, acts.length, actHysteresis))
    }
    options.onProgress?.(p, handle)
    progressListeners.forEach((listener) => listener(p))
  }

  function rehydrate(reason: string) {
    if (destroyed) return
    cancelAnimationFrame(rehydrateFrame)
    rehydrateFrame = requestAnimationFrame(() => {
      rehydrateFrame = 0
      measure()
      // Fresh rect maths: a resume must not read a ScrollTrigger that hasn't refreshed yet (S5).
      const r = root.getBoundingClientRect()
      if (isNear(r.top, r.bottom, window.innerHeight, wakeMarginPx)) wake(true)
      const p = progressFromRect(r.top, r.height, window.innerHeight)
      state.p = p
      if (p > 0 && p < 1) wake(true)
      const at = sceneAt(p, state.rangePx, holds, state.reduced)
      state.act = state.reduced ? 0 : actFromProgress(p, acts.length)
      writeActs(state.reduced ? null : state.act)
      // Media first, then the mode: a controller given the new mode by the rehydrate snaps without a second handover.
      options.onRehydrate?.({ reason, p, ...at, awake: state.awake, reduced: state.reduced }, handle)
      setMode(at.mode)
    })
  }

  function createTrigger(pinned: boolean) {
    return ScrollTrigger.create({
      trigger: root,
      start: 'top top',
      end: 'bottom bottom',
      pin: pinned && pin ? pin : false,
      pinSpacing: false,
      refreshPriority: options.refreshPriority,
      onUpdate: (self) => onProgress(self.progress),
      onRefresh: (self) => {
        measure()
        onProgress(self.progress)
      },
    })
  }

  function build(conditions: MotionConditions) {
    state.reduced = conditions.reduce
    const cleanupBuild = options.onBuild?.(conditions, handle)
    measure()

    if (gsapPin) {
      // The pin goes under reduced motion, so this trigger is rebuilt with the conditions. A trigger created during a
      // matchMedia rebuild makes GSAP (3.15) drop the page's recorded scroll, and its refresh leaves the page at the
      // top: put the reader back once that refresh is done.
      trigger = createTrigger(!state.reduced)
      if (revertedAt !== null) {
        const y = revertedAt
        const restore = () => {
          ScrollTrigger.removeEventListener('refresh', restore)
          if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y)
        }
        ScrollTrigger.addEventListener('refresh', restore)
      }
    }

    // Deferred a frame: Safari can service `resize` with the new innerHeight while layout still holds the old
    // viewport units. Coalesced to one read per frame.
    let measureFrame = 0
    const scheduleMeasure = () => {
      cancelAnimationFrame(measureFrame)
      measureFrame = requestAnimationFrame(measure)
    }
    const resizeObserver = new ResizeObserver(scheduleMeasure)
    resizeObserver.observe(root)
    const unwatchLayout = watchLayout()

    const warm = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        warm.disconnect()
        options.onWarm?.(handle)
      },
      { rootMargin: `${warmMarginPx}px 0px` },
    )
    warm.observe(root)

    // Safari can report a stale `isIntersecting: false` around a resize for elements far taller than the viewport,
    // and an observer only fires on crossings: the resize path computes nearness from the rect instead.
    const awakeObserver = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        wake(entry.isIntersecting)
        if (entry.isIntersecting) measure()
      },
      { rootMargin: `${wakeMarginPx}px 0px` },
    )
    awakeObserver.observe(root)

    const onResize = () => {
      scheduleMeasure()
      const r = root.getBoundingClientRect()
      wake(isNear(r.top, r.bottom, window.innerHeight, wakeMarginPx))
      measure()
      rehydrate('resize')
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') rehydrate('visibility')
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) rehydrate('bfcache')
    }
    const onFocus = () => rehydrate('focus')
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('focus', onFocus)
    rehydrate('mount')

    // The matchMedia revert kills a trigger built here; this undoes everything else.
    return () => {
      revertedAt = window.scrollY
      cancelAnimationFrame(measureFrame)
      cancelAnimationFrame(rehydrateFrame)
      rehydrateFrame = 0
      resizeObserver.disconnect()
      unwatchLayout()
      warm.disconnect()
      awakeObserver.disconnect()
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('focus', onFocus)
      writeActs(null)
      wake(false)
      if (gsapPin) trigger = null
      if (typeof cleanupBuild === 'function') cleanupBuild()
    }
  }

  root.setAttribute('data-scene-state', state.mode)
  if (gsapPin) pin?.setAttribute('data-scene-pin', 'gsap')
  // Reduced motion rebuilds the scene live; the breakpoint doesn't (nothing in a scene depends on it, and the video's
  // tier has its own query), so resizing across it never rebuilds.
  const mm = gsap.matchMedia()
  mm.add(MOTION_CONDITIONS, (context) => build(context.conditions as MotionConditions))
  // Sticky mode: one trigger for the scene's life, created outside the build. Re-created in a rebuild, it would make
  // GSAP drop the page's scroll position (see build).
  if (!gsapPin) trigger = createTrigger(false)
  return handle
}

// ── ScrollTrigger freshness ─────────────────────────────────────────────
// A layout change above a range (an image without dimensions, a late font, an accordion) moves the range without a
// window resize, and ScrollTrigger keeps the old start and end until something refreshes it: 300 px stale in S5.
// One observer on <body> serves every scene; a burst of changes is one refresh, 150 ms after the last.

let layoutUsers = 0
let layoutObserver: ResizeObserver | null = null
let refreshTimer = 0

function watchLayout(): () => void {
  if (!layoutObserver) {
    let last = ''
    layoutObserver = new ResizeObserver(([entry]) => {
      if (!entry) return
      const size = `${Math.round(entry.contentRect.width)}x${Math.round(entry.contentRect.height)}`
      const first = last === ''
      if (size === last) return
      last = size
      if (first) return
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 150)
    })
    layoutObserver.observe(document.body)
  }
  layoutUsers++
  return () => {
    if (--layoutUsers > 0 || !layoutObserver) return
    layoutObserver.disconnect()
    layoutObserver = null
    window.clearTimeout(refreshTimer)
  }
}
