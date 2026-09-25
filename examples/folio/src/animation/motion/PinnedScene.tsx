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
 * Progress advances 1/(N−1) per viewport of content, N being the content's height in viewports: three one-viewport
 * acts land at 0, ½ and 1, not thirds. The root carries data-scene-state="head|scrub|tail" (React state, set per
 * transition) and any other div props (id, aria-*, data-header-theme). `ref` gets the scene handle.
 */
import { useImperativeHandle, type ComponentPropsWithoutRef, type ReactNode, type Ref } from 'react'

import { usePinnedScene, type PinnedSceneEvents, type PinnedSceneHandle, type PinnedSceneOptions } from './usePinnedScene'

export interface PinnedSceneProps
  extends PinnedSceneOptions,
    Omit<ComponentPropsWithoutRef<'div'>, keyof PinnedSceneEvents | 'children'> {
  ref?: Ref<PinnedSceneHandle>
  /** What the pin holds. */
  pinned?: ReactNode
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
  const { rootRef, pinRef, mode, scene } = usePinnedScene({
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
    <div {...rest} ref={rootRef} data-scene-root="" data-scene-state={mode}>
      <div ref={pinRef} data-scene-pin="" className={pinClassName}>
        {pinned}
      </div>
      <div data-scene-content="" className={contentClassName}>
        {children}
      </div>
    </div>
  )
}

export type { PinnedSceneHandle, PinnedSceneOptions, PinnedSceneEvents }
