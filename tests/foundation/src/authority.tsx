// The scroll-authority stamp: createSmoothScroll and the React SmoothScroll own
// <html data-scroll-authority> while they run and remove it when they stop. Nothing starts on load;
// tests/foundation.mjs calls these hooks and reads `state()` after each step.
import { useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import '../../../skills/scroll-animation/assets/css/animation.css'
import { currentSmoothScroll, type SmoothScrollHandle } from '../../../skills/scroll-animation/assets/smooth/authority'
import { createSmoothScroll, rafDriver } from '../../../skills/scroll-animation/assets/smooth/lenis'
import { SmoothScroll } from '../../../skills/scroll-animation/assets/smooth/SmoothScroll'
import './page.css'

type Authority = 'lenis' | 'native'

// Live Lenis instances, counted from outside: each adds one non-passive `wheel` listener on window
// and removes it in destroy(). Patched before any instance exists (none start on load).
const liveWheel = new Set<unknown>()
const addListener = EventTarget.prototype.addEventListener
const removeListener = EventTarget.prototype.removeEventListener
EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, listener: unknown, options?: unknown) {
  if (this === window && type === 'wheel' && (options as AddEventListenerOptions | undefined)?.passive === false) liveWheel.add(listener)
  return addListener.call(this, type, listener as EventListener, options as AddEventListenerOptions)
}
EventTarget.prototype.removeEventListener = function (this: EventTarget, type: string, listener: unknown, options?: unknown) {
  if (this === window && type === 'wheel') liveWheel.delete(listener)
  return removeListener.call(this, type, listener as EventListener, options as EventListenerOptions)
}

const warnings: string[] = []
const warn = console.warn.bind(console)
console.warn = (...args: unknown[]) => {
  warnings.push(args.map(String).join(' '))
  warn(...args)
}

const html = document.documentElement
const handles: SmoothScrollHandle[] = []

let setAuthority: (a: Authority) => void = () => {}
function App({ initial }: { initial: Authority }) {
  const [authority, set] = useState(initial)
  setAuthority = set
  return (
    <SmoothScroll authority={authority}>
      <p>Content governed by one scroll authority.</p>
    </SmoothScroll>
  )
}
let root: Root | null = null

Object.assign(window, {
  __fx: {
    warnings,
    /** Starts a handle and returns its index in `handles`. */
    create() {
      handles.push(createSmoothScroll({ driver: rafDriver() }))
      return handles.length - 1
    },
    authorityOf: (i: number) => handles[i].authority,
    destroy: (i: number) => handles[i].destroy(),
    mount(initial: Authority) {
      root = createRoot(document.getElementById('root')!)
      flushSync(() => root!.render(<App initial={initial} />))
    },
    set: (a: Authority) => flushSync(() => setAuthority(a)),
    unmount: () => root?.unmount(),
    state: () => ({
      stamp: html.dataset.scrollAuthority ?? null,
      stamped: [...document.querySelectorAll('[data-scroll-authority]')].map((el) => el.tagName.toLowerCase()),
      lenisClass: html.classList.contains('lenis'),
      lenis: liveWheel.size,
      current: currentSmoothScroll()?.authority ?? null,
    }),
  },
})
