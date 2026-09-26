// motion-seam.html's entry (task 21): mounts LoopVideo.tsx in seam mode and
// instruments rVFC callbacks (mediaTime, presentedFrames) plus
// ended/pause/play/seeking/seeked events for tests/loop-video.mjs's seam-wrap
// checks. A SEPARATE requestVideoFrameCallback subscription from the one
// LoopVideo.tsx registers internally — rVFC supports many concurrent
// subscribers on one element, so this observes without disturbing the
// controller under test. See gsap-seam-entry.ts for the clip/seam-frame
// rationale (shared).
import { createRoot } from 'react-dom/client'

import { LoopVideo } from '../../../../skills/scroll-animation/assets/motion/LoopVideo'

const FPS = 30
const POSTER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7'

createRoot(document.getElementById('root')!).render(
  <LoopVideo poster={POSTER} loopFromFrame={45} fps={FPS}>
    <source src="/clip-seam.mp4" type="video/mp4" />
  </LoopVideo>
)

const events: { type: string; t: number }[] = []
const frames: { mediaTime: number; presentedFrames: number }[] = []

function attach() {
  const video = document.querySelector('video')
  if (!video) {
    // React's commit for the first render happens synchronously under
    // createRoot in a browser, but poll briefly rather than assume.
    requestAnimationFrame(attach)
    return
  }
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
}
attach()
