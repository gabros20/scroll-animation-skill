/**
 * scale.ts — design px to CSS px, for motion that needs a scaled DISTANCE on a viewport-scaled layout: a tween's
 * x, a ScrollTrigger end, a parallax range, a canvas font size.
 *
 * With `SCALE = null` in config.ts (a plain px layout) every function returns the number it was given, so blocks
 * call it unconditionally. With a scale (fluid-design's FLUID_DESIGN_SCALE, or your own), `scaledPx(600)` is 600
 * design px at the current viewport.
 *
 * Why a probe and not getComputedStyle: the units are unregistered custom properties, so getPropertyValue returns
 * their formula text, not a number. A hidden element sized `calc(1000 * var(--unit))` lets layout resolve it. One
 * layout read per change: the cache is marked dirty on resize, and a ResizeObserver on the probes catches every
 * other change (a late stylesheet, a zoom factor), notifying `onScaleChange` listeners.
 *
 * `el` reads the unit as it applies AT that element: inside a limited subtree (fluid-design's
 * `fluid-grow-until-*`, `fluid-off`, `fluid-scope`) the units differ from the page's. It walks up to the nearest
 * element carrying the registered mirror (one style read per ancestor): cache the result per frame, not per tick.
 *
 * Small entrance offsets (a 24 px rise) stay fixed px; only travel scales. references/scenes.md has the recipes.
 */
import { SCALE, type ScaleRole } from './config'

export type { ScaleRole }
export type ScaleUnits = Readonly<Record<ScaleRole, number>>

const ROLES: ScaleRole[] = ['layout', 'display', 'copy', 'ui']
const ONE: ScaleUnits = { layout: 1, display: 1, copy: 1, ui: 1 }

let probes: { root: HTMLElement; els: Record<ScaleRole, HTMLElement> } | null = null
let cache: ScaleUnits | null = null
let dirty = true
let resizeWired = false
const listeners = new Set<(units: ScaleUnits) => void>()

function unitExpr(role: ScaleRole): string {
  const units = SCALE?.units ?? {}
  const layout = units.layout ? `var(${units.layout}, 1px)` : '1px'
  const own = units[role]
  return own && role !== 'layout' ? `var(${own}, ${layout})` : layout
}

function ensureProbes() {
  if (probes && probes.root.isConnected) return probes
  const root = document.createElement('div')
  root.setAttribute('aria-hidden', 'true')
  root.setAttribute('data-scale-probe', '')
  root.style.cssText =
    'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;contain:layout style'
  const els = {} as Record<ScaleRole, HTMLElement>
  for (const role of ROLES) {
    const el = document.createElement('div')
    el.style.cssText = `position:absolute;left:0;top:0;height:0;width:calc(1000 * ${unitExpr(role)})`
    root.appendChild(el)
    els[role] = el
  }
  ;(document.body ?? document.documentElement).appendChild(root)
  probes = { root, els }
  dirty = true

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      const before = cache
      const after = measure()
      if (!before || changed(before, after)) listeners.forEach((cb) => cb(after))
    })
    for (const role of ROLES) ro.observe(els[role])
  }
  if (!resizeWired) {
    resizeWired = true
    window.addEventListener('resize', () => {
      dirty = true
    })
  }
  return probes
}

function measure(): ScaleUnits {
  const p = ensureProbes()
  const next = {} as Record<ScaleRole, number>
  for (const role of ROLES) {
    const w = p.els[role].getBoundingClientRect().width / 1000
    next[role] = w > 0 && Number.isFinite(w) ? w : 1
  }
  cache = next
  dirty = false
  return cache
}

function changed(a: ScaleUnits, b: ScaleUnits) {
  return ROLES.some((r) => Math.abs(a[r] - b[r]) > 1e-6)
}

/** CSS px per design px for every role. All 1 on the server or without a scale. */
export function scaleUnits(): ScaleUnits {
  if (!SCALE || typeof document === 'undefined') return ONE
  ensureProbes()
  return dirty || !cache ? measure() : cache
}

/** `n` design px on `role` (default 'layout'), in CSS px at the current viewport. */
export function scaledPx(n = 1, role: ScaleRole = 'layout', el?: Element): number {
  if (!SCALE || typeof document === 'undefined') return n
  const mirror = SCALE.mirrors?.[role]
  if (el && mirror && typeof getComputedStyle !== 'undefined') {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const v = parseFloat(getComputedStyle(e).getPropertyValue(mirror))
      if (v > 0 && Number.isFinite(v)) return (n * v) / 1000
    }
  }
  return n * scaleUnits()[role]
}

/** Call `cb(units)` whenever a unit changes. Returns an unsubscribe function. A no-op without a scale. */
export function onScaleChange(cb: (units: ScaleUnits) => void): () => void {
  if (!SCALE || typeof document === 'undefined') return () => {}
  ensureProbes()
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/**
 * A GSAP function-based value: `x: scaledValue(600)`. GSAP re-evaluates it on every ScrollTrigger refresh when the
 * trigger has `invalidateOnRefresh: true`, so the distance follows the scale; a plain number would freeze it at the
 * window the page loaded in.
 */
export function scaledValue(n: number, role: ScaleRole = 'layout', el?: Element): () => number {
  return () => scaledPx(n, role, el)
}

/** A ScrollTrigger `end` of `n` design px of scroll: `end: scaledEnd(1800)`. */
export function scaledEnd(n: number, role: ScaleRole = 'layout', el?: Element): () => string {
  return () => `+=${scaledPx(n, role, el)}`
}
