/**
 * Imperative controller over a scroll-driven `<video>`. Port of
 * `videoController.ts` — already framework-free, carried over unchanged bar
 * the module docs.
 *
 * This is where the hard-won browser/WebKit hardening lives, isolated from
 * whatever scroll/easing logic drives it, so a higher-level state machine
 * never has to touch the element directly. Owns:
 *
 * - decoder priming (some WebKit builds won't paint a `currentTime` seek on
 *   a video that has never started — a muted `play()` + `pause()` warms the
 *   pipeline);
 * - guarded seeking (one seek in flight at a time, sub-frame epsilon — some
 *   engines queue seeks and fall behind otherwise);
 * - robust playback start that survives a `play()` issued mid-seek during a
 *   fast handoff (silently dropped by some engines; wait for `seeked` with
 *   a timeout fallback);
 * - a watchdog that re-issues `play()` when the engine demotes the GPU
 *   layer or the tab hides/shows and the video should be playing.
 *
 * The controller tracks a single `desiredPlaying` intent: `play()` sets it,
 * `pause()`/`reset()` clear it, and the watchdogs only ever resume while
 * it's set.
 */

/** Seeks below this delta are skipped — roughly half a frame at 30fps. */
const SEEK_EPSILON = 1 / 60

export interface VideoController {
  /** Warm the decoder so the first scrub seek actually paints. */
  prime(): void
  /** Guarded scrub seek: skipped if a seek is in flight or within epsilon. */
  setTime(seconds: number): void
  /** Start/continue playback robustly (survives a mid-seek `play()`). */
  play(): void
  /** Pause and clear the playing intent. */
  pause(): void
  /** Re-issue `play()` if it was dropped while intending to play (in-loop watchdog). */
  ensurePlaying(): void
  /** Pause and force `currentTime` back to `seconds` (tolerates not-yet-seekable). */
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
    if (p) {
      p.then(() => {
        if (!desiredPlaying) video.pause()
      }).catch(() => {})
    }
  }

  // During a FAST scrub the handoff can land while a currentTime seek is
  // still resolving, and some engines silently drop a play() issued
  // mid-seek. So if seeking, wait for `seeked` — with a timeout fallback in
  // case the event never fires — then play.
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
    // One seek in flight at a time — some engines queue them and fall behind.
    if (!video.seeking && Math.abs(video.currentTime - seconds) > SEEK_EPSILON) {
      video.currentTime = seconds
    }
  }

  const ensurePlaying = () => {
    if (desiredPlaying && !video.ended && video.paused && document.visibilityState === 'visible') {
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

  // Some engines demote the video's GPU layer and silently pause it;
  // browsers also pause when the tab hides. Resume only while intended.
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
