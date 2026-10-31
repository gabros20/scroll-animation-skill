// Vendored by copy for spike S11 from ~/.claude/skills/3d/assets/web/conductor.ts on 2026-10-30 (unchanged below this line).
/**
 * conductor.ts: turns ONE scroll value into the state every part of a 3D scene reads.
 *
 * Owns: exact + smooth progress, chapter mapping, direction, reduced-motion flag, subscriptions.
 * Must not: read the DOM or scroll position in tick() (adapters feed setExact), own the pin or the
 * scroll authority (scroll-animation does), touch three or React, or smooth a value that Lenis /
 * ScrollSmoother already smoothed (use `damping: null` there).
 *
 * Contract: waypoints are chapters. `position` is a fractional chapter index (2.35 = 35% of the leg
 * from chapter 2 to 3). `weight` on chapter i is the share of scroll spent on the leg i -> i+1; the
 * last chapter's weight is unused. Logic reads `exact*`; visuals read `smooth*`.
 */

export interface Chapter {
  id: string
  /** Scroll share of the leg from this chapter to the next. Default 1. */
  weight?: number
}

export interface ConductorOptions {
  chapters: readonly Chapter[]
  /** Damping lambda for `smooth` (about 4.5-7). `null` = no smoothing (the authority already smooths). */
  damping?: number | null
  /** Largest dt one tick may integrate, seconds. Default 1/30. */
  maxDt?: number
  /** Fraction (0-0.45) of each leg spent resting at both ends, so beats dwell. Default 0.12. */
  dwell?: number
  /** Chapter-index hysteresis for the discrete `index`. Default 0.1. */
  hysteresis?: number
  reduced?: boolean
}

export interface ConductorState {
  /** Reproducible scroll progress 0..1. Logic, DOM state and analytics read this. */
  exact: number
  /** Damped progress 0..1. Visuals only; never a threshold. */
  smooth: number
  /** Fractional chapter index from `exact`, 0..N-1. */
  position: number
  /** Fractional chapter index from `smooth`, 0..N-1. */
  smoothPosition: number
  /** Active chapter (latched with hysteresis, from exact). */
  index: number
  /** Progress inside the current leg, 0..1, from exact. */
  localExact: number
  /** Progress inside the current leg, 0..1, from smooth. */
  localSmooth: number
  /** Last non-zero scroll direction: 1 forward, -1 backward, 0 not yet moved. */
  direction: -1 | 0 | 1
  reduced: boolean
  /** True when smooth has caught up with exact (an on-demand renderer can stop). */
  settled: boolean
}

export interface Segment {
  /** Leg start chapter index. */
  a: number
  /** Leg end chapter index (a + 1, or a when there is one chapter). */
  b: number
  /** Dwell-shaped leg progress 0..1: use for camera/world interpolation. */
  t: number
  /** Linear leg progress 0..1. */
  raw: number
}

/** What a scroll adapter needs. Adapters never see more of the conductor than this. */
export interface ConductorInput {
  setExact(progress: number): void
  /** Snap smooth to exact: call on mount, resume, bfcache restore, reload mid-page. */
  settle(): void
}

/** What every adapter returns. */
export interface ScrollAdapter {
  /** Re-measure geometry and re-derive progress from the DOM now. */
  refresh(): void
  destroy(): void
}

export type StateListener = (state: Readonly<ConductorState>) => void
export type ChapterListener = (index: number, previous: number, state: Readonly<ConductorState>) => void

