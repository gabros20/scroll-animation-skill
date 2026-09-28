/**
 * scene.ts — a pinned scene's maths: bounds, modes, the band and acts. Pure and DOM-free, so both adapters
 * (motion/usePinnedScene.ts, gsap/pinned-scene.ts) and the unit tests share one copy.
 *
 * A pinned scene is a range wrapper holding a sticky pin (css/scene.css). Progress `p` runs 0 → 1 while the wrapper
 * scrolls past, over `rangePx = wrapper height − viewport height`: the distance the pin travels. Two holds, set in px
 * of that range, split it into three modes:
 *
 *   p = 0    headExit                                   tailEnter        1
 *   |- head -|------------------ scrub -------------------|---- tail ----|
 *
 * - Px, not fractions: the same fraction is a different distance on every viewport height.
 * - Each hold is capped at a quarter of the range, so a bad range reading can't park the scene in `head` or eat the band.
 * - Enter and exit are different numbers (hysteresis, as a RATIO of the hold, never a second px constant that can be
 *   retuned into an invalid pair), so a scroll resting on a boundary or a jittery trackpad can't flap a mode.
 * - Modes read EXACT progress. A smoothed value settles across a threshold rather than landing on it.
 *
 * The band is the scrub span, [headExit, tailEnter] → 0..1. Media that scrubs maps the band, not raw progress, so
 * the holds own the ends and the two never fight over a frame.
 *
 * Acts: N acts of one viewport each put act i fully in view at p = i / (N − 1) (progress advances 1/(N−1) per
 * viewport), so the active act is the nearest one, switched with hysteresis like the modes.
 */

export type SceneMode = 'head' | 'scrub' | 'tail'

export interface SceneHolds {
  /** How far past the pin's start the head holds before the band begins, in px of range. */
  headHoldPx: number
  /** How early before the pin's end the band finishes and the tail holds, in px of range. */
  tailLeadPx: number
  /** Hysteresis as a fraction of each hold: the value that enters a mode is never the value that leaves it. */
  hysteresisRatio: number
}

/** Measured on the reference build: the head barely holds (scrub engages almost at once), the tail leads by 320 px. */
export const SCENE_HOLDS: SceneHolds = { headHoldPx: 12, tailLeadPx: 320, hysteresisRatio: 0.7 }

/** IntersectionObserver margins, px: start fetching media early, wake the per-frame loop late. */
export const SCENE_MARGINS = { warmMarginPx: 600, wakeMarginPx: 200 } as const

/** Act hysteresis, in acts: the active act changes this far past the midpoint between two acts. */
export const ACT_HYSTERESIS = 0.1

export interface SceneBounds {
  /** head → scrub once p passes it. */
  headExit: number
  /** scrub → head once p falls below it. */
  headEnter: number
  /** scrub → tail once p passes it. */
  tailEnter: number
  /** tail → scrub once p falls below it. */
  tailExit: number
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** The distance the pin travels: wrapper height minus the viewport, never below 1 px. */
export function rangeFromHeight(heightPx: number, viewportPx: number): number {
  return Math.max(1, heightPx - viewportPx)
}

/** Progress from the wrapper's rect: 0 above the range, 1 past it. The rect maths ScrollTrigger and useScroll match. */
export function progressFromRect(top: number, height: number, viewportPx: number): number {
  const total = height - viewportPx
  if (total <= 0) return 0
  return clamp01(-top / total)
}

/** Whether a rect lies within `marginPx` of the viewport: the wake test, computed instead of waited for. */
export function isNear(top: number, bottom: number, viewportPx: number, marginPx: number): boolean {
  return top < viewportPx + marginPx && bottom > -marginPx
}

export function sceneBounds(rangePx: number, holds: SceneHolds = SCENE_HOLDS): SceneBounds {
  const range = Math.max(1, rangePx)
  const headPx = Math.min(holds.headHoldPx, range * 0.25)
  const tailPx = Math.min(holds.tailLeadPx, range * 0.25)
  return {
    headExit: headPx / range,
    headEnter: (headPx - headPx * holds.hysteresisRatio) / range,
    tailEnter: 1 - tailPx / range,
    tailExit: 1 - (tailPx + tailPx * holds.hysteresisRatio) / range,
  }
}

/**
 * The live stepper: from `mode`, cross every boundary `p` has passed until the mode holds. A jump that lands inside
 * a hysteresis gap keeps the side it came from, as a slow scroll would; a jump from the head to the end lands in
 * `tail` on its one progress event. Bounded at three steps; ordered bounds settle within two.
 */
export function stepMode(mode: SceneMode, p: number, b: SceneBounds): SceneMode {
  let current = mode
  for (let i = 0; i < 3; i++) {
    let next = current
    if (current === 'head' && p > b.headExit) next = 'scrub'
    else if (current === 'scrub' && p < b.headEnter) next = 'head'
    else if (current === 'scrub' && p > b.tailEnter) next = 'tail'
    else if (current === 'tail' && p < b.tailExit) next = 'scrub'
    if (next === current) break
    current = next
  }
  return current
}

/** Absolute mode, for a cold start or resume only: live scroll goes through `stepMode`. */
export function modeFromProgress(p: number, b: SceneBounds): SceneMode {
  if (p <= b.headExit) return 'head'
  if (p >= b.tailEnter) return 'tail'
  return 'scrub'
}

/** Position across the band, 0 at headExit and 1 at tailEnter, clamped. */
export function bandProgress(p: number, b: SceneBounds): number {
  return clamp01((p - b.headExit) / Math.max(1e-6, b.tailEnter - b.headExit))
}

export interface SceneState {
  bounds: SceneBounds
  mode: SceneMode
  band: number
}

/** Everything a resume re-derives from progress alone. Reduced motion holds the head. */
export function sceneAt(p: number, rangePx: number, holds: SceneHolds, reduced = false): SceneState {
  const bounds = sceneBounds(rangePx, holds)
  const mode = reduced ? 'head' : modeFromProgress(p, bounds)
  return { bounds, mode, band: reduced ? 0 : bandProgress(p, bounds) }
}

/**
 * What both adapters hand `onRehydrate`: the scene re-derived from scroll after a mount, wake, resize, tab or
 * bfcache return, focus, reduced-motion change or media recovery. Scroll is the only durable truth.
 */
export interface SceneRehydrate extends SceneState {
  reason: string
  p: number
  awake: boolean
  reduced: boolean
}

/** Absolute act: the nearest of `count` evenly paced acts. */
export function actFromProgress(p: number, count: number): number {
  if (count <= 1) return 0
  return Math.min(count - 1, Math.max(0, Math.round(clamp01(p) * (count - 1))))
}

/** The live act stepper: leaves an act only once p is `hysteresis` acts past the midpoint to its neighbour. */
export function stepAct(act: number, p: number, count: number, hysteresis = ACT_HYSTERESIS): number {
  if (count <= 1) return 0
  const x = clamp01(p) * (count - 1)
  let current = Math.min(count - 1, Math.max(0, act))
  for (let i = 0; i < count; i++) {
    if (current < count - 1 && x > current + 0.5 + hysteresis) current++
    else if (current > 0 && x < current - 0.5 - hysteresis) current--
    else break
  }
  return current
}
