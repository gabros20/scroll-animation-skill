// What tests/recipes.mjs reads and drives on both parallax pages: each `.layer` in order, with its speed.
import { currentSmoothScroll } from '../../../../skills/scroll-animation/assets/smooth/authority'
import { frames } from './harness'

const round = (v: number, places = 2) => Math.round(v * 10 ** places) / 10 ** places

/** Scrolls at once to document position `y`, through the page's authority. */
export function toScroll(y: number) {
  const scroll = currentSmoothScroll()
  if (scroll) scroll.scrollTo(y, { immediate: true })
  else window.scrollTo({ top: y, behavior: 'instant' })
  return frames(3)
}

export function parallaxProbe(speeds: number[]) {
  const layer = (i: number) => document.querySelectorAll<HTMLElement>('.layer')[i]!
  /**
   * The drawn offset, px, and the layout box under it. The GSAP recipe writes the `translate` property (a percentage
   * of the element's height), the Motion one `transform`: both count.
   */
  const read = (i: number) => {
    const el = layer(i)
    const style = getComputedStyle(el)
    let translate = style.transform === 'none' ? 0 : new DOMMatrix(style.transform).m42
    const y = style.translate === 'none' ? '0px' : (style.translate.split(' ')[1] ?? '0px')
    translate += y.endsWith('%') ? (Number.parseFloat(y) / 100) * el.offsetHeight : Number.parseFloat(y)
    const top = el.getBoundingClientRect().top - translate
    return { el, translate, top, height: el.offsetHeight }
  }
  return {
    /** Layer `i`: its translate, where its pass puts it (the drift the recipe promises) and its inline style. */
    layer(i: number) {
      const { el, translate, top, height } = read(i)
      const view = window.innerHeight
      const p = (view - top) / (view + height)
      const expected = speeds[i]! * (view + height) * (Math.min(1, Math.max(0, p)) - 0.5)
      return { translate: round(translate), expected: round(expected), p: round(p, 4), inline: el.getAttribute('style') ?? '' }
    },
    /** Scrolls so layer `i` is at progress `p` of its pass (0: its top at the viewport's bottom; 1: its bottom at the top). */
    toPass(i: number, p: number) {
      const { top, height } = read(i)
      const view = window.innerHeight
      return toScroll(top + window.scrollY - view + p * (view + height))
    },
  }
}
