// agnostic.html's entry: the engine-free mountReveals() on the route root (#page), after `?boot`. It marks the
// engine ready itself.
import { mountReveals } from '../../../../skills/scroll-animation/assets/reveal'
import { boot } from './boot'

const root = document.getElementById('page')!
let stop: (() => void) | null = null

boot(() => (stop = mountReveals(root)), {
  hide() {
    stop?.()
    stop = null
    root.style.display = 'none'
  },
  show() {
    root.style.display = ''
    stop = mountReveals(root)
  },
})
