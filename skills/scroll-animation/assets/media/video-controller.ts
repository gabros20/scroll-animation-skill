/**
 * media/video-controller.ts — the decoder behind a scrubbed video. Engine-agnostic: the Motion and GSAP ScrubVideo
 * adapters drive it identically from a pinned scene (scene.ts), and it never reads scroll itself.
 *
 *   const video = createVideoController(el, { fps: 30, headLoop, tailLoop, src, mobileSrc, onRehydrate })
 *   video.setMode(mode)          per mode transition (the scene's exact-progress stepper)
 *   video.setBand(band)          per progress event: where the scrub wants the playhead, 0..1 across the band
 *   video.setAwake(awake)        per wake transition: the per-frame loop runs only while awake
 *   video.setReduced(reduced)    reduced motion: the poster is the scene; no video is fetched
 *   video.rehydrate(state)       the video half of a resume: snap the playhead to what scroll implies
 *   video.warm()                 the preload hint, from the scene's warm margin (kept until reduced motion lifts)
 *   video.destroy()              stops everything and pauses (a hidden route never keeps decoding), and puts back the
 *                                attributes it wrote (muted, playsinline, loop, poster, data-scene-media) as the markup had them
 *
 * Modes on one continuous clip: the head and tail either LOOP (sub-ranges whose endpoints match, so leaving a loop
 * means continuing to play) or HOLD a frame when no loop is given; the scrub band in between is driven by scroll.
 *
 *    head loop           scrub band                    tail loop
 *   from ── match−1↺   match ──────────────── from   from ── last−1↺
 *
 * - The asset must be ALL-INTRA (`scroll-animation media scrub`): a scrub seeks nearly every frame, and a long-GOP
 *   file decodes from the previous keyframe on each one.
 * - Two drivers, never at once: the band seeks the playhead with the decoder paused; a loop plays and wraps on
 *   `requestVideoFrameCallback`, whose `mediaTime` is the presented frame's exact index.
 * - The band TRACKS the scroll frame for frame: the frame it wants is the band's, rounded, in every mode that doesn't
 *   loop (a hold too, clamped to its end, so the playhead leaves the tail as soon as the band does, not after the
 *   mode's hysteresis). Smoothing belongs to the scroll (Lenis, native momentum); a second stage here trailed a fast
 *   skim by an eighth of the clip and leapt after every long frame. The one glide left is the handover out of a loop:
 *   the playhead's distance from the band decays at `glide` per 60 Hz frame (`dt`-based) while the band moves on, so
 *   a loop resolves into the scrub by playing the frames in between, not by cutting.
 * - One seek in flight, and only for a new frame: Gecko aborts a seek that a newer one replaces (nothing paints while
 *   they keep coming), where WebKit and Chromium hold the newest behind the running one. The moment one lands
 *   (`seeked`) the frame the band wants THEN is sent, so a slow decoder shows fewer frames, never older ones. Each
 *   seek lands a quarter frame into its frame, so float rounding can't show the frame before. A loop wrap and a snap
 *   skip the queue: behind a stale seek they would land a frame late. A band seek the element still reports
 *   `seeking` after `STUCK_SEEK_MS` is sent again: iOS has been seen to leave one pending for good, and the
 *   one-in-flight guard would then hold the frame for the rest of the visit. While a seek is pending `readyState`
 *   sits at HAVE_METADATA (measured in Chromium), so the check runs before the tick's wait for a frame.
 * - The tail's wrap sits one frame before the clip's end, and WebKit runs frame callbacks about 0.8 of a frame after
 *   presentation: a busy main thread let the tail run out, stop (`ended`) and sit paused until the watchdog. So a
 *   late callback wraps as soon as the loop's last frame is DUE (`wrapDue`), a rAF backstop wraps once it is half
 *   shown without a callback, and a loop that ends or pauses at its end anyway is re-wrapped and played at once.
 *   None of the three moves a wrap that runs on time: the loop's last frame keeps its full time on screen.
 * - Safari drops a `play()` issued mid-seek, so play waits for `seeked` (150 ms fallback). A watchdog re-issues
 *   `play()` when a loop should run but sits paused (Safari pauses a video it judges invisible, e.g. around a
 *   resize), throttled to one call per ~30 frames.
 * - A loop moves by itself for as long as the reader rests in its region, and WCAG 2.2.2 allows 5 s of that without a
 *   pause control. So each visit to a region gets `loopSeconds` (5) of looping; then the loop finishes its cycle and
 *   holds its seam frame on the band's side (`loopHoldTime`), and the scrub takes over from there. Leaving the region,
 *   or the loop restarting after the scene slept or the tab hid, starts a new budget.
 * - Scroll is durable truth; the playhead is derived. On resume (`rehydrate`) the playhead snaps with no glide, and a
 *   media element that lost its data after a long sleep gets ONE soft `load()`; the scene is asked to rehydrate
 *   again when metadata returns. A first load is never aborted, and a far-away scene never fetches before `warm()`.
 * - After every hide (a lock, a hidden tab, a bfcache stay) WebKit can leave the picture stale: seeks land, the time
 *   follows the scroll at `readyState` 4, frame callbacks fire, and the layer on screen keeps the old frame until the
 *   element plays. Nothing a page can read reports it, so it is not detected but prevented: the poster covers on the
 *   hide, and on the return the KICK runs unconditionally behind it (two frames, `play()`, the `playing` event as
 *   proof, `pause()`, a seek to the band's frame, the lift once it lands plus a frame). No `playing` within
 *   `KICK_PLAYING_MS`: one retry, then `load()` and a fresh prime (a load keeps the unlock), then `blocked` with the
 *   tap retry armed. Never a clone (a new element loses the unlock), and never a `play()` mid-scrub.
 * - Tiers: with `mobileSrc`, the desktop query picks the source one frame after mount (never in the hydrating
 *   commit), so only one tier is fetched. `onTier` tells the camera which crop is on screen.
 * - Reduced motion fetches no video: the poster is the scene. A managed source (`src`/`mobileSrc`) is not set, or is
 *   removed if reduced motion turns on mid-visit, which aborts its download; no warm margin, wake or rehydrate loads
 *   it. When reduced motion lifts, the source is set, and fetched if the scene is already warm. A source written in
 *   the markup is the page's: give it to the controller instead (GSAP: `data-src`) to keep it unloaded.
 * - Save-Data (`navigator.connection.saveData`) picks the smallest tier, `mobileSrc`, at every viewport; nothing else
 *   changes. It is followed live where `navigator.connection` fires `change` (Chromium), else read whenever the tier
 *   is picked: once per mount and on a breakpoint crossing. Safari and Firefox expose no `navigator.connection`.
 */
import { DESKTOP_QUERY } from '../config'
import { clamp01, type SceneMode } from '../scene'
import type { MediaTier } from './camera'

/** The head loop: its first frame, and the frame whose pose closes the cycle (never itself displayed). */
export interface HeadLoop {
  fromFrame: number
  matchFrame: number
}

/** The tail loop's first frame. Its match frame is the clip's own last frame, read from `duration`. */
export interface TailLoop {
  fromFrame: number
}

