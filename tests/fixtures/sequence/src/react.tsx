// <FrameSequence> fed by Motion's useScroll over the range, inside an <Activity> the runner can hide (what Next does
// to a route it keeps alive): hiding must destroy the sequence, showing must build a new one.
import { useScroll } from 'motion/react'
import { Activity, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { FrameSequence as Handle } from '../../../../skills/scroll-animation/assets/media/frame-sequence'
import { FrameSequence } from '../../../../skills/scroll-animation/assets/motion/FrameSequence'
import { MotionProvider } from '../../../../skills/scroll-animation/assets/motion/MotionProvider'
import { expose } from './fixture'

// Every handle the component hands over, so the runner can read one after it was destroyed.
const handles: Handle[] = []
let current: Handle | null = null
const sequenceRef = {
  get current() {
    return current
  },
  set current(h: Handle | null) {
    current = h
    if (h) handles.push(h)
  },
}

let readProgress = () => 0
let setHidden: (hidden: boolean) => void = () => {}

function App() {
  const range = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: range, offset: ['start start', 'end end'] })
  readProgress = () => scrollYProgress.get()
  const [hidden, hide] = useState(false)
  setHidden = hide
  return (
    <>
      <div id="lead" />
      <div id="range" ref={range}>
        <div id="pin">
          <Activity mode={hidden ? 'hidden' : 'visible'}>
            <FrameSequence
              id="seq"
              manifest="seq/manifest.json"
              progress={scrollYProgress}
              label="Test pattern"
              sequenceRef={sequenceRef}
            />
          </Activity>
        </div>
      </div>
      <div id="tail" />
    </>
  )
}

const root = createRoot(document.getElementById('root')!)
root.render(
  <MotionProvider>
    <App />
  </MotionProvider>,
)

expose({
  handle: () => current,
  progress: () => readProgress(),
  handles: () => handles.length,
  handleStats: (n: number) => handles[n]?.stats() ?? null,
  hide: (hidden: boolean) => flushSync(() => setHidden(hidden)),
  unmount: () => root.unmount(),
})
