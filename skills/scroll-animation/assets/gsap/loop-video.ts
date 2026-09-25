/**
 * `[data-loop-video]` — a background render that starts when it is ~20% on
 * screen and pauses when it leaves. v2 of `inViewLoopVideo.ts`
 * (`assets/gsap/inViewLoopVideo.ts`, kept in place — the controller removes
 * v1's files with the v1 barrels later). Carries v1's playback core forward
 * unchanged and adds the pieces v1 didn't have: a WCAG 2.2.2 pause control,
 * live reduced-motion and Save-Data gating, rejected-`play()` handling, and
 * a play watchdog + tab-sleep rehydrate ported from the sibling `ScrubStage`
 * controller's pattern.
 *
 * ```html
 * <div style="position: relative">
 *   <video data-loop-video poster="…" muted playsinline preload="none"
 *          data-loop-from-frame="73" data-fps="60" data-duration="4.2">
 *     <source src="…webm" type="video/webm" />
 *     <source src="…mp4" type="video/mp4" />
 *   </video>
 *   <!-- optional: wired if present; auto-created next to the video if not
 *        (see "the toggle control" below) -->
 *   <button type="button" data-loop-toggle>Pause</button>
 * </div>
 * ```
 *
 * ```js
 * import { initLoopVideos } from './loop-video'
 * const videos = initLoopVideos(routeRoot)
 * // later, on hide/teardown:
 * videos.destroy()
 * ```
 *
 * For a single element instead of an attribute scan, call `loopVideo(el, opts)`
 * directly — `initLoopVideos` is a thin wrapper that reads the same options
 * off each matched element's dataset and calls it once per video.
 *
 * ## Kept from v1
 *
 * - **Two loop policies, one rewind policy: never.** Native `loop` (no
 *   `data-loop-from-frame`) joins the clip's own ends and pauses IN PLACE on
 *   exit. Intro + seam (`data-loop-from-frame` + `data-fps`) plays the full
 *   clip once, then re-enters at a measured seamless frame
 *   (`references/video.md` §2) for the rest of the element's life — the wrap
 *   happens ON the last frame, while still playing, never by pausing for it.
 *   Both policies resume IN PLACE on re-entry: replaying the intro every
 *   scroll-past reads as the section "restarting" rather than living.
 * - **Two preload tiers.** `preload` stays `'none'` until a wide (800px)
 *   `IntersectionObserver` margin fires, then only `'auto'` — never
 *   `.load()`, which aborts an in-progress `play()` on phones when the warm
 *   and play observers fire in the same batch (`references/video.md` §5).
 *   A tight (20%) observer gates actual playback.
 * - **Frame-accurate wrap on `requestVideoFrameCallback`**, which hands over
 *   the PRESENTED frame's exact `mediaTime`, with an rAF fallback for
 *   browsers without rVFC (`references/video.md` §3).
 * - The `translateZ(0)` compositing anchor (set only if nothing already
 *   positioned the element) — this stays a decorative, protected media
 *   island; nothing may animate a transform on it or its ancestors.
 *
 * ## New in v2
 *
 * - **A pause/play control** (WCAG 2.2.2, Pause/Stop/Hide: content that
 *   moves by itself for more than 5s needs one). Shown when `data-controls`
 *   is unset and `data-duration` (the clip's measured single-cycle length,
 *   seconds) is either absent or greater than 5 — `preload="none"` means
 *   the real `video.duration` usually isn't known at mount, and silently
 *   omitting a required control is a worse failure than one extra button on
 *   a clip that turns out to be short. Set `data-duration` for an exact
 *   default with no guess, or `data-controls="false"`/`"true"` to override
 *   outright.
 *   - **If `[data-loop-toggle]` is present** (a sibling of the video inside
 *     its parent, or anywhere in the mounted root when tagged
 *     `data-loop-toggle-for="<video id>"`), it is always wired, regardless
 *     of the duration default — the author's explicit markup wins.
 *   - **Otherwise, when a control is due and none exists, one is created**
 *     and inserted right after the video, so the WCAG requirement holds
 *     even if the markup forgot the button. Style it with `[data-loop-toggle]`.
 *   - Either way `aria-pressed` and the accessible name are owned by this
 *     module and mirror the element's actual `play`/`pause` events
 *     (`references/video.md` §11: the element is the source of truth, the UI
 *     only reflects it) — an auto-created button's visible text is the
 *     label; a supplied button keeps its own content and gets the label via
 *     `aria-label` instead, so its own text/icon is never overwritten. A
 *     user pause is sticky — entering the viewport again never auto-resumes
 *     it — and clears only when the user presses play again.
 * - **Reduced motion.** No autoplay; the poster (or wherever the last frame
 *   left off) holds; the control can still start it — reduced motion is a
 *   motion-sensitivity preference, not a refusal of the content. Read live
 *   via a `change` listener, not once at mount the way `fadeOnExit.ts` and
 *   `countUp.ts` read it (the v1 gap the plan calls out generally).
 * - **`navigator.connection?.saveData`.** Poster only, and — unlike reduced
 *   motion — the warm preload tier is skipped too: Save-Data is a
 *   data-cost signal, so nothing fetches until the user explicitly asks via
 *   the control. Also read live (a `connection` `change` listener).
 * - **A rejected `play()`** (Low Power Mode, an autoplay-policy refusal, or
 *   any other reason the promise rejects) leaves the poster and the control
 *   showing and does not retry on its own — no timer, and the IO/watchdog
 *   paths stop attempting `play()` until a fresh user click tries again.
 * - **A play watchdog and a tab-sleep rehydrate**, ported from
 *   `videoController.ts`'s pattern (`references/video.md` §14, §12:
 *   `ensurePlaying()` / `rehydrate()`), which v1's `inViewLoopVideo.ts`
 *   didn't have. A 2s interval re-issues `play()` if the browser silently
 *   paused a should-be-playing element (a demoted GPU layer, a background/
 *   foreground race) — gated by the same rejected-play flag, so a genuine
 *   refusal is never retried in a loop. `visibilitychange`, `pageshow` and
 *   `focus` re-run the same check immediately on wake and, if the decoder
 *   was evicted after a long background tab (`duration` no longer finite),
 *   issue one soft `.load()` and resume from `loadedmetadata` — never a
 *   repeated recovery attempt.
 * - **`destroy()` pauses the video.** v1's teardown disconnected the
 *   observers and timers but never paused the element — harmless while it
 *   only ever ran under a full page teardown, but not once a route can be
 *   hidden and kept alive elsewhere in the tree. "Videos pause on hide" is a
 *   plan-wide contract, so this module holds it too even without React's
 *   Activity to force the question.
 */

