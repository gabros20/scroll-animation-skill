// motionDriver: Motion's frameloop drives Lenis, and a hand-written useScroll() value must land in
// the frame whose scroll it paints with. S4b's probe (the raw value written to a custom property
// from useMotionValueEvent, the non-accelerated path) and its end-of-frame recorder.
import { cancelFrame, frame } from 'motion'
import { useMotionValueEvent, useScroll } from 'motion/react'
import { useRef } from 'react'
import { createRoot } from 'react-dom/client'
import '../../../skills/scroll-animation/assets/css/animation.css'
import { MotionProvider } from '../../../skills/scroll-animation/assets/motion/MotionProvider'
import { createSmoothScroll, motionDriver } from '../../../skills/scroll-animation/assets/smooth/lenis'
import './page.css'
import { createRecorder, scrollTop } from './rec.js'

const handle = createSmoothScroll({ driver: motionDriver(frame, cancelFrame) })

function Probe() {
  const { scrollY } = useScroll()
  const raw = useRef<HTMLDivElement>(null)
  useMotionValueEvent(scrollY, 'change', (v) => raw.current?.style.setProperty('--v', String(v)))
  return (
    <>
      <div id="raw" ref={raw} />
      <div style={{ height: 6000, background: 'linear-gradient(#fff, #ccf)' }} />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <MotionProvider>
    <Probe />
  </MotionProvider>,
)

const read = () => {
  const v = document.getElementById('raw')?.style.getPropertyValue('--v')
  return v ? parseFloat(v) : null
}
const rec = createRecorder((t: number) => ({ t, y: scrollTop(), raw: read() }))

Object.assign(window, { __fx: { rec, handle } })
