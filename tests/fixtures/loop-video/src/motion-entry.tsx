// motion.html's entry: mounts LoopVideo.tsx into #root. `controls` is forced
// on explicitly so every check in tests/loop-video.mjs is deterministic,
// independent of the duration-default heuristic (covered by reading the
// source, not by this fixture).
import { createRoot } from 'react-dom/client'

import { LoopVideo } from '../../../../skills/scroll-animation/assets/motion/LoopVideo'

const POSTER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7'

createRoot(document.getElementById('root')!).render(
  <LoopVideo poster={POSTER} controls>
    <source src="/clip.mp4" type="video/mp4" />
  </LoopVideo>
)
