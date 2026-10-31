/**
 * gsap/pinned-scene-render.ts — render-bridge.ts for GSAP pages: a real-time canvas in a pinnedScene(), fed by the
 * scene and rendered on `gsap.ticker`, last in each tick: after the authority's driver, whenever it was added.
 *
 *   const render = pinnedSceneRender(conductor, { render: (ms) => advance(ms / 1000) })
 *   const scene = pinnedScene(root, { onProgress: render.onProgress, onRehydrate: render.onRehydrate })
 *   …  render.destroy(); scene.destroy()
 *
 * - One tick, in order whatever the mount order: the ticker runs its callbacks in the order they were added, and
 *   Lenis's (gsapDriver) can come after this one: a layout's <SmoothScroll> starts in the parent's layout effect, after
 *   the page's `useGSAP`, and Lenis is re-created when reduced motion is turned off. So this one draws nothing in its
 *   place: each tick it appends the bridge's frame to the END of the ticker's list, which GSAP runs in the same pass
 *   (its loop reads the list's length as it goes: measured on 3.15.0, not documented), after every callback already there: Lenis has moved and
 *   ScrollTrigger has read the new position: 0 frames late under native scrolling, Lenis in any mount order and after
 *   a reduced-motion round trip, and ScrollSmoother (its update is GSAP's own root render, the ticker's first
 *   callback). Measured in tests/render-bridge.mjs. Never `prioritize` either callback.
 * - The scene is the one its callbacks hand over (their second argument): a GSAP scene takes its callbacks when it is
 *   created and has no rehydrate listener, so the bridge comes first and learns the handle from them. Until the scene
 *   has called one, the bridge is gated (asleep).
 * - `requestRender()`: for a canvas that mounts after the bridge primed (a lazy three chunk, a remount).
 * - Reduced motion: mount the canvas only while motion is allowed (motion/useReducedMotionLive in React); the bridge
 *   holds, and the poster is the scene.
 * - destroy() removes both ticker callbacks, the conductor listeners and the route refresh; idempotent. In React,
 *   call both inside one `useGSAP`/effect and destroy both in its cleanup; on a vanilla page, in the route's mount().
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
  // GSAP's ticker time is in seconds. `draw` runs once, at the end of the tick that queued it, and removes itself.
  const draw = (time: number) => {
    gsap.ticker.remove(draw)
    bridge.frame(time * 1000)
  }
  const tick = () => {
    gsap.ticker.add(draw)
  }
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
      gsap.ticker.remove(draw)
      bridge.destroy()
      handle = null
    },
  }
}
