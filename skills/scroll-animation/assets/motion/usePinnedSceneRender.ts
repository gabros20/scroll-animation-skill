'use client'
/**
 * motion/usePinnedSceneRender.ts — render-bridge.ts for Motion (React) routes: a real-time canvas in a <PinnedScene>
 * (or usePinnedScene), fed by the scene and rendered on Motion's `frame.render` step.
 *
 *   const conductor = useMemo(() => createConductor({ chapters, damping }), [])        // the 3d skill's conductor
 *   const bridge = usePinnedSceneRender(conductor, { render: (ms) => advance(ms / 1000) })
 *   <PinnedScene onProgress={bridge.onProgress} onRehydrate={bridge.onRehydrate}
 *     pinned={<div data-scene-canvas><SceneCanvas frameloop="never">…<ConductorDriver …/></SceneCanvas></div>}>
 *
 * - One tick: the bridge's frame runs in Motion's `frame.render` step, after `useScroll` has read and written this
 *   frame's progress (and after Lenis, which motionDriver runs in `frame.setup`): 0 frames late, native or Lenis, in
 *   any mount order and after a reduced-motion round trip (Motion orders by step, not by registration). No rAF of its
 *   own: on a Motion page a separate rAF loop renders 1 frame late. The registration is keep-alive, so Motion's
 *   frameloop requests a frame for the bridge's whole life, at rest too: one call per frame that returns at once
 *   unless the scene is awake, the page visible and the bridge dirty (0 renders at rest).
 * - Reduced motion: mount the canvas only while motion is allowed (`useReducedMotionLive()`); the bridge holds, and
 *   the poster is the scene.
 * - The scene is the one the callbacks hand over (their second argument), so the hook takes no ref: until the scene
 *   has called one, the bridge is gated (asleep). Pass the two callbacks as they are; the hook keeps them stable.
 * - `render` and `hold` are read at call time (the latest props), without re-creating the bridge; a new `conductor`
 *   creates a new bridge, which asks the scene to rehydrate it.
 * - `requestRender()`: for a canvas that mounts after the bridge primed (a lazy three chunk on a slow connection, a
 *   remount): call it from an effect inside the canvas.
 * - Created in an effect and destroyed in its cleanup (unmount, Next's Activity hiding the route, StrictMode's double
 *   effects): the frame registration, the conductor listeners and the route refresh go with it. SSR-safe.
 */
import { cancelFrame, frame } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { createRenderBridge, type RenderBridge, type RenderBridgeOptions, type RenderConductor } from '../render-bridge'
import type { SceneRehydrate } from '../scene'
import type { PinnedSceneHandle } from './usePinnedScene'

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface PinnedSceneRenderState {
  /** PinnedScene's onProgress. Stable. */
  onProgress(p: number, scene: PinnedSceneHandle): void
  /** PinnedScene's onRehydrate. Stable. */
  onRehydrate(state: SceneRehydrate, scene: PinnedSceneHandle): void
  /** Render until the conductor ticks: a canvas that exists only now. Stable; a no-op before the bridge mounts. */
  requestRender(): void
}

export function usePinnedSceneRender(conductor: RenderConductor, options: RenderBridgeOptions): PinnedSceneRenderState {
  const latest = useRef(options)
  useIsomorphicLayoutEffect(() => {
    latest.current = options
  })
  const [link] = useState(createLink)

  useEffect(() => {
    const bridge = createRenderBridge(link.scene, conductor, {
      render: (ms) => latest.current.render(ms),
      get hold() {
        return latest.current.hold
      },
    })
    const detach = link.attach(bridge)
    const step = ({ timestamp }: { timestamp: number }) => bridge.frame(timestamp)
    frame.render(step, true)
    return () => {
      cancelFrame(step)
      detach()
      bridge.destroy()
    }
  }, [conductor, link])

  return link.state
}

/** The scene handle the callbacks last brought, and the bridge of the current effect. */
function createLink() {
  let handle: PinnedSceneHandle | null = null
  let bridge: RenderBridge | null = null
  const state: PinnedSceneRenderState = {
    onProgress(p, scene) {
      handle = scene
      bridge?.onProgress(p)
    },
    onRehydrate(rehydrate, scene) {
      handle = scene
      bridge?.onRehydrate(rehydrate)
    },
    requestRender() {
      bridge?.requestRender()
    },
  }
  return {
    state,
    scene: {
      awake: () => handle?.awake() ?? false,
      reduced: () => handle?.reduced() ?? false,
      rehydrate: (reason?: string) => handle?.rehydrate(reason),
    },
    attach(next: RenderBridge) {
      bridge = next
      // A bridge created after the scene's mount rehydrate (a new conductor) takes the scene's state now.
      handle?.rehydrate('render')
      return () => {
        if (bridge === next) bridge = null
      }
    },
  }
}
