'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * A background render that starts when it is ~20% on screen and pauses when
 * it leaves. v2 of `InViewLoopVideo` (`assets/motion/components/InViewLoopVideo.tsx`,
 * kept in place — the controller removes v1's files with the v1 barrels
 * later). Carries v1's playback core forward unchanged and adds the pieces
 * v1 didn't have: a WCAG 2.2.2 pause control, live reduced-motion and
 * Save-Data gating, rejected-`play()` handling, and Next Activity hide/show
 * safety.
 *
 * ## Kept from v1
 *
 * - **Two loop policies, one rewind policy: never.** Native `loop` (no
 *   `loopFromFrame`) joins the clip's own ends and pauses IN PLACE on exit.
 *   Intro + seam (`loopFromFrame` + `fps`) plays the full clip once, then
 *   re-enters at a measured seamless frame (`references/video.md` §2) for
 *   the rest of the element's life — the wrap happens ON the last frame,
 *   while still playing, never by pausing for it. Both policies resume IN
 *   PLACE on re-entry: replaying the intro every scroll-past reads as the
 *   section "restarting" rather than living.
 * - **Two preload tiers.** `preload` stays `'none'` until a wide (800px)
 *   `IntersectionObserver` margin fires, then only `'auto'` — never
 *   `.load()`, which aborts an in-progress `play()` on phones when the warm
 *   and play observers fire in the same batch (`references/video.md` §5).
 *   A tight (20%) observer gates actual playback.
 * - **Frame-accurate wrap on `requestVideoFrameCallback`**, which hands over
 *   the PRESENTED frame's exact `mediaTime`, with an rAF fallback for
 *   browsers without rVFC (`references/video.md` §3).
 * - The `translateZ(0)` compositing anchor and the attribute set
 *   (`muted`, `playsInline`, `disablePictureInPicture`,
 *   `disableRemotePlayback`, `aria-hidden`) — this stays a decorative,
 *   protected media island; nothing may animate a transform on it or its
 *   ancestors.
 *
 * ## New in v2
 *
 * - **A pause/play control** (WCAG 2.2.2, Pause/Stop/Hide: content that
 *   moves by itself for more than 5s needs one). `controls` defaults to
 *   `durationS > 5` when given, and to **shown** when `durationS` is
 *   omitted — `preload="none"` means the real `video.duration` usually
 *   isn't known at mount, and silently omitting a required control is a
 *   worse failure than one extra button on a clip that turns out to be
 *   short. Pass `durationS` (the clip's measured single-cycle length) for
 *   an exact default with no guess, or `controls` to override outright.
 *   The control is a real `<button>` with `aria-pressed` and an accessible
 *   name, both mirrored from the element's actual `play`/`pause` events
 *   (`references/video.md` §11: the element is the source of truth, the UI
 *   only reflects it). A user pause is sticky — entering the viewport again
 *   never auto-resumes it — and clears only when the user presses play
 *   again.
 * - **Reduced motion.** No autoplay; the poster (or wherever the last frame
 *   left off) holds; the control can still start it — reduced motion is a
 *   motion-sensitivity preference, not a refusal of the content. Read live
 *   via a `change` listener, not once at mount (the v1 gap the plan calls
 *   out generally: GSAP and Motion blocks that read `matchMedia` once).
 * - **`navigator.connection?.saveData`.** Poster only, and — unlike reduced
 *   motion — the warm preload tier is skipped too: Save-Data is a
 *   data-cost signal, so nothing fetches until the user explicitly asks via
 *   the control. Also read live (a `connection` `change` listener).
 * - **A rejected `play()`** (Low Power Mode, an autoplay-policy refusal, or
 *   any other reason the promise rejects) leaves the poster and the control
 *   showing and does not retry on its own — no timer, and the IO/watchdog
 *   paths stop attempting `play()` until a fresh user click tries again.
 * - **Hide/show safety.** Cleanup runs in a **layout** effect (not a plain
 *   effect, unlike v1): Next's `<Activity>` keeps a hidden route's DOM (and
 *   a playing `<video>`) alive across a synchronous hide, and a passive
 *   effect cleanup would let a frame of continued playback slip through
 *   before it ran. On show, the freshly-recreated `IntersectionObserver`
 *   reports the element's current intersection immediately (that's the
 *   platform contract, not a poll), so playback resumes on its own only if
 *   the element is actually in view AND the sticky user-pause / rejected-play
 *   / reduced-motion / Save-Data gates all still clear — which is exactly
 *   "it was playing and the visitor didn't pause it," without a separate
 *   flag to keep in sync.
 * - **A play watchdog and a tab-sleep rehydrate**, ported from the pattern
 *   the sibling `ScrubStage` controller uses (`references/video.md` §14,
 *   §12: `ensurePlaying()` / `rehydrate()`), which v1's `InViewLoopVideo`
 *   didn't have. A 2s interval re-issues `play()` if the browser silently
 *   paused a should-be-playing element (a demoted GPU layer, a background/
 *   foreground race) — gated by the same rejected-play flag, so a genuine
 *   refusal is never retried in a loop. `visibilitychange`, `pageshow` and
 *   `focus` re-run the same check immediately on wake and, if the decoder
 *   was evicted after a long background tab (`duration` no longer finite),
 *   issue one soft `.load()` and resume from `loadedmetadata` — never a
 *   repeated recovery attempt.
 *
 * ## What this deliberately does not do
 *
 * `motion/react`'s own `useReducedMotion()` looks like the obvious tool for
 * the reduced-motion gate and is used that way elsewhere in this pack
 * (`FadeOnExit.tsx`). It is NOT live: it seeds a `useState` from
 * `prefersReducedMotion.current` once and never updates it (confirmed
 * against the installed `framer-motion` — the hook's own source leaves a
 * to-do comment next to the call about not updating automatically, and
 * its docstring's "actively responds to changes" claim does not match
 * what the code does). Since this file's brief is specifically a LIVE
 * gate, it reads `matchMedia` itself instead.
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

