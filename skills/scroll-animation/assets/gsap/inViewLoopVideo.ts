/**
 * `[data-loop-video]` — a background render that starts when it is ~20% on
 * screen and pauses when it leaves. Port of `InViewLoopVideo`.
 *
 * ```html
 * <video data-loop-video poster="…" muted playsinline preload="none"
 *        data-loop-from-frame="73" data-fps="60">
 *   <source src="…webm" type="video/webm" />
 *   <source src="…mp4" type="video/mp4" />
 * </video>
 * ```
 *
 * ## Two loop policies, one rewind policy: never
 *
 * **Native loop** (no `data-loop-from-frame`) — a continuous clip that
 * joins its own ends. Uses the HTML `loop` attribute and pauses IN PLACE on
 * exit; rewinding would restart the loop on every scroll-past and read as a
 * stutter.
 *
 * **Intro + seam** (`data-loop-from-frame` + `data-fps`) — the full clip
 * plays once, then re-enters at a measured seamless frame for the rest of
 * the element's life. No `loop` attribute. `loopFromFrame` is the first
 * frame of the loop body — the frame AFTER the pixel match to the last
 * frame (see `references/video.md` §2).
 * The wrap happens ON the last frame, while still playing — never pause for
 * the seam.
 *
 * Both policies resume IN PLACE on re-entry, never from the top: an intro
 * that replays every time a visitor scrolls past reads as the section
 * "restarting" rather than living, and the intro then means something only
 * the first time it plays.
 *
 * ## Loading
 *
 * `preload` stays `none` until a wide `rootMargin` observer fires (the
 * warm margin below), so a visitor who never scrolls this far pays nothing
 * for the asset. A second, tight observer starts playback only once the
 * element is genuinely on screen.
 *
 * Nothing here may animate a transform on this element or its ancestors —
 * it is a protected media island, same rule as `scrubStage.ts`.
 */

/** The share of the element that must be visible before it plays. */
const PLAY_THRESHOLD = 0.2
/** How far out to start fetching, so arrival does not stall on the first frame. */
const WARM_MARGIN = '800px 0px'

export interface InViewLoopVideoController {
  destroy(): void
}

export function initInViewLoopVideos(root: ParentNode = document): InViewLoopVideoController {
  const videos = Array.from(root.querySelectorAll<HTMLVideoElement>('[data-loop-video]'))
  const teardowns = videos.map(mountOne)
  return {
    destroy() {
      teardowns.forEach((fn) => fn())
    }
  }
}

function mountOne(video: HTMLVideoElement): () => void {
  const loopFromFrameAttr = video.dataset.loopFromFrame
  const fpsAttr = video.dataset.fps
  const loopFromFrame = loopFromFrameAttr != null ? Number.parseFloat(loopFromFrameAttr) : null
  const fps = fpsAttr != null ? Number.parseFloat(fpsAttr) : null
  // Seam time is exactly N/fps, not N+0.5 — landing on a forced keyframe at
  // the seam (if the asset has one) makes the seek near-instant.
  const seamTime = loopFromFrame != null && fps != null && fps > 0 ? loopFromFrame / fps : null
  const frameDur = fps != null && fps > 0 ? 1 / fps : 0

  video.loop = seamTime == null
  // The repo's standing compositing anchor for a video island — load-bearing
  // on WebKit. Only set if nothing already positioned it.
  if (!video.style.transform) video.style.transform = 'translateZ(0)'

  const warm = new IntersectionObserver(
    (entries) => {
      const entry = entries[0]
      if (!entry?.isIntersecting) return
      video.preload = 'auto'
      warm.disconnect()
    },
    { rootMargin: WARM_MARGIN }
  )
  warm.observe(video)

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
  // early enough to usually beat the ended/pause transition.
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
    (entries) => {
      const entry = entries[0]
      if (!entry) return
      wrapping = false
      if (!entry.isIntersecting) {
        video.pause()
        return
      }
      // `play()` on an ENDED element rewinds to 0 — the one path that could
      // still restart the intro. Send it to the seam instead.
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
}
