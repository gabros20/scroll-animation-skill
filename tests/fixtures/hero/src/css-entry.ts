// css.html's entry: the headline is css/split.css's from the first frame; this only tracks it for the signal.
import { markAnimationReady } from '../../../../skills/scroll-animation/assets/config'
import { trackEntrance } from '../../../../skills/scroll-animation/assets/entrance-signal'
import { boot } from './boot'

boot(() => {
  markAnimationReady()
  trackEntrance(document.querySelector('[data-split-words]')!)
})
