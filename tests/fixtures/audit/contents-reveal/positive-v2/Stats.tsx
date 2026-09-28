import { Reveal, RevealItem } from './Reveal'

export function Stats() {
  return (
    <>
      <Reveal className="lg:contents">
        <RevealItem>stat</RevealItem>
      </Reveal>
      <section className="contents" data-reveal data-reveal-stagger="0.1">
        <p data-reveal-item>stat</p>
      </section>
    </>
  )
}
