'use client'
/**
 * motion/ScrubVideo.tsx — a scrubbed video on a pinned scene, for Motion (React) routes: PinnedScene + the video
 * controller (media/video-controller.ts) + the camera and backdrop (media/camera.ts).
 *
 *   <ScrubVideo
 *     src="/media/orbit-1920.mp4" mobileSrc="/media/orbit-960.mp4" poster="/media/orbit-poster.avif"
 *     fps={30} headLoop={{ fromFrame: 32, matchFrame: 80 }} tailLoop={{ fromFrame: 192 }}
 *   >
 *     <section className="h-svh">…copy riding over the render…</section>
 *     <section data-scene-spacer className="h-[200svh]" />
 *     <section className="h-svh">…</section>
 *   </ScrubVideo>
 *
 * - The clip must be ALL-INTRA (`scroll-animation media scrub`), cut at your own measured loop seams. Omit
 *   `headLoop`/`tailLoop` to hold the first and last frames instead of looping.
 * - The source is set on the client, a frame after mount: the server renders the poster alone, and only the picked
 *   tier (`mobileSrc` below config.ts DESKTOP_QUERY, and at every width under Save-Data) is ever fetched, from the
 *   scene's warm margin on. Save-Data is followed live where `navigator.connection` fires `change` (Chromium).
 * - A head or tail loop runs at most `loopSeconds` (5, WCAG 2.2.2) per visit to its region, then holds a frame of it.
 * - `camera` pans and zooms a subject across the band; omit it for a plain covering frame. Its `frameSize` is CSS
 *   (a scoped rule on the desktop query), so the first paint is sized for the tier the browser is actually in; once
 *   the source is picked, the size follows the source's tier (Save-Data can put the mobile crop on a desktop).
 * - `backdrop` paints a gradient behind the video that follows the playhead: a backstop for the paint before the
 *   camera's first frame. Sample your own clip's top and bottom edges.
 * - Reduced motion (live) fetches no video: the poster, in the head shot, is the scene, and css/scene.css releases
 *   the pin. Lifted mid-visit, the source loads and the scene runs from where the reader is.
 * - `?motion-debug` (or `html[data-motion-debug]`) exposes `window.__scrub()`: which layer of a frozen scene died.
 */
import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type Ref,
} from 'react'

import { DESKTOP_QUERY } from '../config'
import {
  cameraTier,
  createBackdropWriter,
  createCameraWriter,
  frameCamera,
  frameSizeCss,
  measureFrame,
  type BackdropStop,
  type BackdropWriter,
  type CameraConfig,
  type CameraWriter,
  type FrameGeometry,
  type MediaTier,
} from '../media/camera'
import {
  createVideoController,
  exposeDebug,
  type HeadLoop,
  type TailLoop,
  type VideoController,
} from '../media/video-controller'
import { PinnedScene, type PinnedSceneHandle, type PinnedSceneProps } from './PinnedScene'

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface ScrubVideoProps extends Omit<PinnedSceneProps, 'ref'> {
  ref?: Ref<ScrubVideoHandle>
  /** All-intra H.264 (the desktop tier, cut to `camera.desktop.crop` if there is a camera). */
  src: string
  /** The narrow tier, cut from the same canvas. */
  mobileSrc?: string
  poster?: string
  /** Matches `mobileSrc`'s aspect. */
  mobilePoster?: string
  /** The clip's frame rate, exactly. Default 30. */
  fps?: number
  headLoop?: HeadLoop
  tailLoop?: TailLoop
  /** Glide rate per 60 Hz frame for the handovers. Default 0.18. */
  glide?: number
  /** Seconds a head or tail loop may run per visit to its region. Default 5 (WCAG 2.2.2). */
  loopSeconds?: number
  camera?: CameraConfig
  backdrop?: BackdropStop[]
  /** Classes on the <video>. Not a size: with a camera, the camera owns it. */
  videoClassName?: string
  /** More of the pin, above the video: stacked `data-scene-act` captions, say. */
  pinned?: ReactNode
  children?: ReactNode
}

export interface ScrubVideoHandle {
  scene: PinnedSceneHandle | null
  video: HTMLVideoElement | null
  debug(): Record<string, unknown>
}

