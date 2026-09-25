'use client'
/**
 * motion/usePinnedScene.ts — the pinned scene core for Motion (React) routes. PinnedScene.tsx renders the markup;
 * use the hook directly only for markup of your own (the same data-scene-* contract, css/scene.css).
 *
 * - Progress is Motion's `useScroll` on the RANGE WRAPPER (never the pin: a sticky element stops moving, so its own
 *   rect is no ruler), offset ['start start', 'end end']. It is read in `useMotionValueEvent` and every scroll-linked
 *   style is written by hand. Bound through `style`, Motion hands opacity, clipPath, filter, backgroundColor and
 *   transform to a native timeline whose keyframes stop at the input range, and past it the element drifts back to its
 *   first-render value (spike S3), pinned or not.
 * - The mode (head | scrub | tail, scene.ts) is React state, set per TRANSITION only, from exact progress. Every
 *   per-frame path writes refs and styles, never state.
 * - Acts: descendants marked `data-scene-act` (this scene's own) get `inert` unless active, per transition.
 * - Gating: a warm margin (media may start fetching) and a wake margin (per-frame work may run). Safari can report a
 *   stale `isIntersecting: false` around a resize for elements much taller than the viewport, so the resize path
 *   computes nearness from the rect, and any progress strictly between 0 and 1 proves the range straddles the view.
 * - Rehydrate: on mount, wake, resize, tab return, bfcache restore, focus and reduced-motion changes the scene
 *   re-derives mode, acts and band from scroll, coalesced to one frame, and hands the result to `onRehydrate`.
 * - Reduced motion (live, on config.ts REDUCED_MOTION_QUERY) holds the head; css/scene.css collapses the runway.
 * - Hide/show safe: everything is created in effects and torn down in their cleanup (Next's Activity hides routes).
 */
import { useMotionValueEvent, useScroll, type MotionValue } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'

