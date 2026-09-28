/**
 * pages/clocks.ts — the four clocks on `/`: a pinned scene (gsap/pinned-scene.ts) that ScrollTrigger pins, since
 * sticky never sticks inside ScrollSmoother's content, driving one paused section timeline with a named span per
 * clock: trigger, scroll, media, render.
 *
 * - The timeline follows the scene's exact progress, which is what `scrub: true` does. ScrollSmoother already smooths
 *   the scroll, so nothing smooths it a second time (invariant 3). A second ScrollTrigger with `scrub` would also be
 *   created inside the scene's matchMedia rebuild, where GSAP 3.15 drops the reader's scroll position.
 * - It is built per matchMedia build (onBuild), so reduced motion is live. Under `reduce` there is no timeline and the
 *   dial shows its resting state from CSS, every clock lit and full: the timeline's last frame, and what a reader
 *   without JavaScript sees.
 */
import { pinnedScene, type PinnedSceneHandle } from '../animation/gsap/pinned-scene'
import { gsap } from '../animation/gsap/setup'

/** The timeline's labels, one span each, in order. */
export const CLOCKS = ['trigger', 'scroll', 'media', 'render'] as const

export interface ClocksHandle extends PinnedSceneHandle {
  /** The section timeline: null under reduced motion. */
  timeline(): gsap.core.Timeline | null
}

export function clocksScene(root: HTMLElement): ClocksHandle {
  let timeline: gsap.core.Timeline | null = null
  const scene = pinnedScene(root, {
    pin: 'gsap',
    onBuild(conditions) {
      if (conditions.reduce) return
      timeline = clocksTimeline(root)
      return () => {
        timeline?.revert()
        timeline = null
      }
    },
    onProgress: (p) => timeline?.progress(p),
    onRehydrate: ({ p }) => timeline?.progress(p),
  })
  return Object.assign(scene, { timeline: () => timeline })
}

/** One span per clock: its row lights up and its meter fills, one after the other. Transform and opacity only. */
function clocksTimeline(root: HTMLElement): gsap.core.Timeline {
  const timeline = gsap.timeline({ paused: true, defaults: { ease: 'none' } })
  CLOCKS.forEach((clock, i) => {
    timeline.addLabel(clock, i)
    const row = root.querySelector<HTMLElement>(`[data-clock="${clock}"]`)
    const fill = row?.querySelector<HTMLElement>('[data-clock-fill]')
    if (!row || !fill) return
    timeline.fromTo(row, { opacity: 0.35 }, { opacity: 1, duration: 0.25 }, clock)
    timeline.fromTo(fill, { scaleX: 0 }, { scaleX: 1, duration: 1 }, clock)
  })
  return timeline
}
