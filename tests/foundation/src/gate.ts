// The pre-JS gate's page: no engine boots unless `?ready=<ms>` asks for one at that time.
// markAnimationReady is exposed so a check can boot the engine late, after the failsafe fired.
import { markAnimationReady } from '../../../skills/scroll-animation/assets/config'

const failsafeEvents: { name: string; t: number }[] = []
document.addEventListener(
  'animationend',
  (e) => {
    if (e.animationName.startsWith('animation-failsafe')) failsafeEvents.push({ name: e.animationName, t: performance.now() })
  },
  true,
)

const ready = Number(new URLSearchParams(location.search).get('ready'))
if (ready > 0) setTimeout(markAnimationReady, ready)

Object.assign(window, { __fx: { markAnimationReady, failsafeEvents } })
