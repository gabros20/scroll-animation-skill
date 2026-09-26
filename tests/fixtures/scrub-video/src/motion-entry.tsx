import { createRoot } from 'react-dom/client'

import { ScrubVideo } from '../../../../skills/scroll-animation/assets/motion/ScrubVideo'
import { CAMERA, LOOPS, SOURCES } from './config'

createRoot(document.getElementById('root')!).render(
  <>
    <ScrubVideo fps={30} {...LOOPS} {...SOURCES} camera={CAMERA}>
      <section style={{ height: '100vh' }} />
      <section style={{ height: '100vh' }} />
      <section style={{ height: '100vh' }} />
    </ScrubVideo>
    <div style={{ height: '150vh' }} />
  </>
)
