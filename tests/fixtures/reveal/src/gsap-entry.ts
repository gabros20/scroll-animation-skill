// gsap.html's entry: reveal() on the route root (#page), after `?boot`. setupGsap() runs inside reveal() and marks
// the engine ready, so nothing is ready until then.
import { reveal, type RevealHandle } from '../../../../skills/scroll-animation/assets/gsap/reveal'
import { boot } from './boot'

const root = document.getElementById('page')!
let handle: RevealHandle | null = null

boot(() => (handle = reveal(root)), {
  hide() {
    handle?.destroy()
    handle = null
    root.style.display = 'none'
  },
  show() {
    root.style.display = ''
    handle = reveal(root)
  },
})