export interface LoopVideoProps {
  /** Still shown before the first frame decodes, and whenever playback is withheld. */
  poster?: string
  className?: string
  /** `<source>` elements, smallest-first. */
  children: ReactNode
  /**
   * When set with `fps`, play 0→end once, then loop `loopFromFrame`→end.
   * Omit for a native full-clip loop. Frame index is 0-based at the source fps.
   */
  loopFromFrame?: number
  /** Required with `loopFromFrame` (e.g. 60 for a 10x-decode-friendly re-encode). */
  fps?: number
  /** Explicit override. Omit to use the WCAG default derived from `durationS` (see file docblock). */
  controls?: boolean
  /** The clip's measured single-cycle length in seconds — decides the `controls` default. */
  durationS?: number
  toggleClassName?: string
  /** Accessible name while paused (what the control will do if pressed). */
  playLabel?: string
  /** Accessible name while playing. */
  pauseLabel?: string
}

export function LoopVideo({
  poster,
  className,
  children,
  loopFromFrame,
  fps,
  controls,
  durationS,
  toggleClassName,
  playLabel = 'Play background video',
  pauseLabel = 'Pause background video'
}: LoopVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  // Seam time is exactly N/fps (not N+0.5): landing on a forced keyframe at
  // the seam (if the asset has one) makes the seek near-instant.
  const seamTime = loopFromFrame != null && fps != null && fps > 0 ? loopFromFrame / fps : null
  const frameDur = fps != null && fps > 0 ? 1 / fps : 0

  const showControls = controls ?? (durationS != null ? durationS > WCAG_AUTO_DURATION_S : true)

  // Sticky gates, read (and written) by both the controller effect below and
  // the live media-query effect — refs, not state, so neither has to be torn
  // down and rebuilt just because the other fired.
  const userPausedRef = useRef(false)
  const autoBlockedRef = useRef(false)
  const reducedMotionRef = useRef(false)
  const saveDataRef = useRef(false)
  const reconcileRef = useRef<() => void>(() => {})
  // Populated by the controller effect; the button's onClick reads through
  // this rather than closing over the controller directly, so the JSX below
  // never needs to know the controller's internals.
  const toggleRef = useRef<() => void>(() => {})

  // Mirrors the element's actual play/pause state for aria-pressed and the
  // label — never driven by our own intent, only by what the element did
  // (references/video.md §11).
  const [playing, setPlaying] = useState(false)

  // ---- reduced motion + Save-Data, read live ----
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedMotionRef.current = mq.matches
    const onReduceChange = () => {
      reducedMotionRef.current = mq.matches
      reconcileRef.current()
    }
    mq.addEventListener('change', onReduceChange)

    const connection = (navigator as NavigatorWithConnection).connection
    saveDataRef.current = connection?.saveData === true
    const onConnectionChange = () => {
      saveDataRef.current = connection?.saveData === true
      reconcileRef.current()
    }
    connection?.addEventListener?.('change', onConnectionChange)

    return () => {
      mq.removeEventListener('change', onReduceChange)
      connection?.removeEventListener?.('change', onConnectionChange)
    }
  }, [])

  // ---- the controller ----
  useLayoutEffect(() => {
    const video = videoRef.current
    if (!video) return

    // Independent snapshot, so this effect never depends on the listener
    // effect above having already run (React Strict Mode, ordering, etc.).
    reducedMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    saveDataRef.current = (navigator as NavigatorWithConnection).connection?.saveData === true

    let disposed = false
    let inView = false
    let wrapping = false
    let recovering = false
    let raf = 0
    let wrapSafety = 0

    const desiredPlaying = () =>
      inView &&
      !userPausedRef.current &&
      !autoBlockedRef.current &&
      !reducedMotionRef.current &&
      !saveDataRef.current

    const attemptPlay = () => {
      if (disposed) return
      video.play().catch(() => {
        // A rejected play() (Low Power Mode, an autoplay-policy refusal, a
        // teardown mid-promise) sticks until a fresh user gesture clears it —
        // the poster and the control stay, and nothing here retries on its
        // own (no timer, and the watchdog's own desiredPlaying() check
        // reads this same flag).
        if (!disposed) autoBlockedRef.current = true
      })
    }

    // Last half-frame of the clip — late enough to show the match pose,
    // early enough to usually beat the ended/pause transition.
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
    // intro — so route through the seam wrap instead when the seam policy
    // is in play. A user gesture clears the sticky gates; nothing else may.
    const startPlayback = (userGesture: boolean) => {
      if (disposed) return
      if (userGesture) {
        userPausedRef.current = false
        autoBlockedRef.current = false
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
    const onPlayEvt = () => setPlaying(true)
    const onPauseEvt = () => setPlaying(false)
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
    // decoder is not. Re-check on wake rather than trusting whatever state
    // was last observed before the tab went away.
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
        if (saveDataRef.current) return
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

    // ---- the toggle control ----
    toggleRef.current = () => {
      if (disposed) return
      if (!video.paused) {
        userPausedRef.current = true
        video.pause()
      } else {
        startPlayback(true)
      }
    }

    // Reduced motion / Save-Data flipping live: re-derive rather than wait
    // for the next IO event, which won't fire on its own (intersection
    // didn't change).
    reconcileRef.current = () => {
      if (disposed) return
      if (!desiredPlaying()) {
        if (!video.paused) video.pause()
        return
      }
      if (video.paused) startPlayback(false)
    }

    return () => {
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
      toggleRef.current = () => {}
      reconcileRef.current = () => {}
      // Hide/show safety: Next's <Activity> keeps a hidden route's DOM (and a
      // playing <video>) alive, so cleanup must pause it, not just stop
      // watching it. A layout effect (not a passive one) means this runs
      // before the browser paints the hidden state.
      video.pause()
    }
  }, [seamTime, frameDur])

  return (
    <>
      <video
        ref={videoRef}
        muted
        // Native loop only when there is no intro seam — the seam path owns the wrap.
        loop={seamTime == null}
        playsInline
        preload="none"
        poster={poster}
        disablePictureInPicture
        disableRemotePlayback
        aria-hidden="true"
        className={className}
        // A standing Safari compositing anchor — load-bearing. Do not "clean up".
        style={{ transform: 'translateZ(0)' }}
      >
        {children}
      </video>
      {showControls && (
        <button type="button" aria-pressed={playing} className={toggleClassName} onClick={() => toggleRef.current()}>
          {playing ? pauseLabel : playLabel}
        </button>
      )}
    </>
  )
}
