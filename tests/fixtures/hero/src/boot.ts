// Every entry boots through here. The stub scene starts first (it prepares before the entrance starts), or with
// `?stub=late` once the entrance is running (it must wait for settled to prepare). `?boot=<ms>` holds the engine back,
// so a check can let the failsafe fire first; `?failsafe=latch` sets its latch instead, for the Motion page, which
// renders on the client and so has no item for the CSS failsafe to fire on. `__fx.bootedAt` is the page time the
// engine started.
import { stubScene, type StageRecord } from './stub-scene'

export function boot(start: () => void): void {
  const fx = { bootedAt: null as number | null, scene: null as StageRecord[] | null }
  Object.assign(window, { __fx: fx })
  const params = new URLSearchParams(location.search)
  const canvas = document.getElementById('scene')!
  if (params.get('stub') === 'late') {
    const html = document.documentElement
    const onPhase = () => {
      html.removeEventListener('entrance:phase', onPhase)
      fx.scene = stubScene(canvas)
    }
    html.addEventListener('entrance:phase', onPhase)
  } else {
    fx.scene = stubScene(canvas)
  }
  const run = () => {
    if (params.get('failsafe') === 'latch') document.documentElement.dataset.animationFailsafe = ''
    fx.bootedAt = performance.now()
    start()
  }
  const delay = Number(params.get('boot'))
  if (delay > 0) setTimeout(run, delay)
  else run()
}
