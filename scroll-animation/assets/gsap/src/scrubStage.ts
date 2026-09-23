/**
 * `[data-scrub-stage]` — a pinned background video that LOOPS at both ends
 * and is SCRUBBED in between, with the sections that narrate it riding over
 * the pin as normal flow content. Port of `ScrubStage`.
 *
 * Read this file's docblocks before changing a constant — this is the
 * densest module in the package, and most of what is here was arrived at
 * by measuring a real render, not by guessing (see the reference build's
 * `references/video.md` §1–§5, `references/scroll-scenes.md`).
 *
 * ## The DOM contract
 *
 * ```html
 * <div data-scrub-stage>
 *   <div data-scrub-pin>                          <!-- sticky, motion.css -->
 *     <div data-scrub-gutter aria-hidden="true"></div>   <!-- backdrop, optional -->
 *     <video data-scrub-video muted playsinline preload="none"
 *            disablepictureinpicture disableremoteplayback aria-hidden="true"
 *            data-src="…mp4" data-mobile-src="…mp4" poster="…" data-mobile-poster="…"></video>
 *   </div>
 *   <div data-scrub-content>…sections, riding over the pin…</div>
 * </div>
 * ```
 *
 * `motion.css` supplies the pin's `position: sticky`, the content wrapper's
 * negative margin that cancels the pin's contribution to the range's
 * height, and the reduced-motion structural collapse. This module wires
 * behaviour onto whatever markup already carries these attributes; it
 * creates no elements of its own.
 *
 * ## Three modes on one continuous render
 *
 * ```
 *   head          scrub                        tail
 *  32──79↺   80 ─────────────────── 193   193──282↺
 *  ↺ auto    ← driven by scroll →          ↺ auto
 * ```
 *
 * The loops are sub-ranges of the SAME clip, not separate files — the frame
 * after the head loop's last is also where the scrub begins, so leaving the
 * loop means *continuing to play* rather than cutting anywhere. Configure
 * `headLoop`/`tailLoop`/`fps` to your own asset's measured seam points
 * (Recipe 2); the numbers above are the reference build's example, not a
 * default baked into this file.
 *
 * ## Why the handover glides instead of cutting
 *
 * At a loop's own boundary the render is typically moving fast, so a hard
 * cut from mid-loop to the scrub's start would pop. Instead the video time
 * is its own exponential-approach value: on handover it is *jumped* to
 * wherever the loop actually is and then eased toward the scroll target, so
 * the frames in between are simply played — the same frames, in the same
 * order, the loop was about to play anyway.
 *
 * ## Mode changes read the UNSPRUNG progress
 *
 * A smoothed value settles ACROSS a threshold rather than landing on it, so
 * a mode test fed from anything eased flaps as it rings down. The three
 * boundaries use raw scroll progress and hysteresis — enter and exit are
 * different numbers, so incidental jitter can never flap a mode
 * (`references/scroll-scenes.md` §5, "A spring never feeds a threshold").
 *
 * ## Scroll is durable truth; video time is derived
 *
 * After a long background spell the browser may freeze the frame loop, drop
 * the media pipeline, or leave the playhead stale while the page's scroll
 * position is still correct. On resume this module REHYDRATES: re-measures
 * geometry, re-derives mode and target time from scroll, snaps the playhead
 * (no glide), reframes the camera. Live head↔scrub handovers still glide.
 * Nothing here ever force-scrolls the visitor or reloads the page.
 */

import { ENGAGE_QUERY } from './config'
import { prefersReducedMotion } from './eases'
import { createVideoController } from './videoController'

/**
 * Gate for the `window.__scrub()` debug probe attached below. This module
 * is framework-free and ships as plain ESM to whatever bundler consumes it,
 * so unlike the React port there is no `process.env.NODE_ENV` to key a
 * dev-vs-production default off (no bundler guarantee it gets replaced/
 * stripped here at all). Rather than guess, the probe is opt-in everywhere
 * — dev AND production — via the same flag: append `?fluid-debug` to the
 * URL, or set `document.documentElement.dataset.fluidDebug` before this
 * module mounts. See `references/verification.md`.
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

/** Source frame rate, exactly. */
export interface LoopPoint {
  /** First frame of the loop body — the frame after the pixel match to the
   * clip's last (head) or `duration` (tail). */
  fromFrame: number
}

