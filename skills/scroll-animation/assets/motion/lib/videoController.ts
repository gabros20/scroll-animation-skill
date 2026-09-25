/**
 * Imperative controller over a scroll-driven <video>. This is where ALL the
 * hard-won browser/WebKit hardening lives, isolated from the scroll/easing
 * logic so the higher-level state machine never touches the element directly.
 *
 * Owns:
 *   – decoder priming (iOS won't paint currentTime seeks on a never-started
 *     video; a muted play()+pause() warms the pipeline);
 *   – guarded seeking (one seek in flight at a time + sub-frame epsilon — Safari
 *     queues seeks and falls behind otherwise);
 *   – robust playback start that survives a play() issued mid-seek during a fast
 *     handoff (Safari silently drops it; we wait for `seeked` with a timeout
 *     fallback);
 *   – a watchdog that re-issues play() when Safari demotes the GPU layer or the
 *     tab hides/shows and the video should be playing.
 *
 * The controller tracks a single `desiredPlaying` intent: play() sets it,
 * pause()/reset() clear it, and the watchdogs only ever resume while it's set.
 */

/** Seeks below this delta are skipped — roughly half a frame at 30fps. */
const SEEK_EPSILON = 1 / 60

export interface VideoController {
  /** Warm the decoder so the first scrub seek actually paints (iOS). */
  prime(): void
  /** Guarded scrub seek: skipped if a seek is in flight or within epsilon. */
  setTime(seconds: number): void
  /** Start/continue playback robustly (survives mid-seek play() on Safari). */
  play(): void
  /** Pause and clear the playing intent. */
  pause(): void
  /** Re-issue play() if it was dropped while we intend to be playing (in-loop watchdog). */
  ensurePlaying(): void
  /** Pause and force currentTime back to `seconds` (tolerates not-yet-seekable). */
  reset(seconds: number): void
  setLoop(loop: boolean): void
  /** Remove the pause/visibility watchdog listeners. */
  dispose(): void
}

export function createVideoController(video: HTMLVideoElement): VideoController {
  let primed = false
  let desiredPlaying = false

  const prime = () => {
    if (primed) return
    primed = true
    const p = video.play()
    if (p)
      p.then(() => {
        // Only undo the priming play if we don't actually intend to be playing.
        if (!desiredPlaying) video.pause()
      }).catch(() => {})
  }

  // Start playback robustly. During a FAST scrub the handoff lands while a
  // currentTime seek is still resolving, and Safari silently drops a play()
  // issued mid-seek (the slow path works because the seek has long settled).
  // So if seeking, wait for `seeked` — with a timeout fallback in case the
  // event never fires — then play.
  const startPlayback = () => {
    const doPlay = () => {
      const p = video.play()
      if (p) p.catch(() => {})
    }
    if (!video.seeking) {
      doPlay()
      return
    }
    let fired = false
    const go = () => {
      if (fired) return
      fired = true
      video.removeEventListener('seeked', go)
      doPlay()
    }
    video.addEventListener('seeked', go, { once: true })
    window.setTimeout(go, 150)
  }

  const play = () => {
    desiredPlaying = true
    startPlayback()
  }

  const pause = () => {
    desiredPlaying = false
    video.pause()
  }

  const setTime = (seconds: number) => {
    // One seek in flight at a time — Safari queues them and falls behind.
    if (!video.seeking && Math.abs(video.currentTime - seconds) > SEEK_EPSILON) {
      video.currentTime = seconds
    }
  }

  const ensurePlaying = () => {
    // Watchdog: while we intend to play, re-issue play() if it got dropped —
    // covers a play() that didn't take during the rapid handoff, and Safari
    // silently pausing on a layer demotion. Skips a legitimately ended video.
    if (
      desiredPlaying &&
      !video.ended &&
      video.paused &&
      document.visibilityState === 'visible'
    ) {
      video.play().catch(() => {})
    }
  }

  const reset = (seconds: number) => {
    desiredPlaying = false
    video.pause()
    try {
      video.currentTime = seconds
    } catch {
      /* not seekable yet — poster still covers frame 0 */
    }
  }

  const setLoop = (loop: boolean) => {
    video.loop = loop
  }

  // Safari/WebKit can demote the video's GPU layer and silently pause it;
  // browsers also pause when the tab hides. Resume only while we intend to play.
  const resumeIfPlaying = () => {
    if (document.visibilityState !== 'visible') return
    if (video.ended) return
    if (desiredPlaying) video.play().catch(() => {})
  }
  video.addEventListener('pause', resumeIfPlaying)
  document.addEventListener('visibilitychange', resumeIfPlaying)

  const dispose = () => {
    video.removeEventListener('pause', resumeIfPlaying)
    document.removeEventListener('visibilitychange', resumeIfPlaying)
  }

  return { prime, setTime, play, pause, ensurePlaying, reset, setLoop, dispose }
}
