/**
 * motion/useReducedMotionLive.ts — `prefers-reduced-motion`, live, for React blocks.
 *
 * Motion 13.4's `useReducedMotion()` reads the setting once per mount (a `useState`, despite its docs), so a visitor who
 * switches it mid-visit keeps the old answer: a scene collapses in CSS while its JS still scrubs, a reveal keeps moving.
 * This subscribes to the same query css/animation.css and css/scene.css use (`REDUCED_MOTION_QUERY`), so the JS and
 * the CSS always agree. On the server it answers false; the CSS carries reduced motion until hydration.
 */
import { useSyncExternalStore } from 'react'

import { REDUCED_MOTION_QUERY } from '../config'

function subscribe(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
const read = () => window.matchMedia(REDUCED_MOTION_QUERY).matches
const readOnServer = () => false

export function useReducedMotionLive(): boolean {
  return useSyncExternalStore(subscribe, read, readOnServer)
}
