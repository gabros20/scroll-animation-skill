// The same-document pages' harness: window.__fx renders a view through transition() (the block), straight through
// document.startViewTransition (what React and any unguarded caller do: `raw`), or directly. tests/view-transitions.mjs
// drives it and reads the running transition through its own in-page tools (window.__t).
import { transition } from '../../../../skills/scroll-animation/assets/view-transitions'
import { articleView, indexView } from './layout'

type View = 'index' | 'article'
interface GoOptions {
  via?: 'transition' | 'raw'
  types?: string[]
  /** The update also jumps to the top, as a route change does. */
  scrollTop?: boolean
}

export function start(): void {
  const page = document.getElementById('page')!
  const header = document.querySelector<HTMLElement>('[data-header]')!
  let view: View = 'index'
  let finished: Promise<void> = Promise.resolve()

  const render = (next: View) => {
    view = next
    page.innerHTML = next === 'index' ? indexView() : articleView()
    header.dataset.headerInk = next === 'index' ? 'day' : 'night'
    fx.updates++
  }

  const fx = {
    updates: 0,
    view: () => view,
    go(next: View, { via = 'transition', types = [], scrollTop = false }: GoOptions = {}) {
      const update = () => {
        render(next)
        if (scrollTop) window.scrollTo(0, 0)
      }
      if (via === 'raw') {
        const vt = document.startViewTransition({ update, types })
        vt.ready.catch(() => {})
        finished = vt.finished.catch(() => {})
        return vt.updateCallbackDone
      }
      const p = transition(update, { types })
      finished = p.finished
      return p
    },
    finished: () => finished,
  }
  ;(window as unknown as { __fx: typeof fx }).__fx = fx
  render('index')
  fx.updates = 0
}
