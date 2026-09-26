import { scrubVideo } from '../../../../skills/scroll-animation/assets/gsap/scrub-video'
import { setupGsap } from '../../../../skills/scroll-animation/assets/gsap/setup'
import { CAMERA, LOOPS, SOURCES } from './config'

setupGsap()
scrubVideo(document.querySelector<HTMLElement>('[data-scene-root]')!, { fps: 30, ...LOOPS, ...SOURCES, camera: CAMERA })
