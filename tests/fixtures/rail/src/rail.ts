// Shared by every rail page: fills the track, builds the rail and puts `window.__rail` (the handle) and `window.__t`
// (what tests/rail.mjs reads and drives) on the page. Each page's entry starts its scroll authority first.
import {
  horizontalRail,
  type HorizontalRailHandle,
  type HorizontalRailOptions,
} from '../../../../skills/scroll-animation/assets/gsap/horizontal-rail'
import { currentSmoothScroll } from '../../../../skills/scroll-animation/assets/smooth/authority'

/** Holds the band has to respect: far from the scene defaults, so a writer that ignored them would show. */
export const HOLDS = { headHoldPx: 120, tailLeadPx: 240 }

/** Panel sizes, in order: `late` is as wide as an image that loads when the test asks. */
const PANELS = ['w60', 'w45', 'late', 'w70', 'w55']
/** 1600 x 800 intrinsic: 600 px wide at the fixture's 300 px height. */
const WIDE_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1600' height='800'%3E%3Crect width='1600' height='800' fill='%23a58a64'/%3E%3C/svg%3E"

declare global {
  interface Window {
    __rail: HorizontalRailHandle | null
    __t: ReturnType<typeof helpers>
  }
}

export function mount(options: HorizontalRailOptions = {}) {
  const root = document.querySelector<HTMLElement>('[data-scene-root]')!
  const track = root.querySelector<HTMLElement>('[data-rail-track]')!
  PANELS.forEach((size, i) => {
    const panel = document.createElement('article')
    panel.dataset.railPanel = ''
    panel.className = size
    panel.innerHTML =
      `<h2>Panel ${i + 1}</h2><p><a href="#panel-${i + 1}" data-link>Open panel ${i + 1}</a></p>` +
      (size === 'late' ? '<img alt="" data-late>' : '')
    track.append(panel)
  })
  // Links go nowhere: a click must not move the page for any reason but the rail's.
  document.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a')) event.preventDefault()
  })
  const create = () => horizontalRail(root, { ...HOLDS, ...options })
  window.__rail = create()
  window.__t = helpers(root, track, create)
}

