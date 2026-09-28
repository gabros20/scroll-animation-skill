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
 * `gsap.matchMedia()` conditions for anything that creates ScrollTriggers: reduced motion only. Build inside
 * `mm.add(MOTION_CONDITIONS, (ctx) => …)` and read `ctx.conditions.reduce`: when the visitor turns reduced motion on
 * or off, GSAP reverts what was built and runs the function again. Don't nest `gsap.context()` in it.
 *
 * Never put the BREAKPOINT in the conditions of a build that creates ScrollTriggers. Measured with GSAP 3.15: when a
 * condition changes, the rebuilt trigger's own refresh zeroes the recorded scroll and the refresh that follows leaves
 * the page at scrollY 0 (Chromium, WebKit and Firefox), so rotating an iPad across the desktop breakpoint throws the
 * reader to the top. Branch on the breakpoint inside the build (`isDesktop()` from config, function-based values and
 * `invalidateOnRefresh`), or keep the trigger outside the matchMedia and swap only its tweens. A reduced-motion switch
 * rebuilds too: an entrance whose trigger must keep the reader's place (reveal, split-reveal) creates it outside.
 */
export const MOTION_CONDITIONS = {
  reduce: REDUCED_MOTION_QUERY,
  motion: '(prefers-reduced-motion: no-preference)',
} as const

/** Breakpoint conditions, for matchMedia builds that create NO ScrollTriggers (a tween set, a hover setup). */
export const CONDITIONS = {
  desktop: DESKTOP_QUERY,
  mobile: `not all and ${DESKTOP_QUERY}`,
  ...MOTION_CONDITIONS,
} as const

export type Conditions = { [K in keyof typeof CONDITIONS]: boolean }
export type MotionConditions = { [K in keyof typeof MOTION_CONDITIONS]: boolean }

/**
 * An IntersectionObserver rootMargin as ScrollTrigger positions, so a GSAP trigger fires on the same line as the
 * engine-free blocks: `start` where the element's top meets the bottom edge of the margin box, `end` where its bottom
 * leaves the top edge. TRIGGERS.reveal ('0px 0px -20% 0px') is start 'top 80%', end 'bottom top'.
 */
export function lineFromMargin(margin: string): { start: string; end: string } {
  const values = margin.trim().split(/\s+/)
  const top = values[0] ?? '0px'
  const bottom = values[2] ?? top
  return { start: `top ${edgeAt('bottom', bottom)}`, end: `bottom ${edgeAt('top', top)}` }
}

/** A viewport edge moved outward by a margin (the bottom edge down, the top edge up), as a ScrollTrigger position. */
function edgeAt(edge: 'top' | 'bottom', length: string): string {
  const match = /^(-?\d*\.?\d+)(px|%)?$/.exec(length)
  // Down the screen is positive.
  const offset = (match ? Number(match[1]) : 0) * (edge === 'bottom' ? 1 : -1)
  if (match?.[2] === '%') return `${(edge === 'bottom' ? 100 : 0) + offset}%`
  return offset === 0 ? edge : `${edge}${offset > 0 ? '+=' : '-='}${Math.abs(offset)}`
}

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
