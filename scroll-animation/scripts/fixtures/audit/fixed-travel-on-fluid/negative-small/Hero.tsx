import { m, useScroll, useTransform } from 'motion/react'
// styles use var(--fluid) elsewhere on this page
export function Hero() {
  const { scrollYProgress } = useScroll()
  const y = useTransform(scrollYProgress, [0, 1], [0, 40])
  return <m.div style={{ y }} initial={{ y: 24 }} animate={{ y: 0 }} />
}
