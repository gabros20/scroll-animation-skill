/**
 * media/camera.ts — how a scene's media sits in its pin: the camera (a subject point placed on screen at a zoom,
 * panned across the band) and the backdrop ramp behind it. Pure maths plus two small writers, shared by ScrubVideo in
 * both engines and by any other pinned media (a frame sequence's canvas) later.
 *
 * The camera is a function of SCROLL AND GEOMETRY ONLY. It reads band progress, never the playhead: the render
 * animates its own subject, and the camera only places the frame. Cancelling the subject's own travel frame by frame
 * does not hold it still, it slides the whole backdrop the other way under static copy. It pans across the band, not
 * the whole range, so the shot lands when the scrub does and holds through the tail.
 *
 * Coverage is a closed form: placing subject point `s` (the crop's own 0..1 space) at pin fraction `a` needs `a / s` of
 * the pin to its left and `(1 − a) / (1 − s)` to its right, so the zoom is the design zoom raised to whatever keeps the
 * canvas edges off screen. The composition holds wherever there is room; only the scale gives way where there isn't.
 *
 * The writer composes one transform string (`translate3d(…) scale(…)`, origin top left, so x/y ARE the media's
 * top-left in the pin) and skips a write that would repeat the last one. Geometry is read once per resize, never per
 * frame: the pin is `lvh` and the media `svh`, and neither moves with the mobile toolbar.
 */
import { clamp01, lerp } from '../scene'

export type MediaTier = 'desktop' | 'mobile'

/** A crop of one shared master canvas, normalised to it (the ffmpeg `crop=w:h:x:y`, each over the canvas size). */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

/** A point in the MASTER canvas's normalised space (the space `crop` is in), not the crop's own. */
export interface CameraPoint {
  x: number
  y: number
}

/** Where the subject lands in the pin (`at`, normalised [x, y]) and the zoom on the base size, at one end of the pan. */
export interface CameraShot {
  zoom: number
  at: [number, number]
}

export interface CameraTier {
  /** Default: the whole canvas. */
  crop?: CropRect
  /** The subject at the band's start and end. Default: the canvas centre. */
  subject?: { head: CameraPoint; tail: CameraPoint }
  /** Default: the subject centred at zoom 1 at both ends. */
  shots?: { head: CameraShot; tail: CameraShot }
  /**
   * The media's base size as a multiple of the viewport height (`svh`): height-driven, because viewports vary far
   * more in aspect than in height. Default: the media fills the pin.
   */
  frameSize?: { w: number; h: number }
}

/** Per tier; `mobile` falls back to `desktop`. Every field defaults to the identity camera. */
export interface CameraConfig {
  desktop?: CameraTier
  mobile?: CameraTier
  /** The master canvas's px size. Informational: what raw crop and subject px are divided by. */
  canvas?: number
}

export interface ResolvedCameraTier {
  crop: CropRect
  subject: { head: CameraPoint; tail: CameraPoint }
  shots: { head: CameraShot; tail: CameraShot }
  frameSize: { w: number; h: number } | null
}

/** Pin and media box sizes, px. */
export interface FrameGeometry {
  pw: number
  ph: number
  bw: number
  bh: number
}

export interface CameraFrame {
  x: number
  y: number
  zoom: number
}

const CENTRE: CameraPoint = { x: 0.5, y: 0.5 }
const IDENTITY_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 }
const IDENTITY_SHOT: CameraShot = { zoom: 1, at: [0.5, 0.5] }

export function cameraTier(config: CameraConfig, tier: MediaTier): ResolvedCameraTier {
  const t = (tier === 'mobile' ? (config.mobile ?? config.desktop) : config.desktop) ?? {}
  return {
    crop: t.crop ?? IDENTITY_CROP,
    subject: t.subject ?? { head: CENTRE, tail: CENTRE },
    shots: t.shots ?? { head: IDENTITY_SHOT, tail: IDENTITY_SHOT },
    frameSize: t.frameSize ?? null,
  }
}

/** Keeps a subject on the crop's edge from dividing by zero. */
const inside = (v: number) => Math.min(1 - 1e-4, Math.max(1e-4, v))

