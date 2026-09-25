// gsap.html's entry: mounts loop-video.ts over the static [data-loop-video]
// markup and exposes a tiny __fx surface for tests/loop-video.mjs. No
// [data-loop-toggle] exists in the HTML, so this also exercises the
// auto-created-button path.
import { initLoopVideos } from '../../../../skills/scroll-animation/assets/gsap/loop-video'

const controller = initLoopVideos(document)

Object.assign(window, {
  __fx: {
    destroy: () => controller.destroy()
  }
})
