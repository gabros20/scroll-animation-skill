'use client'

import { useMotionValue, useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'

import { ENGAGE_BREAKPOINT_PX, ENGAGE_QUERY } from '../lib/constants'

/**
 * Ambient, module-scoped fallback for bundler-injected `process.env.NODE_ENV`
 * (webpack/Next/Vite all replace this expression with a string literal at
 * build time, whether or not `@types/node` is installed). Declared locally
 * so this file type-checks in ANY React + TypeScript project — a consuming
 * project that already has `@types/node`'s real `process` type simply shadows
 * this narrower one inside this module; nothing else is affected.
 */
declare const process: { env: { NODE_ENV?: string } } | undefined

/**
 * `__scrub()` (below) used to be gated on `NODE_ENV !== 'production'` alone,
 * which means it does not exist in a production build — the exact build a
 * `next start`/production verification pass runs against. That is fine for
 * screenshots, but a scripted sweep that wants ground truth (`targetTime`,
 * raw mode) had nothing to read and had to fall back to inferring state from
 * the DOM (`video[data-motion-state]`, `currentTime`) — workable, but a
 * strictly weaker signal than the probe itself. This opt-in escape hatch
 * keeps the probe OFF by default in production (it is not something to ship
 * live) while letting a verification run turn it on deliberately: append
 * `?fluid-debug` to the URL, or set `document.documentElement.dataset.
 * fluidDebug` before this component mounts (e.g. from a tiny inline script
 * in the document head, for a harness that cannot control the URL). See
 * `references/verification.md`.
 */
function isFluidDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false
  if (document.documentElement.dataset.fluidDebug !== undefined) return true
  try {
    return new URLSearchParams(window.location.search).has('fluid-debug')
  } catch {
    return false
  }
}

/**
 * A pinned background video that LOOPS at both ends and is SCRUBBED in between.
 *
 * Meant to be the ONE scroll-driven scene on a page. Everything else should
 * reveal on view (`Stage`), which is what keeps this affordable: at most one
 * scrubbed video is ever live, and its decoder sleeps the moment it leaves the
 * viewport.
 *
 * ## Three modes on one continuous render
 *
 * ```
 *   head          scrub                        tail
 *  32──79↺   80 ─────────────────── 193   193──282↺
 *  ↺ auto    ← driven by scroll →          ↺ auto
 * ```
 * (frame numbers above are the reference build's asset — yours will differ;
 * see `headLoop` / `tailLoop`.)
 *
 * The asset is ONE continuous animation. The loops are not separate clips —
 * they are sub-ranges whose endpoints happen to match, which is exactly why
 * the handover can be seamless: the frame after the head loop's last is the
 * scrub band's first frame, so leaving the loop means *continuing to play*
 * rather than cutting somewhere else.
 *
 * Verify seams against your own master before shipping (PSNR, higher is a
 * closer match — not taken on trust). On the reference build's asset:
 *
 * ```
 *   80 vs 32   54.98 dB   head seam     (79: 48.72, 81: 41.96 — a sharp peak)
 *  282 vs 193  50.27 dB   tail seam     (281: 47.03, 280: 44.71)
 *   32 vs 60   28.30 dB   the loop genuinely moves; it is not a still
 * ```
 *
 * ## Why the handover glides instead of cutting
 *
 * At the head loop point the render is moving FAST — on the reference asset,
 * the match frame against the next frame is only 27.8 dB. So a hard cut from
 * mid-loop to the scrub's start would pop badly.
 *
 * Instead the video time is its own exponential-approach value (`glide`). On
 * handover it is *jumped* to wherever the loop actually is and then eased
 * toward the scroll target, so the frames between are simply played — the
 * same frames, in the same order, that the loop was about to play anyway. The
 * reader sees the loop resolve into the transformation. Backwards works for
 * free: re-entering a loop resumes from wherever the scrub left it, and the
 * loop's own wrap point is a matched seam.
 *
 * ## Mode changes read the UNSPRUNG progress
 *
 * A smoothed value settles ACROSS a threshold rather than landing on it, so a
 * mode test fed from a spring flips head/scrub/head as it rings down. The
 * three boundaries use raw `scrollYProgress` and hysteresis — enter and exit
 * are different numbers, so incidental jitter can never flap a mode.
 *
 * ## The asset must be ALL-INTRA
 *
 * Scrubbing seeks on nearly every frame and a seek costs a decode from the
 * nearest keyframe. A normally-encoded clip (GOP 20-30) decodes up to a GOP's
 * worth of frames per seek. Re-encoded to every-frame-a-keyframe it is a
 * single decode per seek — and, counterintuitively, this usually comes out
 * SMALLER, because a long-GOP master aimed at playback is optimised for the
 * wrong thing here.
 *
 * ```bash
 * ffmpeg -i in.mp4 -c:v libx264 -preset slow -crf 22 \
 *   -x264-params "keyint=1:min-keyint=1:scenecut=0" \
 *   -pix_fmt yuv420p -movflags +faststart -an out.mp4
 * ```
 *
 * ## Scroll is durable truth; video time is derived
 *
 * After a long background the browser may freeze rAF, drop the media
 * pipeline, or leave `awake`/`currentTime` stale while the page scroll is
 * still correct. On resume we **rehydrate**: re-measure geometry, place mode
 * and target time from `scrollYProgress`, snap the playhead (no glide),
 * reframe the camera. Live head↔scrub handovers still glide. We never
 * force-scroll the user or reload the page. Triggers: `visibilitychange`,
 * `pageshow` (bfcache), window `focus` (coalesced), wake, mount, and media
 * recovery after a dead duration.
 */

/** A loop's start, and — for the head loop — the frame its cycle closes on. */
export interface ScrubLoopConfig {
  /**
   * First frame of the loop body — the frame AFTER the pixel match to the
   * loop's own last frame. Not the match frame itself: displaying the match
   * frame and then jumping to `fromFrame` shows the same pose twice, a
   * one-frame stutter. The last frame the loop DISPLAYS is `matchFrame - 1`
   * (head) or the clip's true last frame (tail).
   */
  fromFrame: number
  /**
   * Required for the head loop only. The frame where the cycle closes — same
   * pose as `fromFrame`, proven by a PSNR peak against it, but never itself
   * displayed (see `fromFrame`). The tail loop's match frame is always the
   * clip's own last frame, read from `video.duration` at runtime, so it has
   * no `matchFrame` field.
   */
  matchFrame?: number
}

/** Where the camera places the subject, and at what zoom, at one end of the pan. */
export interface CameraShot {
  /** Multiplies the base CSS size (`frameSize`). 1 = base size. */
  zoom: number
  /** Normalised [x, y] in [0, 1] — where in the PIN the subject should land. */
  at: [number, number]
}

export interface CameraTierShots {
  head: CameraShot
  tail: CameraShot
}

/** A crop rectangle, normalised to the master canvas (i.e. already divided by
 * canvas size — the literal ffmpeg `crop=w:h:x:y`, each term over the canvas
 * dimension). */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The point the camera aims at, in the MASTER CANVAS's own normalised
 * coordinates (0-1 across the full `canvas` square — the same space `crop`
 * is defined in) — NOT the crop's own local space. `applyFraming` computes
 * `(subject.x − crop.x) / crop.w`, which converts a master-space point INTO
 * the crop's local 0-1 space; feeding it an already-crop-local point
 * double-transforms it. A centred subject gives 0.5 either way, which is
 * why this only bites once the subject is off-centre — measure and write
 * pixel coordinates off the master canvas, then divide by `canvas` to get
 * here, exactly like `crop` itself.
 */