export interface VideoSources {
  src?: string
  /** The narrow tier, picked below the desktop query. */
  mobileSrc?: string
  poster?: string
  mobilePoster?: string
  /** Default: config.ts DESKTOP_QUERY. */
  desktopQuery?: string
}

export interface VideoControllerOptions extends VideoSources {
  /** The clip's frame rate, exactly. Default 30. */
  fps?: number
  /** Omit to hold frame 0 in the head. */
  headLoop?: HeadLoop | null
  /** Omit to hold the clip's last frame in the tail. */
  tailLoop?: TailLoop | null
  /** The handover out of a loop: the playhead's distance from the band decays by this per 60 Hz frame. Default 0.18
   * (about 150 ms). In the band the playhead tracks the scroll frame for frame. */
  glide?: number
  /** Seconds a head or tail loop may run per visit to its region. Default 5 (WCAG 2.2.2); `Infinity` only on a page
   * that gives the reader a pause control of its own. */
  loopSeconds?: number
  /** Media became ready (first load, a tier swap, a recovery): rehydrate the scene. Without it, the controller snaps
   * from the last state it was given. */
  onRehydrate?: (reason: 'metadata') => void
  /** The playhead as a band position, every tick while awake: the backdrop follows the render, not the scroll. */
  onPlayhead?: (band: number) => void
  onTier?: (tier: MediaTier) => void
  /**
   * The poster as its own image over the video (`<img data-scene-poster>` after it): the controller sets its source per
   * tier and lifts it only once the video presents the frame the scroll wants. Without it the poster is the video's
   * `poster` attribute, which a `play()` clears before any frame decodes: a blank, then frame 0, then the right frame.
   */
  posterElement?: HTMLImageElement | null
}

/** `data-scene-media` on the video: `blocked` while a play is refused (Low Power Mode), `live` once it shows the
 * scroll's frame (the poster lifts), empty otherwise. */
export type MediaState = '' | 'blocked' | 'live'

export interface VideoRehydrateState {
  mode: SceneMode
  band: number
  awake: boolean
  reason?: string
}

export interface VideoController {
  setMode(mode: SceneMode): void
  setBand(band: number): void
  setAwake(awake: boolean): void
  setReduced(reduced: boolean): void
  rehydrate(state: VideoRehydrateState): void
  warm(): void
  tier(): MediaTier | null
  timeline(): VideoTimeline
  debug(): Record<string, unknown>
  destroy(): void
}

/** The anchor times, in seconds. */
export interface VideoTimeline {
  fps: number
  /** Where the head sits: its loop's first frame, or frame 0 for a hold. */
  headFrom: number
  /** Where the band starts: the head loop's match frame, or frame 0. */
  scrubFrom: number
  /** Where the band ends and the tail sits: the tail loop's first frame, or the clip's last (NaN until known). */
  tailFrom: number
  /** The head loop's match frame index; null for a hold. */
  headMatch: number | null
  tailLoop: boolean
  /** Below this, a glide is done: half a frame. */
  glideRest: number
}

export function videoTimeline(
  fps: number,
  headLoop: HeadLoop | null | undefined,
  tailLoop: TailLoop | null | undefined,
  duration = Number.NaN,
): VideoTimeline {
  const last = lastFrame(duration, fps)
  return {
    fps,
    headFrom: headLoop ? headLoop.fromFrame / fps : 0,
    scrubFrom: headLoop ? headLoop.matchFrame / fps : 0,
    tailFrom: tailLoop ? tailLoop.fromFrame / fps : last / fps,
    headMatch: headLoop ? headLoop.matchFrame : null,
    tailLoop: !!tailLoop,
    glideRest: 0.5 / fps,
  }
}

/** The clip's last frame index; NaN until the duration is known. */
export function lastFrame(duration: number, fps: number): number {
  return Number.isFinite(duration) && duration > 0 ? Math.round(duration * fps) - 1 : Number.NaN
}

/** Where the band puts the playhead. */
export function bandTime(band: number, tl: VideoTimeline): number {
  return tl.scrubFrom + clamp01(band) * (tl.tailFrom - tl.scrubFrom)
}

/** The playhead as a band position (the backdrop's input). */
export function timeBand(time: number, tl: VideoTimeline): number {
  const span = tl.tailFrom - tl.scrubFrom
  return span > 0 ? clamp01((time - tl.scrubFrom) / span) : 0
}

/** Where a snap puts the playhead for a mode: the head's start, the band position, or the tail's start. */
export function targetTime(mode: SceneMode, band: number, tl: VideoTimeline): number {
  return mode === 'head' ? tl.headFrom : mode === 'tail' ? tl.tailFrom : bandTime(band, tl)
}

/** How far into its frame a band seek lands: a quarter frame, so float rounding can't show the frame before. */
export const FRAME_BIAS = 0.25

/** The frame showing at `time`: the one whose span contains it. */
export function frameOf(time: number, fps: number): number {
  return Math.floor(time * fps + 1e-6)
}

/** The time a seek to `frame` asks for. */
export function frameTime(frame: number, fps: number): number {
  return (frame + FRAME_BIAS) / fps
}

/** The frame the band wants for a playhead target: the nearest, within the clip (`last` is NaN until it is known). */
export function wantedFrame(time: number, fps: number, last: number): number {
  const frame = Math.max(0, Math.round(time * fps))
  return Number.isFinite(last) ? Math.min(frame, last) : frame
}

/**
 * Whether a loop must wrap now, from a frame callback: once its last frame (`matchFrame − 1`) is on screen, or already
 * DUE by the playback position when the callback runs late. WebKit runs frame callbacks about 0.8 of a frame after
 * presentation; one late by a whole frame used to leave the tail running into the clip's end. On time (Chromium fires
 * ahead of presentation), the due frame is never the later one and the wrap is exactly the presented-frame rule, so
 * the loop's last frame stays on screen for its full time. A playhead below the loop (arriving from the band) wraps
 * at once.
 */
export function wrapDue(presented: number, playback: number, matchFrame: number, wrapFrom: number, fps: number): boolean {
  const due = Math.max(Math.round(presented * fps), Math.floor(playback * fps + 1e-6))
  return due >= matchFrame - 1 || presented < wrapFrom - 0.001
}

/** The glide's per-tick fraction for a frame of `dtMs`, from a rate defined per 60 Hz frame. */
export function glideAlpha(glide: number, dtMs: number): number {
  return 1 - Math.pow(1 - glide, dtMs / (1000 / 60))
}

/** WCAG 2.2.2: motion that starts by itself and lasts more than 5 s needs a pause control. */
export const LOOP_SECONDS = 5

/**
 * Where a loop that has had its time holds: its seam frame on the band's side, so the scrub takes over with no jump.
 * The head holds its last frame (the band starts at its match frame); the tail holds its first (where the band ends).
 */
export function loopHoldTime(mode: SceneMode, tl: VideoTimeline): number {
  return mode === 'head' ? Math.max(0, (tl.headMatch ?? 1) - 1) / tl.fps : tl.tailFrom
}

interface NetworkInformationLike extends EventTarget {
  saveData?: boolean
}

function connection(): NetworkInformationLike | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: NetworkInformationLike }).connection
}

