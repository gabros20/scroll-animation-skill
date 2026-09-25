'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/**
 * A background render that starts when it is 20% on screen and pauses when it
 * leaves. Nothing plays off-screen, and nothing is fetched until the viewer is
 * nearly there.
 *
 * ## Two loop policies, one rewind policy: never
 *
 * **Native loop** (default) — continuous clip that joins its own ends. Uses the
 * HTML `loop` attribute and pauses IN PLACE on exit. Rewinding would restart
 * the orbit every scroll-past and read as a stutter.
 *
 * **Intro + seam** (`loopFromFrame` + `fps`) — full clip plays once, then
 * re-enters at a measured seamless frame for the rest of the element's life.
 * No `loop` attribute. `loopFromFrame` is the first frame of the loop body (the
 * frame AFTER the pixel match to the last frame) — the same "match frame is not
 * a frame to show" rule `ScrubStage` uses for its own loops. The wrap happens
 * ON the last frame, **while still playing** — never pause for the seam, so the
 * loop is continuous.
 *
 * This policy can be tempting to build as "rewind to 0 on exit, replay the
 * intro on every entry" on the reasoning that the build is the point of the
 * render. It is not, past the first showing: scrolling up and down a page
 * re-triggers the whole construction each time, which a visitor reads as the
 * section "restarting" rather than living. The fix is to hold the playhead —
 * leave in the loop body, come back in the loop body. The intro then plays
 * exactly once per page, which is when it means anything. (Leaving mid-intro
 * resumes mid-intro, deliberately: the alternative is deciding on the
 * visitor's behalf that they need to see it from the top, which is the
 * behaviour being avoided.)
 *
 * ## Loading
 *
 * `preload="none"` until the outer observer fires ~800px out, so a visitor who
 * never scrolls this far pays nothing for the asset. The inner observer starts
 * playback only once it is genuinely on screen.
 *
 * Video-island rule: nothing may animate transforms on this element or its
 * ancestors — a transformed ancestor can force the browser to repaint the
 * video's compositing layer every frame instead of leaving the decoder alone.
 */

/** The share of the element that must be visible before it plays. */
const PLAY_THRESHOLD = 0.2
/** How far out to start fetching, so arrival does not stall on the first frame. */
const WARM_MARGIN = '800px 0px'

interface InViewLoopVideoProps {
  /** Still shown before the first frame decodes — prevents a black flash. */
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
}

export function InViewLoopVideo({
  poster,
  className,
  children,
  loopFromFrame,
  fps
}: InViewLoopVideoProps) {
  const ref = useRef<HTMLVideoElement>(null)
  // Seam time is exactly N/fps (not N+0.5): land on a forced keyframe at the
  // seam if the asset has one (see the re-encode note in the README) — landing
  // on the keyframe makes the seek near-instant; mid-frame would miss it and
  // hitch.
  const seamTime = loopFromFrame != null && fps != null && fps > 0 ? loopFromFrame / fps : null
  const frameDur = fps != null && fps > 0 ? 1 / fps : 0

  useEffect(() => {
    const video = ref.current
    if (!video) return

    // Raise `preload` and nothing else. Calling `load()` here resets the
    // element and ABORTS any play() already in flight, and the two observers
    // can fire in the same batch: on a phone the section can cross the 800px
    // warm margin and the 20% play threshold in one scroll, so the video
    // loaded fully (readyState 4) and sat paused forever. Measured on a real
    // device at a narrow width, ten polls over five seconds, every one
    // `paused: true`.
    //
    // Nothing is lost: `play()` fetches the resource by itself, so this is a
    // head start, not the mechanism.
    const warm = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        video.preload = 'auto'
        warm.disconnect()
      },
      { rootMargin: WARM_MARGIN }
    )
    warm.observe(video)

    // Seam loop: continuous wrap on the LAST frame only.
    //
    // Do NOT wrap several frames early — a wrap that early is a real visible
    // jump (measured on the reference asset: MSE ~29 wrapping 3 frames early
    // vs MSE 1.3 on the true match). So wait until we are ON the last frame,
    // then seek while still playing (never pause). The asset needs a keyframe
    // at the seam or the seek itself hitches regardless of timing.
    let wrapping = false
    let disposed = false
    let raf = 0
    let wrapSafety = 0

    const wrapToSeam = () => {
      if (seamTime == null || wrapping || disposed) return
      if (!Number.isFinite(video.duration) || video.duration <= 0) return
      wrapping = true
      const wasPlaying = !video.paused
      try {
        video.currentTime = seamTime
      } catch {
        wrapping = false
        if (wasPlaying) void video.play().catch(() => {})
        return
      }
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked)
        window.clearTimeout(wrapSafety)
        wrapping = false
        if (!disposed && video.paused) void video.play().catch(() => {})
      }
      video.addEventListener('seeked', onSeeked)
      wrapSafety = window.setTimeout(() => {
        if (!wrapping) return
        video.removeEventListener('seeked', onSeeked)
        wrapping = false
        if (!disposed && video.paused) void video.play().catch(() => {})
      }, 120)
    }

    // Last half-frame of the clip — late enough to show the match pose,
    // early enough that we usually beat the ended/pause transition.
    const shouldWrap = (t: number) => {
      if (seamTime == null || frameDur <= 0) return false
      if (!Number.isFinite(video.duration) || video.duration <= 0) return false
      return t >= video.duration - frameDur * 0.6
    }

    const tick = () => {
      if (disposed) return
      raf = requestAnimationFrame(tick)
      if (seamTime == null || wrapping || video.paused) return
      if (shouldWrap(video.currentTime)) wrapToSeam()
    }

    const onFrame = (_now: number, meta: { mediaTime: number }) => {
      if (disposed) return
      if (seamTime != null && !wrapping && !video.paused && shouldWrap(meta.mediaTime)) {
        wrapToSeam()
      }
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

    const playback = new IntersectionObserver(
      ([entry]) => {
        // Both policies resume IN PLACE. Nothing here rewinds: the intro is a
        // thing that happens once, at the top of the element's life, and
        // after that the loop body is where the render lives. Autoplay
        // policy allows programmatic play on a muted element; the catch is
        // for a teardown mid-promise.
        wrapping = false
        if (!entry.isIntersecting) {
          video.pause()
          return
        }
        // `play()` on an ENDED element rewinds to 0 — the one path that could
        // still restart the intro, reachable by leaving on the last frame
        // before the wrap lands. Send it to the seam instead.
        if (seamTime != null && video.ended) wrapToSeam()
        else void video.play().catch(() => {})
      },
      { threshold: PLAY_THRESHOLD }
    )
    playback.observe(video)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      window.clearTimeout(wrapSafety)
      warm.disconnect()
      playback.disconnect()
      if (handleEnded) video.removeEventListener('ended', handleEnded)
    }
  }, [seamTime, frameDur])

  return (
    <video
      ref={ref}
      muted
      // Native loop only when there is no intro seam — seam path owns the wrap.
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
  )
}
