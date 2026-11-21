// motion.html's entry: the hero's mount group as Reveal/RevealItem with `entrance`, rendered on the client (the
// pending phase is in the HTML, so nothing races the render).
import { createRoot } from 'react-dom/client'

import { MotionProvider } from '../../../../skills/scroll-animation/assets/motion/MotionProvider'
import { Reveal, RevealItem } from '../../../../skills/scroll-animation/assets/motion/Reveal'
import { boot } from './boot'
import { ITEMS } from './page'

function Hero() {
  return (
    <MotionProvider>
      <Reveal as="section" id="hero" className="hero" trigger="mount" entrance>
        {ITEMS.map((item) => (
          <RevealItem key={item.id} as={item.tag} id={item.id} effect={item.effect}>
            {item.text}
          </RevealItem>
        ))}
      </Reveal>
    </MotionProvider>
  )
}

boot(() => createRoot(document.getElementById('page')!).render(<Hero />))