export interface SubjectPoint {
  x: number
  y: number
}

export interface SubjectTierPoints {
  head: SubjectPoint
  tail: SubjectPoint
}

/** The video element's base size, as a multiple of the pin's own height. */
export interface FrameSize {
  h: number
  w: number
}

/**
 * Placing a subject point at `shots[tier].{head,tail}.at` of the pin fixes
 * how much of the render must sit on each side of it, so `applyFraming` can
 * solve for the zoom that keeps the crop's edges off screen as a closed form
 * rather than a guess — see the component's internal `applyFraming` for the
 * derivation. Two tiers (desktop/mobile) because a portrait crop and a
 * landscape crop of the same master usually need different compositions, not
 * just different sizes.
 */
export interface CameraConfig {
  /**
   * The master render's own pixel size (it is assumed square, matching an
   * ALL-INTRA export cut wide enough that the camera never has to show a
   * canvas edge). Informational only — not read at runtime; it is what you
   * divide raw crop/subject pixel coordinates by to get the normalised
   * fractions below, so keep it beside them for whoever re-cuts the asset.
   */
  canvas: number
  /** The two crops of that one canvas — the ffmpeg `crop=w:h:x:y`, normalised. */
  crop: { desktop: CropRect; mobile: CropRect }
  /** The subject's position in the MASTER CANVAS's own normalised space
   * (see `SubjectPoint`), at both ends of the pan — the same space `crop`
   * is defined in, not `crop`'s own local space. */
  subject: { desktop: SubjectTierPoints; mobile: SubjectTierPoints }
  /** The two shots (head, tail) per tier; scroll interpolates between them. */
  shots: { desktop: CameraTierShots; mobile: CameraTierShots }
  /**
   * Base video size in `svh` (a multiple of the pin's own height).
   * Height-driven is what generalises: viewports vary far more in aspect than
   * in height, so a width-driven scale that reads correctly on a phone puts
   * the subject several times too large on a tablet. Derive this from where
   * the subject should read at its intended on-screen scale, not from the
   * crop's raw aspect ratio.
   */
  frameSize: { desktop: FrameSize; mobile: FrameSize }
}

export interface BackdropStop {
  /** Position along the scrub band: 0 = scrub start, 1 = scrub end. */
  at: number
  /** Top-edge colour at this stop, as a hex string. */
  t: string
  /** Bottom-edge colour at this stop, as a hex string. */
  b: string
}

/**
 * Default vertical backdrop ramp — measured on the reference build's asset by
 * sampling the top and bottom tenth of its desktop crop, averaged, at even
 * steps through the fall. Provide your own stops (sample your own asset the
 * same way) rather than relying on this matching an unrelated clip; it exists
 * as a working default and a template for the shape a ramp normally takes
 * (the render brightens briefly before darkening, then drops fast near the
 * end).
 */
const DEFAULT_BACKDROP_STOPS: BackdropStop[] = [
  { at: 0.0, t: '#959595', b: '#C6C6C6' },
  { at: 0.142, t: '#BCBCBC', b: '#CCCCCC' },
  { at: 0.283, t: '#B5B5B5', b: '#CDCDCD' },
  { at: 0.425, t: '#AAAAAA', b: '#BABABA' },
  { at: 0.566, t: '#BDBDBD', b: '#C5C5C5' },
  { at: 0.708, t: '#808080', b: '#828282' },
  { at: 0.779, t: '#454545', b: '#474747' },
  { at: 0.85, t: '#191919', b: '#1F1F1F' },
  { at: 1.0, t: '#0A0A0A', b: '#0B0B0B' }
]

type Rgb = [number, number, number]
const toRgb = (h: string): Rgb => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16)
]
const mix = (a: Rgb, b: Rgb, t: number) =>
  `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`

/**
 * ONLY A BACKSTOP, which is why it is one ramp and not a four-cornered
 * gutter. When a `camera` is supplied, `applyFraming`'s coverage clamp
 * guarantees the video covers the pin at every scroll position and every
 * viewport, so nothing of this layer is ever visible once framing has run —
 * it exists for the one paint between hydration and the first framing call,
 * where the alternative is the pin's raw background showing through.
 */
function backdropAt(t: number, stops: BackdropStop[]) {
  let i = 0
  while (i < stops.length - 2 && t > stops[i + 1].at) i++
  const a = stops[i]
  const b = stops[i + 1]
  const span = b.at - a.at
  const k = span <= 0 ? 0 : Math.min(1, Math.max(0, (t - a.at) / span))
  return { t: mix(toRgb(a.t), toRgb(b.t), k), b: mix(toRgb(a.b), toRgb(b.b), k) }
}

const BACKDROP_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  backgroundImage: 'linear-gradient(to bottom, var(--g-t), var(--g-b))'
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

type Mode = 'head' | 'scrub' | 'tail'
type Tier = 'desktop' | 'mobile'

type Bounds = {
  headExit: number
  headEnter: number
  tailEnter: number
  tailExit: number
}

/**
 * Mode / scrub boundaries from measured range height. Each end is capped at a
 * quarter of the runway so a bad range reading cannot pin the machine in
 * `head` forever or eat the entire scrub band at the tail.
 */
function boundsFromRangePx(
  rangePx: number,
  headHoldPx: number,
  tailLeadPx: number,
  hysteresisRatio: number
): Bounds {
  const range = Math.max(1, rangePx)
  const headPx = Math.min(headHoldPx, range * 0.25)
  const headGap = headPx * hysteresisRatio
  const tailPx = Math.min(tailLeadPx, range * 0.25)
  const tailGap = tailPx * hysteresisRatio
  return {
    headExit: headPx / range,
    headEnter: (headPx - headGap) / range,
    tailEnter: 1 - tailPx / range,
    tailExit: 1 - (tailPx + tailGap) / range
  }
}

/** The three anchor times derived from `fps`/`headLoop`/`tailLoop`, computed
 * once per config change. */
interface Timeline {
  /** Where the head loop's playhead sits while looping, seconds. */
  headLoopFrom: number
  /** Where the tail loop's playhead sits while looping, seconds. */
  tailLoopFrom: number
  /** Where the scrub band starts — the head loop's match frame, seconds. */
  scrubFrom: number
  /** Below this delta (seconds) the glide is done — stop seeking and rest. */
  glideRest: number
}

/**
 * Absolute mode from progress — cold start / resume only.
 * Live scroll still uses the edge + hysteresis stepper so boundaries do not flap.
 */
function modeFromProgress(p: number, b: Bounds): Mode {
  if (p <= b.headExit) return 'head'
  if (p >= b.tailEnter) return 'tail'
  return 'scrub'
}

/** Playhead seconds implied by scroll progress (snap target for rehydrate). */
function targetTimeFromProgress(p: number, b: Bounds, tl: Timeline): number {
  if (p <= b.headExit) return tl.headLoopFrom
  if (p >= b.tailEnter) return tl.tailLoopFrom
  const t = (p - b.headExit) / (b.tailEnter - b.headExit)
  return tl.scrubFrom + clamp01(t) * (tl.tailLoopFrom - tl.scrubFrom)
}

