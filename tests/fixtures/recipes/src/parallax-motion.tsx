// parallax-motion.html: motion/Parallax.tsx under MotionProvider, rendered on the client. "Destroyed" renders plain
// divs in the layers' places, so the page's geometry and markup match the GSAP page's before and after.
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'

import { expose } from './harness'
import { MotionProvider } from '../../../../skills/scroll-animation/assets/motion/MotionProvider'
import { Parallax } from '../../../../skills/scroll-animation/assets/motion/Parallax'
import { parallaxProbe, toScroll } from './parallax-probe'

function Page({ on }: { on: boolean }) {
  return (
    <MotionProvider>
      <main>
        <div className="spacer" />
        {on ? <Parallax speed={0.2} className="layer" /> : <div className="layer" />}
        <div className="spacer" />
        {on ? <Parallax speed={-0.15} className="layer small" /> : <div className="layer small" />}
        <div className="spacer" />
      </main>
    </MotionProvider>
  )
}

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
  extras: { ...parallaxProbe([0.2, -0.15]), toScroll },
})
