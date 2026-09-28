// marquee.html: gsap/marquee-velocity.ts with its toggle, native scrolling. A 10 s loop, so movement shows quickly.
import { expose, frames } from './harness'
import { gsap, setupGsap } from '../../../../skills/scroll-animation/assets/gsap/setup'
import {
  marqueeVelocity,
  type MarqueeVelocityHandle,
} from '../../../../skills/scroll-animation/assets/gsap/marquee-velocity'
import { gsapCensus } from './census'

setupGsap()

const el = document.getElementById('ticker')!
const track = el.querySelector<HTMLElement>('[data-marquee-track]')!
const toggle = document.getElementById('toggle')!
document.addEventListener('click', (event) => {
  if ((event.target as Element).closest('a')) event.preventDefault()
})

const loop = () => gsap.getTweensOf(track)[0] ?? null
/** The track's drawn offset, px, from its computed transform (a GSAP read would fold its CSS translate inline). */
const offset = () => {
  const transform = getComputedStyle(track).transform
  return transform === 'none' ? 0 : new DOMMatrix(transform).m41
}

expose<MarqueeVelocityHandle | null>({
  create: () => marqueeVelocity(el, { toggle, duration: 10 }),
  destroy: (handle) => handle?.destroy(),
  census: gsapCensus,
  extras: {
    state() {
      const tween = loop()
      return {
        x: Math.round(offset() * 100) / 100,
        timeScale: tween ? Math.round(tween.timeScale() * 1000) / 1000 : null,
        running: !!tween && !tween.paused(),
        pressed: toggle.getAttribute('aria-pressed'),
        inline: track.getAttribute('style') ?? '',
        paused: (window.__t.handle as () => MarqueeVelocityHandle | null)()?.paused ?? null,
      }
    },
    /** Scrolls at `speed` px/s (negative: up) for `ms`, whatever the frame rate; returns the largest timeScale seen, signed. */
    async fling(speed: number, ms: number) {
      let peak = 0
      const t0 = performance.now()
      let last = t0
      while (last - t0 < ms) {
        await frames(1)
        const now = performance.now()
        window.scrollBy({ top: (speed * (now - last)) / 1000, behavior: 'instant' })
        last = now
        const s = loop()?.timeScale() ?? 0
        if (Math.abs(s) > Math.abs(peak)) peak = s
      }
      return Math.round(peak * 1000) / 1000
    },
    /** How far the track moved over `ms`, px. */
    async moved(ms: number) {
      const a = offset()
      await new Promise((resolve) => setTimeout(resolve, ms))
      return Math.round((offset() - a) * 100) / 100
    },
  },
})