export interface HeadLoopPoint extends LoopPoint {
  /** The frame the loop cycles back to matching — NOT a frame to display;
   * see the reference build's `ScrubStage` docblock on why the match frame
   * itself is skipped. */
  matchFrame: number
}

export interface ScrubStageShot {
  /** Multiplies the design zoom; 1 = no extra zoom beyond coverage. */
  zoom: number
  /** Where the subject point should land in the pin, normalised [x, y]. */
  at: [number, number]
}

/** A crop of one shared source canvas, normalised to it. Omit entirely for
 * an asset that is not a crop of a larger canvas (`x`/`y` default 0,
 * `w`/`h` default 1 — the identity crop). */
export interface ScrubStageCrop {
  x: number
  y: number
  w: number
  h: number
}

/** Per-tier camera geometry. Every field is optional and defaults to the
 * identity camera — a plain covering video with no pan or zoom — so this
 * module is useful with zero configuration and grows into the full
 * reference-build camera only once you supply measured numbers for your
 * own asset (Recipe 5/6 in the reference build's cookbook). */
export interface ScrubStageTierGeometry {
  crop?: ScrubStageCrop
  /**
   * The subject point, normalised to the shared MASTER CANVAS's own
   * coordinates (the same space `crop` is defined in) — NOT the crop's own
   * local space — at each end of the scrub band. `applyFraming` computes
   * `(subject.x − crop.x) / crop.w`, which converts a master-space point
   * INTO the crop's local 0-1 space; feeding it an already-crop-local point
   * double-transforms it. A centred subject gives 0.5 either way, so this
   * only bites once the subject is off-centre. This option's default,
   * `{ x: 0.5, y: 0.5 }`, is the MASTER CANVAS's own centre (matching the
   * default identity crop) — not necessarily the crop's centre once a
   * non-identity `crop` is supplied without a matching `subject`. Measure
   * and write pixel coordinates off the master canvas, then divide by the
   * canvas size, exactly like `crop` itself.
   */
  subject?: { head: { x: number; y: number }; tail: { x: number; y: number } }
  /** Where the subject should land in the pin, and the extra zoom, at each
   * end. Defaults to centred, zoom 1, at both ends. */
  shots?: { head: ScrubStageShot; tail: ScrubStageShot }
}

export interface ScrubStageBackdropStop {
  /** Position along the scrub band: 0 = scrub start, 1 = scrub end. */
  at: number
  top: string
  bottom: string
}

export interface ScrubStageOptions {
  fps: number
  headLoop: HeadLoopPoint
  tailLoop: LoopPoint
  /** How far past pin-start the head loop holds before scrub begins, in CSS
   * px of pin range. Reference default: 12 (measured on the reference
   * build's homepage — "near-zero so scrub engages almost as soon as the
   * first act starts to leave"). */
  headHoldPx?: number
  /** How early the scrub finishes and the tail loop engages, in CSS px of
   * pin range. Reference default: 320. */
  tailLeadPx?: number
  /** Hysteresis as a FRACTION of each end's lead — never a second absolute
   * constant, or the two can be set into an invalid pair (`references/scroll-scenes.md`
   * §3, "The latch: a discrete crossing with hysteresis"). Reference default: 0.7. */
  hysteresisRatio?: number
  /** IntersectionObserver root margin (px) for starting the network fetch. */
  warmMarginPx?: number
  /** IntersectionObserver root margin (px) for waking the per-frame loop. */
  wakeMarginPx?: number
  /** Exponential approach rate on the handover glide, per tick. Reference
   * default: 0.18 (~150ms settle). */
  glide?: number
  /** Below this many seconds the glide is done. Defaults to half a frame. */
  glideRestSeconds?: number
  desktop?: ScrubStageTierGeometry
  mobile?: ScrubStageTierGeometry
  /** matchMedia query selecting the desktop tier. Default matches the
   * package-wide `ENGAGE_QUERY`. */
  mobileBreakpoint?: string
  /** The backdrop behind the video, as stops along the scrub band. Sample
   * your own asset's edges (Recipe 3) — the default is a neutral
   * placeholder, not a measured value, and only shows during the gap
   * between hydration and the first framing call once a camera is
   * configured. */
  backdropStops?: ScrubStageBackdropStop[]
}

