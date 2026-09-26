// gsap-seam.html's entry (task 21): mounts loop-video.ts in seam mode and
// instruments rVFC callbacks (mediaTime, presentedFrames) plus
// ended/pause/play/seeking/seeked events for tests/loop-video.mjs's seam-wrap
// checks. A SEPARATE requestVideoFrameCallback subscription from the one
// loop-video.ts registers internally — rVFC supports many concurrent
// subscribers on one element, so this observes without disturbing the
// controller under test.
import { initLoopVideos } from '../../../../skills/scroll-animation/assets/gsap/loop-video'

const FPS = 30

initLoopVideos(document)

const video = document.querySelector('video')!
const events: { type: string; t: number }[] = []
const frames: { mediaTime: number; presentedFrames: number }[] = []

for (const type of ['ended', 'pause', 'play', 'seeking', 'seeked']) {
  video.addEventListener(type, () => events.push({ type, t: performance.now() }))
}

const observe = (_now: number, meta: VideoFrameCallbackMetadata) => {
  frames.push({ mediaTime: meta.mediaTime, presentedFrames: meta.presentedFrames })
  video.requestVideoFrameCallback?.(observe)
}
video.requestVideoFrameCallback?.(observe)

Object.assign(window, {
  __fx: {
    fps: FPS,
    duration: () => video.duration,
    events: () => events,
    frames: () => frames,
    reset: () => {
      events.length = 0
      frames.length = 0
    }
  }
})
