// flip.html: gsap/flip-transition.ts on a grid that opens #a into a detail (and #e enters), or reverses its order.
// "Mounted" is nothing: the recipe is a call. destroy() kills a running flip and puts the grid back as it was.
// `pending(view)` starts a flip whose change waits for `release()` (an async change: a fetch, a re-render), and every
// Flip.from call is counted, so a check can tell a flip that animated from one that was stopped first.
import { Flip } from 'gsap/Flip'

import { expose } from './harness'
import { gsap, setupGsap } from '../../../../skills/scroll-animation/assets/gsap/setup'
import { flipTransition, type FlipTransition } from '../../../../skills/scroll-animation/assets/gsap/flip-transition'
import { gsapCensus } from './census'

setupGsap({ plugins: [Flip] })

let froms = 0
const from = Flip.from.bind(Flip)
Flip.from = (...args: Parameters<typeof Flip.from>) => {
  froms++
  return from(...args)
}

const gallery = document.getElementById('gallery')!
const IDS = ['a', 'b', 'c', 'd', 'e']
const order = Array.from(gallery.children)

interface Box {
  x: number
  y: number
  w: number
  h: number
}
const round = (n: number) => Math.round(n * 10) / 10
function box(id: string): Box {
  const r = document.getElementById(id)!.getBoundingClientRect()
  return { x: round(r.left), y: round(r.top), w: round(r.width), h: round(r.height) }
}
const boxes = () => Object.fromEntries(IDS.map((id) => [id, box(id)]))
/** Each tile's style attribute: null when it has none. */
const inline = () => Object.fromEntries(IDS.map((id) => [id, document.getElementById(id)!.getAttribute('style')]))

function change(view: string, reverse: boolean) {
  return () => {
    gallery.dataset.view = view
    if (reverse) gallery.append(...Array.from(gallery.children).reverse())
  }
}

let current: FlipTransition | null = null
let pendingRelease = () => {}
/** One entry per flip started: true once its promise has resolved. */
const history: boolean[] = []
const samples: Array<{ boxes: Record<string, Box>; width: string; height: string }> = []
const sample = () => {
  const a = document.getElementById('a')!
  samples.push({ boxes: boxes(), width: a.style.width, height: a.style.height })
}

expose<true>({
  create: () => true,
  destroy() {
    current?.kill()
    current = null
    gsap.ticker.remove(sample)
    gallery.dataset.view = 'grid'
    gallery.append(...order)
  },
  census: gsapCensus,
  extras: {
    boxes,
    inline,
    /** Where everything lands in `view` (reversed or not), measured without a flip, and put back. */
    layout(view: string, reverse = false) {
      const was = gallery.dataset.view!
      const kids = Array.from(gallery.children)
      change(view, reverse)()
      const at = boxes()
      gallery.dataset.view = was
      gallery.append(...kids)
      return at
    },
    /**
     * Starts a flip to `view` with GSAP's clock held, so the boxes it starts from can be read before a single tick;
     * then lets it run, sampling every tick after GSAP's own update.
     */
    async flip(view: string, reverse = false) {
      const tweensBefore = gsap.globalTimeline.getChildren(true, true, true).length
      gsap.globalTimeline.pause()
      samples.length = 0
      const flip = flipTransition(gallery, { change: change(view, reverse) })
      current = flip
      const i = history.push(false) - 1
      flip.then(() => (history[i] = true))
      await new Promise((resolve) => setTimeout(resolve, 0))
      const start = {
        boxes: boxes(),
        inline: inline(),
        tweensBefore,
        tweens: gsap.globalTimeline.getChildren(true, true, true).length,
      }
      gsap.ticker.add(sample)
      gsap.globalTimeline.resume()
      return start
    },
    /** Waits for the flip to land; its samples, then where everything is and what's inline. */
    async landed(timeout = 4000) {
      const flip = current
      const ok = await Promise.race([flip?.then(() => true), new Promise((r) => setTimeout(() => r(false), timeout))])
      gsap.ticker.remove(sample)
      const opacityE = getComputedStyle(document.getElementById('e')!).opacity
      return { ok, samples: samples.slice(), boxes: boxes(), inline: inline(), opacityE }
    },
    history: () => history.slice(),
    froms: () => froms,
    bodyStyle: () => document.body.getAttribute('style'),
    /** A flip to `view` whose change lands only on release(): the first of two calls, or one killed mid-change. */
    pending(view: string) {
      let release = () => {}
      const flip = flipTransition(gallery, {
        change: () =>
          new Promise<void>((resolve) => {
            release = () => {
              change(view, false)()
              resolve()
            }
          }),
      })
      current = flip
      const i = history.push(false) - 1
      flip.then(() => (history[i] = true))
      pendingRelease = () => release()
    },
    release: () => pendingRelease(),
    kill: () => current?.kill(),
  },
})
