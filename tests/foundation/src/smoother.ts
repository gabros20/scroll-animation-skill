// ScrollSmoother as the scroll authority. createSmoother stamps `smoother` and follows reduced motion live
// without killing the smoother (the page's ScrollTriggers are bound to its wrapper): smoothing 0 and no
// data-speed effects under `reduce`, so the page scrolls 1:1 from where the reader was, and the triggers keep
// tracking. Nothing starts on load; tests/foundation.mjs calls these hooks and reads `state()` after each step.
import { ScrollSmoother } from 'gsap/ScrollSmoother'
import '../../../skills/scroll-animation/assets/css/animation.css'
import { gsap, ScrollTrigger, setupGsap } from '../../../skills/scroll-animation/assets/gsap/setup'
import { currentSmoothScroll, type SmoothScrollHandle } from '../../../skills/scroll-animation/assets/smooth/authority'
import { createSmoother } from '../../../skills/scroll-animation/assets/smooth/smoother'
import './page.css'

setupGsap({ plugins: [ScrollSmoother] })

let handle: SmoothScrollHandle | null = null
let st: ScrollTrigger | null = null

Object.assign(window, {
  __fx: {
    /** The smoother with data-speed effects, then a trigger over #track (900–2700 px in a 600 px viewport, so
     * progress runs 0 → 1 over scroll 300 → 2700). */
    create() {
      handle = createSmoother(ScrollSmoother, { smooth: 1, effects: true })
      st = ScrollTrigger.create({ trigger: '#track', start: 'top bottom', end: 'bottom top' })
    },
    scrollTo: (y: number, immediate = true) => handle?.scrollTo(y, { immediate }),
    stop: () => handle?.stop(),
    start: () => handle?.start(),
    /** Content grows above #track: its trigger's start moves down by `px` once something refreshes. */
    grow(px: number) {
      const block = document.createElement('div')
      block.style.height = `${px}px`
      document.getElementById('smooth-content')!.prepend(block)
    },
    /** Resolves after `frames` frames with the largest distance between where the content is drawn and scrollY. */
    drift: (frames: number) =>
      new Promise<number>((resolve) => {
        const content = document.getElementById('smooth-content')!
        let worst = 0
        let n = 0
        const loop = () => {
          worst = Math.max(worst, Math.abs(content.getBoundingClientRect().top + window.scrollY))
          if (++n < frames) requestAnimationFrame(loop)
          else resolve(Math.round(worst))
        }
        requestAnimationFrame(loop)
      }),
    destroy() {
      st?.kill()
      handle?.destroy()
    },
    state: () => {
      const smoother = ScrollSmoother.get()
      return {
        stamp: document.documentElement.dataset.scrollAuthority ?? null,
        current: currentSmoothScroll()?.authority ?? null,
        smoother: !!smoother,
        smooth: smoother ? smoother.smooth() : null,
        effects: smoother ? smoother.effects().length : null,
        speedY: Math.round(gsap.getProperty('#speed', 'y') as number),
        wrapperFixed: getComputedStyle(document.getElementById('smooth-wrapper')!).position === 'fixed',
        scrollY: Math.round(window.scrollY),
        contentTop: Math.round(document.getElementById('smooth-content')!.getBoundingClientRect().top),
        progress: st ? Math.round(st.progress * 1000) / 1000 : null,
        bodyHeight: document.body.style.height,
      }
    },
  },
})
