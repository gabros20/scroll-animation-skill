import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { PinnedScene } from '../animation/motion/PinnedScene'

export function HeroPin() {
  ScrollTrigger.create({ trigger: '#hero', pin: true })
  return (
    <section id="hero">
      <PinnedScene acts={3}>scene content</PinnedScene>
    </section>
  )
}
