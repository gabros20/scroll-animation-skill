'use client'
/**
 * motion/PinnedScene.tsx — a pinned scene for Motion (React) routes: the range wrapper, the sticky pin, and the
 * content layer that rides over it (geometry in css/scene.css, behaviour in usePinnedScene.ts).
 *
 *   <PinnedScene
 *     pinned={<Stage />}                                   // the layer that stays: media, a canvas, stacked acts
 *     onProgress={(p, scene) => { fill.style.scale = `${scene.band()} 1` }}   // manual writes, never bound styles
 *   >
 *     <section className="h-svh">Act one</section>
 *     <section data-scene-spacer className="h-[200svh]" />   // an empty pacing act (collapses under reduced motion)
 *     <section className="h-svh">Act two</section>
 *   </PinnedScene>
 *
 * `pinned` can also be a function of the scene, { band, progress, mode, reduced }: `band` and `progress` are
 * MotionValues (exact, written by hand, never bound to a style), so media that scrubs takes the band directly:
 *
 *   <PinnedScene pinned={({ band }) => <FrameSequence manifest="/media/hero/manifest.json" progress={band} label="…" />}>
 *
 * Progress advances 1/(N−1) per viewport of content, N being the content's height in viewports: three one-viewport
 * acts land at 0, ½ and 1, not thirds. The root carries data-scene-state="head|scrub|tail" (written by the scene per
 * transition, never React state) and any other div props (id, aria-*, data-header-theme). `ref` gets the scene handle.
 */
import { useImperativeHandle, type ComponentPropsWithoutRef, type ReactNode, type Ref } from 'react'

import type { MotionValue } from 'motion/react'

import type { SceneMode } from '../scene'
import { usePinnedScene, type PinnedSceneEvents, type PinnedSceneHandle, type PinnedSceneOptions } from './usePinnedScene'

/** What a `pinned` render function receives. */
export interface PinnedSceneRender {
  /** Exact progress across the band, 0..1 (0 under reduced motion): what a frame sequence or a scrub follows. */
  band: MotionValue<number>
  /** Exact progress over the whole range, 0..1. */
  progress: MotionValue<number>
  mode: SceneMode
  reduced: boolean
}

export interface PinnedSceneProps
  extends PinnedSceneOptions,
    Omit<ComponentPropsWithoutRef<'div'>, keyof PinnedSceneEvents | 'children'> {
  ref?: Ref<PinnedSceneHandle>
  /** What the pin holds, or a function of the scene that returns it. */
  pinned?: ReactNode | ((scene: PinnedSceneRender) => ReactNode)
  pinClassName?: string
  contentClassName?: string
  /** The acts, riding over the pin in normal flow. */
  children?: ReactNode
}

export function PinnedScene({
  ref,
  pinned,
  pinClassName,
  contentClassName,
  children,
  headHoldPx,
  tailLeadPx,
  hysteresisRatio,
  warmMarginPx,
  wakeMarginPx,
  actHysteresis,
  onProgress,
  onMode,
  onAwake,
  onWarm,
  onMeasure,
  onRehydrate,
  onAct,
  ...rest
}: PinnedSceneProps) {
  const { rootRef, pinRef, progress, band, mode, reduced, scene } = usePinnedScene({
    headHoldPx,
    tailLeadPx,
    hysteresisRatio,
    warmMarginPx,
    wakeMarginPx,
    actHysteresis,
    onProgress,
    onMode,
    onAwake,
    onWarm,
    onMeasure,
    onRehydrate,
    onAct,
  })
  useImperativeHandle(ref, () => scene, [scene])

  return (
    <div {...rest} ref={rootRef} data-scene-root="">
      <div ref={pinRef} data-scene-pin="" className={pinClassName}>
        {typeof pinned === 'function' ? pinned({ band, progress, mode, reduced }) : pinned}
      </div>
      <div data-scene-content="" className={contentClassName}>
        {children}
      </div>
    </div>
  )
}

export type { PinnedSceneHandle, PinnedSceneOptions, PinnedSceneEvents }
