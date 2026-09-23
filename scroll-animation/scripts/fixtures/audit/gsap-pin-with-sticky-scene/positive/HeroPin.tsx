import { ScrollTrigger } from 'gsap/ScrollTrigger'

export function HeroPin() {
  ScrollTrigger.create({ trigger: '#hero', pin: true })
  return (
    <section id="hero">
      <div data-scrub-stage>scene content</div>
    </section>
  )
}