/** The tier to show now: the smallest (`mobileSrc`) under Save-Data, else the desktop query's. */
export function sourceTier(sources: VideoSources): MediaTier {
  if (!sources.mobileSrc) return 'desktop'
  if (connection()?.saveData === true) return 'mobile'
  return window.matchMedia(sources.desktopQuery ?? DESKTOP_QUERY).matches ? 'desktop' : 'mobile'
}

/**
 * `window.__scrub()` for a verification run: a snapshot of every live scrubbed video, so one console call from a
 * frozen tab says which layer died (no progress events, the scene asleep, `play()` refused, the loop idle). Off unless
 * the URL has `?motion-debug` or <html data-motion-debug>. Returns the unregister function.
 */
export function exposeDebug(snapshot: () => Record<string, unknown>): () => void {
  if (typeof window === 'undefined') return () => {}
  const on = 'motionDebug' in document.documentElement.dataset || new URLSearchParams(location.search).has('motion-debug')
  if (!on) return () => {}
  const w = window as Window & { __scrubSnapshots?: Set<() => Record<string, unknown>>; __scrub?: () => unknown[] }
  const all = (w.__scrubSnapshots ??= new Set())
  all.add(snapshot)
  w.__scrub = () => Array.from(all, (read) => read())
  return () => {
    all.delete(snapshot)
  }
}

const NETWORK_IDLE = 1
const NETWORK_LOADING = 2
const HAVE_CURRENT_DATA = 2

/** A band seek with no `seeked` after this long, in ms, is sent again. */
export const STUCK_SEEK_MS = 700

/** A kick's `play()` with no `playing` event after this long, in ms, failed: the next rung of the ladder runs. */
export const KICK_PLAYING_MS = 300

/** The ladder's last rung, `load()` and a fresh prime, waits this long, in ms, for `playing` before reading blocked. */
export const KICK_LOAD_MS = 2000

/** Covered with a frame to show and no lift for this long, in ms: the seek or the layer is wedged (WebKit, iPhone,
 * refreshed in view: `seeking` for seconds, one frame callback), and a kick runs behind the cover. */
export const LIFT_STALL_MS = 600

/** Kicks the stall watchdog runs before the scene reads `blocked`, so a tap reloads it: never covered for good. */
const STALL_KICKS = 2

/** The events that grant user activation (HTML: `touchend`, never `touchstart`), on which a refused prime retries. */
const ACTIVATION_EVENTS = ['touchend', 'pointerup', 'click', 'keydown'] as const

/** A touch that moved further than this, in px, between `touchstart` and `touchend` was a pan: no activation. */
const TAP_SLOP_PX = 10

/** A kick in flight (see `createVideoController`). */
interface KickRun {
  rung: 1 | 2 | 3
  phase: 'wait' | 'play' | 'seek'
  timer: number
  raf: number
  off: (() => void) | null
}

