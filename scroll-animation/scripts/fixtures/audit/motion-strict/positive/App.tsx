import { LazyMotion, domAnimation } from 'motion/react'

export function App() {
  return (
    <LazyMotion features={domAnimation} strict>
      <motion.div className="box" />
    </LazyMotion>
  )
}
