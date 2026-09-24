/**
 * The fluid units as numbers, for motion that needs a scaled DISTANCE: a
 * tween's x, a ScrollTrigger end, a parallax range, a canvas font size.
 *
 * A mirror of the `fluid-design` skill's `assets/runtime/fluid-units.js`,
 * kept here so this skill works alone. Without the fluid scale every unit
 * reads 1 (the `var(--fluid, 1px)` fallbacks), so distances are plain
 * reference px — correct at 1440×900 and unscaled elsewhere, never NaN.
 *
 * Why a probe and not getComputedStyle: `--fluid` is an unregistered custom
 * property, so getPropertyValue returns its formula text, not a number. A
 * hidden element sized `calc(1000 * var(--fluid))` lets layout resolve it.
 * One layout read per change: the cache is marked dirty on resize and a
 * ResizeObserver on the probes catches every other change (late stylesheet,
 * `--fluid-zoom`), notifying `onFluidChange` listeners.
 *
 * `references/fluid-interop.md` §3 has the GSAP and Motion recipes.
 */

/** 'chrome' is the v1 name for 'ui'; both resolve to the same measured value. */
export type FluidUnit = 'fluid' | 'display' | 'copy' | 'ui' | 'chrome'
export type FluidUnits = Readonly<Record<FluidUnit, number>>

type MeasuredUnit = 'fluid' | 'display' | 'copy' | 'ui'

const UNITS: MeasuredUnit[] = ['fluid', 'display', 'copy', 'ui']
const VARS: Record<MeasuredUnit, string> = {
  fluid: 'var(--fluid, 1px)',
  display: 'var(--fluid-display, var(--fluid, 1px))',
  copy: 'var(--fluid-copy, var(--fluid, 1px))',
  // Falls back to --fluid-chrome (v1 name, still emitted when a project's
  // fluid.config.json sets `aliases: true`) before the unscaled default.
  ui: 'var(--fluid-ui, var(--fluid-chrome, var(--fluid, 1px)))'
}
const ONE: Readonly<Record<MeasuredUnit, number>> = { fluid: 1, display: 1, copy: 1, ui: 1 }
/** v1 name for the ui unit. */
const ALIASES: Partial<Record<FluidUnit, MeasuredUnit>> = { chrome: 'ui' }

let probes: { root: HTMLElement; els: Record<MeasuredUnit, HTMLElement> } | null = null
let cache: Readonly<Record<MeasuredUnit, number>> | null = null
let dirty = true
let resizeWired = false
const listeners = new Set<(units: FluidUnits) => void>()

function ensureProbes() {
  if (probes && probes.root.isConnected) return probes
  const root = document.createElement('div')
  root.setAttribute('aria-hidden', 'true')
  root.setAttribute('data-fluid-probe', '')
  root.style.cssText =
    'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;contain:layout style'
  const els = {} as Record<MeasuredUnit, HTMLElement>
  for (const unit of UNITS) {
    const el = document.createElement('div')
    el.style.cssText = `position:absolute;left:0;top:0;height:0;width:calc(1000 * ${VARS[unit]})`
    root.appendChild(el)
    els[unit] = el
  }
  ;(document.body ?? document.documentElement).appendChild(root)
  probes = { root, els }
  dirty = true

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      const before = cache
      measure()
      if (!before || changed(before, cache!)) listeners.forEach((cb) => cb(withChrome(cache!)))
    })
    for (const unit of UNITS) ro.observe(els[unit])
  }
  if (!resizeWired) {
    resizeWired = true
    window.addEventListener('resize', () => {
      dirty = true
    })
  }
  return probes
}

function measure(): Readonly<Record<MeasuredUnit, number>> {
  const p = ensureProbes()
  const next = {} as Record<MeasuredUnit, number>
  for (const unit of UNITS) {
    const w = p.els[unit].getBoundingClientRect().width / 1000
    next[unit] = w > 0 && Number.isFinite(w) ? w : 1
  }
  cache = next
  dirty = false
  return cache
}

function changed(a: Readonly<Record<MeasuredUnit, number>>, b: Readonly<Record<MeasuredUnit, number>>) {
  return UNITS.some((u) => Math.abs(a[u] - b[u]) > 1e-6)
}

/** Adds the 'chrome' alias (same value as 'ui') for the public, FluidUnit-keyed shape. */
function withChrome(m: Readonly<Record<MeasuredUnit, number>>): FluidUnits {
  return { ...m, chrome: m.ui }
}

/** Every unit in CSS px per drawn px, plus the 'chrome' alias for 'ui'. All 1 on the server or without the scale. */
export function fluidUnits(): FluidUnits {
  if (typeof document === 'undefined') return withChrome(ONE)
  ensureProbes()
  return withChrome(dirty || !cache ? measure() : cache)
}

/** `n` drawn px on `unit` (default 'fluid'), in CSS px at the current viewport. `'chrome'` is an alias of `'ui'`. */
export function fluidPx(n = 1, unit: FluidUnit = 'fluid'): number {
  const key = ALIASES[unit] ?? (unit as MeasuredUnit)
  if (typeof document === 'undefined') return n * ONE[key]
  ensureProbes()
  const m = dirty || !cache ? measure() : cache
  return n * m[key]
}

/** Call `cb(units)` whenever any unit changes. Returns an unsubscribe function. */
export function onFluidChange(cb: (units: FluidUnits) => void): () => void {
  if (typeof document === 'undefined') return () => {}
  ensureProbes()
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