export function ScrubVideo({
  ref,
  src,
  mobileSrc,
  poster,
  mobilePoster,
  fps = 30,
  headLoop,
  tailLoop,
  glide,
  loopSeconds,
  camera,
  backdrop,
  videoClassName,
  pinned,
  onProgress,
  onMode,
  onAwake,
  onWarm,
  onMeasure,
  onRehydrate,
  children,
  ...sceneProps
}: ScrubVideoProps) {
  const sceneRef = useRef<PinnedSceneHandle>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<VideoController | null>(null)
  const cameraRef = useRef<CameraWriter | null>(null)
  const backdropRef = useRef<BackdropWriter | null>(null)
  const geometry = useRef<FrameGeometry>({ pw: 0, ph: 0, bw: 0, bh: 0 })

  // The latest camera and caller events, for handlers that must not re-create the controller.
  const latest = useRef({ camera, onProgress, onMode, onAwake, onWarm, onMeasure, onRehydrate })
  useIsomorphicLayoutEffect(() => {
    latest.current = { camera, onProgress, onMode, onAwake, onWarm, onMeasure, onRehydrate }
  })

  /** The camera from scroll and geometry only; the head shot under reduced motion. */
  const frame = (scene: PinnedSceneHandle, remeasure = false) => {
    const config = latest.current.camera
    const video = videoRef.current
    if (!config || !video || !scene.pin || !cameraRef.current) return
    if (remeasure) geometry.current = measureFrame(scene.pin, video)
    const tier = cameraTier(config, controllerRef.current?.tier() ?? 'desktop')
    cameraRef.current.write(frameCamera(geometry.current, tier, scene.reduced() ? 0 : scene.band()))
  }

  /** The frame size of the tier on screen, inline over the scoped rule, which only knows the viewport. */
  const sizeFrame = (tier: MediaTier) => {
    const config = latest.current.camera
    const video = videoRef.current
    if (!video) return
    const size = config ? cameraTier(config, tier).frameSize : null
    if (size) {
      video.style.setProperty('--scene-frame-w', `${size.w}svh`)
      video.style.setProperty('--scene-frame-h', `${size.h}svh`)
    } else {
      video.style.removeProperty('--scene-frame-w')
      video.style.removeProperty('--scene-frame-h')
    }
  }

  const headFrom = headLoop?.fromFrame
  const headMatch = headLoop?.matchFrame
  const tailFrom = tailLoop?.fromFrame
  useIsomorphicLayoutEffect(() => {
    const video = videoRef.current
    if (!video) return
    cameraRef.current = createCameraWriter(video)
    const controller = createVideoController(video, {
      fps,
      glide,
      loopSeconds,
      headLoop: headFrom === undefined || headMatch === undefined ? null : { fromFrame: headFrom, matchFrame: headMatch },
      tailLoop: tailFrom === undefined ? null : { fromFrame: tailFrom },
      src,
      mobileSrc,
      poster,
      mobilePoster,
      onRehydrate: () => sceneRef.current?.rehydrate('metadata'),
      onPlayhead: (band) => backdropRef.current?.paint(band),
      onTier: (tier) => {
        sizeFrame(tier)
        if (sceneRef.current) frame(sceneRef.current, true)
      },
    })
    controllerRef.current = controller
    // The scene may already be running (a config change): take its state now, and snap on its next frame.
    const scene = sceneRef.current
    if (scene) {
      controller.setReduced(scene.reduced())
      scene.rehydrate('config')
    }
    const hideDebug = exposeDebug(() => {
      const s = sceneRef.current
      return {
        scene: s ? { mode: s.mode(), p: +s.progress().toFixed(4), awake: s.awake(), rangePx: s.rangePx() } : null,
        video: controller.debug(),
      }
    })
    return () => {
      hideDebug()
      controller.destroy()
      controllerRef.current = null
      cameraRef.current?.reset()
      cameraRef.current = null
    }
  }, [src, mobileSrc, poster, mobilePoster, fps, glide, loopSeconds, headFrom, headMatch, tailFrom])

  useEffect(() => {
    const gutter = gutterRef.current
    backdropRef.current = gutter && backdrop?.length ? createBackdropWriter(gutter, backdrop) : null
    const scene = sceneRef.current
    if (scene) backdropRef.current?.paint(scene.band())
  }, [backdrop])

  useImperativeHandle(
    ref,
    () => ({
      get scene() {
        return sceneRef.current
      },
      get video() {
        return videoRef.current
      },
      debug: () => controllerRef.current?.debug() ?? {},
    }),
    [],
  )

  // Scoped to this instance: two scenes on a page never share a rule. useId's punctuation is stripped so the id also
  // survives being pasted into a class or id selector.
  const scopeId = useId().replace(/[^\w-]/g, '')
  const frameCss = camera ? frameSizeCss(`[data-scene-frame="${scopeId}"]`, camera, DESKTOP_QUERY) : ''

  return (
    <PinnedScene
      {...sceneProps}
      ref={sceneRef}
      pinned={
        <>
          {backdrop?.length ? <div ref={gutterRef} data-scene-gutter="" aria-hidden="true" /> : null}
          {frameCss ? <style dangerouslySetInnerHTML={{ __html: frameCss }} /> : null}
          <video
            ref={videoRef}
            data-scene-media=""
            data-scene-frame={frameCss ? scopeId : undefined}
            poster={poster}
            muted
            playsInline
            preload="none"
            disablePictureInPicture
            disableRemotePlayback
            aria-hidden="true"
            className={videoClassName}
          />
          {pinned}
        </>
      }
      onProgress={(p, scene) => {
        controllerRef.current?.setBand(scene.band())
        frame(scene)
        latest.current.onProgress?.(p, scene)
      }}
      onMode={(mode, scene) => {
        controllerRef.current?.setMode(mode)
        latest.current.onMode?.(mode, scene)
      }}
      onAwake={(awake, scene) => {
        controllerRef.current?.setAwake(awake)
        latest.current.onAwake?.(awake, scene)
      }}
      onWarm={(scene) => {
        controllerRef.current?.warm()
        latest.current.onWarm?.(scene)
      }}
      onMeasure={(scene) => {
        frame(scene, true)
        latest.current.onMeasure?.(scene)
      }}
      onRehydrate={(state, scene) => {
        const controller = controllerRef.current
        controller?.setReduced(state.reduced)
        backdropRef.current?.paint(state.band)
        frame(scene)
        controller?.rehydrate(state)
        latest.current.onRehydrate?.(state, scene)
      }}
    >
      {children}
    </PinnedScene>
  )
}
