// reveal-cjk.html: split-reveal on spike S6e's Japanese, Chinese and Thai samples, each in its own `lang`. What
// SplitText made is read against splitWords() run here, in this browser's own Intl.Segmenter.
import { SplitText } from 'gsap/SplitText'

import { setupGsap } from '../../../../skills/scroll-animation/assets/gsap/setup'
import { splitReveal } from '../../../../skills/scroll-animation/assets/gsap/split-reveal'
import { splitWords } from '../../../../skills/scroll-animation/assets/split-words'
import { norm } from './measure'
import { SAMPLES, type Lang } from './samples'

setupGsap({ plugins: [SplitText] })

const boxes = Array.from(document.querySelectorAll<HTMLElement>('[data-sample]'))
const handles = boxes.map((box) => splitReveal(box))

const t = {
  ready: () => handles.every((handle) => !!handle.split),
  read: () =>
    boxes.map((box, i) => {
      const split = handles[i].split
      const lang = box.dataset.sample as Lang
      return {
        lang,
        words: split?.words.map((word) => word.textContent ?? '') ?? [],
        expected: splitWords(SAMPLES[lang], lang),
        lines: split?.lines.map((line) => norm(line.textContent)) ?? [],
        pieces: norm(box.querySelector('[aria-hidden="true"]')?.textContent),
        copy: norm(box.firstElementChild?.textContent),
        text: SAMPLES[lang],
        boundaryLeft: box.innerHTML.includes('​'),
      }
    }),
}

declare global {
  interface Window {
    __t: typeof t
  }
}
window.__t = t
