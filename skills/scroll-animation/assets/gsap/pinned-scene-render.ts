/**
 * gsap/pinned-scene-render.ts — render-bridge.ts for GSAP pages: a real-time canvas in a pinnedScene(), fed by the
 * scene and rendered on `gsap.ticker`, after the authority's driver.
 *
 *   createSmoothScroll({ driver: gsapDriver(gsap, ScrollTrigger) })      // the authority FIRST (native: nothing to add)
 *   const render = pinnedSceneRender(conductor, { render: (ms) => advance(ms / 1000) })
 *   const scene = pinnedScene(root, { onProgress: render.onProgress, onRehydrate: render.onRehydrate })
 *   …  render.destroy(); scene.destroy()
 *
 * - One tick: the ticker runs its callbacks in the order they were added, so adding this after the authority's driver
 *   renders after Lenis has moved and ScrollTrigger has read the new position, in the same tick: 0 frames late under
 *   native scrolling and Lenis (spike S11). Create the authority first; never `prioritize` this callback.
 * - The scene is the one its callbacks hand over (their second argument): a GSAP scene takes its callbacks when it is
 *   created and has no rehydrate listener, so the bridge comes first and learns the handle from them. Until the scene
 *   has called one, the bridge is gated (asleep).
 * - `requestRender()`: for a canvas that mounts after the bridge primed (a lazy three chunk, a remount).
 * - destroy() removes the ticker callback, the conductor listeners and the route refresh; idempotent. In React, call
 *   both inside one `useGSAP`/effect and destroy both in its cleanup; on a vanilla page, in the route's mount().
 */
import { createRenderBridge, type RenderBridgeOptions, type RenderConductor } from '../render-bridge'
import type { SceneRehydrate } from '../scene'
import type { PinnedSceneHandle } from './pinned-scene'
import { gsap } from './setup'

export interface PinnedSceneRender {
  /** pinnedScene's onProgress. */
  onProgress(p: number, scene: PinnedSceneHandle): void
  /** pinnedScene's onRehydrate. */
  onRehydrate(state: SceneRehydrate, scene: PinnedSceneHandle): void
  /** Render until the conductor ticks: a canvas that exists only now. */
  requestRender(): void
  destroy(): void
}

export function pinnedSceneRender(conductor: RenderConductor, options: RenderBridgeOptions): PinnedSceneRender {
  let handle: PinnedSceneHandle | null = null
  const bridge = createRenderBridge(
    {
      awake: () => handle?.awake ?? false,
      reduced: () => handle?.reduced ?? false,
      rehydrate: (reason) => handle?.rehydrate(reason),
    },
    conductor,
    options,
  )
  // GSAP's ticker time is in seconds.
  const tick = (time: number) => bridge.frame(time * 1000)
  gsap.ticker.add(tick)
  let destroyed = false

  return {
    onProgress(p, scene) {
      handle = scene
      bridge.onProgress(p)
    },
    onRehydrate(state, scene) {
      handle = scene
      bridge.onRehydrate(state)
    },
    requestRender: () => bridge.requestRender(),
    destroy() {
      if (destroyed) return
      destroyed = true
      gsap.ticker.remove(tick)
      bridge.destroy()
      handle = null
    },
  }
}
