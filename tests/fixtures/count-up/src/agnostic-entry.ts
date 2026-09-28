// agnostic.html's entry: the engine-free mountCountUps() on the route root (#page), after `?boot`. Count-up never marks
// the engine ready (its numbers are never hidden), so this page does it for the entrance engine a real page would run,
// unless `?noready` asks to see that count-up alone leaves the failsafe armed.
import { markAnimationReady } from '../../../../skills/scroll-animation/assets/config'
import { mountCountUps } from '../../../../skills/scroll-animation/assets/count-up'
import { boot } from './boot'

const root = document.getElementById('page')!
let stop: (() => void) | null = null

boot(
  () => {
    stop = mountCountUps(root)
    if (!new URLSearchParams(location.search).has('noready')) markAnimationReady()
  },
  {
    hide() {
      stop?.()
      stop = null
      root.style.display = 'none'
    },
    show() {
      root.style.display = ''
      stop = mountCountUps(root)
    },
  },
)
