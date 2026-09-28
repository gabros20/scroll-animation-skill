// S6b — SplitText's aria modes on a heading and a paragraph with a link.
import gsap from 'gsap'
import { SplitText } from 'gsap/SplitText'

gsap.registerPlugin(SplitText)
const aria = new URLSearchParams(location.search).get('aria') ?? 'auto'
const targets = [document.getElementById('h'), document.getElementById('p')]
const splits = aria === 'unsplit' ? [] : targets.map((el) => SplitText.create(el, { type: 'lines,words', aria }))

window.__s6b = {
  aria,
  attrs: () =>
    targets.map((el) => ({
      id: el.id,
      ariaLabel: el.getAttribute('aria-label'),
      ariaHidden: el.getAttribute('aria-hidden'),
      piecesHidden: el.querySelectorAll('[aria-hidden="true"]').length,
      linkText: el.querySelector('a')?.textContent ?? null,
      linkHiddenInside: el.querySelector('a') ? el.querySelectorAll('a [aria-hidden="true"]').length : null
    })),
  splitCount: splits.length
}
