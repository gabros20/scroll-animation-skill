/**
 * gsap/setup.ts — register GSAP once, for every GSAP block.
 *
 * Call `setupGsap()` once, client-side, before any block runs (a vanilla entry, or a React client module imported by
 * the root layout). It is idempotent. Every GSAP plugin is free since 3.13 (gsap.com: "100% free"), so blocks import
 * the ones they need from `gsap/<Plugin>` and pass them here; no licence setup, no .npmrc token.
 *
 *   import { setupGsap } from './gsap/setup'
 *   import { SplitText } from 'gsap/SplitText'
 *   setupGsap({ plugins: [SplitText] })
 *
 * In React, register `useGSAP` too (`setupGsap({ plugins: [useGSAP] })`, `useGSAP` from '@gsap/react') and build
 * every block inside `useGSAP(() => …, { scope })`: it reverts tweens, ScrollTriggers and SplitText on unmount and on
 * hide under Next's Activity, and StrictMode's double effect no longer stacks duplicate triggers.
 */
import gsap from 'gsap'
import { CustomEase } from 'gsap/CustomEase'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

import { CURVES, DESKTOP_QUERY, REDUCED_MOTION_QUERY, markAnimationReady, type CurveName } from '../config'

/** The measured curves as CustomEase names: `ease: EASES.entrance`. */
export const EASES: Readonly<Record<CurveName, string>> = {
  entrance: 'anim-entrance',
  roll: 'anim-roll',
  disclosure: 'anim-disclosure',
}

/**
 * `gsap.matchMedia()` conditions every block shares. Build inside `mm.add(CONDITIONS, (ctx) => …)` and read
 * `ctx.conditions`: when a query stops matching (a resize past the breakpoint, the visitor turning reduced motion
 * on), GSAP reverts everything created inside and runs the function again. Don't nest `gsap.context()` in it.
 */
export const CONDITIONS = {
  desktop: DESKTOP_QUERY,
  mobile: `not all and ${DESKTOP_QUERY}`,
  reduce: REDUCED_MOTION_QUERY,
  motion: '(prefers-reduced-motion: no-preference)',
} as const

export type Conditions = { [K in keyof typeof CONDITIONS]: boolean }

let registered = false

export function setupGsap(options: { plugins?: object[] } = {}): typeof gsap {
  if (!registered) {
    registered = true
    gsap.registerPlugin(ScrollTrigger, CustomEase)
    for (const name of Object.keys(CURVES) as CurveName[]) {
      const [x1, y1, x2, y2] = CURVES[name]
      // A single cubic segment from (0,0) to (1,1) is exactly what CSS cubic-bezier() describes, and valid
      // CustomEase path syntax: the measured curve carries over with no refitting.
      CustomEase.create(EASES[name], `M0,0,C${x1},${y1},${x2},${y2},1,1`)
    }
    // An iOS toolbar show/hide fires `resize`; it is not a layout change. Without this, every pinned scene below the
    // first re-measures mid-scroll and visibly jumps. (normalizeScroll is a separate fix and never runs with Lenis.)
    ScrollTrigger.config({ ignoreMobileResize: true })
    markAnimationReady()
  }
  if (options.plugins?.length) gsap.registerPlugin(...options.plugins)
  return gsap
}

export { gsap, ScrollTrigger }