const DEFAULT_BACKDROP: ScrubStageBackdropStop[] = [
  { at: 0, top: '#9a9a9a', bottom: '#9a9a9a' },
  { at: 1, top: '#0a0a0a', bottom: '#0a0a0a' }
]

const IDENTITY_CROP: ScrubStageCrop = { x: 0, y: 0, w: 1, h: 1 }
const IDENTITY_SUBJECT = { head: { x: 0.5, y: 0.5 }, tail: { x: 0.5, y: 0.5 } }
const IDENTITY_SHOTS = { head: { zoom: 1, at: [0.5, 0.5] as [number, number] }, tail: { zoom: 1, at: [0.5, 0.5] as [number, number] } }

function resolveTier(tier: ScrubStageTierGeometry | undefined) {
  return {
    crop: tier?.crop ?? IDENTITY_CROP,
    subject: tier?.subject ?? IDENTITY_SUBJECT,
    shots: tier?.shots ?? IDENTITY_SHOTS
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

type Mode = 'head' | 'scrub' | 'tail'

interface Bounds {
  headExit: number
  headEnter: number
  tailEnter: number
  tailExit: number
}

type Rgb = [number, number, number]
const toRgb = (h: string): Rgb => [
  Number.parseInt(h.slice(1, 3), 16),
  Number.parseInt(h.slice(3, 5), 16),
  Number.parseInt(h.slice(5, 7), 16)
]
const mixRgb = (a: Rgb, b: Rgb, t: number) =>
  `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`

function backdropAt(stops: ScrubStageBackdropStop[], t: number) {
  const first = stops[0]
  if (!first) return { top: 'rgb(128,128,128)', bottom: 'rgb(128,128,128)' }
  let i = 0
  while (i < stops.length - 2 && t > (stops[i + 1] ?? first).at) i++
  const a = stops[i] ?? first
  const b = stops[i + 1] ?? a
  const span = b.at - a.at
  const k = span <= 0 ? 0 : clamp01((t - a.at) / span)
  return { top: mixRgb(toRgb(a.top), toRgb(b.top), k), bottom: mixRgb(toRgb(a.bottom), toRgb(b.bottom), k) }
}

/**
 * Snap the decoder to `time`, then optionally play. Waits for `seeked`
 * before playing — some engines drop a `play()` issued mid-seek. Falls
 * back after 150ms if `seeked` never fires (already-at-time, or dead media).
 */
function snapPlayhead(video: HTMLVideoElement, fps: number, time: number, shouldPlay: boolean): void {
  video.pause()
  const finish = () => {
    if (!shouldPlay) return
    void video.play().catch(() => {})
  }
  if (!Number.isFinite(video.duration) || video.duration === 0) {
    finish()
    return
  }
  const clamped = Math.min(Math.max(0, time), Math.max(0, video.duration - 1 / fps))
  if (Math.abs(video.currentTime - clamped) < 0.5 / fps) {
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

export interface ScrubStageController {
  destroy(): void
}

export function initScrubStages(
  root: ParentNode = document,
  resolveOptions: (el: HTMLElement) => ScrubStageOptions | undefined = () => undefined
): ScrubStageController {
  const stages = Array.from(root.querySelectorAll<HTMLElement>('[data-scrub-stage]'))
  const teardowns: Array<() => void> = []

  for (const stageEl of stages) {
    const options = resolveOptions(stageEl)
    if (!options) continue
    const teardown = mountOne(stageEl, options)
    if (teardown) teardowns.push(teardown)
  }

  return {
    destroy() {
      teardowns.forEach((fn) => fn())
    }
  }
}

function mountOne(rangeEl: HTMLElement, options: ScrubStageOptions): (() => void) | null {
  const pin = rangeEl.querySelector<HTMLElement>('[data-scrub-pin]')
  const video = rangeEl.querySelector<HTMLVideoElement>('[data-scrub-video]')
  const gutter = rangeEl.querySelector<HTMLElement>('[data-scrub-gutter]')
  if (!pin || !video) return null

  const fps = options.fps
  const headHoldPx = options.headHoldPx ?? 12
  const tailLeadPx = options.tailLeadPx ?? 320
  const hysteresisRatio = options.hysteresisRatio ?? 0.7
  const warmMarginPx = options.warmMarginPx ?? 600
  const wakeMarginPx = options.wakeMarginPx ?? 200
  const glide = options.glide ?? 0.18
  const glideRest = options.glideRestSeconds ?? 0.5 / fps
  // Default to the shared ENGAGE_QUERY (references/attribute-contract.md §4)
  // rather than a hand-typed literal — the reference build's earlier
  // '(min-width: 1024px)' here drifted silently from any project whose
  // fluid.config.json engageAt wasn't 1024. See ./config's own docblock: a
  // project with a non-default engageAt should regenerate fluid.config.ts
  // (`--stack ts`) and pass its ENGAGE_QUERY through `mobileBreakpoint`.
  const mobileBreakpoint = options.mobileBreakpoint ?? ENGAGE_QUERY
  const backdropStops = options.backdropStops ?? DEFAULT_BACKDROP

  const desktop = resolveTier(options.desktop)
  const mobile = resolveTier(options.mobile ?? options.desktop)

  const headLoopFrom = options.headLoop.fromFrame / fps
  const scrubFrom = options.headLoop.matchFrame / fps
  const tailLoopFrom = options.tailLoop.fromFrame / fps

  const reduced = prefersReducedMotion()
  const controller = createVideoController(video)

  function boundsFromRangePx(rangePx: number): Bounds {
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

  function modeFromProgress(p: number, b: Bounds): Mode {
    if (p <= b.headExit) return 'head'
    if (p >= b.tailEnter) return 'tail'
    return 'scrub'
  }

  function targetTimeFromProgress(p: number, b: Bounds): number {
    if (p <= b.headExit) return headLoopFrom
    if (p >= b.tailEnter) return tailLoopFrom
    const t = (p - b.headExit) / (b.tailEnter - b.headExit)
    return scrubFrom + clamp01(t) * (tailLoopFrom - scrubFrom)
  }

  // ---- src tier selection --------------------------------------------
  const hasMobileSrc = !!video.dataset.mobileSrc
  let desktopTier = true
  const mediaQuery = hasMobileSrc ? window.matchMedia(mobileBreakpoint) : null
  const pickTier = () => {
    desktopTier = !mediaQuery || mediaQuery.matches
    const src = desktopTier ? video.dataset.src : video.dataset.mobileSrc
    const poster = desktopTier ? video.getAttribute('poster') : (video.dataset.mobilePoster ?? video.getAttribute('poster'))
    if (src && video.getAttribute('src') !== src) video.src = src
    if (poster) video.poster = poster
  }
  const tierFrame = requestAnimationFrame(pickTier)
  mediaQuery?.addEventListener('change', pickTier)

  // ---- range measurement ------------------------------------------------
  let rangePx = 1
  const measureRange = () => {
    rangePx = Math.max(1, rangeEl.offsetHeight - window.innerHeight)
  }
  measureRange()

  let resizeRaf = 0
  const scheduleMeasure = () => {
    cancelAnimationFrame(resizeRaf)
    resizeRaf = requestAnimationFrame(measureRange)
  }
  const resizeObserver = new ResizeObserver(scheduleMeasure)
  resizeObserver.observe(rangeEl)
  window.addEventListener('resize', scheduleMeasure)

  // ---- progress source ---------------------------------------------------
  // A passive scroll listener + rAF, not GSAP ScrollTrigger. Reasons:
  // (1) the pin is CSS `position: sticky`, not a ScrollTrigger pin, and
  //     running ScrollTrigger's own pinning/refresh machinery alongside a
  //     manually-pinned element risks the two disagreeing about geometry on
  //     resize; (2) the module already runs an IntersectionObserver-gated
  //     rAF loop for the decoder clock, and a second scroll-observation
  //     system (ScrollTrigger's internal ticker) buys nothing a direct
  //     `getBoundingClientRect` read does not already give for free; (3) it
  //     keeps this file's "direct write, one clock, no library abstraction
  //     between the read and the write" style consistent with the rest of
  //     the reference build's manual writers (`references/scroll-scenes.md` §6,
  //     "The direct style write").
  const getProgress = (): number => {
    const rect = rangeEl.getBoundingClientRect()
    const total = rect.height - window.innerHeight
    if (total <= 0) return 0
    return clamp01(-rect.top / total)
  }

  // ---- mode machine (raw progress + hysteresis) ---------------------------
  let mode: Mode = 'head'
  let awake = false

  // Write the initial mode ONCE at mount, rather than relying on setMode's
  // own early-return-when-unchanged guard to do it. `mode` starts 'head' and
  // the first real setMode('head') call would be a no-op under that guard,
  // so a page loaded at progress 0 would never get `data-motion-state` at
  // all — "head at progress 0" becomes unverifiable (the marker CSS in
  // verification.md §3 has nothing to key off), and the React port has the
  // same fact expressed for free by useState('head')'s first render.
  video.setAttribute('data-motion-state', mode)

  const wake = (next: boolean) => {
    if (awake === next) return
    awake = next
    // Mirrors the React port's wake-edge effect (`if (awake &&
    // !wasAwakeRef.current) rehydrate('wake')`): re-derive mode/time/camera
    // from scroll on every false->true transition, not only on mount/resize/
    // visibility/focus. Without this, a scene that goes to sleep mid-scrub
    // (scrolled far past, then back) can wake with a stale decoder state
    // that nothing re-syncs until the next of those other triggers fires.
    if (next) rehydrate('wake')
  }

  const setMode = (next: Mode) => {
    if (mode === next) return
    mode = next
    video.setAttribute('data-motion-state', next)
    // Mirrors the React port's playback effect (`if (!awake || reduced ||
    // mode === 'scrub') { video.pause(); return }`): entering scrub hands
    // the playhead to the scroll-driven glide in tick() below, and the
    // decoder must not keep free-running under it. Without this, a reader
    // arriving from the head loop keeps the decoder playing under the
    // glide — measured via requestVideoFrameCallback: 121 presented frames
    // in 2s at a PARKED scroll position, a visible shimmer plus wasted
    // decode, invisible to the mode/attribute alone since the mode itself
    // was already correct.
    if (next === 'scrub') video.pause()
  }

  // ---- camera geometry ------------------------------------------------
  let pw = 0
  let ph = 0
  let bw = 0
  let bh = 0
  const measureGeom = () => {
    pw = pin.clientWidth
    ph = pin.clientHeight
    bw = video.offsetWidth
    bh = video.offsetHeight
  }

  let lastFramed = ''
  const applyFraming = (progress: number) => {
    if (!pw || !ph || !bw || !bh) return

    const tier = desktopTier ? desktop : mobile

    let t = 0
    if (!reduced) {
      const b = boundsFromRangePx(rangePx)
      const span = Math.max(1e-6, b.tailEnter - b.headExit)
      t = clamp01((progress - b.headExit) / span)
    }

    const crop = tier.crop
    const sx = (lerp(tier.subject.head.x, tier.subject.tail.x, t) - crop.x) / crop.w
    const sy = (lerp(tier.subject.head.y, tier.subject.tail.y, t) - crop.y) / crop.h
    const ax = lerp(tier.shots.head.at[0], tier.shots.tail.at[0], t)
    const ay = lerp(tier.shots.head.at[1], tier.shots.tail.at[1], t)
    const design = lerp(tier.shots.head.zoom, tier.shots.tail.zoom, t)

    const zoom = Math.max(
      design,
      (pw * Math.max(ax / sx, (1 - ax) / (1 - sx))) / bw,
      (ph * Math.max(ay / sy, (1 - ay) / (1 - sy))) / bh
    )

    const x = ax * pw - sx * bw * zoom
    const y = ay * ph - sy * bh * zoom

    // Write the FULL transform string with a translateZ compositing anchor
    // — never the `x`/`y`/`scale` GSAP shorthands, which run main-thread.
    const next = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0) scale(${zoom.toFixed(4)})`
    if (next === lastFramed) return
    lastFramed = next
    video.style.transform = next
  }

  let paintedStep = -1
  const paintBackdrop = (t: number) => {
    if (!gutter) return
    const step = Math.round(t * 256)
    if (step === paintedStep) return
    paintedStep = step
    const c = backdropAt(backdropStops, t)
    gutter.style.setProperty('--scrub-g-top', c.top)
    gutter.style.setProperty('--scrub-g-bottom', c.bottom)
  }
  paintBackdrop(0)

  // ---- scroll-driven state update -----------------------------------
  const scrubTargetRef = { current: scrubFrom }

  const onProgressChange = (p: number) => {
    if (p > 0 && p < 1) wake(true)

    const b = boundsFromRangePx(rangePx)
    let next = mode
    if (mode === 'head' && p > b.headExit) next = 'scrub'
    else if (mode === 'scrub' && p < b.headEnter) next = 'head'
    else if (mode === 'scrub' && p > b.tailEnter) next = 'tail'
    else if (mode === 'tail' && p < b.tailExit) next = 'scrub'
    setMode(next)

    const t = (p - b.headExit) / (b.tailEnter - b.headExit)
    const clamped = clamp01(Number.isFinite(t) ? t : 0)
    scrubTargetRef.current = scrubFrom + clamped * (tailLoopFrom - scrubFrom)

    applyFraming(p)
  }

  let scrollRaf = 0
  const onScroll = () => {
    if (scrollRaf) return
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0
      onProgressChange(getProgress())
    })
  }
  window.addEventListener('scroll', onScroll, { passive: true })

  // ---- rehydrate ------------------------------------------------------
  let rehydrateRaf = 0
  let mediaRecovering = false

  const rehydrate = (_reason: string) => {
    if (rehydrateRaf) cancelAnimationFrame(rehydrateRaf)
    rehydrateRaf = requestAnimationFrame(() => {
      rehydrateRaf = 0
      measureRange()
      measureGeom()

      const rect = rangeEl.getBoundingClientRect()
      const near = rect.top < window.innerHeight + wakeMarginPx && rect.bottom > -wakeMarginPx
      if (near) wake(true)

      const p = clamp01(getProgress())
      if (p > 0 && p < 1) wake(true)

      const b = boundsFromRangePx(rangePx)
      const nextMode = reduced ? 'head' : modeFromProgress(p, b)
      const time = reduced ? headLoopFrom : targetTimeFromProgress(p, b)
      setMode(nextMode)
      scrubTargetRef.current = nextMode === 'scrub' ? time : nextMode === 'head' ? scrubFrom : tailLoopFrom

      const band = nextMode === 'head' ? 0 : nextMode === 'tail' ? 1 : (time - scrubFrom) / (tailLoopFrom - scrubFrom)
      paintBackdrop(clamp01(band))
      applyFraming(p)

      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null

      if (duration === null) {
        if (!mediaRecovering) {
          mediaRecovering = true
          video.preload = 'auto'
          const onMeta = () => {
            mediaRecovering = false
            rehydrate('metadata')
          }
          video.addEventListener('loadedmetadata', onMeta, { once: true })
          try {
            video.load()
          } catch {
            mediaRecovering = false
          }
        }
        return
      }
      mediaRecovering = false

      if (!awake) {
        video.pause()
        return
      }

      const shouldPlay = !reduced && nextMode !== 'scrub'
      snapPlayhead(video, fps, time, shouldPlay)
    })
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible') rehydrate('visibility')
  }
  const onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted) rehydrate('bfcache')
  }
  const onFocus = () => rehydrate('focus')
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pageshow', onPageShow)
  window.addEventListener('focus', onFocus)
  rehydrate('mount')

  // ---- per-frame decoder loop, gated on `awake` ---------------------
  // Every rAF loop in this module is gated by an IntersectionObserver —
  // ungated, this would run from page load to unload regardless of whether
  // the scene is anywhere near the viewport.
  let loopDisposed = false
  let loopRaf = 0
  let seeking = false
  let pending: number | null = null
  let sincePlay = 0
  let badDurationFrames = 0
  let loopStarted = false

  const seek = (time: number) => {
    if (seeking) {
      pending = time
      return
    }
    seeking = true
    video.currentTime = time
  }

  const onSeeked = () => {
    if (pending !== null) {
      const next = pending
      pending = null
      video.currentTime = next
    } else {
      seeking = false
    }
  }

  const matchFrame = () => (mode === 'head' ? options.headLoop.matchFrame : Math.round(video.duration * fps) - 1)
  const wrapFrom = () => (mode === 'head' ? headLoopFrom : tailLoopFrom)

  const onVideoFrame = (_now: number, meta: { mediaTime: number }) => {
    if (loopDisposed) return
    if (mode !== 'scrub') {
      const frame = Math.round(meta.mediaTime * fps)
      if (frame >= matchFrame() - 1 || meta.mediaTime < wrapFrom() - 0.001) {
        seeking = false
        pending = null
        video.currentTime = wrapFrom()
      }
    }
    video.requestVideoFrameCallback?.(onVideoFrame)
  }
  const hasFrameCallback = typeof video.requestVideoFrameCallback === 'function'

  const tick = () => {
    loopRaf = requestAnimationFrame(tick)
    if (!Number.isFinite(video.duration) || video.duration === 0) {
      if (++badDurationFrames > 45 && !mediaRecovering) {
        badDurationFrames = 0
        mediaRecovering = true
        video.preload = 'auto'
        const onMeta = () => {
          mediaRecovering = false
          const p = clamp01(getProgress())
          const b = boundsFromRangePx(rangePx)
          const m = reduced ? 'head' : modeFromProgress(p, b)
          setMode(m)
          const time = reduced ? headLoopFrom : targetTimeFromProgress(p, b)
          snapPlayhead(video, fps, time, !reduced && m !== 'scrub')
        }
        video.addEventListener('loadedmetadata', onMeta, { once: true })
        try {
          video.load()
        } catch {
          mediaRecovering = false
        }
      }
      return
    }
    badDurationFrames = 0
    mediaRecovering = false

    if (mode !== 'scrub' && video.paused && ++sincePlay > 30) {
      sincePlay = 0
      void video.play().catch(() => {})
    }

    const frame = video.currentTime * fps
    const band = (frame - options.headLoop.matchFrame) / (options.tailLoop.fromFrame - options.headLoop.matchFrame)
    paintBackdrop(clamp01(band))

    if (mode === 'scrub') {
      const target = scrubTargetRef.current
      const delta = target - video.currentTime
      if (Math.abs(delta) < glideRest) return
      seek(video.currentTime + delta * glide)
      return
    }

    if (hasFrameCallback) return
    const from = wrapFrom()
    const wrapAt = (matchFrame() - 1) / fps
    if (video.currentTime >= wrapAt || video.currentTime < from - 0.001) {
      seek(from)
    }
  }

  const startLoop = () => {
    if (loopStarted || !awake || reduced) return
    loopStarted = true
    video.addEventListener('seeked', onSeeked)
    if (hasFrameCallback) video.requestVideoFrameCallback?.(onVideoFrame)
    loopRaf = requestAnimationFrame(tick)
  }
  const stopLoop = () => {
    if (!loopStarted) return
    loopStarted = false
    cancelAnimationFrame(loopRaf)
    video.removeEventListener('seeked', onSeeked)
  }

  // ---- warm / wake observers -----------------------------------------
  // NEVER call video.load() here (video.md §5: "on phones this aborts an
  // in-progress play()"). This element is genuinely SRC-LESS until `pickTier`
  // assigns it — unlike inViewLoopVideo.ts's warm tier, whose <source>
  // children already exist at mount, so setting `preload='auto'` alone has
  // nothing to hint the fetch toward here unless a src exists. Assigning the
  // `src` IDL attribute directly is what starts the fetch (the browser's own
  // resource-selection algorithm runs off that assignment, the same
  // mechanism `.load()` would trigger) — no `.load()` call is needed on top
  // of it, and nothing has played yet at this point for one to abort even if
  // it were. If `pickTier`'s rAF has already run (the common case — it is
  // scheduled at mount, long before this margin fires), `src` is already set
  // and this is a no-op past the preload hint.
  const warmObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries[0]
      if (!entry?.isIntersecting) return
      if (!video.getAttribute('src')) {
        const src = desktopTier ? video.dataset.src : video.dataset.mobileSrc
        if (src) video.src = src
      }
      video.preload = 'auto'
      warmObserver.disconnect()
    },
    { rootMargin: `${warmMarginPx}px 0px` }
  )
  warmObserver.observe(rangeEl)

  const wakeObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries[0]
      if (!entry) return
      wake(entry.isIntersecting)
      if (entry.isIntersecting) {
        measureRange()
        measureGeom()
        startLoop()
      } else {
        stopLoop()
        video.pause()
      }
    },
    { rootMargin: `${wakeMarginPx}px 0px` }
  )
  wakeObserver.observe(rangeEl)

  const onResize = () => {
    const rect = rangeEl.getBoundingClientRect()
    wake(rect.top < window.innerHeight + wakeMarginPx && rect.bottom > -wakeMarginPx)
    measureRange()
    measureGeom()
    rehydrate('resize')
  }
  window.addEventListener('resize', onResize)

  // ---- reduced motion: hold the head loop's first frame ------------------
  if (reduced) {
    const settle = () => {
      video.currentTime = headLoopFrom
    }
    if (video.readyState >= 1) settle()
    else video.addEventListener('loadedmetadata', settle, { once: true })
  }

  void controller // reserved for a future prime()/ensurePlaying() hookup; the
  // handover/loop logic above already owns play/pause/seek directly, the
  // same division of labour as the reference build (ScrubStage owns its own
  // decoder rather than delegating to the shared controller).

  // ---- debug probe: `window.__scrub()` -----------------------------------
  // Call it in a frozen tab, then scroll once and call it again — whichever
  // counter did not advance is the dead layer. Opt-in only (see
  // isFluidDebugEnabled's docblock); most mounts never touch `window`.
  let scrubProbeAttached = false
  if (isFluidDebugEnabled()) {
    const w = window as Window & { __scrub?: () => Record<string, unknown> }
    w.__scrub = () => {
      const rect = rangeEl.getBoundingClientRect()
      const p = getProgress()
      const b = boundsFromRangePx(rangePx)
      return {
        awake,
        mode,
        modeFromP: modeFromProgress(p, b),
        targetTime: +targetTimeFromProgress(p, b).toFixed(3),
        reduced,
        travel: rangePx,
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        time: +video.currentTime.toFixed(3),
        paused: video.paused,
        ready: video.readyState,
        duration: Number.isFinite(video.duration) ? +video.duration.toFixed(3) : null
      }
    }
    scrubProbeAttached = true
  }

  return () => {
    loopDisposed = true
    stopLoop()
    cancelAnimationFrame(tierFrame)
    cancelAnimationFrame(resizeRaf)
    cancelAnimationFrame(scrollRaf)
    if (rehydrateRaf) cancelAnimationFrame(rehydrateRaf)
    mediaQuery?.removeEventListener('change', pickTier)
    resizeObserver.disconnect()
    warmObserver.disconnect()
    wakeObserver.disconnect()
    window.removeEventListener('resize', scheduleMeasure)
    window.removeEventListener('resize', onResize)
    window.removeEventListener('scroll', onScroll)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pageshow', onPageShow)
    window.removeEventListener('focus', onFocus)
    controller.dispose()
    if (scrubProbeAttached) delete (window as Window & { __scrub?: () => Record<string, unknown> }).__scrub
  }
}
