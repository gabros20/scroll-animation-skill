import Lenis from 'lenis'
import { PullToCentre } from '../components/PullToCentre'

export function Hero() {
  const lenis = new Lenis()
  return (
    <section>
      <PullToCentre />
    </section>
  )
}