/**
 * Snap the decoder to `time`, then optionally play (loop modes).
 * Waits for `seeked` before play — Safari drops play() issued mid-seek.
 * Falls back after 150ms if seeked never fires (already-at-time, or dead media).
 */
function snapPlayhead(
  video: HTMLVideoElement,
  time: number,
  shouldPlay: boolean,
  fps: number,
  onPlay?: () => void,
  onReject?: () => void
) {
  const glideRest = 0.5 / fps
  video.pause()
  const finish = () => {
    if (!shouldPlay) return
    onPlay?.()
    void video.play().catch(() => {
      onReject?.()
    })
  }
  if (!Number.isFinite(video.duration) || video.duration === 0) {
    finish()
    return
  }
  const clamped = Math.min(Math.max(0, time), Math.max(0, video.duration - 1 / fps))
  if (Math.abs(video.currentTime - clamped) < glideRest) {
    finish()
    return
  }
  let settled = false
  const settle = () => {
    if (settled) return
    settled = true
    video.removeEventListener('seeked', settle)
    window.clearTimeout(fallback)
    finish()
  }
  const fallback = window.setTimeout(settle, 150)
  video.addEventListener('seeked', settle)
  try {
    video.currentTime = clamped
  } catch {
    settle()
  }
}

interface ScrubStageProps {
  children: ReactNode
  /** All-intra H.264, cut to `camera.crop.desktop` (if `camera` is supplied).
   * See the docblock — a normally-encoded clip will stutter under scrubbing. */
  src: string
  /**
   * The narrow tier, cut to `camera.crop.mobile` from the SAME canvas. Chosen
   * on the client, so neither is fetched twice. Both are framed by the
   * camera; the crops differ, the animation does not.
   */
  mobileSrc?: string
  poster?: string
  /** Matches `mobileSrc`'s aspect — a landscape poster in a portrait box is a
   * stretch. */
  mobilePoster?: string
  /**
   * Classes on the range wrapper (the `[data-scrub-stage]` div). This is the
   * ONLY prop forwarded to it — there is no `...rest` spread onto that
   * element, so an arbitrary `data-*` attribute cannot be set here. In
   * particular, a scene that should read as dark to the header
   * (`data-header-theme="dark"`) cannot be marked once on the range
   * wrapper; every act inside `children` — including an empty
   * `data-scrub-spacer` act — has to carry its own `data-header-theme` or
   * the header flips to light ink while scrolled over it.
   */
  className?: string
  /** Extra classes on the video box. NOT a width cap — when a `camera` is
   * supplied it owns the size, and clamping it would break the framing rather
   * than scale it. */
  videoClassName?: string

  /** Source frame rate. Default 30 — matches the reference build's asset. */
  fps?: number
  /** Head loop range, in frames at `fps`. Default `{ fromFrame: 32, matchFrame: 80 }`
   * — the reference build's measured values; re-measure for any other clip. */
  headLoop?: ScrubLoopConfig
  /** Tail loop start, in frames at `fps`. Default `{ fromFrame: 192 }`. */
  tailLoop?: { fromFrame: number }
  /** How far past pin-start the head loop holds before scrub begins, in CSS px
   * of pin range. Default 12 — near-zero, so scrub engages almost immediately. */
  headHoldPx?: number
  /** How early the scrub finishes and the tail loop engages, in CSS px of pin
   * range. Default 320 — enough that the final pose holds while trailing
   * copy is still on screen, capped inside `boundsFromRangePx` so a short
   * range cannot collapse the scrub band. */
  tailLeadPx?: number
  /** Hysteresis as a FRACTION of each end's lead — the value that enters a
   * mode is never the value that leaves it, so a stalled scroll or a jittery
   * trackpad on the boundary cannot flap a loop on and off. Default 0.7. */
  hysteresisRatio?: number
  /** IntersectionObserver root-margin px for starting the network fetch,
   * before the scene is near. Default 600. */
  warmMarginPx?: number
  /** IntersectionObserver root-margin px for waking the per-frame loop —
   * later than the warm margin, since this starts a running rAF/rVFC loop.
   * Default 200. */
  wakeMarginPx?: number
  /** Exponential approach rate for the head→scrub / scrub→tail handover.
   * Default 0.18 (~150ms to settle). */
  glide?: number
  /** Vertical backdrop ramp behind the video — a backstop only. Default: the
   * reference build's measured ramp (see `DEFAULT_BACKDROP_STOPS`); provide
   * your own, sampled from your own asset's edges. */
  backdropStops?: BackdropStop[]
  /**
   * The camera: places a subject point on screen at a given zoom,
   * interpolated across the scrub band. Omit it for a plain `object-cover`
   * frame — no pan, no zoom, just the loops and the scrub, covering the pin
   * at every viewport with whatever the crop naturally shows.
   */
  camera?: CameraConfig
}

