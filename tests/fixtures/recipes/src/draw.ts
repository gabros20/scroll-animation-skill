// draw.html: gsap/draw-on-scroll.ts on native scrolling.
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'

import { expose, frames } from './harness'
import { setupGsap } from '../../../../skills/scroll-animation/assets/gsap/setup'
import { drawOnScroll, type DrawOnScrollHandle } from '../../../../skills/scroll-animation/assets/gsap/draw-on-scroll'
import { gsapCensus } from './census'

setupGsap({ plugins: [DrawSVGPlugin] })

const main = document.querySelector('main')!
const svg = (id: string) => document.getElementById(id)!

expose<DrawOnScrollHandle>({
  create: () => drawOnScroll(main),
  destroy: (handle) => handle.destroy(),
  census: gsapCensus,
  extras: {
    /** How much of each shape in svg `id` shows, 0..1, from its dash: no dash at all is fully drawn. */
    drawn(id: string) {
      return Array.from(svg(id).querySelectorAll<SVGPathElement>('[data-draw]'), (shape) => {
        const dash = getComputedStyle(shape).strokeDasharray
        const offset = Number.parseFloat(getComputedStyle(shape).strokeDashoffset) || 0
        if (!dash || dash === 'none') return { fraction: 1, offset, inline: shape.getAttribute('style') ?? '' }
        const length = DrawSVGPlugin.getLength(shape)
        const visible = Number.parseFloat(dash)
        return {
          fraction: Math.round((Math.min(visible, length) / length) * 1000) / 1000,
          offset,
          inline: shape.getAttribute('style') ?? '',
        }
      })
    },
    /** Scrolls so svg `id` is at progress `p` of its pass: top at 80% of the viewport → bottom at 50%. */
    toPass(id: string, p: number) {
      const box = svg(id).getBoundingClientRect()
      const view = window.innerHeight
      const start = box.top + window.scrollY - 0.8 * view
      const end = box.bottom + window.scrollY - 0.5 * view
      window.scrollTo({ top: start + p * (end - start), behavior: 'instant' })
      return frames(3)
    },
  },
})