/** The frame at band position `t` (0 head shot, 1 tail shot); null until the geometry is measured. */
export function frameCamera(geom: FrameGeometry, tier: ResolvedCameraTier, t: number): CameraFrame | null {
  const { pw, ph, bw, bh } = geom
  if (!pw || !ph || !bw || !bh) return null
  const k = clamp01(t)
  const { crop, subject, shots } = tier

  // The subject, from master-canvas space into the crop's own 0..1 space.
  const sx = inside((lerp(subject.head.x, subject.tail.x, k) - crop.x) / crop.w)
  const sy = inside((lerp(subject.head.y, subject.tail.y, k) - crop.y) / crop.h)
  const ax = lerp(shots.head.at[0], shots.tail.at[0], k)
  const ay = lerp(shots.head.at[1], shots.tail.at[1], k)

  const zoom = Math.max(
    lerp(shots.head.zoom, shots.tail.zoom, k),
    (pw * Math.max(ax / sx, (1 - ax) / (1 - sx))) / bw,
    (ph * Math.max(ay / sy, (1 - ay) / (1 - sy))) / bh,
  )
  return { x: ax * pw - sx * bw * zoom, y: ay * ph - sy * bh * zoom, zoom }
}

/** Whole px and a 4-decimal scale: sub-px translation is invisible and would make every frame a new string. */
export function cameraTransform(frame: CameraFrame): string {
  return `translate3d(${Math.round(frame.x)}px,${Math.round(frame.y)}px,0) scale(${frame.zoom.toFixed(4)})`
}

/** Layout reads: call on mount, resize and tier change, never per frame. */
export function measureFrame(pin: HTMLElement, media: HTMLElement): FrameGeometry {
  return { pw: pin.clientWidth, ph: pin.clientHeight, bw: media.offsetWidth, bh: media.offsetHeight }
}

export interface CameraWriter {
  write(frame: CameraFrame | null): void
  /** Forget the last write, so the next one lands even if it repeats it (after something else wrote the style). */
  reset(): void
}

export function createCameraWriter(media: HTMLElement): CameraWriter {
  let last = ''
  return {
    write(frame) {
      if (!frame) return
      const next = cameraTransform(frame)
      if (next === last) return
      last = next
      media.style.transform = next
    },
    reset() {
      last = ''
    },
  }
}

/**
 * The per-tier frame size as scoped CSS (`--scene-frame-w/h` in svh), switched by the desktop media query in the
 * same paint as everything else. A JS-picked size would render the first paint at the wrong tier. '' without sizes.
 */
export function frameSizeCss(selector: string, config: CameraConfig, desktopQuery: string): string {
  const desktop = cameraTier(config, 'desktop').frameSize
  const mobile = cameraTier(config, 'mobile').frameSize
  const rule = (size: { w: number; h: number }) => `${selector}{--scene-frame-w:${size.w}svh;--scene-frame-h:${size.h}svh}`
  let css = mobile ? rule(mobile) : ''
  if (desktop) css += `@media ${desktopQuery}{${rule(desktop)}}`
  return css
}

/** One stop of the backdrop ramp: its position across the band and the pin's top and bottom edge colours (#rrggbb). */
export interface BackdropStop {
  at: number
  top: string
  bottom: string
}

type Rgb = [number, number, number]
const toRgb = (hex: string): Rgb => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
]
const mix = (a: Rgb, b: Rgb, t: number) =>
  `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`

/** The ramp's two edge colours at band position `t`; null without stops. */
export function backdropAt(t: number, stops: readonly BackdropStop[]): { top: string; bottom: string } | null {
  const first = stops[0]
  if (!first) return null
  let i = 0
  while (i < stops.length - 2 && t > (stops[i + 1] ?? first).at) i++
  const a = stops[i] ?? first
  const b = stops[i + 1] ?? a
  const span = b.at - a.at
  const k = span <= 0 ? 0 : clamp01((t - a.at) / span)
  return { top: mix(toRgb(a.top), toRgb(b.top), k), bottom: mix(toRgb(a.bottom), toRgb(b.bottom), k) }
}

export interface BackdropWriter {
  paint(t: number): void
}

/**
 * Paints `--scene-g-top/-bottom` on the gutter (`[data-scene-gutter]` draws the gradient). A backstop only: with a
 * camera the media covers the pin from the first framing on. Quantised to 1/256, finer than 8-bit colour, so a
 * frame that would repeat the last two values writes nothing.
 */
export function createBackdropWriter(gutter: HTMLElement, stops: readonly BackdropStop[]): BackdropWriter {
  let painted = -1
  return {
    paint(t) {
      const step = Math.round(clamp01(t) * 256)
      if (step === painted) return
      const c = backdropAt(step / 256, stops)
      if (!c) return
      painted = step
      gutter.style.setProperty('--scene-g-top', c.top)
      gutter.style.setProperty('--scene-g-bottom', c.bottom)
    },
  }
}