import { REDUCED_MOTION_QUERY } from '../config'
import {
  ACT_HYSTERESIS,
  SCENE_HOLDS,
  SCENE_MARGINS,
  actFromProgress,
  bandProgress,
  clamp01,
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

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * Reduced motion, live: the same query css/scene.css collapses on, so the JS hold and the CSS collapse always agree.
 * Motion 13.4's useReducedMotion reads the setting once per mount (useState, despite its docs), so a visitor who
 * switches it mid-visit would get a collapsed runway over a still-scrubbing scene.
 */
function subscribeReduced(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
const readReduced = () => window.matchMedia(REDUCED_MOTION_QUERY).matches
const readReducedOnServer = () => false

export function useReducedMotionLive(): boolean {
  return useSyncExternalStore(subscribeReduced, readReduced, readReducedOnServer)
}

/** Module constant: a fresh array each render would resubscribe the scroll listener. */
const PIN_OFFSET = ['start start', 'end end'] as const satisfies [string, string]

export interface PinnedSceneHandle {
  readonly root: HTMLDivElement | null
  readonly pin: HTMLDivElement | null
  /** Exact progress, 0..1. Logic, latches and thresholds read this, never a smoothed copy. */
  progress(): number
  mode(): SceneMode
  /** The active act, 0 without acts. */
  act(): number
  awake(): boolean
  reduced(): boolean
  rangePx(): number
  bounds(): SceneBounds
  /** Position across the band (scene.ts), 0..1. */
  band(): number
  /** Re-derive everything from scroll on the next frame. */
  rehydrate(reason?: string): void
}

export interface PinnedSceneEvents {
  /** Every exact progress change: write scroll-linked styles here, by hand. */
  onProgress?: (p: number, scene: PinnedSceneHandle) => void
  onMode?: (mode: SceneMode, scene: PinnedSceneHandle) => void
  /** The wake margin was crossed: start or stop per-frame work. */
  onAwake?: (awake: boolean, scene: PinnedSceneHandle) => void
  /** Once, at the warm margin: start fetching media. */
  onWarm?: (scene: PinnedSceneHandle) => void
  /** The range was re-measured (mount, resize, wake): re-read any geometry you cache. */
  onMeasure?: (scene: PinnedSceneHandle) => void
  onRehydrate?: (state: SceneRehydrate, scene: PinnedSceneHandle) => void
  onAct?: (act: number, scene: PinnedSceneHandle) => void
}

export interface PinnedSceneOptions extends Partial<SceneHolds>, PinnedSceneEvents {
  warmMarginPx?: number
  wakeMarginPx?: number
  /** In acts. Default 0.1. */
  actHysteresis?: number
}

export interface PinnedSceneState {
  rootRef: RefObject<HTMLDivElement | null>
  pinRef: RefObject<HTMLDivElement | null>
  /** Exact scroll progress over the range. Read it in events; never bind it to `style`. */
  progress: MotionValue<number>
  mode: SceneMode
  reduced: boolean
  scene: PinnedSceneHandle
}

export function usePinnedScene(options: PinnedSceneOptions = {}): PinnedSceneState {
  const rootRef = useRef<HTMLDivElement>(null)
  const pinRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotionLive()
  const { scrollYProgress } = useScroll({ target: rootRef, offset: PIN_OFFSET })
  const [mode, setMode] = useState<SceneMode>('head')

  // The latest options for handlers that must not resubscribe; written in an effect, never during render.
  const opts = useRef(options)
  useIsomorphicLayoutEffect(() => {
    opts.current = options
  })

  const [core] = useState(() => createCore(rootRef, pinRef, scrollYProgress, setMode, opts))

  useIsomorphicLayoutEffect(() => core.setReduced(reduced), [core, reduced])
  useMotionValueEvent(scrollYProgress, 'change', core.onProgress)

  const warmMarginPx = options.warmMarginPx ?? SCENE_MARGINS.warmMarginPx
  const wakeMarginPx = options.wakeMarginPx ?? SCENE_MARGINS.wakeMarginPx
  useEffect(() => core.mount(warmMarginPx, wakeMarginPx), [core, warmMarginPx, wakeMarginPx])

  return { rootRef, pinRef, progress: scrollYProgress, mode, reduced, scene: core.handle }
}

function createCore(
  rootRef: RefObject<HTMLDivElement | null>,
  pinRef: RefObject<HTMLDivElement | null>,
  progress: MotionValue<number>,
  commitMode: (mode: SceneMode) => void,
  opts: RefObject<PinnedSceneOptions>,
) {
  const state = { p: 0, mode: 'head' as SceneMode, act: 0, awake: false, reduced: false, rangePx: 1, wakeMarginPx: 0 }
  let acts: HTMLElement[] = []
  let rehydrateFrame = 0

  const o = () => opts.current
  const holds = (): SceneHolds => ({
    headHoldPx: o().headHoldPx ?? SCENE_HOLDS.headHoldPx,
    tailLeadPx: o().tailLeadPx ?? SCENE_HOLDS.tailLeadPx,
    hysteresisRatio: o().hysteresisRatio ?? SCENE_HOLDS.hysteresisRatio,
  })
  const bounds = () => sceneBounds(state.rangePx, holds())

  const handle: PinnedSceneHandle = {
    get root() {
      return rootRef.current
    },
    get pin() {
      return pinRef.current
    },
    progress: () => state.p,
    mode: () => state.mode,
    act: () => state.act,
    awake: () => state.awake,
    reduced: () => state.reduced,
    rangePx: () => state.rangePx,
    bounds,
    band: () => (state.reduced ? 0 : bandProgress(state.p, bounds())),
    rehydrate: (reason = 'manual') => rehydrate(reason),
  }

  function setMode(next: SceneMode) {
    if (next === state.mode) return
    state.mode = next
    commitMode(next)
    o().onMode?.(next, handle)
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
    o().onAct?.(next, handle)
  }

  function wake(next: boolean) {
    if (state.awake === next) return
    state.awake = next
    o().onAwake?.(next, handle)
    if (next) rehydrate('wake')
  }

  function measure() {
    const root = rootRef.current
    if (!root) return
    state.rangePx = rangeFromHeight(root.offsetHeight, window.innerHeight)
    acts = Array.from(root.querySelectorAll<HTMLElement>('[data-scene-act]')).filter(
      (el) => el.closest('[data-scene-root]') === root,
    )
    o().onMeasure?.(handle)
  }

  function onProgress(p: number) {
    state.p = p
    if (!state.reduced) {
      if (p > 0 && p < 1) wake(true)
      setMode(stepMode(state.mode, p, bounds()))
      if (acts.length) setAct(stepAct(state.act, p, acts.length, o().actHysteresis ?? ACT_HYSTERESIS))
    }
    o().onProgress?.(p, handle)
  }

  function rehydrate(reason: string) {
    cancelAnimationFrame(rehydrateFrame)
    rehydrateFrame = requestAnimationFrame(() => {
      rehydrateFrame = 0
      const root = rootRef.current
      if (!root) return
      measure()
      // Fresh rect maths, not the last scroll event's value: a resume must not wait for one. Equal to useScroll's
      // progress at rest.
      const r = root.getBoundingClientRect()
      if (isNear(r.top, r.bottom, window.innerHeight, state.wakeMarginPx)) wake(true)
      const p = progressFromRect(r.top, r.height, window.innerHeight)
      state.p = p
      if (p > 0 && p < 1) wake(true)
      const at = sceneAt(p, state.rangePx, holds(), state.reduced)
      state.act = state.reduced ? 0 : actFromProgress(p, acts.length)
      writeActs(state.reduced ? null : state.act)
      // Media first, then the mode: a controller given the new mode by the rehydrate snaps without a second handover.
      o().onRehydrate?.({ reason, p, ...at, awake: state.awake, reduced: state.reduced }, handle)
      setMode(at.mode)
    })
  }

  function setReduced(next: boolean) {
    if (next === state.reduced) return
    state.reduced = next
    rehydrate('reduced-motion')
  }

  function mount(warmMarginPx: number, wakeMarginPx: number) {
    const root = rootRef.current
    if (!root) return
    state.wakeMarginPx = wakeMarginPx
    state.p = clamp01(progress.get())
    measure()

    // Deferred a frame: Safari can service `resize` with the new innerHeight while layout still holds the old
    // viewport units, which reads back as a range far shorter than it is. Coalesced to one read per frame.
    let measureFrame = 0
    const scheduleMeasure = () => {
      cancelAnimationFrame(measureFrame)
      measureFrame = requestAnimationFrame(measure)
    }
    const resizeObserver = new ResizeObserver(scheduleMeasure)
    resizeObserver.observe(root)

    const warm = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        warm.disconnect()
        o().onWarm?.(handle)
      },
      { rootMargin: `${warmMarginPx}px 0px` },
    )
    warm.observe(root)

    // Arriving is also when geometry is certainly settled: a resize while the scene was away is re-read here.
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

    return () => {
      cancelAnimationFrame(measureFrame)
      cancelAnimationFrame(rehydrateFrame)
      rehydrateFrame = 0
      resizeObserver.disconnect()
      warm.disconnect()
      awakeObserver.disconnect()
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('focus', onFocus)
      writeActs(null)
      wake(false)
    }
  }

  return { handle, onProgress, setReduced, mount }
}
