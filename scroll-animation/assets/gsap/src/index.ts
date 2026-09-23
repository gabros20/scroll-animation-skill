import { initCountUps, type CountUpOptions } from './countUp'
import { registerEases } from './eases'
import { initFadeOnExit } from './fadeOnExit'
import { initHeaderTheme, type HeaderThemeOptions } from './headerTheme'
import { initInViewLoopVideos } from './inViewLoopVideo'
import { initScrubStages, type ScrubStageOptions } from './scrubStage'
import { initPullToCentre } from './scrollPull'
import { initStages } from './stage'
import { initVeil } from './veil'

export interface FluidMotionOptions {
  countUp?: CountUpOptions
  /** Omit to skip header-theme wiring entirely (most pages have no fixed
   * header that needs an inverse ink). */
  headerTheme?: HeaderThemeOptions
  /** Per-`[data-scrub-stage]` configuration. Return `undefined` to skip a
   * given element (e.g. it isn't this page's scene). `references/performance.md`
   * §3 ("Only 1–3 scroll-driven scenes should intersect the viewport at
   * once") is why a page should carry AT MOST one scroll-driven scene —
   * this callback exists for the rare multi-scene page, not to encourage
   * one. */
  scrubStage?: (el: HTMLElement) => ScrubStageOptions | undefined
}

interface SubController {
  destroy(): void
  refresh?(): void
}

export interface FluidMotionController {
  /** Tear down every observer, listener and in-flight tween this call
   * created. Call before re-initialising over the same `root` (HMR does
   * this for you). */
  destroy(): void
  /**
   * Re-measure the pieces that cache geometry (`scrubStage`, `headerTheme`,
   * `fadeOnExit`) without tearing down stage entrance state. Cheap; call
   * after injecting content into `root` without a resize to react to.
   */
  refresh(): void
}

/** The instance mounted against a given root, so a second call on the same
 * root tears down the first — this is what makes `initFluidMotion` HMR-safe:
 * a module replacement re-running the init call cannot leak the previous
 * page's listeners. */
const instances = new WeakMap<ParentNode, FluidMotionController>()

/**
 * Wires every fluid-design motion primitive found under `root` (default:
 * the whole document). Idempotent per `root` — calling it again on the same
 * root tears down the previous instance first, which is what makes it safe
 * to call from a Vite/webpack HMR accept handler without accumulating
 * listeners across reloads.
 *
 * Order matters only in that `registerEases()` runs first — every other
 * module is independent and touches its own attribute selector.
 */
export function initFluidMotion(root: ParentNode = document, options: FluidMotionOptions = {}): FluidMotionController {
  instances.get(root)?.destroy()

  registerEases()

  const subControllers: SubController[] = [
    initStages(root),
    initVeil(root),
    initCountUps(root, options.countUp),
    initFadeOnExit(root),
    initPullToCentre(root),
    initScrubStages(root, options.scrubStage),
    initInViewLoopVideos(root)
  ]
  if (options.headerTheme) {
    subControllers.push(initHeaderTheme(root, options.headerTheme))
  }

  const controller: FluidMotionController = {
    destroy() {
      subControllers.forEach((c) => c.destroy())
      if (instances.get(root) === controller) instances.delete(root)
    },
    refresh() {
      subControllers.forEach((c) => c.refresh?.())
    }
  }

  instances.set(root, controller)
  return controller
}

export { ENGAGE_PX, ENGAGE_QUERY } from './config'
export { registerEases, EASE_NAMES, MOTION, TRIGGERS, SCROLL_SPRING, prefersReducedMotion } from './eases'
export { initStages, type StageController } from './stage'
export { initVeil, type VeilController } from './veil'
export { initCountUps, type CountUpOptions, type CountUpController } from './countUp'
export { initFadeOnExit, type FadeOnExitController } from './fadeOnExit'
export { initPullToCentre, createScrollPull, type ScrollPull, type ScrollPullOptions, type PullToCentreController } from './scrollPull'
export {
  initScrubStages,
  type ScrubStageOptions,
  type ScrubStageController,
  type ScrubStageTierGeometry,
  type ScrubStageShot,
  type ScrubStageCrop,
  type ScrubStageBackdropStop,
  type HeadLoopPoint,
  type LoopPoint
} from './scrubStage'
export { initHeaderTheme, type HeaderTheme, type HeaderThemeOptions, type HeaderThemeController } from './headerTheme'
export { initInViewLoopVideos, type InViewLoopVideoController } from './inViewLoopVideo'
export { createVideoController, type VideoController } from './videoController'
