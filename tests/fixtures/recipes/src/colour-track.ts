// colour-track.html: gsap/colour-track.ts on <body>, native scrolling.
import { expose, frames } from './harness'
import { setupGsap } from '../../../../skills/scroll-animation/assets/gsap/setup'
import { colourTrack, type ColourTrackHandle } from '../../../../skills/scroll-animation/assets/gsap/colour-track'
import { gsapCensus } from './census'

setupGsap()

const main = document.querySelector('main')!
const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-colour-track]'))

/** A colour the browser resolves: `background-color` on a probe that exists only while it is read. */
function resolve(value: string) {
  const probe = document.createElement('div')
  probe.style.backgroundColor = value
  main.append(probe)
  const colour = getComputedStyle(probe).backgroundColor
  probe.remove()
  return colour
}

expose<ColourTrackHandle>({
  create: () => colourTrack(main),
  destroy: (handle) => handle.destroy(),
  census: gsapCensus,
  extras: {
    state() {
      const body = document.body.style
      return {
        a: body.getPropertyValue('--track-a'),
        b: body.getPropertyValue('--track-b'),
        p: Number.parseFloat(body.getPropertyValue('--track-p')),
        background: getComputedStyle(document.body).backgroundColor,
        inline: document.body.getAttribute('style') ?? '',
      }
    },
    /** What the blend must be: the browser's own color-mix of two colours at `p`, in a colour space. */
    mix(a: string, b: string, p: number, space = 'oklch') {
      return resolve(`color-mix(in ${space}, ${a}, ${b} ${p * 100}%)`)
    },
    resolve,
    /** Scrolls so handover `h` (into section h + 1) is at progress `p`: that section's top at (75% − 50% × p). */
    toHandover(h: number, p: number) {
      const top = sections[h + 1]!.getBoundingClientRect().top + window.scrollY
      window.scrollTo({ top: top - (0.75 - 0.5 * p) * window.innerHeight, behavior: 'instant' })
      return frames(3)
    },
  },
})
