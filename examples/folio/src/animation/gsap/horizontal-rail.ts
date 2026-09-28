/**
 * gsap/horizontal-rail.ts — a horizontal rail for GSAP pages: `horizontalRail(root, options)` → a pinned scene
 * (gsap/pinned-scene.ts) whose band slides a track of panels sideways.
 *
 *   <section data-scene-root data-rail>                             css/scene.css, then css/rail.css
 *     <div data-scene-pin>
 *       <div data-rail-track role="region" aria-label="Selected work">
 *         <article data-rail-panel>…</article>                      as many as you like
 *       </div>
 *     </div>
 *     <div data-scene-spacer aria-hidden="true"></div>              the runway: the rail sets its height to the travel
 *   </section>
 *
 *   const rail = horizontalRail(el)   // { pin: 'gsap' } on ScrollSmoother pages; holds and scene events pass through
 *   rail.travel()   rail.rtl()   rail.scrollToPanel(2)   rail.refresh()   rail.destroy()   …plus pinnedScene's handle
 *
 * - Travel is measured, never set: the track's scroll width minus the pin's width, read exactly (a gutter of end
 *   padding counts in every engine) and already scaled on a fluid layout. Pad the track, not the pin. The spacer takes
 *   that height, so the runway is the horizontal distance. It is re-measured inside every ScrollTrigger refresh
 *   (resize, load, `ScrollTrigger.refresh()`), once GSAP has unpinned everything and before any trigger reads the page,
 *   and a ResizeObserver on the track and its panels (a late font, an image without dimensions) asks for that refresh.
 *   After adding or removing panels, call `rail.refresh()`.
 * - One writer: every progress event writes the track's `translate` from the band, 0 at its start and the whole travel
 *   at its end, so the scene's holds keep the first panel still in the head and the last one flush in the tail. Linear,
 *   never eased: the reader's scroll is the easing. The sign follows the track's computed `direction`, so an RTL rail
 *   moves right and reads right to left.
 * - Focus follows: a panel focused from the keyboard (`:focus-visible`) out of view jumps the page, through the scroll
 *   authority (Lenis, ScrollSmoother or native), by the least progress that shows it whole; in a panel wider than the
 *   pin, the focused element. `rail.scrollToPanel(i)` is the same move, smooth unless `{ immediate: true }`, for
 *   previous/next controls. A ScrollTrigger refresh stops a native smooth scroll where it is (it scrolls to measure).
 * - Reduced motion is live (the scene's matchMedia build): no pin, no runway, no translate. css/rail.css makes the
 *   track a native horizontal scroller with mandatory snap, and the rail makes it focusable while it is one.
 * - Create it in page order and outside your own `gsap.matchMedia` callbacks, like any scene. In React, call it inside
 *   `useGSAP(() => { const r = horizontalRail(ref.current!); return () => r?.destroy() })`; `destroy()` puts back
 *   every style and attribute the rail wrote.
 */
import { prefersReducedMotion } from '../config'
import { clamp01 } from '../scene'
import { currentSmoothScroll } from '../smooth/authority'
import { pinnedScene, type PinnedSceneHandle, type PinnedSceneOptions } from './pinned-scene'
import { ScrollTrigger } from './setup'

export type HorizontalRailOptions = PinnedSceneOptions

export interface HorizontalRailHandle extends PinnedSceneHandle {
  readonly track: HTMLElement
  /** The distance the track moves, px: its scroll width minus the pin's width. */
  travel(): number
  /** The track reads right to left (its computed `direction`), so it moves right. */
  rtl(): boolean
  /** Scrolls the page until a panel (or the panel at an index) is whole in view, smoothly unless `immediate`. */
  scrollToPanel(panel: HTMLElement | number, options?: { immediate?: boolean }): void
  /** Re-measures the travel through a ScrollTrigger refresh: call it after adding or removing panels. */
  refresh(): void
}

/** A content resize (a late font or image) asks for one ScrollTrigger refresh, this long after the last. */
const REFRESH_DELAY_MS = 150