export interface Conductor extends ConductorInput {
  readonly state: Readonly<ConductorState>
  readonly chapters: readonly Chapter[]
  /** Advance smooth by dt seconds. Call exactly once per frame, from the render clock. */
  tick(dt: number): Readonly<ConductorState>
  /** Leg + shaped t for a camera or world interpolation. Default source: smooth. */
  segment(source?: 'exact' | 'smooth'): Segment
  /** Exact progress at which chapter `index` is composed (for nav links and scroll-to). */
  progressAtChapter(index: number): number
  setReduced(reduced: boolean): void
  /** Called synchronously whenever exact changes (wake an on-demand renderer). */
  onInput(listener: StateListener): () => void
  /** Called after every tick. */
  subscribe(listener: StateListener): () => void
  /** Called once per chapter transition, not per frame. */
  onChapter(listener: ChapterListener): () => void
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Frame-rate independent exponential approach (same form as three's MathUtils.damp). */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt))
}

export function createConductor(options: ConductorOptions): Conductor {
  const chapters = options.chapters
  if (chapters.length === 0) throw new Error('createConductor: at least one chapter is required')
  const damping = options.damping === undefined ? 5.5 : options.damping
  const maxDt = options.maxDt ?? 1 / 30
  const dwell = Math.min(0.45, Math.max(0, options.dwell ?? 0.12))
  const hysteresis = Math.max(0, options.hysteresis ?? 0.1)

  const legs = Math.max(chapters.length - 1, 0)
  // bounds[k] = exact progress at which chapter k is composed; bounds[legs] = 1.
  const weights = chapters.slice(0, legs).map((c) => Math.max(c.weight ?? 1, 1e-6))
  const total = weights.reduce((sum, w) => sum + w, 0)
  const bounds: number[] = [0]
  let run = 0
  weights.forEach((w, i) => {
    run += w
    bounds.push(i === legs - 1 ? 1 : run / total)
  })
  const boundAt = (k: number): number => bounds[Math.min(Math.max(k, 0), bounds.length - 1)] ?? 1

  const toPosition = (p: number): number => {
    if (legs === 0) return 0
    const x = clamp01(p)
    let k = 0
    while (k < legs - 1 && x >= boundAt(k + 1)) k++
    const span = boundAt(k + 1) - boundAt(k)
    return k + (span > 0 ? (x - boundAt(k)) / span : 0)
  }

  const shape = (raw: number): number => {
    if (dwell === 0) return raw
    return clamp01((raw - dwell) / (1 - 2 * dwell))
  }

  const segmentAt = (position: number): Segment => {
    if (legs === 0) return { a: 0, b: 0, t: 0, raw: 0 }
    const a = Math.min(Math.floor(position), legs - 1)
    const raw = clamp01(position - a)
    return { a, b: a + 1, t: shape(raw), raw }
  }

  const state: ConductorState = {
    exact: 0,
    smooth: 0,
    position: 0,
    smoothPosition: 0,
    index: 0,
    localExact: 0,
    localSmooth: 0,
    direction: 0,
    reduced: options.reduced ?? false,
    settled: true,
  }

  const inputListeners = new Set<StateListener>()
  const tickListeners = new Set<StateListener>()
  const chapterListeners = new Set<ChapterListener>()

  const derive = (): void => {
    state.position = toPosition(state.exact)
    state.smoothPosition = toPosition(state.smooth)
    state.localExact = segmentAt(state.position).raw
    state.localSmooth = segmentAt(state.smoothPosition).raw
    if (legs === 0) state.localExact = state.localSmooth = state.exact
    state.settled = Math.abs(state.smooth - state.exact) < 1e-4
  }

  // Latch with hysteresis; loops so a jump crosses every boundary in one call.
  const latchIndex = (): void => {
    const prev = state.index
    let i = prev
    const last = chapters.length - 1
    while (i < last && state.position > i + 0.5 + hysteresis) i++
    while (i > 0 && state.position < i - 0.5 - hysteresis) i--
    if (i !== prev) {
      state.index = i
      chapterListeners.forEach((fn) => fn(i, prev, state))
    }
  }

  const follow = (): boolean => damping === null || state.reduced

  return {
    state,
    chapters,

    setExact(progress) {
      const next = clamp01(Number.isFinite(progress) ? progress : 0)
      if (next === state.exact) return
      if (next > state.exact) state.direction = 1
      else state.direction = -1
      state.exact = next
      if (follow()) state.smooth = next
      derive()
      latchIndex()
      inputListeners.forEach((fn) => fn(state))
    },

    settle() {
      state.smooth = state.exact
      derive()
      // Absolute re-derive (resume / reload): no hysteresis, no listeners per skipped chapter.
      const prev = state.index
      state.index = Math.min(chapters.length - 1, Math.round(state.position))
      if (state.index !== prev) chapterListeners.forEach((fn) => fn(state.index, prev, state))
    },

    tick(dt) {
      const step = Math.min(Math.max(dt, 0), maxDt)
      if (follow()) state.smooth = state.exact
      else state.smooth = damp(state.smooth, state.exact, damping as number, step)
      if (Math.abs(state.smooth - state.exact) < 1e-4) state.smooth = state.exact
      derive()
      tickListeners.forEach((fn) => fn(state))
      return state
    },

    segment(source = 'smooth') {
      return segmentAt(source === 'exact' ? state.position : state.smoothPosition)
    },

    progressAtChapter(index) {
      return boundAt(Math.round(index))
    },

    setReduced(reduced) {
      if (state.reduced === reduced) return
      state.reduced = reduced
      if (reduced) {
        // Settled alternate: land on the nearest composed chapter, not a mid-leg frame.
        const nearest = Math.round(state.position)
        state.exact = boundAt(nearest)
        state.smooth = state.exact
        derive()
        latchIndex()
      }
      inputListeners.forEach((fn) => fn(state))
    },

    onInput(listener) {
      inputListeners.add(listener)
      return () => inputListeners.delete(listener)
    },
    subscribe(listener) {
      tickListeners.add(listener)
      return () => tickListeners.delete(listener)
    },
    onChapter(listener) {
      chapterListeners.add(listener)
      return () => chapterListeners.delete(listener)
    },
  }
}

/**
 * Follow the live prefers-reduced-motion setting. Returns a stop function.
 * When it turns on, the conductor snaps to the nearest composed chapter and stops damping.
 * The DOM scroll position is untouched: pin collapse is the scroll authority's job.
 */
export function bindReducedMotion(conductor: Conductor): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined
  const query = window.matchMedia('(prefers-reduced-motion: reduce)')
  const apply = (): void => conductor.setReduced(query.matches)
  apply()
  query.addEventListener('change', apply)
  return () => query.removeEventListener('change', apply)
}

