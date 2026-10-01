// scroll-well-motion.html: motion/ScrollWell.tsx under MotionProvider, rendered on the client, on the GSAP page's
// geometry. "Destroyed" renders the same sections without the wells, so the markup matches before and after.
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'

import { expose } from './harness'
import { MotionProvider } from '../../../../skills/scroll-animation/assets/motion/MotionProvider'
import { ScrollWell } from '../../../../skills/scroll-animation/assets/motion/ScrollWell'
import { wellProbe } from './scroll-well-probe'

function Page({ on }: { on: boolean }) {
  return (
    <MotionProvider>
      <main>
        <div className="spacer" />
        <section className="well fits" id="fits">
          {on && <ScrollWell />}
          <h2>Fits the viewport</h2>
          <p>
            <a href="#end" id="to-end">
              Down to the end
            </a>
          </p>
        </section>
        <div className="spacer" />
        <section className="well tall" id="tall">
          {on && <ScrollWell />}
          <h2>Taller than the viewport</h2>
        </section>
        <div className="spacer" />
        <div className="scene" id="scene" data-scene-root="">
          <section className="well clamped" id="clamped">
            {on && <ScrollWell />}
            <h2>Inside a pinned scene</h2>
          </section>
        </div>
        <div className="spacer" />
        <section className="end" id="end">
          <h2>The end</h2>
        </section>
        <div className="spacer short" />
      </main>
    </MotionProvider>
  )
}

document.documentElement.classList.add('smooth')
const root = createRoot(document.getElementById('root')!)
flushSync(() => root.render(<Page on={false} />))

expose<true>({
  create() {
    flushSync(() => root.render(<Page on />))
    return true
  },
  destroy() {
    flushSync(() => root.render(<Page on={false} />))
  },
  extras: wellProbe(),
})