export function horizontalRail(root: HTMLElement, options: HorizontalRailOptions = {}): HorizontalRailHandle | null {
  const own = (el: Element) => el.closest('[data-scene-root]') === root
  const pin = Array.from(root.querySelectorAll<HTMLElement>('[data-scene-pin]')).find(own)
  const track = pin?.querySelector<HTMLElement>('[data-rail-track]')
  if (!pin || !track) return null
  const spacer =
    Array.from(root.querySelectorAll<HTMLElement>('[data-scene-spacer]')).find((el) => own(el) && !pin.contains(el)) ??
    null
  const panels = () => Array.from(track.querySelectorAll<HTMLElement>('[data-rail-panel]'))
  // What the page wrote itself, put back instead of cleared.
  const authored = { translate: track.style.translate, height: spacer?.style.height ?? '' }

  let travel = 0
  let rtl = false
  /** The translate written, px; null while none is. */
  let x: number | null = null
  /** A full-motion build is running: the rail measures, writes and follows focus. */
  let live = false
  let observePanels = () => {}

  /**
   * The track's scroll width, exact: from its start edge to the farthest child's end margin, plus its end padding.
   * `scrollWidth` itself is whole pixels, and Chromium and WebKit leave a box's end padding and end margins out of it
   * unless the box scrolls (Firefox counts them), so a rail ending on a gutter would stop 50 px apart across engines.
   * It still wins when content overflows a child.
   */
  const scrollWidth = () => {
    const box = track.getBoundingClientRect()
    const cs = getComputedStyle(track)
    const start = rtl ? box.right - parseFloat(cs.borderRightWidth) : box.left + parseFloat(cs.borderLeftWidth)
    let far = 0
    for (const child of Array.from(track.children)) {
      const r = child.getBoundingClientRect()
      if (!r.width && !r.height) continue
      const margin = parseFloat(getComputedStyle(child)[rtl ? 'marginLeft' : 'marginRight'])
      far = Math.max(far, rtl ? start - r.left + margin : r.right + margin - start)
    }
    const width = far + parseFloat(rtl ? cs.paddingLeft : cs.paddingRight)
    return track.scrollWidth > width + 1 ? track.scrollWidth : width
  }

  /** Travel and direction from the layout as it stands, and the runway to match. */
  const measure = () => {
    rtl = getComputedStyle(track).direction === 'rtl'
    // The pin's padding box, exact: the window the track moves through.
    const view = pin.getBoundingClientRect().width - (pin.offsetWidth - pin.clientWidth)
    travel = Math.max(0, scrollWidth() - view)
    if (spacer) spacer.style.height = `${travel}px`
  }

  /**
   * The one writer: the band as a translate, in whole device pixels (a crisp layer) and never past the exact travel, so
   * the end lands flush or clipped by under a pixel, never short of the edge with a hairline of page showing.
   */
  const write = (s: PinnedSceneHandle) => {
    if (!live) return
    const dpr = window.devicePixelRatio || 1
    const px = Math.floor(travel * s.band() * dpr + 1e-3) / dpr
    const next = rtl ? px : -px
    if (next === x) return
    x = next
    track.style.translate = `${next}px 0`
  }

  const clear = () => {
    x = null
    put(track, 'translate', authored.translate)
    if (spacer) put(spacer, 'height', authored.height)
  }

  /** Scrolls the page, through the scroll authority, by the least that brings `el` whole into the pin. */
  const show = (s: PinnedSceneHandle, el: Element, immediate = false) => {
    const t = s.trigger
    if (!live || !t || travel < 1) return
    const view = pin.getBoundingClientRect()
    const box = el.getBoundingClientRect()
    // The box's left edge in the pin with the track at rest: its rect less the translate written now.
    const left = box.left - view.left - pin.clientLeft - (x ?? 0)
    // The translates that put the box whole in the pin; one wider than the pin shows its start edge.
    let lo = -left
    let hi = pin.clientWidth - box.width - left
    if (hi < lo) {
      if (rtl) lo = hi
      else hi = lo
    }
    // As bands (translate = ∓band × travel), then as progress: band 0 holds over the whole head, band 1 the tail.
    const perBand = rtl ? travel : -travel
    const [bandLo, bandHi] = [clamp01(lo / perBand), clamp01(hi / perBand)].sort((a, b) => a - b)
    const { headExit, tailEnter } = s.bounds()
    const pLo = bandLo > 0 ? headExit + bandLo * (tailEnter - headExit) : 0
    const pHi = bandHi < 1 ? headExit + bandHi * (tailEnter - headExit) : 1
    // As scroll, in the trigger's own space (ScrollSmoother's too). Outside the range counts as out of view.
    const y = t.scroll()
    const yLo = t.start + pLo * (t.end - t.start)
    const yHi = t.start + pHi * (t.end - t.start)
    if (y >= yLo - 1 && y <= yHi + 1) return
    const to = y < yLo ? Math.ceil(yLo) : Math.floor(yHi)
    const scroll = currentSmoothScroll()
    if (scroll) scroll.scrollTo(to, { immediate })
    else window.scrollTo({ top: to, behavior: immediate ? 'instant' : 'smooth' })
  }

  const buildMotion = (s: PinnedSceneHandle) => {
    live = true
    measure()

    // Every refresh re-measures inside the refresh: by 'revert' GSAP has unpinned everything (a pinned 'gsap' pin
    // carries its old inline width), and no trigger has read the page yet, so the new runway is in their numbers.
    const onRevert = () => {
      if (!prefersReducedMotion()) measure()
    }
    ScrollTrigger.addEventListener('revert', onRevert)

    // A width that changes on its own (a late font, an image without dimensions) asks for that refresh.
    const widths = new WeakMap<Element, number>()
    let refreshTimer = 0
    const resizeObserver = new ResizeObserver((entries) => {
      let changed = false
      for (const { target, contentRect } of entries) {
        const width = Math.round(contentRect.width)
        if (widths.has(target) && widths.get(target) !== width) changed = true
        widths.set(target, width)
      }
      if (!changed) return
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), REFRESH_DELAY_MS)
    })
    observePanels = () => [track, ...panels()].forEach((el) => resizeObserver.observe(el))
    observePanels()

    // Keyboard focus only: a click already lands on what the reader can see, and must not move the page.
    let focusFrame = 0
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof Element) || !target.matches(':focus-visible')) return
      const panel = target.closest<HTMLElement>('[data-rail-panel]')
      const el = panel && track.contains(panel) && panel.offsetWidth <= pin.clientWidth ? panel : target
      // A frame later, once the browser's own scroll-into-view (and ScrollSmoother's) has landed. At once, as they
      // do: a Tab never waits on an animation, and a refresh mid-way (it scrolls to measure) can't stop it short.
      cancelAnimationFrame(focusFrame)
      focusFrame = requestAnimationFrame(() => show(s, el, true))
    }
    track.addEventListener('focusin', onFocusIn)

    return () => {
      live = false
      ScrollTrigger.removeEventListener('revert', onRevert)
      window.clearTimeout(refreshTimer)
      resizeObserver.disconnect()
      observePanels = () => {}
      cancelAnimationFrame(focusFrame)
      track.removeEventListener('focusin', onFocusIn)
      clear()
    }
  }

  const buildReduced = () => {
    // A native scroller is keyboard-operable only if it can take focus, and Safari never makes one focusable itself.
    const added = !track.hasAttribute('tabindex')
    if (added) track.tabIndex = 0
    return () => {
      if (added) track.removeAttribute('tabindex')
    }
  }

  const scene = pinnedScene(root, {
    ...options,
    onBuild(conditions, s) {
      const undo = conditions.reduce ? buildReduced() : buildMotion(s)
      const cleanup = options.onBuild?.(conditions, s)
      return () => {
        if (typeof cleanup === 'function') cleanup()
        undo()
      }
    },
    onProgress(p, s) {
      write(s)
      options.onProgress?.(p, s)
    },
    onRehydrate(state, s) {
      write(s)
      options.onRehydrate?.(state, s)
    },
  })

  const sceneDebug = scene.debug
  const sceneDestroy = scene.destroy

  return Object.assign(scene, {
    track,
    travel: () => travel,
    rtl: () => rtl,
    scrollToPanel(panel: HTMLElement | number, { immediate = false }: { immediate?: boolean } = {}) {
      const el = typeof panel === 'number' ? panels()[panel] : panel
      if (!el) return
      if (live) show(scene, el, immediate)
      // Reduced motion: the track is the scroller.
      else if (scene.reduced) el.scrollIntoView({ block: 'nearest', inline: 'start', behavior: 'instant' })
    },
    refresh() {
      observePanels()
      ScrollTrigger.refresh()
      scene.rehydrate('refresh')
    },
    debug: () => ({ ...sceneDebug(), travel, rtl, translate: x }),
    destroy() {
      sceneDestroy()
      live = false
      clear()
    },
  })
}

/** An inline property back to what the page wrote, or gone; an emptied style attribute goes with it. */
function put(el: HTMLElement, property: string, value: string) {
  if (value) el.style.setProperty(property, value)
  else el.style.removeProperty(property)
  if (el.getAttribute('style') === '') el.removeAttribute('style')
}