export function ScrubStage({
  children,
  src,
  mobileSrc,
  poster,
  mobilePoster,
  className,
  videoClassName,
  fps = 30,
  headLoop = { fromFrame: 32, matchFrame: 80 },
  tailLoop = { fromFrame: 192 },
  headHoldPx = 12,
  tailLeadPx = 320,
  hysteresisRatio = 0.7,
  warmMarginPx = 600,
  wakeMarginPx = 200,
  glide = 0.18,
  backdropStops = DEFAULT_BACKDROP_STOPS,
  camera
}: ScrubStageProps) {
  const rangeRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()

  const TL: Timeline = useMemo(
    () => ({
      headLoopFrom: headLoop.fromFrame / fps,
      tailLoopFrom: tailLoop.fromFrame / fps,
      scrubFrom: (headLoop.matchFrame ?? headLoop.fromFrame) / fps,
      glideRest: 0.5 / fps
    }),
    [headLoop.fromFrame, headLoop.matchFrame, tailLoop.fromFrame, fps]
  )

  const WARM_MARGIN = `${warmMarginPx}px 0px`
  const WAKE_MARGIN = `${wakeMarginPx}px 0px`

  // Dev-only black box for the recurring "frozen scene" reports. Counters live
  // in a ref (never rendered); `window.__scrub()` snapshots them so ONE console
  // call from a frozen tab says which layer died: scroll events not arriving
  // (`changes` static), the machine asleep (`awake` false), the decoder refused
  // (`rejections`), or the loops idle (`ticks`/`vframes` static).
  const debugRef = useRef({
    changes: 0,
    p: -1,
    ticks: 0,
    vframes: 0,
    plays: 0,
    rejections: 0,
    recovers: 0,
    lastRehydrate: null as null | {
      reason: string
      p: number
      mode: Mode
      time: number
      awake: boolean
      duration: number | null
    }
  })
  /** Soft media recovery — at most one load() per bad-duration spell. */
  const mediaRecoveringRef = useRef(false)
  /** Coalesce visibility+focus+pageshow into one rehydrate per frame. */
  const rehydrateRafRef = useRef(0)

  // Resolved on the client so only one tier is ever fetched. `null` through SSR
  // and the first client render — the element carries no `src` and the poster
  // holds the frame, so there is nothing to mismatch at hydration.
  //
  // Assigned in a frame callback rather than synchronously in the effect: the
  // src must not be set during the same commit that hydrates the page, or the
  // browser starts negotiating a multi-MB video against a main thread that is
  // still busy. Deferring it is also what keeps this off React's
  // cascading-render path.
  //
  // The same query decides the TIER, because the two tiers are not crops of
  // one another when a camera is supplied — each is framed on its own. One
  // boolean, so the src and the framing can never disagree about which is on
  // screen. A ref beside the state for the scroll handlers, which must not
  // wait for a render to see the change.
  const [tier, setTier] = useState<Tier | null>(null)
  const desktopRef = useRef(true)
  useEffect(() => {
    const query = mobileSrc ? window.matchMedia(ENGAGE_QUERY) : null
    const pick = () => {
      desktopRef.current = !query || query.matches
      setTier(desktopRef.current ? 'desktop' : 'mobile')
    }
    const frame = requestAnimationFrame(pick)
    query?.addEventListener('change', pick)
    return () => {
      cancelAnimationFrame(frame)
      query?.removeEventListener('change', pick)
    }
  }, [mobileSrc])

  const resolved = tier === null ? null : tier === 'desktop' ? src : mobileSrc!
  const resolvedPoster = tier === 'mobile' ? (mobilePoster ?? poster) : poster

  const { scrollYProgress } = useScroll({ target: rangeRef, offset: PIN_OFFSET })

  // The scrollable distance, in px, so the tolerances above can be expressed in
  // px. This is what `useScroll` divides by to produce progress, so converting
  // through it is exact rather than approximate.
  //
  // A ref, not state: it is read inside scroll handlers, never rendered. Writing
  // it during measurement therefore costs no render.
  const rangePxRef = useRef(1)
  const measureRange = useCallback(() => {
    const el = rangeRef.current
    if (!el) return
    rangePxRef.current = Math.max(1, el.offsetHeight - window.innerHeight)
  }, [])

  useEffect(() => {
    const el = rangeRef.current
    if (!el) return
    measureRange()

    // Resize measurements are deferred a frame. Every child of the range is
    // sized in viewport units now, and Safari can service a `resize` event with
    // the new `innerHeight` while the layout still holds the old `svh` — which
    // reads back as a range far shorter than it really is. One rAF puts the
    // read after layout has settled. Coalesced, so a drag is one measurement
    // per frame rather than one per event.
    let raf = 0
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measureRange)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(el)
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [measureRange])

  /**
   * The four boundaries, resolved against the current geometry.
   * See `boundsFromRangePx` — tolerance capped so a bad range cannot lock head.
   */
  const bounds = useCallback(
    () => boundsFromRangePx(rangePxRef.current, headHoldPx, tailLeadPx, hysteresisRatio),
    [headHoldPx, tailLeadPx, hysteresisRatio]
  )

  // Whether the scene is close enough to be worth running at all. Gates the
  // decoder AND the rAF loop — see the two observers near the bottom.
  //
  // Because it gates both, a WRONGLY false value is a frozen scene: the video
  // is paused and the per-frame loop never starts, so the render sits on
  // whatever frame it reached and no scroll can move it. Measured in that
  // state on Safari on the reference build: `mode:"head", paused:true,
  // ready:4, travel:3222` — a fully loaded video, a healthy runway, and a
  // machine that had simply stopped.
  //
  // Safari can deliver a bogus `isIntersecting: false` around a window resize
  // for elements far taller than the viewport, and an IntersectionObserver only
  // fires on threshold CROSSINGS — so once the belief is wrong it stays wrong
  // until the reader scrolls clear of the scene and back. Hence the two repair
  // paths below; the ref is what lets them read the current value without
  // resubscribing anything.
  const [awake, setAwake] = useState(false)
  const awakeRef = useRef(false)
  const wake = useCallback((next: boolean) => {
    if (awakeRef.current === next) return
    awakeRef.current = next
    setAwake(next)
  }, [])

  // The mode is a MACHINE: discrete, low frequency, driven off the exact value.
  // `setState` per TRANSITION is fine — the ban is on setState per scroll frame.
  const modeRef = useRef<Mode>('head')
  const [mode, setMode] = useState<Mode>('head')

  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    debugRef.current.changes++
    debugRef.current.p = p

    // A progress strictly BETWEEN the ends is proof the range straddles the
    // viewport — it cannot be anywhere else and produce that number. So it is
    // also proof that a `false` here is stale, and it costs no layout read.
    if (p > 0 && p < 1) wake(true)

    const { headExit, headEnter, tailEnter, tailExit } = bounds()
    const current = modeRef.current
    let next = current
    if (current === 'head' && p > headExit) next = 'scrub'
    else if (current === 'scrub' && p < headEnter) next = 'head'
    else if (current === 'scrub' && p > tailEnter) next = 'tail'
    else if (current === 'tail' && p < tailExit) next = 'scrub'
    if (next !== current) {
      modeRef.current = next
      setMode(next)
    }
  })

  // Where the scrub band wants the playhead, in seconds. The band maps ONLY the
  // middle segment — the loops own the ends, so progress never targets a frame
  // inside them and the two can never fight over the playhead.
  //
  // It spans the same boundaries the modes use, so the frame the scrub wants at
  // handover is exactly the frame the loop was leaving. Hardcoding a different
  // band here would reintroduce the jump the glide exists to remove.
  // Written as custom properties rather than bound through `style`: a
  // scroll-linked value handed to Motion can be promoted to a native timeline
  // whose range disagrees with useScroll's JS math — see `FadeOnExit`, where
  // exactly that made a fade run backwards. Direct writes on one node instead.
  const paintedRef = useRef(-1)
  const paintBackdrop = useCallback(
    (t: number) => {
      const el = gutterRef.current
      if (!el) return
      // Quantised to ~1/256, which is finer than 8-bit colour can express, so a
      // frame that would paint the same two values costs nothing.
      const step = Math.round(t * 256)
      if (step === paintedRef.current) return
      paintedRef.current = step
      const c = backdropAt(t, backdropStops)
      el.style.setProperty('--g-t', c.t)
      el.style.setProperty('--g-b', c.b)
    },
    [backdropStops]
  )

  // The first paint has no scroll event to react to.
  useEffect(() => {
    paintBackdrop(0)
  }, [paintBackdrop])

  /**
   * The four numbers the camera needs from layout, cached.
   *
   * Read here rather than in `applyFraming` because that runs once per animation
   * frame while the scene is awake, and `offsetWidth`/`clientWidth` are layout
   * reads — four of them per frame, interleaved with the transform write on the
   * same node, is the classic forced-reflow shape. None of the four can change
   * without a resize: the pin is in `lvh` and the video in `svh`, and both of
   * those are defined to ignore the iOS toolbar.
   */
  const geomRef = useRef({ pw: 0, ph: 0, bw: 0, bh: 0 })
  const measureGeom = useCallback(() => {
    const video = videoRef.current
    const pin = video?.parentElement
    if (!video || !pin) return
    geomRef.current = {
      pw: pin.clientWidth,
      ph: pin.clientHeight,
      bw: video.offsetWidth,
      bh: video.offsetHeight
    }
  }, [])

  /**
   * The camera. Manual writes, like the backdrop and for the same reason: a
   * scroll-linked value handed to Motion can be promoted to a native timeline
   * whose range disagrees with useScroll's JS math.
   *
   * ## It is a function of SCROLL AND GEOMETRY ONLY
   *
   * Nothing here reads the playhead, and that is the whole design. The render
   * drives its own subject — whatever the animator built tumbles where it was
   * animated to tumble — and the camera's only job is to place the frame:
   * translate on both axes, and scale when coverage demands it.
   *
   * Resist the temptation to also CANCEL the subject's travel, following its
   * centroid frame by frame so it stays pinned to one spot. That is
   * over-engineering with a visible cost: cancelling the subject's motion does
   * not hold the subject still, it slides the entire backdrop the other way,
   * so the render wanders left and right under otherwise-static copy the
   * whole way down the scrub — worse than doing nothing, for more code.
   *
   * Because it does not read `currentTime`, this does not belong in the rAF
   * loop either — scroll, resize and tier changes are the only things that can
   * move it, and each of those already calls it.
   *
   * No `camera` prop means no framing at all: the video is a plain
   * `object-cover` box sized to the pin, and this function returns immediately.
   *
   * Nothing here touches layout. CSS/inline styles own the video's width and
   * height; this writes one composed transform string, and `origin-top-left`
   * on the element is what makes that maths trivial — the transform's x/y ARE
   * the element's top-left in the pin.
   */
  const framedRef = useRef('')
  const applyFraming = useCallback(() => {
    const video = videoRef.current
    if (!video || !camera) return
    const { pw, ph, bw, bh } = geomRef.current
    if (!pw || !ph || !bw || !bh) return

    const tierKey: Tier = desktopRef.current ? 'desktop' : 'mobile'
    const crop = camera.crop[tierKey]
    const shots = camera.shots[tierKey]
    const subject = camera.subject[tierKey]

    // Under reduced motion the camera holds the head shot, for the same reason
    // the playhead holds the head loop's frame: a scroll-linked pan and zoom
    // over a still is still a scroll-linked pan and zoom. `MotionConfig
    // reducedMotion` cannot reach this — it degrades Motion-driven animations,
    // and these are direct writes.
    //
    // Camera travels the SAME band as the scrub (headExit → tailEnter), not the
    // full 0→1 pin. Otherwise the playhead lands on the final pose at tailEnter
    // while the camera is still mid-pan until p=1 — the subject "lands late"
    // under whatever follows. Once tail starts, t stays 1 so the shot holds.
    let t = 0
    if (!reduced) {
      const p = clamp01(scrollYProgress.get())
      const { headExit, tailEnter } = boundsFromRangePx(
        rangePxRef.current,
        headHoldPx,
        tailLeadPx,
        hysteresisRatio
      )
      const span = Math.max(1e-6, tailEnter - headExit)
      t = clamp01((p - headExit) / span)
    }

    // Converts the subject from MASTER-canvas space (SubjectPoint's own
    // coordinate space) into the CROP's own normalised coordinates.
    const sx = (lerp(subject.head.x, subject.tail.x, t) - crop.x) / crop.w
    const sy = (lerp(subject.head.y, subject.tail.y, t) - crop.y) / crop.h

    const ax = lerp(shots.head.at[0], shots.tail.at[0], t)
    const ay = lerp(shots.head.at[1], shots.tail.at[1], t)

    /**
     * The zoom the composition asks for, raised to whatever keeps the canvas
     * edges off screen.
     *
     * Placing a subject point at `a` of the pin fixes how much render must sit
     * on each side of it, so coverage is a closed form rather than a guess:
     * the video must span `a/s` of the pin to the left of the subject and
     * `(1-a)/(1-s)` to the right, and the same in y. Taking the max of those
     * against the design zoom means the composition is honoured wherever there
     * is room and only the SCALE gives way where there is not — the subject
     * still lands exactly where the shot puts it.
     *
     * It only engages on very wide windows, where a height-driven render is
     * narrow relative to the viewport — this is the seam-down-each-side fix
     * traded for a bit more render.
     */
    const design = lerp(shots.head.zoom, shots.tail.zoom, t)
    const zoom = Math.max(
      design,
      (pw * Math.max(ax / sx, (1 - ax) / (1 - sx))) / bw,
      (ph * Math.max(ay / sy, (1 - ay) / (1 - sy))) / bh
    )

    const x = ax * pw - sx * bw * zoom
    const y = ay * ph - sy * bh * zoom

    const next = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0) scale(${zoom.toFixed(4)})`
    if (next === framedRef.current) return
    framedRef.current = next
    video.style.transform = next
  }, [camera, scrollYProgress, reduced, headHoldPx, tailLeadPx, hysteresisRatio])

  useMotionValueEvent(scrollYProgress, 'change', applyFraming)

  // Mount, tier flip and resize: the framing is a function of viewport geometry
  // as much as of scroll, and none of those three emit a scroll event.
  useEffect(() => {
    const remeasure = () => {
      measureGeom()
      applyFraming()
    }
    remeasure()
    window.addEventListener('resize', remeasure)
    return () => window.removeEventListener('resize', remeasure)
  }, [applyFraming, measureGeom, tier])

  const scrubTarget = useMotionValue(TL.scrubFrom)
  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    const { headExit, tailEnter } = bounds()
    const t = (p - headExit) / (tailEnter - headExit)
    const clamped = t < 0 ? 0 : t > 1 ? 1 : t
    scrubTarget.set(TL.scrubFrom + clamped * (TL.tailLoopFrom - TL.scrubFrom))
  })

  /**
   * Re-derive mode + playhead + camera from scroll. Scroll is durable; video
   * time is not. Snaps (no glide) — live handovers keep the exponential approach.
   *
   * Coalesced to one call per frame when visibility/focus/pageshow fire together.
   */
  const rehydrate = useCallback(
    (reason: string) => {
      if (rehydrateRafRef.current) cancelAnimationFrame(rehydrateRafRef.current)
      rehydrateRafRef.current = requestAnimationFrame(() => {
        rehydrateRafRef.current = 0

        measureRange()
        measureGeom()

        const range = rangeRef.current
        const video = videoRef.current
        if (range) {
          const r = range.getBoundingClientRect()
          const near = r.top < window.innerHeight + wakeMarginPx && r.bottom > -wakeMarginPx
          if (near) wake(true)
        }

        const p = clamp01(scrollYProgress.get())
        if (p > 0 && p < 1) wake(true)

        const b = boundsFromRangePx(rangePxRef.current, headHoldPx, tailLeadPx, hysteresisRatio)
        const nextMode = reduced ? 'head' : modeFromProgress(p, b)
        const time = reduced ? TL.headLoopFrom : targetTimeFromProgress(p, b, TL)

        if (modeRef.current !== nextMode) {
          modeRef.current = nextMode
          setMode(nextMode)
        }
        scrubTarget.set(
          nextMode === 'scrub' ? time : nextMode === 'head' ? TL.scrubFrom : TL.tailLoopFrom
        )

        // Backdrop from progress so paint is right before seek settles.
        const band =
          nextMode === 'head'
            ? 0
            : nextMode === 'tail'
              ? 1
              : (time - TL.scrubFrom) / (TL.tailLoopFrom - TL.scrubFrom)
        paintBackdrop(clamp01(band))
        applyFraming()

        const duration =
          video && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null

        debugRef.current.lastRehydrate = {
          reason,
          p: +p.toFixed(4),
          mode: nextMode,
          time: +time.toFixed(3),
          awake: awakeRef.current,
          duration
        }

        if (!video || !resolved) return

        // Media eviction: duration gone — soft load once, then rehydrate on metadata.
        if (duration === null) {
          if (!mediaRecoveringRef.current && resolved) {
            mediaRecoveringRef.current = true
            debugRef.current.recovers++
            video.preload = 'auto'
            const onMeta = () => {
              mediaRecoveringRef.current = false
              rehydrate('metadata')
            }
            video.addEventListener('loadedmetadata', onMeta, { once: true })
            try {
              video.load()
            } catch {
              mediaRecoveringRef.current = false
            }
          }
          return
        }

        mediaRecoveringRef.current = false

        if (!awakeRef.current && reason !== 'wake') {
          // Off-screen: do not spin the decoder; mode/framing already updated.
          video.pause()
          return
        }

        const shouldPlay = !reduced && nextMode !== 'scrub' && awakeRef.current
        snapPlayhead(
          video,
          time,
          shouldPlay,
          fps,
          () => {
            debugRef.current.plays++
          },
          () => {
            debugRef.current.rejections++
          }
        )
      })
    },
    [
      applyFraming,
      measureGeom,
      measureRange,
      paintBackdrop,
      reduced,
      resolved,
      scrubTarget,
      scrollYProgress,
      wake,
      fps,
      headHoldPx,
      tailLeadPx,
      hysteresisRatio,
      wakeMarginPx,
      TL
    ]
  )

  // Resume after tab sleep / bfcache / focus. APIs are universal (IE10+ for
  // visibilitychange; pageshow everywhere; focus everywhere). Coalesced inside
  // rehydrate so the trio does not seek three times.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') rehydrate('visibility')
    }
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) rehydrate('bfcache')
    }
    const onFocus = () => rehydrate('focus')
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('focus', onFocus)
    // First paint: progress may already be mid-range without a scroll event yet.
    rehydrate('mount')
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('focus', onFocus)
      if (rehydrateRafRef.current) cancelAnimationFrame(rehydrateRafRef.current)
    }
  }, [rehydrate])

  // TWO drivers, one writer each, and they are mode-exclusive so they never
  // contend: the scrub is driven by SCROLL (rAF, video paused), each loop is
  // driven by the DECODER (one callback per presented frame, video playing).
  //
  // GATED ON `awake`, which is not optional. Ungated this loop runs from page
  // load to page unload — measured on the reference build at ~120 iterations
  // per second with the scene three screens away, each one reading
  // `offsetWidth` and `clientWidth`, which are layout reads. The rest of the
  // component is already careful never to touch layout in a frame; the loop
  // that calls it must be gated too.
  //
  // Tearing the effect down on the way out is safe by construction: `disposed`
  // stops the old rVFC chain at its next presented frame, and resetting the seek
  // coalescing state is exactly what re-entry wants anyway.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !resolved || reduced || !awake) return

    let raf = 0
    let disposed = false
    // A seek issued while one is outstanding is dropped by the browser, so the
    // newest target would be lost and the render would lag the scrollbar.
    let seeking = false
    let pending: number | null = null

    const onSeeked = () => {
      if (pending !== null) {
        const next = pending
        pending = null
        video.currentTime = next
      } else {
        seeking = false
      }
    }
    video.addEventListener('seeked', onSeeked)

    const seek = (time: number) => {
      if (seeking) {
        pending = time
        return
      }
      seeking = true
      video.currentTime = time
    }

    /** The frame index the loop must never present — see the docblock on
     * `ScrubLoopConfig.fromFrame`. */
    const matchFrame = () =>
      modeRef.current === 'head'
        ? (headLoop.matchFrame ?? headLoop.fromFrame)
        : Math.round(video.duration * fps) - 1

    const wrapFrom = () => (modeRef.current === 'head' ? TL.headLoopFrom : TL.tailLoopFrom)

    /**
     * Frame-accurate wrap. `mediaTime` is the presentation timestamp of the
     * frame ON SCREEN, so rounding it gives the exact index — no clock
     * reading, no race. Seeking on the frame BEFORE the match means the next
     * frame presented is the loop's first, which is what the match frame
     * would have been.
     */
    const onFrame = (_now: number, meta: { mediaTime: number }) => {
      if (disposed) return
      debugRef.current.vframes++
      if (modeRef.current !== 'scrub') {
        const frame = Math.round(meta.mediaTime * fps)
        if (frame >= matchFrame() - 1 || meta.mediaTime < wrapFrom() - 0.001) {
          // Direct, not coalesced: a wrap must never be queued behind another
          // seek and arrive a frame late, which is the whole failure being fixed.
          seeking = false
          pending = null
          video.currentTime = wrapFrom()
        }
      }
      video.requestVideoFrameCallback?.(onFrame)
    }
    video.requestVideoFrameCallback?.(onFrame)
    const hasFrameCallback = typeof video.requestVideoFrameCallback === 'function'

    // Safari pauses an autoplaying muted video ON ITS OWN when it judges it
    // invisible — around a window resize it can judge wrong, and the pause
    // arrives outside React so no effect re-runs to undo it. The play effect
    // below also swallows a rejected `play()`. Either way the machine believes
    // a loop is running while the decoder sits paused: a frozen scene. The
    // tick loop is the one place that runs regardless, so it re-issues play
    // whenever a loop SHOULD be running but isn't — throttled, because a
    // pending `play()` takes a few frames to resolve and re-calling it every
    // rAF spams the media stack.
    let sincePlay = 0

    let badDurationFrames = 0

    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (!Number.isFinite(video.duration) || video.duration === 0) {
        // Media eviction after long idle: do not no-op forever with awake true.
        if (++badDurationFrames > 45 && !mediaRecoveringRef.current) {
          badDurationFrames = 0
          mediaRecoveringRef.current = true
          debugRef.current.recovers++
          video.preload = 'auto'
          const onMeta = () => {
            mediaRecoveringRef.current = false
            // Snap from scroll once duration is real again.
            const p = clamp01(scrollYProgress.get())
            const b = boundsFromRangePx(rangePxRef.current, headHoldPx, tailLeadPx, hysteresisRatio)
            const m = reduced ? 'head' : modeFromProgress(p, b)
            modeRef.current = m
            const time = reduced ? TL.headLoopFrom : targetTimeFromProgress(p, b, TL)
            snapPlayhead(
              video,
              time,
              !reduced && m !== 'scrub',
              fps,
              () => {
                debugRef.current.plays++
              },
              () => {
                debugRef.current.rejections++
              }
            )
          }
          video.addEventListener('loadedmetadata', onMeta, { once: true })
          try {
            video.load()
          } catch {
            mediaRecoveringRef.current = false
          }
        }
        return
      }
      badDurationFrames = 0
      mediaRecoveringRef.current = false
      debugRef.current.ticks++

      if (modeRef.current !== 'scrub' && video.paused && ++sincePlay > 30) {
        sincePlay = 0
        debugRef.current.plays++
        void video.play().catch(() => {
          debugRef.current.rejections++
        })
      }

      // The backdrop follows the RENDER's own playhead, not the scroll target.
      // The two differ: `currentTime` glides toward the target rather than
      // jumping to it, and during a loop the scroll is static while the render
      // is still cycling. Reading the playhead keeps them matched in both cases.
      const frame = video.currentTime * fps
      const matchF = headLoop.matchFrame ?? headLoop.fromFrame
      const band = (frame - matchF) / (tailLoop.fromFrame - matchF)
      paintBackdrop(clamp01(band))

      if (modeRef.current === 'scrub') {
        // Exponential approach, not a jump. On handover `currentTime` is still
        // wherever the loop left it, so this plays the frames in between rather
        // than cutting past them.
        const target = scrubTarget.get()
        const delta = target - video.currentTime
        if (Math.abs(delta) < TL.glideRest) return
        seek(video.currentTime + delta * glide)
        return
      }

      // Fallback only. Polling cannot be frame-accurate, so it wraps a FULL
      // frame early rather than half — losing the last frame of the cycle is
      // cheap; presenting the first frame of the next cycle is the visible fault.
      if (hasFrameCallback) return
      const from = wrapFrom()
      const wrapAt = (matchFrame() - 1) / fps
      if (video.currentTime >= wrapAt || video.currentTime < from - 0.001) {
        seek(from)
      }
    }
    raf = requestAnimationFrame(tick)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      video.removeEventListener('seeked', onSeeked)
    }
  }, [
    resolved,
    reduced,
    awake,
    scrubTarget,
    paintBackdrop,
    scrollYProgress,
    fps,
    headLoop.fromFrame,
    headLoop.matchFrame,
    tailLoop.fromFrame,
    headHoldPx,
    tailLeadPx,
    hysteresisRatio,
    glide,
    TL
  ])

  // Playback follows the mode AND the scene's presence. Loops run the decoder;
  // the scrub owns `currentTime` itself and must not have playback fighting it;
  // and nothing runs at all while the scene is away.
  //
  // On wake we rehydrate (seek-to-mode) rather than only play() from a stale
  // currentTime — that avoids a "head section, tail frame" failure after a
  // long background tab.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !resolved) return
    if (!awake || reduced || mode === 'scrub') {
      video.pause()
      return
    }
    // Loop modes: play is issued by rehydrate snap or the tick watchdog.
    // Do not bare-play here without a seek — leaves a desynced playhead running.
  }, [mode, awake, resolved, reduced])

  // Wake edge: always snap playhead from scroll (not only start the rAF loop).
  const wasAwakeRef = useRef(false)
  useEffect(() => {
    if (awake && !wasAwakeRef.current) rehydrate('wake')
    wasAwakeRef.current = awake
  }, [awake, rehydrate])

  // Two observers on the RANGE, not on the video: the range is the scene's own
  // geometry, where the video below the engage breakpoint can be a
  // deliberately oversized box whose rect says nothing useful about whether
  // the scene is near.
  //
  // Warm early, wake late. A multi-MB video decoding behind three screens of
  // content is pure cost, and gating it is the reason one scrubbed scene is
  // affordable.
  useEffect(() => {
    const range = rangeRef.current
    if (!range || !resolved) return

    // NEVER call video.load() here (video.md §5). This element is genuinely
    // SRC-LESS until `resolved` becomes non-null (one rAF after mount, once
    // the tier resolves) — unlike InViewLoopVideo's warm tier, whose
    // <source> children already exist at mount, where preload='auto' alone
    // is enough to hint the fetch and an explicit load() only risks aborting
    // a play() already in flight. Here, the `src` prop (bound to `resolved`)
    // is what starts the fetch once React commits it — the same
    // resource-selection algorithm `.load()` would otherwise re-trigger —
    // and nothing has played yet at this point for a `.load()` to abort even
    // if it were called. If `resolved` is still null when this margin fires
    // (rare — it resolves on the very first rAF after mount), there is
    // nothing to warm yet; the preload hint below simply waits for React's
    // next commit to give it a src.
    const warm = new IntersectionObserver(
      ([entry]) => {
        const video = videoRef.current
        if (!entry.isIntersecting || !video) return
        video.preload = 'auto'
        warm.disconnect()
      },
      { rootMargin: WARM_MARGIN }
    )
    warm.observe(range)

    // `setState` per TRANSITION, which is the allowed kind — this flips twice
    // per visit, not once per frame.
    //
    // Arriving is also the one moment the geometry is certainly settled, so the
    // range is re-measured here. A resize that happened while the scene was off
    // screen would otherwise leave the reading it produced in place until the
    // next one.
    const observer = new IntersectionObserver(
      ([entry]) => {
        wake(entry.isIntersecting)
        if (entry.isIntersecting) {
          measureRange()
          measureGeom()
        }
      },
      { rootMargin: WAKE_MARGIN }
    )
    observer.observe(range)

    // The resize path, computed from the rect rather than waited for. This is
    // exactly where Safari's observer goes stale, and one layout read per
    // resize is nothing. Rehydrate after so mode/time match the new geometry.
    const recheck = () => {
      const r = range.getBoundingClientRect()
      wake(r.top < window.innerHeight + wakeMarginPx && r.bottom > -wakeMarginPx)
      measureRange()
      measureGeom()
      rehydrate('resize')
    }
    window.addEventListener('resize', recheck)

    return () => {
      warm.disconnect()
      observer.disconnect()
      window.removeEventListener('resize', recheck)
    }
  }, [resolved, measureRange, measureGeom, wake, rehydrate, WARM_MARGIN, WAKE_MARGIN, wakeMarginPx])

  // The dev black box's readout. Call `__scrub()` in a frozen tab, then scroll
  // once and call it again — whichever counter did NOT advance is the dead
  // layer. Off by default in production; `isFluidDebugEnabled()` above is the
  // opt-in for a verification run against a production build.
  useEffect(() => {
    const isProd = typeof process !== 'undefined' && process.env.NODE_ENV === 'production'
    if (isProd && !isFluidDebugEnabled()) return
    const w = window as Window & { __scrub?: () => Record<string, unknown> }
    w.__scrub = () => {
      const video = videoRef.current
      const range = rangeRef.current
      const rect = range?.getBoundingClientRect()
      const p = scrollYProgress.get()
      const b = boundsFromRangePx(rangePxRef.current, headHoldPx, tailLeadPx, hysteresisRatio)
      return {
        ...debugRef.current,
        awake: awakeRef.current,
        mode: modeRef.current,
        modeFromP: modeFromProgress(p, b),
        targetTime: +targetTimeFromProgress(p, b, TL).toFixed(3),
        reduced,
        travel: rangePxRef.current,
        top: rect ? Math.round(rect.top) : null,
        bottom: rect ? Math.round(rect.bottom) : null,
        time: video ? +video.currentTime.toFixed(3) : null,
        paused: video?.paused ?? null,
        ready: video?.readyState ?? null,
        duration: video && Number.isFinite(video.duration) ? +video.duration.toFixed(3) : null
      }
    }
    return () => {
      delete w.__scrub
    }
  }, [reduced, scrollYProgress, headHoldPx, tailLeadPx, hysteresisRatio, TL])

  // Reduced motion holds the head loop's first frame — the composition the
  // section was designed around, with none of the movement.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !reduced) return
    const settle = () => {
      video.currentTime = TL.headLoopFrom
    }
    if (video.readyState >= 1) settle()
    else video.addEventListener('loadedmetadata', settle, { once: true })
  }, [reduced, resolved, TL])

  /**
   * `useId()` scopes the CSS below to THIS instance. It returns colons
   * (`:r0:`), which are fine inside a quoted attribute-selector VALUE
   * (`[data-scrub-frame="r0"]` needs no escaping — unlike a bare class or id
   * selector, a quoted attribute value is just a string), but they are
   * stripped anyway so the id is also safe to drop straight into an id/class
   * selector if this is ever copied into one.
   */
  const scopeId = useId().replace(/:/g, '')

  // With a `camera`, the video is positioned entirely by the transform
  // `applyFraming` writes, and SIZED by `--frame-w`/`--frame-h` — two CSS
  // custom properties set below by a scoped <style> tag, not by JS reading
  // `tier` state.
  //
  // That distinction is the fix for a real regression: `tier` resolves on the
  // client, one `requestAnimationFrame` after mount (see the tier-selection
  // effect above), so if this component read `camera.frameSize[tier]`
  // straight into an inline style, the FIRST paint on every visit — desktop
  // included — would render at the `tier` state's initial value (`null` /
  // whatever default) rather than the tier that will actually be chosen. A
  // media query has no such delay: the browser resolves `--frame-w`/
  // `--frame-h` in the same paint as everything else, exactly like the
  // reference build's `lg:[--frame-h:...]` Tailwind utility did. `tier`
  // (JS) still decides which SRC to fetch — that part cannot be done in CSS
  // — but it no longer decides the frame's size.
  //
  // `origin-top-left` is what makes `applyFraming`'s transform maths trivial
  // — the transform's x/y equal the element's top-left in the pin. That
  // function reads the RENDERED size back via `measureGeom`'s
  // `offsetWidth`/`offsetHeight` (see below), never `tier` or `frameSize`
  // directly, so it is automatically correct whichever tier the media query
  // resolved.
  //
  // `maxWidth: 'none'` matters on both branches if a host stylesheet caps
  // `<video>` at 100% width (a common CSS reset, e.g. Tailwind Preflight):
  // without overriding it, a `camera` box's framed width would silently
  // clamp back to the viewport's and only the height would be correct: and
  // even the no-camera box, though it targets 100% anyway, would clamp to
  // whatever ITS containing block resolves to rather than the pin it is
  // meant to fill if that reset's specificity ever wins.
  const videoStyle: CSSProperties = camera
    ? {
        position: 'absolute',
        top: 0,
        left: 0,
        display: 'block',
        width: 'var(--frame-w)',
        height: 'var(--frame-h)',
        maxWidth: 'none',
        transformOrigin: 'top left',
        objectFit: 'cover'
      }
    : {
        position: 'absolute',
        inset: 0,
        height: '100%',
        width: '100%',
        maxWidth: 'none',
        objectFit: 'cover'
      }

  return (
    <div ref={rangeRef} data-scrub-stage className={className}>
      {/* pointer-events:none so the pinned layer never eats clicks meant for the
          content riding over it.

          `lvh`, NOT `svh` — and this is the one that bites. On iOS Safari `svh`
          is the viewport with the toolbars SHOWN, and a scrub scene is read
          while scrolling, which is exactly when Safari collapses them and the
          visible area grows to `lvh`. A pin measured in `svh` is then shorter
          than the screen by the toolbar's height and the page background shows
          through as a band along the bottom edge — reported from a real iPhone,
          and reproduced by shrinking this box 12% in a desktop harness.

          `lvh` is the largest of the three, so the pin covers the screen in
          both toolbar states; when they are shown it simply overhangs, and
          `overflow:hidden` takes care of that. Deliberately not `dvh`: that
          tracks the toolbar animation, so the pin — and with it the video box
          and every framing read — would resize on every collapse, which is a
          layout thrash a scrubbed video is the worst possible surface for. */}
      <div
        data-scrub-pin
        /* Inline styles beat ANY non-`!important` stylesheet rule, source
           order and specificity notwithstanding. The reduced-motion
           structural collapse in `assets/css/animation.css` (keyed off
           `[data-scrub-pin]`) therefore declares its overrides
           `!important` rather than trying to out-order this — see that
           file's comment for why `!important` was chosen over moving this
           geometry into the scoped `<style>` tag below (`--frame-w/-h`):
           the pin's `position`/`height`/`overflow` are the same on every
           instance, so there is nothing per-instance here for a scoped
           rule to buy. */
        style={{
          pointerEvents: 'none',
          position: 'sticky',
          top: 0,
          height: '100lvh',
          width: '100%',
          overflow: 'hidden'
        }}
      >
        {/* The backdrop ramp, behind the video — a backstop for the paint
            between hydration and the first framing call. The camera (when
            supplied) covers this layer completely from then on. */}
        <div ref={gutterRef} aria-hidden="true" style={BACKDROP_STYLE} />
        {camera && (
          // Sets `--frame-w`/`--frame-h` per tier, switched by the SAME media
          // query `ENGAGE_QUERY` uses in JS elsewhere — see `videoStyle`'s
          // docblock for why this has to be CSS rather than a `tier`-keyed
          // inline value. Scoped to this instance via the attribute selector
          // so two `ScrubStage`s on one page (e.g. one static demo beside a
          // live one) never share a rule.
          <style
            // eslint-disable-next-line react/no-danger -- static, component-authored CSS text; no user input reaches this string.
            dangerouslySetInnerHTML={{
              __html: `[data-scrub-frame="${scopeId}"]{--frame-w:${camera.frameSize.mobile.w}svh;--frame-h:${camera.frameSize.mobile.h}svh}@media (min-width:${ENGAGE_BREAKPOINT_PX}px){[data-scrub-frame="${scopeId}"]{--frame-w:${camera.frameSize.desktop.w}svh;--frame-h:${camera.frameSize.desktop.h}svh}}`
            }}
          />
        )}
        <video
          ref={videoRef}
          src={resolved ?? undefined}
          poster={resolvedPoster}
          muted
          playsInline
          preload="none"
          disablePictureInPicture
          disableRemotePlayback
          aria-hidden="true"
          data-motion-state={mode}
          data-scrub-frame={camera ? scopeId : undefined}
          className={videoClassName}
          style={videoStyle}
        />
      </div>

      {/* Pulled back over the pin: this exactly cancels the sticky child's
          contribution to wrapper height, so the measured range is as tall as its
          children and the pin travels exactly that far.

          Must stay the SAME unit as the pin above — it is cancelling that box,
          not a viewport. Left in `svh` while the pin moved to `lvh`, the range
          would measure one toolbar-height too tall and the pin would overrun
          its runway at the bottom. */}
      <div data-scrub-content style={{ position: 'relative', marginTop: '-100lvh' }}>
        {children}
      </div>
    </div>
  )
}

/** Module constant: a fresh literal each render resubscribes the scroll listener. */
const PIN_OFFSET = ['start start', 'end end'] as const satisfies [string, string]
