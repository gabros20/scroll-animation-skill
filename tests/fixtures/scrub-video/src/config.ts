// Shared by both engines' pages: the test clip's loops (2 s at 30 fps: head 0-4, tail 55-58) and a camera whose
// frame size differs per tier (desktop 160 x 100 svh, mobile 60 x 100 svh), so the box width shows which tier's crop
// is on screen. `?holds` makes it a scene of holds instead, Folio's orbit: no loops, 400 px holds at both ends.
import type { CameraConfig } from '../../../../skills/scroll-animation/assets/media/camera'

const params = new URLSearchParams(location.search)

export const LOOPS = params.has('holds')
  ? {}
  : {
      headLoop: { fromFrame: 0, matchFrame: 5 },
      tailLoop: { fromFrame: 55 }
    }

export const HOLDS = params.has('holds') ? { headHoldPx: 400, tailLeadPx: 400 } : {}

export const CAMERA: CameraConfig = {
  desktop: { frameSize: { w: 160, h: 100 } },
  mobile: { frameSize: { w: 60, h: 100 } }
}

// The same file behind two URLs, so the requests say which tier was picked, each carrying the page's run id so the
// test server counts one page's video bytes on their own. The poster is the whole scene under reduced motion.
const run = params.get('run') ?? '0'
export const SOURCES = {
  src: `/clip.mp4?tier=desktop&run=${run}`,
  mobileSrc: `/clip.mp4?tier=mobile&run=${run}`,
  poster: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
}
