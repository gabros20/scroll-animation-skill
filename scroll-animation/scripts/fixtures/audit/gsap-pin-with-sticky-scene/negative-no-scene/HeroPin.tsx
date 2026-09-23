import { ScrollTrigger } from 'gsap/ScrollTrigger'

export function HeroPin() {
  ScrollTrigger.create({ trigger: '#hero', pin: true })
  return <section id="hero">no scene here</section>
}