export function createVideoController(video: HTMLVideoElement, options: VideoControllerOptions = {}): VideoController {
  const fps = options.fps ?? 30
  const glide = options.glide ?? 0.18
  const loopMs = (options.loopSeconds ?? LOOP_SECONDS) * 1000
  const headLoop = options.headLoop ?? null
  const tailLoop = options.tailLoop ?? null
  let tl = videoTimeline(fps, headLoop, tailLoop, video.duration)

  let mode: SceneMode = 'head'
  let band = 0
  let awake = false
  let reduced = false
  let visible = document.visibilityState !== 'hidden'
  let destroyed = false

  const managed = !!(options.src || options.mobileSrc)
  let tier: MediaTier | null = managed ? null : 'desktop'
  let hasSource = managed ? false : !!(video.getAttribute('src') || video.querySelector('source'))
  let hadMetadata = validDuration()
  let recovering = false
  // iOS loads a never-played video's metadata and then idles: one muted play() per source starts its data.
  let primed = false
  // The scene reached its warm margin; and the first tier pick ran (the source waits a frame after mount).
  let warmed = false
  let picked = false

  let running = false
  let raf = 0
  let lastTick = 0
  let chain = 0
  let frameHandle = 0
  let seeking = false
  let pending: number | null = null
  // When the band's seek in flight was sent (performance.now()): one past STUCK_SEEK_MS is sent again.
  let seekSentAt = 0
  // A refused prime waits for the reader's next activation; `activating` is true inside that event.
  let activationArmed = false
  let activating = false
  // Where the touch in progress started (client px), to tell a tap from a pan at its touchend.
  let touchFrom: { x: number; y: number } | null = null
  // The stall watchdog: since when the cover has been up over a frame with no lift, and its kicks since the last lift.
  let coveredAt: number | null = null
  let stallKicks = 0
  // The latest prime: a refusal from an earlier one (a tap's pointerup, before the touchend that unlocked) is stale.
  let primeId = 0
  // This source has shown a frame: from then on a pending seek, not a missing frame, explains a low readyState.
  let framed = false
  // data-scene-media on the video, and how the element was unlocked (a gesture's play() or load()).
  let media: MediaState = ''
  let unlockedBy: 'play' | 'load' | null = null
  // Ticks the playhead has sat on the wanted frame with no seek pending: the reveal's fallback without frame callbacks.
  let settledTicks = 0
  // The page hid since the element last played: the layer on screen may be stale (WebKit), so a kick is owed before
  // the cover lifts again. Cleared by the kick, or by any play honoured while visible.
  let needsKick = false
  // The kick is owed by a tap's reload: a `playing` proves the layer only on the band's frame (a play from the head
  // proves the head, and the paused seek to the band after it may paint late: the reader saw it play its way there).
  let reloaded = false
  // The kick in flight: its rung (1 and 2 play and pause, 3 is load() and a fresh prime), what it waits on, and its
  // timers and listener, released by endKick().
  let kickRun: KickRun | null = null
  const posterEl = options.posterElement ?? null
  // A handover out of a loop: where the loop left the playhead (both adapters step the mode before they hand over the
  // event's band, so it is measured at the next drive), then its distance from the band in seconds, decaying to 0.
  let handoverFrom: number | null = null
  let handover = 0
  let playToken = 0
  let pausedTicks = 0
  let badTicks = 0
  // The loop's budget for this visit to its region: when it started playing, and whether it has had its time.
  let loopStartedAt: number | null = null
  let capped = false

  const stats = {
    ticks: 0,
    vframes: 0,
    plays: 0,
    rejections: 0,
    wraps: 0,
    holds: 0,
    recoveries: 0,
    kicks: 0,
    kickOk: 0,
    kickFail: 0,
    loads: 0,
    primes: 0,
    snaps: 0,
    reseeks: 0,
    unlocks: 0,
    stalls: 0,
    wakes: 0,
    lost: 0,
    vis: document.visibilityState as string,
    lastRehydrate: null as null | Record<string, unknown>,
  }

  const hasFrameCallback = typeof video.requestVideoFrameCallback === 'function'
  // What the markup had, before the writes below and setMedia(): destroy() puts each one back, so an unmount, a
  // remount or an Activity hide finds the element as the page wrote it. The source, the preload hint and a poster the
  // tier picked stay (media state, not motion: a route shown again doesn't fetch the clip again).
  const authored = {
    muted: video.muted,
    defaultMuted: video.defaultMuted,
    playsInline: video.playsInline,
    loop: video.loop,
    poster: video.getAttribute('poster'),
    media: video.getAttribute('data-scene-media'),
  }
  // A scrub video is never heard and never loops natively: the controller wraps its loops.
  video.muted = true
  // The attribute too: React sets `muted` as a property only, and the markup is what an autoplay policy may read first.
  video.defaultMuted = true
  // A poster image owns the cover: the attribute would vanish on the first play() and show the gap under it.
  if (posterEl) video.removeAttribute('poster')
  video.playsInline = true
  video.loop = false

  function validDuration() {
    return Number.isFinite(video.duration) && video.duration > 0
  }

  /** A decoded frame to show. Before one exists a seek would hide the poster (the spec clears its flag on seek) and
   * paint nothing, so nothing seeks until then. */
  const hasFrame = () => video.readyState >= HAVE_CURRENT_DATA

  const loops = (m: SceneMode) => (m === 'head' && tl.headMatch !== null) || (m === 'tail' && tl.tailLoop)
  const wrapFrom = (m: SceneMode) => (m === 'head' ? tl.headFrom : tl.tailFrom)
  const matchFrame = (m: SceneMode) => (m === 'head' ? (tl.headMatch ?? 0) : lastFrame(video.duration, fps))
  /** Where the band puts the playhead in every mode that doesn't loop. A hold follows it too (the band is clamped at
   * its ends), so on the way back the tail lets go where the band does, not after the mode's hysteresis. */
  const bandTarget = () => bandTime(band, tl)
  /** The frame to show now: the band's, plus what is left of a handover. */
  const wanted = () => wantedFrame(bandTarget() + handover, fps, lastFrame(video.duration, fps))

  // ── playback ────────────────────────────────────────────────────────

  function play() {
    stats.plays++
    video.play().catch(() => {
      stats.rejections++
    })
  }

  /** Play once no seek is in flight; dropped if the mode or the loop changed meanwhile. */
  function playWhenSeeked() {
    const token = ++playToken
    const go = () => {
      if (token === playToken && running && loops(mode) && !capped) play()
    }
    if (!video.seeking) {
      go()
      return
    }
    let done = false
    const finish = () => {
      if (done) return
      done = true
      video.removeEventListener('seeked', finish)
      window.clearTimeout(timer)
      go()
    }
    const timer = window.setTimeout(finish, 150)
    video.addEventListener('seeked', finish)
  }

  function pause() {
    playToken++
    video.pause()
  }

  // ── seeking ─────────────────────────────────────────────────────────

  const onSeeked = () => {
    if (pending !== null) {
      const next = pending
      pending = null
      seekSentAt = performance.now()
      video.currentTime = next
    } else {
      seeking = false
      // The decoder is free: the frame the band wants now, not one worked out a frame ago.
      drive()
    }
  }

  /** A loop's seek without frame callbacks (the rAF fallback): the newest one waits for the one in flight. */
  function seek(time: number) {
    if (!hasFrame()) return
    if (seeking) {
      pending = time
      return
    }
    seeking = true
    seekSentAt = performance.now()
    video.currentTime = time
  }

  /** The band's frame to the decoder: a seek only for a new frame, and none while one is in flight. */
  function drive() {
    // Never during a kick: it seeks the band's frame itself once the play has run, and a seek would drop the play.
    if (!running || loops(mode) || kickRun) return
    if (handoverFrom !== null) {
      handover = handoverFrom - bandTarget()
      handoverFrom = null
    }
    if (resendStuck() || seeking || !hasFrame()) return
    // A frame exists: count it now, since this seek drops readyState before any tick can see it.
    markFramed()
    const frame = wanted()
    if (frame === frameOf(video.currentTime, fps)) return
    seeking = true
    seekSentAt = performance.now()
    video.currentTime = frameTime(frame, fps)
  }

  /**
   * A band seek the element still reports `seeking` after STUCK_SEEK_MS: send the band's frame again, even if it is
   * the one already asked for. Only on a source that has shown a frame, so the poster was already gone.
   */
  function resendStuck(): boolean {
    if (!seeking || !video.seeking || !framed || loops(mode) || !validDuration()) return false
    if (performance.now() - seekSentAt <= STUCK_SEEK_MS) return false
    stats.reseeks++
    pending = null
    seekSentAt = performance.now()
    video.currentTime = frameTime(wanted(), fps)
    return true
  }

  /** Straight to `time`, past the queue: a wrap or a snap must not land behind a stale seek. */
  function jump(time: number) {
    seeking = false
    pending = null
    if (!hasFrame()) return
    try {
      seekSentAt = performance.now()
      video.currentTime = time
    } catch {
      // Not seekable yet: the poster still covers.
    }
  }

  const wrapInFlight = () => video.seeking && Math.abs(video.currentTime - wrapFrom(mode)) < tl.glideRest

  function wrap() {
    stats.wraps++
    jump(wrapFrom(mode))
  }

  /** A new visit to a region (or the loop restarting after a sleep): a fresh budget. */
  function freshLoop() {
    loopStartedAt = null
    capped = false
  }

  const loopSpent = () => loopStartedAt !== null && performance.now() - loopStartedAt >= loopMs

  /** The loop has had its time: stop on its seam frame until the reader leaves the region. */
  function hold() {
    capped = true
    stats.holds++
    pause()
    jump(loopHoldTime(mode, tl))
  }

  /** The loop reached its seam: on into the next cycle, or, once its time is up, held there. */
  function seam(resume: boolean) {
    if (loopSpent()) {
      hold()
      return
    }
    wrap()
    if (resume) playWhenSeeked()
  }

  /** A cold resume: pause, jump, and play again if a loop owns the mode. */
  function snap(time: number) {
    stats.snaps++
    pause()
    const clamped = Math.min(Math.max(0, time), Math.max(0, video.duration - 1 / fps))
    if (Math.abs(video.currentTime - clamped) >= tl.glideRest) jump(clamped)
    if (running && loops(mode) && !capped) playWhenSeeked()
  }

  function holdHead() {
    pause()
    if (validDuration() && Math.abs(video.currentTime - tl.headFrom) >= tl.glideRest) jump(tl.headFrom)
  }

  /**
   * iOS loads only metadata for a video that has never played, then idles (preload is a hint it ignores), so a scene
   * of holds would never get a frame: seeks go nowhere and the poster is all there is. A muted, inline play() is
   * allowed and starts the data; it pauses again at once unless a loop owns the mode, and the band's first seek takes
   * the playhead where the scroll wants it. Once per source, and again if the source loses its data. Refused (Low
   * Power Mode), the poster stays until the reader's next activation (`ACTIVATION_EVENTS`), which retries it inside
   * the event, where the play is allowed.
   */
  function prime(at: number | null = primeTime()) {
    primed = true
    stats.primes++
    // Armed before the play, until the source shows a frame: WebKit grants the play only inside the gesture's own
    // event (a tap's touchend or click, not the pointerup before them), and iOS may leave a refused play() pending for
    // good, so a retry can never wait for the refusal to settle.
    armActivation()
    const token = playToken
    const gesture = activating
    const id = ++primeId
    video.play().then(
      () => {
        if (gesture) unlockedBy = 'play'
        if (media === 'blocked') setMedia('')
        if (token === playToken && !(running && loops(mode) && !capped)) video.pause()
      },
      (error: unknown) => {
        // An AbortError is the scene's own pause landing first: the load has started all the same.
        if ((error as { name?: string } | null)?.name !== 'NotAllowedError') return
        stats.rejections++
        // A later prime is in flight (the touchend after a tap's pointerup): its outcome, not this one, says blocked.
        if (id !== primeId) return
        if (media !== 'live') setMedia('blocked')
        // The ladder's last rung was this prime: refused, the scene reads blocked now, not at the rung's timeout.
        if (kickRun?.rung === 3) kickFailed(kickRun)
      },
    )
    // Then straight to the scroll's frame, before anything decodes: the clip is all-intra, so the first frame it
    // presents is that one, never frame 0. After the play(), not before: Safari drops a play() issued mid-seek. Only
    // under a poster image: a seek clears the poster attribute, and with nothing decoded there is nothing to show.
    // Right after a load() (`at` worked out before it) this sets where playback starts once the metadata is back.
    if (at !== null) {
      try {
        seekSentAt = performance.now()
        video.currentTime = at
      } catch {
        // Not seekable yet: the poster still covers.
      }
    }
  }

  /** Where a prime sends the playhead: the scroll's frame (a loop: its target), or nowhere without a poster image or
   * a duration. */
  function primeTime() {
    if (!posterEl || !validDuration()) return null
    return loops(mode) ? targetTime(mode, band, tl) : frameTime(wanted(), fps)
  }

  /** The element as the markup had it (`authored`): the attributes and properties the controller wrote, put back. */
  function restoreMarkup() {
    if (authored.media === null) video.removeAttribute('data-scene-media')
    else video.setAttribute('data-scene-media', authored.media)
    // defaultMuted is the `muted` attribute; paused by stop(), the element is silent either way.
    video.defaultMuted = authored.defaultMuted
    video.muted = authored.muted
    video.playsInline = authored.playsInline
    video.loop = authored.loop
    if (posterEl && authored.poster !== null) video.setAttribute('poster', authored.poster)
  }

  /** `data-scene-media` on the video, written on change only. */
  function setMedia(next: MediaState) {
    if (next === media) return
    media = next
    video.setAttribute('data-scene-media', next)
    if (next === 'live') {
      stallKicks = 0
      disarmActivation()
    }
    else {
      settledTicks = 0
      armActivation()
    }
  }

  /** The frame on screen is the one the scroll wants (a loop: any frame of it): the poster may lift. */
  function onWantedFrame(time: number) {
    return loops(mode) || Math.abs(frameOf(time, fps) - wanted()) <= 1
  }

  /** Whether a prime would help now: no frame, nothing playing, nothing seeking, the network idle (iOS's cap). */
  function needsPrime() {
    return !reduced && hasSource && !primed && !hasFrame() && video.paused && !video.seeking
  }

  /**
   * Every activation event retries the prime synchronously, inside the event, while the source has no frame: the one
   * the browser honours is the one that plays. Asleep, it waits armed; once a frame shows, it disarms. While
   * `blocked`, every tap (a `touchend` that didn't pan, a click, a key) first calls `load()` inside the event.
   */
  function onActivation(event: Event) {
    if (destroyed || media === 'live') {
      disarmActivation()
      return
    }
    if (reduced || !hasSource) return
    // A touch that became a pan (a scroll, a pull to refresh) is no activation in WebKit: nothing to retry on.
    if (event.type === 'touchend' && panned(event as TouchEvent)) return
    // A tap's pointerup comes before its touchend and never carries the gesture in WebKit.
    const gesture = event.type !== 'pointerup'
    activating = true
    try {
      if (gesture && media === 'blocked') {
        // Refused, whatever the element claims. WebKit unpauses on play() before its media session admits the play,
        // and an interrupted session's pause() returns early, so a refused element can read `paused` false with no
        // frame and no `playing`, for good: a retry gated on `paused` never ran again (iPhone, refreshed in view).
        // load() inside the gesture resets it and lifts the restriction for the element; the play follows in the
        // same event, then pauses, and the reveal runs behind the poster as on any prime (if it never lifts, the
        // stall watchdog in the tick kicks). The band's time is read before the load() empties the duration; set
        // after the play, it is where playback starts: never frame 0.
        const at = primeTime()
        if (kickRun) endKick(kickRun)
        unlock()
        if (running) prime(at)
        else primed = false
      } else if (running) {
        // Until the video shows the scroll's frame, a frame it merely claims (readyState after a lock) is no proof.
        if (video.paused) prime()
      } else if (
        gesture &&
        !hasFrame() &&
        !unlockedBy &&
        !primed &&
        video.networkState !== NETWORK_LOADING
      ) {
        // Not running: a load() inside the gesture lifts WebKit's gesture restriction for this element, so a tap
        // anywhere on the way down unlocks it before it arrives. Only on the events WebKit counts (a tap's touchend
        // or click, a key), never the pointerup before them, since the load runs once. Never with a frame or a
        // download in flight, which it would restart; with preload="none" it fetches nothing. The next wake primes
        // again, now allowed.
        unlock()
        primed = false
      }
    } finally {
      activating = false
    }
  }

  /** `load()` inside a gesture: it lifts WebKit's gesture restriction for this element and drops whatever play it
   * held. The cover stays, no longer `blocked`, so the same tap's later events (the click after its touchend) don't
   * load again; a refusal of the play that follows reads `blocked` once more. */
  function unlock() {
    stats.unlocks++
    framed = false
    // A reloaded element has painted nothing and isn't proven until it plays, and the tap's own play rarely gets there
    // (the metadata's rehydrate snaps, and its pause cuts the play before `playing`). So the kick is owed: the cover
    // stays until a `playing` and the band's landed seek, as after a hide (iPhone, the tap after a refresh in view:
    // lifted onto an empty layer, a white flash, then a scrub that skipped frames through stuck seeks).
    needsKick = true
    reloaded = true
    video.load()
    unlockedBy = 'load'
    if (media === 'blocked') setMedia('')
  }

  const onTouchStart = (event: Event) => {
    const touch = (event as TouchEvent).touches?.[0]
    touchFrom = touch ? { x: touch.clientX, y: touch.clientY } : null
  }

  /** The touch moved past `TAP_SLOP_PX` since it started. Unknown (no coordinates): a tap. */
  function panned(event: TouchEvent) {
    const from = touchFrom
    touchFrom = null
    const touch = event.changedTouches?.[0]
    if (!from || !touch) return false
    return Math.hypot(touch.clientX - from.x, touch.clientY - from.y) > TAP_SLOP_PX
  }

  /** The source has shown a frame: the prime did its job. */
  function markFramed() {
    framed = true
  }

  function armActivation() {
    if (activationArmed || destroyed) return
    activationArmed = true
    window.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
    for (const type of ACTIVATION_EVENTS) window.addEventListener(type, onActivation, { capture: true, passive: true })
  }

  function disarmActivation() {
    if (!activationArmed) return
    activationArmed = false
    touchFrom = null
    window.removeEventListener('touchstart', onTouchStart, { capture: true })
    for (const type of ACTIVATION_EVENTS) window.removeEventListener(type, onActivation, { capture: true })
  }

  // ── the per-frame loop, only while awake ─────────────────────────────

  /** One frame-callback chain per run: a restart kills the old chain (it checks its id), so wakes never pile up. */
  function startChain() {
    const id = ++chain
    const onFrame: VideoFrameRequestCallback = (_now, meta) => {
      if (id !== chain) return
      stats.vframes++
      // The frame the scroll wants is on screen: lift the poster, in this callback, with nothing in between.
      // Never while a kick is owed: after a hide this callback reports a frame the layer may not show.
      if (media !== 'live' && !kickOwed() && !video.seeking && onWantedFrame(meta.mediaTime)) setMedia('live')
      if (loops(mode) && !capped && !wrapInFlight() && wrapDue(meta.mediaTime, video.currentTime, matchFrame(mode), wrapFrom(mode), fps)) {
        seam(false)
      }
      frameHandle = video.requestVideoFrameCallback(onFrame)
    }
    frameHandle = video.requestVideoFrameCallback(onFrame)
  }

  function tick(now: number) {
    raf = requestAnimationFrame(tick)
    const dt = lastTick ? Math.min(100, now - lastTick) : 1000 / 60
    lastTick = now

    if (!validDuration()) {
      if (++badTicks > 45) {
        badTicks = 0
        if (needsReload()) reload()
      }
      return
    }
    badTicks = 0
    stats.ticks++
    if (needsKick && !kickRun && hasFrame()) {
      // Back from a hide with data the element still claims: kick it behind the cover. Already blocked, the tap's
      // prime plays it, which is the same cure.
      if (media === 'blocked') needsKick = reloaded = false
      else startKick(1)
    }
    // The kick's last rung owns the prime: no second one from here.
    if (kickRun) return
    if (!hasFrame()) {
      // A pending seek holds readyState at HAVE_METADATA: a hung one is re-sent here, or the tick would never see it.
      // Never prime under a recent pending seek: a play() there ran a held tail to its end. One older than
      // STUCK_SEEK_MS that isn't ours to re-send (left from before a hide) no longer blocks recovery.
      if (resendStuck() || seeking) return
      if (video.seeking && performance.now() - seekSentAt <= STUCK_SEEK_MS) return
      // No frame and no seek to explain it: a source that had one lost it (iOS drops a sleeping clip's data), so it
      // is primed again, and waits for a fresh gesture if that is refused.
      if (framed) {
        framed = false
        primed = false
        // The cover goes back over the hole.
        if (media === 'live') setMedia('')
      }
      if (!primed && video.paused && (video.networkState === NETWORK_IDLE || video.seeking)) prime()
      return
    }
    markFramed()
    const time = video.currentTime
    // Without frame callbacks (or before one fires): two settled ticks on the wanted frame, no seek pending.
    if (media !== 'live' && !kickOwed()) {
      if (!seeking && !video.seeking && onWantedFrame(time)) {
        if (++settledTicks >= 3) setMedia('live')
      } else settledTicks = 0
    }
    // Never covered for good over a frame: no lift within LIFT_STALL_MS, the kick (a play unwedges what a paused
    // seek can't), and past STALL_KICKS of them `blocked`, where the next tap reloads the element.
    if (media === '' && !kickOwed()) {
      coveredAt ??= now
      if (now - coveredAt > LIFT_STALL_MS) {
        coveredAt = null
        stats.stalls++
        if (++stallKicks > STALL_KICKS) setMedia('blocked')
        else startKick(1)
        return
      }
    } else coveredAt = null

    if (loops(mode) && !capped) {
      const match = matchFrame(mode)
      if (video.paused) {
        if (video.ended || time >= (match - 1) / fps) {
          // Ran out, or paused at the loop's end: wrap and play now, not a watchdog period later.
          stats.recoveries++
          seam(true)
        } else if (++pausedTicks > 30) {
          pausedTicks = 0
          play()
        }
      } else {
        pausedTicks = 0
        loopStartedAt ??= performance.now()
        if (hasFrameCallback) {
          // Backstop: the loop's last frame is half shown and no frame callback has wrapped it.
          if (time * fps >= match - 0.5 && !wrapInFlight()) seam(false)
        } else if (time >= (match - 1) / fps) {
          // No frame callbacks: polling can't be frame-accurate, so wrap a full frame early. Losing a cycle's last
          // frame is cheap; showing the next cycle's first frame early is the visible fault.
          if (loopSpent()) hold()
          else seek(wrapFrom(mode))
        } else if (time < wrapFrom(mode) - 0.001) {
          seek(wrapFrom(mode))
        }
      }
    } else if (!loops(mode)) {
      // The scrub never plays: a play that starts late (WebKit defers one issued under an interruption to its end, and
      // drops a pause issued meanwhile) is paused the frame it shows, and the band's seek follows.
      if (media === 'live' && !video.paused) pause()
      if (handover !== 0) {
        handover *= 1 - glideAlpha(glide, dt)
        if (Math.abs(handover) < tl.glideRest) handover = 0
      }
      drive()
    }

    options.onPlayhead?.(timeBand(video.currentTime, tl))
  }

  function start() {
    running = true
    seeking = false
    pending = null
    handoverFrom = null
    handover = 0
    pausedTicks = 0
    badTicks = 0
    lastTick = 0
    coveredAt = null
    stallKicks = 0
    freshLoop()
    video.addEventListener('seeked', onSeeked)
    if (hasFrameCallback) startChain()
    raf = requestAnimationFrame(tick)
  }

  function stop() {
    running = false
    // Still owed: it runs again when the scene does.
    if (kickRun) {
      endKick(kickRun)
      needsKick = true
    }
    chain++
    if (frameHandle) video.cancelVideoFrameCallback?.(frameHandle)
    frameHandle = 0
    cancelAnimationFrame(raf)
    video.removeEventListener('seeked', onSeeked)
    pause()
  }

  function updateRun() {
    const should = awake && !reduced && visible && hasSource && !destroyed
    if (should && !running) start()
    else if (!should && running) stop()
  }

  // ── media readiness and recovery ─────────────────────────────────────

  /** Never abort a first load in flight, never fetch a far-away scene before its warm margin, never under reduced
   * motion. */
  function needsReload() {
    return hasSource && !reduced && !recovering && (hadMetadata || (awake && video.networkState !== NETWORK_LOADING))
  }

  function reload() {
    recovering = true
    primed = false
    framed = false
    setMedia('')
    stats.loads++
    video.preload = 'auto'
    try {
      video.load()
    } catch {
      recovering = false
    }
  }

  const onMetadata = () => {
    hadMetadata = true
    recovering = false
    badTicks = 0
    tl = videoTimeline(fps, headLoop, tailLoop, video.duration)
    if (options.onRehydrate) options.onRehydrate('metadata')
    else rehydrate({ mode, band, awake, reason: 'metadata' })
  }

  /**
   * The network went idle with no frame (iOS caps preload at metadata): prime here, at the warm margin, so a refusal
   * is known (and `data-scene-media="blocked"` set) about 400 px before the scene wakes, and an allowed prime starts
   * the data that early. Desktop engines keep loading to a frame, so this never runs there.
   */
  const onSuspend = () => {
    if (warmed && !running && needsPrime() && validDuration() && video.networkState === NETWORK_IDLE) prime()
  }

  const onEnded = () => {
    if (!running || !loops(mode) || capped) return
    stats.recoveries++
    seam(true)
  }

  /**
   * A return (unlock, wake, a tab shown, a bfcache restore, focus): what the element held before may be gone. iOS
   * pauses and may evict a hidden page's media, leave a seek pending across the lock, and drop the unlock. Seek state
   * from before is stale; a missing frame puts the cover back and primes again; data the element still claims is
   * re-primed once after a real hide; the activation retry is re-armed and `load()` may unlock again.
   */
  function onReturn(hidden: boolean) {
    if (destroyed) return
    stats.wakes++
    // Any seek the element still reports is from before: older than any threshold.
    seekSentAt = -Infinity
    pending = null
    seeking = false
    primed = false
    unlockedBy = null
    if (hidden) onHide()
    if (!hasFrame()) {
      if (framed) stats.lost++
      framed = false
      setMedia('')
    }
    armActivation()
  }

  /** The page hid: a kick is owed, and the cover goes up now, while nothing can be seen anyway. */
  function onHide() {
    needsKick = true
    if (kickRun) endKick(kickRun)
    if (media === 'live') setMedia('')
  }

  const kickOwed = () => needsKick || kickRun !== null

  /** The frame the kick ends on: the band's, or a held loop's seam. */
  const kickTarget = () => (capped && loops(mode) ? loopHoldTime(mode, tl) : frameTime(wanted(), fps))

  /**
   * One rung of the kick ladder, behind the cover. Rungs 1 and 2: wait two frames (WebKit may drop a play() issued
   * while the lock's interruption is still ending), then play(); the `playing` event is the proof it ran. Rung 3:
   * load() (it keeps the unlock) and a fresh prime at the band's frame.
   */
  function startKick(rung: 1 | 2 | 3) {
    if (media === 'live') setMedia('')
    seeking = false
    pending = null
    const run: KickRun = { rung, phase: 'wait', timer: 0, raf: 0, off: null }
    kickRun = run
    if (rung === 1) stats.kicks++
    if (rung === 3) {
      stats.loads++
      run.phase = 'play'
      run.timer = window.setTimeout(() => kickFailed(run), KICK_LOAD_MS)
      framed = false
      // Read before the load() empties the duration; set after the prime's play, it is where playback starts.
      const at = primeTime()
      try {
        video.load()
      } catch {
        // The timeout reads blocked.
      }
      prime(at)
      return
    }
    // From the band's frame: the frames the play shows before its pause are the band's, never the ones between where
    // the element sat (the head, after a reload) and the band. One direct seek, landing during the two frames' wait.
    const target = kickTarget()
    if (hasFrame() && !video.seeking && frameOf(video.currentTime, fps) !== frameOf(target, fps)) {
      try {
        seekSentAt = performance.now()
        video.currentTime = target
      } catch {
        // Not seekable: the play runs from where it is, under the cover.
      }
    }
    const go = () => {
      run.off?.()
      run.off = null
      if (kickRun !== run) return
      run.phase = 'play'
      run.timer = window.setTimeout(() => kickFailed(run), KICK_PLAYING_MS)
      stats.plays++
      video.play().catch((error: unknown) => {
        // An AbortError is a pause landing first (a hide, the scene sleeping): its own path takes over.
        if ((error as { name?: string } | null)?.name !== 'NotAllowedError') return
        stats.rejections++
        kickFailed(run)
      })
    }
    run.raf = requestAnimationFrame(() => {
      run.raf = requestAnimationFrame(() => {
        run.raf = 0
        if (kickRun !== run) return
        if (!video.seeking) return go()
        // Safari drops a play() issued mid-seek: after the band's seek lands (or 150 ms).
        const timer = window.setTimeout(go, 150)
        video.addEventListener('seeked', go, { once: true })
        run.off = () => {
          window.clearTimeout(timer)
          video.removeEventListener('seeked', go)
        }
      })
    })
  }

  /** No `playing` in time, or refused: the next rung, and past the last one blocked, with the tap retry armed. */
  function kickFailed(run: KickRun) {
    if (kickRun !== run || run.phase !== 'play') return
    stats.kickFail++
    endKick(run)
    if (run.rung === 3) {
      needsKick = reloaded = false
      setMedia('blocked')
      return
    }
    // A play still pending must not start later, under the scrub.
    pause()
    startKick(run.rung === 1 ? 2 : 3)
  }

  /** The kick's play ran (or any play while one is owed): pause, seek the band's frame, lift once it lands. */
  const onPlaying = () => {
    const run = kickRun
    if (!run) {
      // An honoured play resets what the hide left behind: the kick is no longer owed. After a tap's reload, only a
      // play on the band's frame does (WebKit starts it at the time set before the data; an older build may not).
      if (visible && (!reloaded || onWantedFrame(video.currentTime))) needsKick = reloaded = false
      return
    }
    if (run.phase !== 'play') return
    window.clearTimeout(run.timer)
    stats.kickOk++
    // The last rung's prime pauses itself; a loop that owns the mode keeps playing. Either way the usual reveal lifts
    // (and the stall watchdog kicks if it never does).
    if (run.rung === 3 || (running && loops(mode) && !capped)) {
      endKick(run)
      needsKick = reloaded = false
      return
    }
    pause()
    run.phase = 'seek'
    const landed = () => {
      run.raf = requestAnimationFrame(() => {
        run.raf = 0
        if (kickRun !== run) return
        endKick(run)
        needsKick = reloaded = false
        // The lift: the seek landed and a frame has passed. Scrolled on meanwhile, the usual reveal takes it.
        if (media !== 'live' && !video.seeking && onWantedFrame(video.currentTime)) setMedia('live')
      })
    }
    video.addEventListener('seeked', landed, { once: true })
    run.off = () => video.removeEventListener('seeked', landed)
    // A `seeked` that never comes: lift anyway if the seek has landed on the band's frame with a frame to show, else
    // leave it to the stall watchdog's next kick.
    run.timer = window.setTimeout(() => {
      if (kickRun !== run) return
      endKick(run)
      needsKick = reloaded = false
      if (media !== 'live' && hasFrame() && !video.seeking && onWantedFrame(video.currentTime)) setMedia('live')
    }, STUCK_SEEK_MS)
    try {
      seekSentAt = performance.now()
      video.currentTime = kickTarget()
    } catch {
      endKick(run)
      needsKick = reloaded = false
    }
  }

  /** `video.buffered` as "from-to" seconds, comma-separated: the device readout's view of what a seek can reach. */
  function bufferedRanges() {
    const out: string[] = []
    try {
      const b = video.buffered
      for (let i = 0; i < (b?.length ?? 0); i++) out.push(`${b.start(i).toFixed(2)}-${b.end(i).toFixed(2)}`)
    } catch {
      // Not readable yet.
    }
    return out.join(',')
  }

  /** Releases the kick's timers and listener; whether the kick is still owed is the caller's. */
  function endKick(run: KickRun) {
    window.clearTimeout(run.timer)
    if (run.raf) cancelAnimationFrame(run.raf)
    run.off?.()
    if (kickRun === run) kickRun = null
  }

  /** The element dropped its data (a load(), iOS evicting a hidden page's media): it will show frame 0 next, so the
   * cover goes back now, even while hidden, and the source must show the scroll's frame again before it lifts. */
  const onEmptied = () => {
    if (framed) stats.lost++
    framed = false
    primed = false
    setMedia('')
  }

  let wasHidden = document.visibilityState === 'hidden'
  const onVisibility = () => {
    visible = document.visibilityState !== 'hidden'
    stats.vis = document.visibilityState
    if (!visible) {
      wasHidden = true
      onHide()
    } else if (wasHidden) {
      wasHidden = false
      onReturn(true)
    }
    updateRun()
  }
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) onReturn(true)
  }
  const onPageHide = () => onHide()
  // Focus after a hide whose visible return went unreported: take the return from here.
  const onFocus = () => {
    if (!visible && document.visibilityState !== 'hidden') onVisibility()
    onReturn(false)
  }

  video.addEventListener('loadedmetadata', onMetadata)
  video.addEventListener('suspend', onSuspend)
  video.addEventListener('emptied', onEmptied)
  video.addEventListener('ended', onEnded)
  video.addEventListener('playing', onPlaying)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pageshow', onPageShow)
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('focus', onFocus)

  // ── tiers ───────────────────────────────────────────────────────────

  const query = managed && options.mobileSrc ? window.matchMedia(options.desktopQuery ?? DESKTOP_QUERY) : null
  const network = query ? connection() : undefined
  /**
   * The picked tier's poster and source. Under reduced motion the poster is the scene: no source at all, so neither
   * the warm margin, a wake nor a rehydrate can fetch a byte of video; turned on mid-visit, the source goes (which
   * aborts its download) and comes back when reduced motion lifts.
   */
  function syncSource() {
    picked = true
    const next = sourceTier(options)
    const src = reduced ? null : next === 'mobile' ? options.mobileSrc : (options.src ?? options.mobileSrc)
    const poster = next === 'mobile' ? (options.mobilePoster ?? options.poster) : options.poster
    if (poster) {
      if (posterEl) {
        if (posterEl.getAttribute('src') !== poster) posterEl.src = poster
      } else if (video.getAttribute('poster') !== poster) video.poster = poster
    }
    const current = video.getAttribute('src')
    if (src ? current !== src : current) {
      hadMetadata = false
      recovering = false
      primed = false
      framed = false
      setMedia('')
      if (src) video.src = src
      else {
        video.removeAttribute('src')
        video.load()
      }
    }
    hasSource = !!src
    const changed = next !== tier
    tier = next
    updateRun()
    if (changed) options.onTier?.(next)
  }
  const tierFrame = managed ? requestAnimationFrame(syncSource) : 0
  // Armed from the start, so a tap anywhere before the scene arrives unlocks it (onActivation).
  armActivation()
  query?.addEventListener('change', syncSource)
  network?.addEventListener?.('change', syncSource)

  // ── the scene's inputs ───────────────────────────────────────────────

  function rehydrate(state: VideoRehydrateState) {
    if (destroyed) return
    if (state.mode !== mode) freshLoop()
    mode = state.mode
    band = state.band
    awake = state.awake
    stats.lastRehydrate = { reason: state.reason ?? null, mode, band: +band.toFixed(4), awake }
    updateRun()
    if (!hasSource) return
    if (!validDuration()) {
      // Metadata will rehydrate the scene again; until then only a lost resource gets a kick. A first load isn't
      // kicked here: networkState turns LOADING a task after `src`/`preload` change, so a rehydrate right after the
      // warm margin reads "idle" and a load() would restart that download (measured: 1.76x the clip in Chromium).
      // A load that never starts (iOS ignoring preload) is the tick's to kick, 45 idle frames on.
      if (hadMetadata && needsReload()) reload()
      return
    }
    if (reduced) holdHead()
    else if (!running) pause()
    else if (kickRun) {
      // A snap would pause the kick's play: the kick ends on the band's frame itself.
      handoverFrom = null
      handover = 0
    } else {
      // A resume snaps: no frame between a stale playhead and the right one is worth showing, not even a handover's.
      handoverFrom = null
      handover = 0
      snap(capped ? loopHoldTime(mode, tl) : loops(mode) ? targetTime(mode, band, tl) : frameTime(wanted(), fps))
    }
  }

  return {
    setMode(next) {
      if (destroyed || next === mode) return
      const looped = loops(mode)
      mode = next
      freshLoop()
      if (!running) return
      if (loops(next)) {
        // Play from wherever the band left the playhead: the frames in between play, and the frame callback wraps
        // into the loop. (v1 left it paused for the watchdog, about 31 frames.)
        pending = null
        handoverFrom = null
        handover = 0
        playWhenSeeked()
      } else {
        // The band (or a hold) owns the playhead from here: the decoder must not free-run under it.
        pause()
        // Out of a loop, the playhead glides to the band from wherever the loop left it.
        if (looped && validDuration()) handoverFrom = video.currentTime
      }
    },
    setBand(next) {
      band = next
      // Straight to the decoder: the frame follows the progress event that moved it, whatever the rAF order.
      drive()
    },
    setAwake(next) {
      if (destroyed) return
      awake = next
      updateRun()
    },
    setReduced(next) {
      if (destroyed || next === reduced) return
      reduced = next
      // Lifted after the warm margin: fetch as the warm margin would have. The source follows the setting.
      if (!reduced && warmed && video.preload !== 'auto') video.preload = 'auto'
      if (managed && picked) syncSource()
      updateRun()
      if (reduced) holdHead()
    },
    rehydrate,
    warm() {
      warmed = true
      if (!reduced && video.preload !== 'auto') video.preload = 'auto'
      onSuspend()
    },
    tier: () => tier,
    timeline: () => tl,
    debug() {
      return {
        ...stats,
        mode,
        band: +band.toFixed(4),
        awake,
        reduced,
        running,
        warmed,
        source: video.getAttribute('src'),
        capped,
        loopMs: loopStartedAt === null ? null : Math.round(performance.now() - loopStartedAt),
        tier,
        target: +bandTarget().toFixed(3),
        handover: +handover.toFixed(3),
        time: +video.currentTime.toFixed(3),
        paused: video.paused,
        ready: video.readyState,
        media,
        blocked: media === 'blocked',
        live: media === 'live',
        unlockedBy,
        kicking: kickRun ? `${kickRun.rung}:${kickRun.phase}` : needsKick ? 'owed' : null,
        // What the element holds: its buffered ranges in seconds, and the preload it was given.
        buf: bufferedRanges(),
        preload: video.preload,
        duration: validDuration() ? +video.duration.toFixed(3) : null,
      }
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      stop()
      disarmActivation()
      restoreMarkup()
      cancelAnimationFrame(tierFrame)
      query?.removeEventListener('change', syncSource)
      network?.removeEventListener?.('change', syncSource)
      video.removeEventListener('loadedmetadata', onMetadata)
      video.removeEventListener('suspend', onSuspend)
      video.removeEventListener('emptied', onEmptied)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('playing', onPlaying)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('focus', onFocus)
    },
  }
}