function helpers(root: HTMLElement, track: HTMLElement, create: () => HorizontalRailHandle | null) {
  const pin = root.querySelector<HTMLElement>('[data-scene-pin]')!
  const spacer = root.querySelector<HTMLElement>('[data-scene-spacer]')!
  const panels = () => Array.from(track.querySelectorAll<HTMLElement>('[data-rail-panel]'))
  const rail = () => window.__rail!
  const frames = (n: number) =>
    new Promise<void>((resolve) => {
      let i = 0
      const step = () => (++i >= n ? resolve() : requestAnimationFrame(step))
      requestAnimationFrame(step)
    })
  const round = (v: number) => Math.round(v * 100) / 100

  /** Scroll to `y` at once, through the page's authority. */
  const toScroll = (y: number) => {
    const scroll = currentSmoothScroll()
    if (scroll) scroll.scrollTo(y, { immediate: true })
    else window.scrollTo({ top: y, behavior: 'instant' })
    return frames(4)
  }
  /** Scroll to progress `p` at once. */
  const toProgress = (p: number) => {
    const t = rail().trigger!
    return toScroll(t.start + p * (t.end - t.start))
  }
  const pOf = (band: number) => {
    const { headExit, tailEnter } = rail().bounds()
    return headExit + band * (tailEnter - headExit)
  }

  return {
    frames,
    toScroll,
    toProgress,
    toBand: (band: number) => toProgress(pOf(band)),
    /** Progress halfway into each hold. */
    toHeadHold: () => toProgress(rail().bounds().headExit / 2),
    toTailHold: () => toProgress((rail().bounds().tailEnter + 1) / 2),
    state() {
      const r = rail()
      const view = pin.getBoundingClientRect()
      const all = panels().map((el) => el.getBoundingClientRect())
      const first = all[0]!
      const last = all[all.length - 1]!
      const inline = track.style.translate
      const { headExit, tailEnter } = r.bounds()
      return {
        travel: round(r.travel()),
        rtl: r.rtl(),
        scrollWidth: track.scrollWidth,
        pinWidth: pin.clientWidth,
        spacer: spacer.offsetHeight,
        rangePx: round(r.rangePx()),
        /** Scroll px the band spans: one of them moves the band by 1 / bandPx. */
        bandPx: round(r.rangePx() * (tailEnter - headExit)),
        p: round(r.progress() * 1000) / 1000,
        band: Math.round(r.band() * 10000) / 10000,
        mode: root.dataset.sceneState ?? null,
        inline,
        translate: inline ? parseFloat(inline) : null,
        computed: getComputedStyle(track).translate,
        // Where the track's box actually sits in the pin: its start edge against the pin's.
        drawn: round(r.rtl() ? track.getBoundingClientRect().right - view.right : track.getBoundingClientRect().left - view.left),
        // Each end's outer edge against the pin: 0 when flush.
        firstGap: round(r.rtl() ? view.right - first.right : first.left - view.left),
        lastGap: round(r.rtl() ? last.left - view.left : view.right - last.right),
        pinTop: round(view.top),
        pinBottomGap: round(innerHeight - view.bottom),
        scrollY: Math.round(scrollY),
        /** The panel sized by the late image (its heading and link hold it open before the image loads). */
        lateWidth: track.querySelector<HTMLElement>('.late')!.offsetWidth,
      }
    },
    /** Panel `i` lies whole inside the pin, and the pin fills the viewport. */
    inView(i: number) {
      const view = pin.getBoundingClientRect()
      const box = panels()[i]!.getBoundingClientRect()
      return (
        box.left >= view.left - 1 &&
        box.right <= view.right + 1 &&
        view.top >= -1 &&
        view.bottom <= innerHeight + 1 &&
        view.top <= 1
      )
    },
    active() {
      const el = document.activeElement
      if (!el || el === document.body) return null
      if (el.hasAttribute('data-intro')) return 'intro'
      if (el === track) return 'track'
      const panel = el.closest('[data-rail-panel]')
      return panel ? `panel-${panels().indexOf(panel as HTMLElement)}` : el.tagName.toLowerCase()
    },
    linkRect(i: number) {
      const r = panels()[i]!.querySelector('a')!.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    },
    reduced() {
      const cs = getComputedStyle(track)
      return {
        pinPosition: getComputedStyle(pin).position,
        pinSpacer: !!pin.closest('.pin-spacer'),
        rootHeight: root.offsetHeight,
        pinHeight: pin.offsetHeight,
        spacer: spacer.offsetHeight,
        inline: track.style.translate,
        computed: cs.translate,
        overflowX: cs.overflowX,
        snapType: cs.scrollSnapType,
        snapAlign: getComputedStyle(panels()[0]!).scrollSnapAlign,
        scrollable: track.scrollWidth > track.clientWidth,
        tabindex: track.getAttribute('tabindex'),
        outline: `${cs.outlineStyle} ${cs.outlineWidth}`,
      }
    },
    /** The native scroller moves: to the far end, snapped. */
    async scrollTrack() {
      track.scrollLeft = 100000
      await frames(6)
      return Math.round(track.scrollLeft)
    },
    loadImage() {
      root.querySelector<HTMLImageElement>('[data-late]')!.src = WIDE_IMAGE
    },
    /** A gutter at both ends of the track, as end padding: an engine that dropped it would end the rail flush. */
    gutter(px: number) {
      track.style.paddingInline = `${px}px`
      rail().refresh()
    },
    /** One more 400 px panel at the end: no existing box changes size, so only `rail.refresh()` can see it. */
    addPanel() {
      const panel = document.createElement('article')
      panel.dataset.railPanel = ''
      panel.style.width = '400px'
      panel.innerHTML = '<h2>Panel 6</h2><p><a href="#panel-6" data-link>Open panel 6</a></p>'
      track.append(panel)
    },
    /** Panel `i`'s start edge against the track's (the scroller's) start edge: 0 when a scroll put it there. */
    panelOffset(i: number) {
      const box = panels()[i]!.getBoundingClientRect()
      const view = track.getBoundingClientRect()
      return round(rail().rtl() ? view.right - box.right : box.left - view.left)
    },
    print() {
      const view = document.documentElement.clientWidth
      const cs = getComputedStyle(track)
      return {
        display: cs.display,
        translate: cs.translate,
        spacer: getComputedStyle(spacer).display,
        pinPosition: getComputedStyle(pin).position,
        // Every panel on the page, none pushed off its side.
        onPage: panels().every((el) => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.left >= -1 && r.right <= view + 1
        }),
      }
    },
    /** Every inline style, attribute and wrapper the rail and its scene could have left. */
    leftovers() {
      const all = [root, ...root.querySelectorAll<HTMLElement>('*')]
      const name = (el: HTMLElement) =>
        `${el.tagName.toLowerCase()}${Array.from(el.attributes, (a) => (a.name.startsWith('data-') ? `[${a.name}]` : '')).join('')}`
      return {
        styled: all.filter((el) => el.style.length > 0).map((el) => `${name(el)} {${el.getAttribute('style')}}`),
        // An emptied style attribute holds no declaration: listed, not failed.
        emptyStyle: all.filter((el) => el.getAttribute('style') === '').map(name),
        state: root.getAttribute('data-scene-state'),
        pinAttr: pin.getAttribute('data-scene-pin'),
        tabindex: track.getAttribute('tabindex'),
        pinSpacers: document.querySelectorAll('.pin-spacer').length,
        pinParent: pin.parentElement === root,
      }
    },
    destroy() {
      rail().destroy()
    },
    remount() {
      window.__rail = create()
    },
  }
}
