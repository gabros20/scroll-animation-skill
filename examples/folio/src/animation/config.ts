/**
 * config.ts — the names and numbers every block reads. `scroll-animation add` copies it once to
 * src/animation/config.ts; change values HERE, never inside a block.
 *
 * On a scaled layout (fluid-design, or any layout that exposes a length-per-design-px custom
 * property), set SCALE, and take DESKTOP_QUERY from the layout's own breakpoint source so motion
 * and layout switch at the same width. On fluid-design:
 *
 *   export { DESKTOP_QUERY } from '../styles/fluid/fluid'   // fluid-design's generated fluid.ts
 *   export const SCALE = FLUID_DESIGN_SCALE
 *
 * and alias the header height once in CSS: `:root { --header-h: var(--fluid-header-h) }`.
 */

/** The desktop breakpoint as a media query. Keep one source: re-export it from your layout system if it has one. */
export const DESKTOP_QUERY = '(min-width: 1024px)'

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * The custom property holding the fixed header's resting height: anchor offsets, header-ink probes, sticky tops,
 * `scroll-padding-top` in css/animation.css. Keep the name; point it at your layout's value in CSS instead
 * (`:root { --header-h: 72px }`, or `var(--fluid-header-h)` on fluid-design), so CSS and code read one variable.
 */
export const HEADER_HEIGHT_VAR = '--header-h'

export type ScaleRole = 'layout' | 'display' | 'copy' | 'ui'

/**
 * A viewport-scaled layout, described by the custom properties that hold one design px as a CSS length.
 * `mirrors` (optional) name registered, NON-inherited per-scope copies of the units, so `scaledPx(n, role, el)`
 * can read the unit that applies inside a limited subtree without a probe.
 */
export interface ScaleConfig {
  units: Partial<Record<ScaleRole, string>>
  mirrors?: Partial<Record<ScaleRole, string>>
}

/** The preset for a project on fluid-design: its units and the per-scope mirrors its engine registers. */
export const FLUID_DESIGN_SCALE: ScaleConfig = {
  units: { layout: '--fluid', display: '--fluid-display', copy: '--fluid-copy', ui: '--fluid-ui' },
  mirrors: {
    layout: '--_fluid-m-fluid',
    display: '--_fluid-m-display',
    copy: '--_fluid-m-copy',
    ui: '--_fluid-m-ui',
  },
}

/** null: the layout is not scaled, so travel distances are plain CSS px. On fluid-design: FLUID_DESIGN_SCALE. */
export const SCALE: ScaleConfig | null = null

/**
 * IntersectionObserver rootMargins. A margin, never a fractional `amount`: a fraction of an element taller than
 * the viewport can never become visible, so the reveal would never fire.
 */
export const TRIGGERS = {
  /** Below-the-fold reveals fire when the element's top crosses 80% of the viewport height. */
  reveal: '0px 0px -20% 0px',
  /** The page's last group, or any group that comes to rest below the reveal line: an inset line would never be crossed. */
  pageEnd: '0px',
  atRest: '0px',
} as const

/**
 * Cubic-bezier control points, measured frame by frame against a reference capture (not chosen by eye).
 * GSAP registers them as CustomEases (gsap/setup.ts); Motion and CSS use the arrays or `cubicBezier()`.
 */
export const CURVES = {
  /** The entrance movement: a first-order exponential approach, no overshoot (29 samples, RMSE 0.0017). */
  entrance: [0.15, 0.6, 0.2, 1],
  /** A label roll (17 samples, RMS 0.48 px). */
  roll: [0, 0, 0.58, 1],
  /** A disclosure opening or closing: a strong ease-out that doesn't creep at the end. */
  disclosure: [0.23, 1, 0.32, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>

export type CurveName = keyof typeof CURVES

/** Seconds. The entrance fade deliberately trails the move: a line-by-line stagger is only visible because of it. */
export const MOTION = {
  entrance: { duration: 1.3, curve: 'entrance' },
  entranceFade: { duration: 0.17, delay: 0.13 },
  veil: { duration: 0.13, delay: 0.17 },
  roll: { duration: 0.3, curve: 'roll' },
  disclosure: { duration: 0.24, curve: 'disclosure' },
  lineStagger: 0.067,
} as const

/** `cubic-bezier(x1, y1, x2, y2)` for CSS from a named curve. */
export function cubicBezier(name: CurveName): string {
  return `cubic-bezier(${CURVES[name].join(', ')})`
}

/** Live, never cached: every manual writer re-reads it. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION_QUERY).matches
}

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches
}

/**
 * The pre-JS gate (css/animation.css): an inline <head> script sets `html[data-animation="on"]` before first paint,
 * so hidden entrance states apply only when JavaScript runs. Put this string in the document head (with your CSP
 * nonce), and `suppressHydrationWarning` on <html> in React, because the attribute is set before hydration.
 * The listener latches the CSS failsafe: if no engine marked itself ready within 4 s, the failsafe reveals
 * everything, and `data-animation-failsafe` keeps it revealed after the engine finally boots.
 */
export const GATE_SCRIPT =
  "document.documentElement.dataset.animation='on';" +
  "document.addEventListener('animationend',function(e){if(e.animationName.indexOf('animation-failsafe')===0)" +
  "document.documentElement.dataset.animationFailsafe=''},true)"

/** Every engine calls this once it can animate: it switches the failsafe off. */
export function markAnimationReady(): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.animationReady = ''
}

/** True when the failsafe already revealed the page: blocks then render their end state instead of animating in. */
export function failsafeFired(): boolean {
  return typeof document !== 'undefined' && 'animationFailsafe' in document.documentElement.dataset
}
