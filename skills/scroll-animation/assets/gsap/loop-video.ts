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
 *          data-loop-from-frame="73" data-fps="60">
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
 *   happens while playing, never by pausing for it. On requestVideoFrameCallback
 *   it fires up to one frame early (the presented frame's end within 1.5
 *   frames of the duration), which beats WebKit's own end-of-media handling;
 *   so a seam clip ends on one spare clone of its last frame, which
 *   `media loop --loop-from` adds, and the early wrap only ever skips that.
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
 * - **A pause/play control, shown by default** (WCAG 2.2.2, Pause/Stop/Hide).
 *   WCAG counts how long the movement itself lasts, not the clip's cycle
 *   length — a loop moves for as long as it's in view, which is normally far
 *   past 5s regardless of how short one cycle is, so this defaults to shown
 *   unconditionally. `data-controls="false"` is the explicit opt-out for the
 *   rare case a loop is genuinely decorative and brief enough to be exempt.
 *   - **If `[data-loop-toggle]` is present** (a sibling of the video inside
 *     its parent, or anywhere in the mounted root when tagged
 *     `data-loop-toggle-for="<video id>"`), it is always wired, regardless
 *     of the duration default — the author's explicit markup wins.
 *   - **Otherwise, when a control is due and none exists, one is created**
 *     and inserted right after the video, so the WCAG requirement holds
 *     even if the markup forgot the button. Style it with `[data-loop-toggle]`.
 *   - Either way the accessible name is owned by this module and flips
 *     between `pauseLabel`/`playLabel`, mirrored from the element's actual
 *     `play`/`pause` events (`references/video.md` §11: the element is the
 *     source of truth, the UI only reflects it) — the WAI-ARIA APG's
 *     carousel play/pause-button pattern, not a fixed label plus
 *     `aria-pressed` (a toggle button's name must not change with its state
 *     per APG; this button IS the state). An auto-created button's visible
 *     text is the label; a supplied button keeps its own content and gets
 *     the label via `aria-label` instead, so its own text/icon is never
 *     overwritten. A user pause is sticky — entering the viewport again
 *     never auto-resumes it — and clears only when the user presses play
 *     again.
 * - **`data-alt`, for footage that isn't decorative.** Omit it and the loop
 *   stays fully decorative: the `<video>` is `aria-hidden` and nothing else
 *   is exposed, as before. Set it and the video keeps its `aria-hidden` (a
 *   `<video>` with no controls or captions still isn't useful for a screen
 *   reader to land on) while the attribute's value is exposed as visually
 *   hidden text alongside it, inserted right after the video (before the
 *   toggle) — a text alternative for what the loop shows, without changing
 *   anything on screen.
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
/** How often the watchdog checks a should-be-playing element that came up paused. */
const WATCHDOG_INTERVAL_MS = 2000
/** Fallback if a wrap seek's `seeked` event never fires. */
const WRAP_SAFETY_MS = 120
/** The standard "sr-only" recipe: present in the DOM and the accessibility tree, invisible on screen. */
const VISUALLY_HIDDEN_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: '0',
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: '0'
}

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
  /** Defaults to shown — WCAG 2.2.2 (see file docblock). Pass `false` to opt out. */
  controls?: boolean
  /** A text alternative for meaningful footage, exposed as visually hidden text. Omit to stay fully decorative. */
  alt?: string
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
  const showControls = opts.controls ?? true

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

  // Inserted 'afterend' the video AFTER the toggle above, so it lands
  // between the two: video, then the text alternative, then the control.
  let altEl: HTMLSpanElement | null = null
  if (opts.alt) {
    altEl = document.createElement('span')
    altEl.textContent = opts.alt
    Object.assign(altEl.style, VISUALLY_HIDDEN_STYLE)
    video.insertAdjacentElement('afterend', altEl)
  }

  const setToggleState = (playing: boolean) => {
    if (!toggle) return
    // An auto-created button owns its visible text; a supplied one keeps
    // whatever content/icon the author gave it and gets the live label via
    // aria-label instead, which wins the accessible-name computation
    // without touching what's on screen. No aria-pressed: the WAI-ARIA APG's
    // carousel play/pause-button pattern is a flipping NAME, not a fixed
    // name plus pressed state (see the file docblock).
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
  // enough to usually beat the ended/pause transition. Used by the rAF
  // fallback below, whose `currentTime` sweeps continuously and so does
  // cross this threshold mid-frame.
  const shouldWrap = (t: number) => {
    if (seamTime == null || frameDur <= 0) return false
    if (!Number.isFinite(video.duration) || video.duration <= 0) return false
    return t >= video.duration - frameDur * 0.6
  }

  // rVFC's `mediaTime` is fixed at the PRESENTED frame's start, not a
  // sweeping clock, so the true last frame's mediaTime (≈ duration −
  // frameDur) never reaches the threshold above — there is no later frame to
  // hand a bigger mediaTime to `shouldWrap`. Un-fixed, the wrap only ever
  // happens once `ended` already had: a pause, a seek and a play at every
  // loop. Comparing the frame's END instead (mediaTime + frameDur) reaches
  // it while that frame is still the one on screen.
  //
  // The tolerance is 1.5 frames, not the "half a frame" that would only ever
  // match the true last frame: measured against WebKit (tests/loop-video.mjs,
  // task 21), a half-frame tolerance still let `ended`/`pause` fire on a
  // measured ~1-in-4 loops even with this trigger in place — WebKit
  // occasionally fires its native "reached end of media" steps before this
  // callback for the true last frame is dispatched, a race between two
  // independently-scheduled browser mechanisms this module doesn't control.
  // 1.5 frames also qualifies the SECOND-to-last frame, giving the wrap two
  // consecutive rVFC callbacks to win that race on instead of one, at the
  // cost of occasionally wrapping one frame earlier than the true last frame
  // — covered by the frame-accuracy checks' own ±1 tolerance, so it isn't a
  // new source of visible imprecision. (Must stay below 2 frames: that would
  // also qualify the third-to-last frame, which the ±1 checks do NOT cover.)
  const shouldWrapPresented = (mediaTime: number) => {
    if (seamTime == null || frameDur <= 0) return false
    if (!Number.isFinite(video.duration) || video.duration <= 0) return false
    return mediaTime + frameDur >= video.duration - frameDur * 1.5
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
    if (seamTime != null && !wrapping && !video.paused && shouldWrapPresented(meta.mediaTime)) wrapToSeam()
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
      altEl?.remove()
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
  const { loopFromFrame: loopFromFrameAttr, fps: fpsAttr, controls: controlsAttr, alt: altAttr } = video.dataset
  return {
    loopFromFrame: loopFromFrameAttr != null ? Number.parseFloat(loopFromFrameAttr) : undefined,
    fps: fpsAttr != null ? Number.parseFloat(fpsAttr) : undefined,
    controls: parseBoolAttr(controlsAttr),
    alt: altAttr || undefined,
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