/**
 * Minimal render clock for non-React pages: one rAF loop that ticks the conductor, pauses while the
 * tab is hidden, and clamps dt. React Three Fiber and GSAP pages tick from their own loop instead
 * (see r3f/SceneCanvas.tsx `ConductorDriver`, adapters/gsap.ts `driveFromGsapTicker`): one clock only.
 */
export function startRafClock(conductor: Conductor, onFrame?: StateListener): () => void {
  let raf = 0
  let last = 0
  let stopped = false
  const frame = (now: number): void => {
    if (stopped) return
    const dt = last === 0 ? 0 : (now - last) / 1000
    last = now
    onFrame?.(conductor.tick(dt))
    raf = requestAnimationFrame(frame)
  }
  const onVisibility = (): void => {
    cancelAnimationFrame(raf)
    last = 0
    if (!document.hidden && !stopped) raf = requestAnimationFrame(frame)
  }
  document.addEventListener('visibilitychange', onVisibility)
  if (!document.hidden) raf = requestAnimationFrame(frame)
  return () => {
    stopped = true
    cancelAnimationFrame(raf)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

/**
 * Adapter helper (DOM, never called from tick): the pin is `100lvh`, so every adapter measures the
 * pinned travel as `wrapperHeight - lvh`. `innerHeight` and ScrollTrigger's `bottom bottom` track the
 * visual viewport instead and finish up to one iOS toolbar height after the pin releases.
 */
export interface LvhProbe {
  /** Current 100lvh in px (falls back to innerHeight where lvh is unsupported). */
  read(): number
  destroy(): void
}

export function createLvhProbe(): LvhProbe {
  const probe = document.createElement('div')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100lvh;visibility:hidden;pointer-events:none'
  document.body.appendChild(probe)
  return {
    read: () => probe.getBoundingClientRect().height || window.innerHeight,
    destroy: () => probe.remove(),
  }
}