/** The share of the element that must be visible before it plays. */
const PLAY_THRESHOLD = 0.2
/** How far out to start fetching, so arrival does not stall on the first frame. */
const WARM_MARGIN = '800px 0px'
/** WCAG 2.2.2: auto-moving content running longer than this needs a pause control. */
const WCAG_AUTO_DURATION_S = 5
/** How often the watchdog checks a should-be-playing element that came up paused. */
const WATCHDOG_INTERVAL_MS = 2000
/** Fallback if a wrap seek's `seeked` event never fires. */
const WRAP_SAFETY_MS = 120

interface NetworkInformationLike extends EventTarget {
  saveData?: boolean
}
interface NavigatorWithConnection extends Navigator {
  connection?: NetworkInformationLike
}

export interface LoopVideoOptions {
  /** When set with `fps`, play 0→end once, then loop `loopFromFrame`→end. Omit for a native full-clip loop. */
  loopFromFrame?: number
  /** Required with `loopFromFrame` (e.g. 60 for a 10x-decode-friendly re-encode). */
  fps?: number
  /** Explicit override. Omit to use the WCAG default derived from `durationS` (see file docblock). */
  controls?: boolean
  /** The clip's measured single-cycle length in seconds — decides the `controls` default. */
  durationS?: number
  /** An explicit toggle button. Omit to auto-discover `[data-loop-toggle]`, then auto-create one if a control is due. */
  toggle?: HTMLButtonElement | null
  /** Class name applied only to an auto-created button (a supplied one keeps its own). */
  toggleClassName?: string
  /** Accessible name while paused (what the control will do if pressed). */
  playLabel?: string
  /** Accessible name while playing. */
  pauseLabel?: string
}

