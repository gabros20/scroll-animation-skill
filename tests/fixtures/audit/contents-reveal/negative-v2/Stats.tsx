import { Reveal, RevealItem } from './Reveal'

// The trigger is the group (Reveal, data-reveal), which keeps a real box; items and plain wrappers may be contents.
export function Stats() {
  return (
    <Reveal className="grid lg:grid-cols-3">
      <div className="lg:contents">
        <RevealItem className="contents">stat</RevealItem>
        <p className="contents" data-reveal-item data-reveal-effect="fade">stat</p>
      </div>
    </Reveal>
  )
}
