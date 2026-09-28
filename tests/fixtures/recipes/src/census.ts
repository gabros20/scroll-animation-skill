// What a GSAP recipe leaves running: its triggers, Observers and tweens. Each page passes this to expose() as its
// census, so leftovers() reports any count that isn't back at its baseline after destroy().
import { Observer } from 'gsap/Observer'

import { ScrollTrigger, gsap } from '../../../../skills/scroll-animation/assets/gsap/setup'

export function gsapCensus() {
  return {
    triggers: ScrollTrigger.getAll(),
    observers: Observer.getAll(),
    tweens: gsap.globalTimeline.getChildren(true, true, true),
  }
}