export interface LoopVideoController {
  destroy(): void
}

export function loopVideo(video: HTMLVideoElement, opts: LoopVideoOptions = {}): LoopVideoController {
  const playLabel = opts.playLabel ?? 'Play background video'
  const pauseLabel = opts.pauseLabel ?? 'Pause background video'

  // Seam time is exactly N/fps, not N+0.5 — landing on a forced keyframe at
  // the seam (if the asset has one) makes the seek near-instant.
  const seamTime = opts.loopFromFrame != null && opts.fps != null && opts.fps > 0 ? opts.loopFromFrame / opts.fps : null
  const frameDur = opts.fps != null && opts.fps > 0 ? 1 / opts.fps : 0
  const showControls = opts.controls ?? (opts.durationS != null ? opts.durationS > WCAG_AUTO_DURATION_S : true)

  video.loop = seamTime == null
  // The repo's standing compositing anchor for a video island — load-bearing
  // on WebKit. Only set if nothing already positioned it.
  if (!video.style.transform) video.style.transform = 'translateZ(0)'

  let toggle: HTMLButtonElement | null =
    opts.toggle ?? video.parentElement?.querySelector<HTMLButtonElement>(':scope > [data-loop-toggle]') ?? null
  let toggleCreated = false
  if (showControls && !toggle) {
    toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.dataset.loopToggle = ''
    if (opts.toggleClassName) toggle.className = opts.toggleClassName
    video.insertAdjacentElement('afterend', toggle)
    toggleCreated = true
  }

  const setToggleState = (playing: boolean) => {
    if (!toggle) return
    toggle.setAttribute('aria-pressed', playing ? 'true' : 'false')
    // An auto-created button owns its visible text; a supplied one keeps
    // whatever content/icon the author gave it and gets the live label via
    // aria-label instead, which wins the accessible-name computation
    // without touching what's on screen.
    if (toggleCreated) toggle.textContent = playing ? pauseLabel : playLabel
    else toggle.setAttribute('aria-label', playing ? pauseLabel : playLabel)
  }
  setToggleState(false)

  let disposed = false
  let inView = false
  let wrapping = false
  let recovering = false
  let raf = 0
  let wrapSafety = 0
  let userPaused = false
  let autoBlocked = false // sticky after ANY rejected play() — cleared only by a manual play
  let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let saveData = (navigator as NavigatorWithConnection).connection?.saveData === true

  const desiredPlaying = () => inView && !userPaused && !autoBlocked && !reducedMotion && !saveData

  const attemptPlay = () => {
    if (disposed) return
    void video.play().catch(() => {
      // A rejected play() (Low Power Mode, an autoplay-policy refusal, a
      // teardown mid-promise) sticks until a fresh user gesture clears it —
      // the poster and the control stay, and nothing here retries on its
      // own (no timer, and the watchdog's own desiredPlaying() check reads
      // this same flag).
      if (!disposed) autoBlocked = true
    })
  }

  // Last half-frame of the clip — late enough to show the match pose, early
  // enough to usually beat the ended/pause transition.
  const shouldWrap = (t: number) => {
    if (seamTime == null || frameDur <= 0) return false
    if (!Number.isFinite(video.duration) || video.duration <= 0) return false
    return t >= video.duration - frameDur * 0.6
  }

  const wrapToSeam = () => {
    if (seamTime == null || wrapping || disposed) return
    if (!Number.isFinite(video.duration) || video.duration <= 0) return
    wrapping = true
    try {
      video.currentTime = seamTime
    } catch {
      wrapping = false
      attemptPlay()
      return
    }
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked)
      window.clearTimeout(wrapSafety)
      wrapping = false
      if (video.paused) attemptPlay()
    }
    video.addEventListener('seeked', onSeeked)
    wrapSafety = window.setTimeout(() => {
      if (!wrapping) return
      video.removeEventListener('seeked', onSeeked)
      wrapping = false
      if (video.paused) attemptPlay()
    }, WRAP_SAFETY_MS)
  }

  // The one entry point that starts playback from rest. `play()` on an
  // ENDED element rewinds to 0 — the one path that could still restart the
  // intro — so route through the seam wrap instead when the seam policy is
  // in play. A user gesture clears the sticky gates; nothing else may.
  const startPlayback = (userGesture: boolean) => {
    if (disposed) return
    if (userGesture) {
      userPaused = false
      autoBlocked = false
    }
    if (seamTime != null && video.ended) wrapToSeam()
    else attemptPlay()
  }

  const tick = () => {
    if (disposed) return
    raf = requestAnimationFrame(tick)
    if (seamTime == null || wrapping || video.paused) return
    if (shouldWrap(video.currentTime)) wrapToSeam()
  }

  const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
    if (disposed) return
    if (seamTime != null && !wrapping && !video.paused && shouldWrap(meta.mediaTime)) wrapToSeam()
    video.requestVideoFrameCallback?.(onFrame)
  }
  if (seamTime != null && typeof video.requestVideoFrameCallback === 'function') {
    video.requestVideoFrameCallback(onFrame)
  } else if (seamTime != null) {
    raf = requestAnimationFrame(tick)
  }

  const handleEnded =
    seamTime != null
      ? () => {
          wrapping = false
          wrapToSeam()
        }
      : null
  if (handleEnded) video.addEventListener('ended', handleEnded)

  // ---- play/pause mirror (video.md §11: the element is the source of truth) ----
  const onPlayEvt = () => setToggleState(true)
  const onPauseEvt = () => setToggleState(false)
  video.addEventListener('play', onPlayEvt)
  video.addEventListener('pause', onPauseEvt)

  // ---- watchdog: re-issue play() if it was dropped while we should be playing ----
  const ensurePlaying = () => {
    if (disposed) return
    if (document.visibilityState !== 'visible') return
    if (!desiredPlaying()) return
    if (!video.paused) return
    attemptPlay()
  }
  const watchdog = window.setInterval(ensurePlaying, WATCHDOG_INTERVAL_MS)

  // ---- tab-sleep rehydrate (references/video.md §12) ----
  // Scroll position (and so `inView`) is durable truth across a sleep; the
  // decoder is not. Re-check on wake rather than trusting whatever state was
  // last observed before the tab went away.
  const rehydrate = () => {
    if (disposed || document.hidden) return
    if (!desiredPlaying()) return
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      if (recovering) return
      recovering = true
      video.load() // single soft reload — never looped
      video.addEventListener(
        'loadedmetadata',
        () => {
          recovering = false
          if (!disposed && desiredPlaying() && video.paused) attemptPlay()
        },
        { once: true }
      )
      return
    }
    ensurePlaying()
  }
  document.addEventListener('visibilitychange', rehydrate)
  window.addEventListener('pageshow', rehydrate)
  window.addEventListener('focus', rehydrate)

  // ---- preload tiers (references/video.md §5) ----
  const warm = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return
      // Save-Data: no fetch at all until the user asks, not just no autoplay.
      if (saveData) return
      video.preload = 'auto' // never .load() — see the file docblock and video.md §5
      warm.disconnect()
    },
    { rootMargin: WARM_MARGIN }
  )
  warm.observe(video)

  const playback = new IntersectionObserver(
    ([entry]) => {
      if (disposed) return
      inView = entry.isIntersecting
      if (!inView) {
        video.pause() // programmatic — never sticky, unlike a user pause
        return
      }
      if (desiredPlaying()) startPlayback(false)
    },
    { threshold: PLAY_THRESHOLD }
  )
  playback.observe(video)

  const onToggleClick = () => {
    if (disposed) return
    if (!video.paused) {
      userPaused = true
      video.pause()
    } else {
      startPlayback(true)
    }
  }
  toggle?.addEventListener('click', onToggleClick)

  // Reduced motion / Save-Data flipping live: re-derive rather than wait for
  // the next IO event, which won't fire on its own (intersection didn't
  // change).
  const reconcile = () => {
    if (disposed) return
    if (!desiredPlaying()) {
      if (!video.paused) video.pause()
      return
    }
    if (video.paused) startPlayback(false)
  }

  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  const onReduceChange = () => {
    reducedMotion = reduceQuery.matches
    reconcile()
  }
  reduceQuery.addEventListener('change', onReduceChange)

  const connection = (navigator as NavigatorWithConnection).connection
  const onConnectionChange = () => {
    saveData = connection?.saveData === true
    reconcile()
  }
  connection?.addEventListener?.('change', onConnectionChange)

  return {
    destroy() {
      disposed = true
      window.clearInterval(watchdog)
      window.clearTimeout(wrapSafety)
      cancelAnimationFrame(raf)
      warm.disconnect()
      playback.disconnect()
      document.removeEventListener('visibilitychange', rehydrate)
      window.removeEventListener('pageshow', rehydrate)
      window.removeEventListener('focus', rehydrate)
      video.removeEventListener('play', onPlayEvt)
      video.removeEventListener('pause', onPauseEvt)
      if (handleEnded) video.removeEventListener('ended', handleEnded)
      reduceQuery.removeEventListener('change', onReduceChange)
      connection?.removeEventListener?.('change', onConnectionChange)
      toggle?.removeEventListener('click', onToggleClick)
      if (toggleCreated) toggle?.remove()
      // Hide/show safety: "videos pause on hide" holds even without Activity
      // forcing the question — see the file docblock.
      video.pause()
    }
  }
}

