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
 *   video.destroy()              stops everything and pauses (a hidden route never keeps decoding)
 *
 * Modes on one continuous clip: the head and tail either LOOP (sub-ranges whose endpoints match, so leaving a loop
 * means continuing to play) or HOLD a frame when no loop is given; the scrub band in between is driven by scroll.
 *
 *    head loop           scrub band                    tail loop
 *   from ── match−1↺   match ──────────────── from   from ── last−1↺
 *
 * - The asset must be ALL-INTRA (`scroll-animation media scrub`): a scrub seeks nearly every frame, and a long-GOP
 *   file decodes from the previous keyframe on each one.
 * - Two drivers, never at once: the band glides the playhead from rAF with the decoder paused; a loop plays and
 *   wraps on `requestVideoFrameCallback`, whose `mediaTime` is the presented frame's exact index. A glide is an
 *   exponential approach from wherever the playhead is, so a loop resolves into the scrub by playing the frames in
 *   between, not by cutting. It is `dt`-based: `glide` is the rate per 60 Hz frame.
 * - Seeks coalesce: one issued while another is in flight is dropped by the browser, so only the newest waits. A
 *   loop wrap and a snap bypass the queue: queued behind a stale seek they would land a frame late.
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
  /** Exponential approach per 60 Hz frame for the scrub glide. Default 0.18 (about 150 ms to settle). */
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
}

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
    primes: 0,
    snaps: 0,
    lastRehydrate: null as null | Record<string, unknown>,
  }

  const hasFrameCallback = typeof video.requestVideoFrameCallback === 'function'
  // A scrub video is never heard and never loops natively: the controller wraps its loops.
  video.muted = true
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
  /** A hold's resting time; the band's target in the scrub. */
  const glideTarget = () => (mode === 'scrub' ? bandTime(band, tl) : mode === 'head' ? tl.scrubFrom : tl.tailFrom)

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
      video.currentTime = next
    } else {
      seeking = false
    }
  }

  function seek(time: number) {
    if (!hasFrame()) return
    if (seeking) {
      pending = time
      return
    }
    seeking = true
    video.currentTime = time
  }

  /** Straight to `time`, past the queue: a wrap or a snap must not land behind a stale glide target. */
  function jump(time: number) {
    seeking = false
    pending = null
    if (!hasFrame()) return
    try {
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
   * allowed and starts the data; it pauses again at once unless a loop owns the mode, and the glide takes the playhead
   * where the scroll wants it. Once per source. Refused (Low Power Mode), the poster simply stays.
   */
  function prime() {
    primed = true
    stats.primes++
    const token = playToken
    video.play().then(
      () => {
        if (token === playToken && !(running && loops(mode) && !capped)) video.pause()
      },
      (error: unknown) => {
        // An AbortError is the scene's own pause landing first: the load has started all the same.
        if ((error as { name?: string } | null)?.name === 'NotAllowedError') stats.rejections++
      },
    )
  }

  // ── the per-frame loop, only while awake ─────────────────────────────

  /** One frame-callback chain per run: a restart kills the old chain (it checks its id), so wakes never pile up. */
  function startChain() {
    const id = ++chain
    const onFrame: VideoFrameRequestCallback = (_now, meta) => {
      if (id !== chain) return
      stats.vframes++
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
        if (needsKick()) kick()
      }
      return
    }
    badTicks = 0
    stats.ticks++
    if (!hasFrame()) {
      if (!primed && video.paused && video.networkState === NETWORK_IDLE) prime()
      return
    }
    const time = video.currentTime

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
      const target = glideTarget()
      const delta = target - time
      if (Number.isFinite(delta) && Math.abs(delta) >= tl.glideRest) seek(time + delta * glideAlpha(glide, dt))
    }

    options.onPlayhead?.(timeBand(video.currentTime, tl))
  }

  function start() {
    running = true
    seeking = false
    pending = null
    pausedTicks = 0
    badTicks = 0
    lastTick = 0
    freshLoop()
    video.addEventListener('seeked', onSeeked)
    if (hasFrameCallback) startChain()
    raf = requestAnimationFrame(tick)
  }

  function stop() {
    running = false
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
  function needsKick() {
    return hasSource && !reduced && !recovering && (hadMetadata || (awake && video.networkState !== NETWORK_LOADING))
  }

  function kick() {
    recovering = true
    primed = false
    stats.kicks++
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

  const onEnded = () => {
    if (!running || !loops(mode) || capped) return
    stats.recoveries++
    seam(true)
  }

  const onVisibility = () => {
    visible = document.visibilityState !== 'hidden'
    updateRun()
  }

  video.addEventListener('loadedmetadata', onMetadata)
  video.addEventListener('ended', onEnded)
  document.addEventListener('visibilitychange', onVisibility)

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
    if (poster && video.getAttribute('poster') !== poster) video.poster = poster
    const current = video.getAttribute('src')
    if (src ? current !== src : current) {
      hadMetadata = false
      recovering = false
      primed = false
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
      if (hadMetadata && needsKick()) kick()
      return
    }
    if (reduced) holdHead()
    else if (!running) pause()
    else snap(capped ? loopHoldTime(mode, tl) : targetTime(mode, band, tl))
  }

  return {
    setMode(next) {
      if (destroyed || next === mode) return
      mode = next
      freshLoop()
      if (!running) return
      if (loops(next)) {
        // Play from wherever the band left the playhead: the frames in between play, and the frame callback wraps
        // into the loop. (v1 left it paused for the watchdog, about 31 frames.)
        pending = null
        playWhenSeeked()
      } else {
        // The band (or a hold) owns the playhead from here: the decoder must not free-run under the glide.
        pause()
      }
    },
    setBand(next) {
      band = next
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
        target: +glideTarget().toFixed(3),
        time: +video.currentTime.toFixed(3),
        paused: video.paused,
        ready: video.readyState,
        duration: validDuration() ? +video.duration.toFixed(3) : null,
      }
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      stop()
      cancelAnimationFrame(tierFrame)
      query?.removeEventListener('change', syncSource)
      network?.removeEventListener?.('change', syncSource)
      video.removeEventListener('loadedmetadata', onMetadata)
      video.removeEventListener('ended', onEnded)
      document.removeEventListener('visibilitychange', onVisibility)
    },
  }
}
