/**
 * gsap/scrub-video.ts — a scrubbed video on a pinned scene, for GSAP pages: `scrubVideo(root, options)` →
 * pinnedScene (gsap/pinned-scene.ts) + the video controller (media/video-controller.ts) + the camera and backdrop
 * (media/camera.ts).
 *
 *   <div data-scene-root>
 *     <div data-scene-pin>
 *       <div data-scene-gutter aria-hidden="true"></div>                        (optional: a backdrop ramp)
 *       <video data-scene-media muted playsinline preload="none" disablepictureinpicture disableremoteplayback
 *              aria-hidden="true" data-src="orbit-1920.mp4" data-mobile-src="orbit-960.mp4"
 *              poster="orbit.avif" data-mobile-poster="orbit-mobile.avif"></video>
 *     </div>
 *     <div data-scene-content>…acts…</div>
 *   </div>
 *
 *   scrubVideo(el, { fps: 30, headLoop: { fromFrame: 32, matchFrame: 80 }, tailLoop: { fromFrame: 192 } })
 *
 * - The clip must be ALL-INTRA (`scroll-animation media scrub`), cut at your own measured loop seams. Omit
 *   `headLoop`/`tailLoop` to hold the first and last frames instead of looping.
 * - Sources come from the options or the video's data-src/data-mobile-src/poster/data-mobile-poster. The source is
 *   set a frame after mount, only for the tier config.ts DESKTOP_QUERY picks, and the mobile one at every width under
 *   Save-Data (followed live where `navigator.connection` fires `change`: Chromium).
 * - A head or tail loop runs at most `loopSeconds` (5, WCAG 2.2.2) per visit to its region, then holds a frame of it.
 * - `camera` pans and zooms a subject across the band (frameSize becomes --scene-frame-w/h on the video, per tier);
 *   omit it for a plain covering frame. `backdrop` paints [data-scene-gutter] from the playhead.
 * - Reduced motion (live, through the scene's matchMedia build) fetches no video: the poster, in the head shot, is
 *   the scene. Lifted mid-visit, the source loads and the scene runs from where the reader is.
 */
import {
  cameraTier,
  createBackdropWriter,
  createCameraWriter,
  frameCamera,
  measureFrame,
  type BackdropStop,
  type CameraConfig,
  type FrameGeometry,
  type MediaTier,
} from '../media/camera'
import {
  createVideoController,
  exposeDebug,
  sourceTier,
  type HeadLoop,
  type TailLoop,
  type VideoController,
} from '../media/video-controller'
import { pinnedScene, type PinnedSceneHandle, type PinnedSceneOptions } from './pinned-scene'

export interface ScrubVideoOptions extends PinnedSceneOptions {
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
  /** Default: the video's data-src. */
  src?: string
  /** Default: the video's data-mobile-src. */
  mobileSrc?: string
  /** Default: the video's poster. */
  poster?: string
  /** Default: the video's data-mobile-poster. */
  mobilePoster?: string
}

export interface ScrubVideoHandle extends PinnedSceneHandle {
  readonly video: HTMLVideoElement
  readonly controller: VideoController
}

export function scrubVideo(root: HTMLElement, options: ScrubVideoOptions = {}): ScrubVideoHandle | null {
  const video = root.querySelector<HTMLVideoElement>('video[data-scene-media]') ?? root.querySelector('video')
  if (!video) return null
  const gutter = root.querySelector<HTMLElement>('[data-scene-gutter]')
  const { camera, backdrop } = options

  const cameraWriter = camera ? createCameraWriter(video) : null
  const backdropWriter = gutter && backdrop?.length ? createBackdropWriter(gutter, backdrop) : null
  let geometry: FrameGeometry = { pw: 0, ph: 0, bw: 0, bh: 0 }
  let scene: PinnedSceneHandle | null = null

  /** The camera from scroll and geometry only; the head shot under reduced motion. */
  const frame = (s: PinnedSceneHandle, remeasure = false) => {
    if (!camera || !cameraWriter || !s.pin) return
    if (remeasure) geometry = measureFrame(s.pin, video)
    const tier = cameraTier(camera, controller.tier() ?? 'desktop')
    cameraWriter.write(frameCamera(geometry, tier, s.reduced ? 0 : s.band()))
  }

  /** The base size per tier, as the custom properties css/scene.css reads. */
  const sizeFrame = (tier: MediaTier) => {
    const size = camera ? cameraTier(camera, tier).frameSize : null
    if (size) {
      video.style.setProperty('--scene-frame-w', `${size.w}svh`)
      video.style.setProperty('--scene-frame-h', `${size.h}svh`)
    } else {
      video.style.removeProperty('--scene-frame-w')
      video.style.removeProperty('--scene-frame-h')
    }
  }
  const sources = {
    src: options.src ?? video.dataset.src,
    mobileSrc: options.mobileSrc ?? video.dataset.mobileSrc,
    poster: options.poster ?? video.getAttribute('poster') ?? undefined,
    mobilePoster: options.mobilePoster ?? video.dataset.mobilePoster,
  }
  // The tier the controller is about to pick, so the first paint already has its size.
  sizeFrame(sourceTier(sources))

  const controller = createVideoController(video, {
    fps: options.fps,
    glide: options.glide,
    loopSeconds: options.loopSeconds,
    headLoop: options.headLoop ?? null,
    tailLoop: options.tailLoop ?? null,
    ...sources,
    onRehydrate: () => scene?.rehydrate('metadata'),
    onPlayhead: (band) => backdropWriter?.paint(band),
    onTier: (tier) => {
      sizeFrame(tier)
      if (scene) frame(scene, true)
    },
  })

  scene = pinnedScene(root, {
    ...options,
    onBuild(conditions, s) {
      controller.setReduced(conditions.reduce)
      return options.onBuild?.(conditions, s)
    },
    onProgress(p, s) {
      controller.setBand(s.band())
      frame(s)
      options.onProgress?.(p, s)
    },
    onMode(mode, s) {
      controller.setMode(mode)
      options.onMode?.(mode, s)
    },
    onAwake(awake, s) {
      controller.setAwake(awake)
      options.onAwake?.(awake, s)
    },
    onWarm(s) {
      controller.warm()
      options.onWarm?.(s)
    },
    onMeasure(s) {
      frame(s, true)
      options.onMeasure?.(s)
    },
    onRehydrate(state, s) {
      controller.setReduced(state.reduced)
      backdropWriter?.paint(state.band)
      frame(s)
      controller.rehydrate(state)
      options.onRehydrate?.(state, s)
    },
  })

  const sceneHandle = scene
  const hideDebug = exposeDebug(() => ({ scene: sceneHandle.debug(), video: controller.debug() }))
  const destroyScene = sceneHandle.destroy

  return Object.assign(sceneHandle, {
    video,
    controller,
    destroy() {
      hideDebug()
      destroyScene()
      controller.destroy()
      cameraWriter?.reset()
    },
  })
}