export interface InitLoopVideosOptions {
  /** Class name applied only to an auto-created button (a supplied one keeps its own). */
  toggleClassName?: string
  playLabel?: string
  pauseLabel?: string
}

function parseBoolAttr(value: string | undefined): boolean | undefined {
  if (value == null) return undefined
  if (value === '' || value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function findToggle(video: HTMLVideoElement, root: ParentNode): HTMLButtonElement | null {
  const id = video.id
  if (id) {
    const linked = root.querySelector<HTMLButtonElement>(`[data-loop-toggle][data-loop-toggle-for="${CSS.escape(id)}"]`)
    if (linked) return linked
  }
  return video.parentElement?.querySelector<HTMLButtonElement>(':scope > [data-loop-toggle]') ?? null
}

function datasetOptions(video: HTMLVideoElement, root: ParentNode, shared: InitLoopVideosOptions): LoopVideoOptions {
  const { loopFromFrame: loopFromFrameAttr, fps: fpsAttr, duration: durationAttr, controls: controlsAttr } = video.dataset
  return {
    loopFromFrame: loopFromFrameAttr != null ? Number.parseFloat(loopFromFrameAttr) : undefined,
    fps: fpsAttr != null ? Number.parseFloat(fpsAttr) : undefined,
    durationS: durationAttr != null ? Number.parseFloat(durationAttr) : undefined,
    controls: parseBoolAttr(controlsAttr),
    toggle: findToggle(video, root),
    toggleClassName: shared.toggleClassName,
    playLabel: shared.playLabel,
    pauseLabel: shared.pauseLabel
  }
}

/** Scans `root` for `[data-loop-video]` and mounts {@link loopVideo} on each. */
export function initLoopVideos(root: ParentNode = document, options: InitLoopVideosOptions = {}): LoopVideoController {
  const videos = Array.from(root.querySelectorAll<HTMLVideoElement>('[data-loop-video]'))
  const controllers = videos.map((video) => loopVideo(video, datasetOptions(video, root, options)))
  return {
    destroy() {
      controllers.forEach((c) => c.destroy())
    }
  }
}
