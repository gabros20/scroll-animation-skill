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
 * - The band moves the track: `translate` 0 at its start and the whole travel at its end, so the scene's holds keep the
 *   first panel still in the head and the last one flush in the tail. Linear, never eased: the reader's scroll is the
 *   easing. The sign follows the track's computed `direction`, so an RTL rail moves right and reads right to left.
 * - Two writers, one band. Where CSS scroll timelines run (Chromium; Safari 26, off the main thread from 26.4), the
 *   rail writes the band's scroll offsets and the travel to the track (`--rail-from`, `--rail-to`, `--rail-x`) and
 *   css/rail.css animates it on `scroll(root)`: the compositor moves it in the scroll's own frame. A script writer is
 *   held to the page's rendering rate, which Safari keeps near 60 fps on a 120 Hz screen while the scroll runs at
 *   120 Hz, and it lands a frame behind: a rail that stutters under the finger. The script writes the translate (in
 *   whole device pixels) everywhere else: without timelines, under ScrollSmoother (`pin: 'gsap'`, where the content
 *   lags the native scroll) and while Lenis is smoothing (`html.lenis-smooth`: it moves the scroll from the main
 *   thread, so the script's value lands in its tick and a timeline's would land a frame late in Safari). Both map the
 *   same scroll offset to the same translate. `timeline: false` keeps the script writer for good.
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
import { currentSmoothScroll, getScrollAuthority } from '../smooth/authority'
import { pinnedScene, type PinnedSceneHandle, type PinnedSceneOptions } from './pinned-scene'
import { ScrollTrigger } from './setup'

export interface HorizontalRailOptions extends PinnedSceneOptions {
  /**
   * Move the track on a CSS scroll timeline where the browser runs them (default true). false keeps the script writer
   * everywhere: for a page that moves something else with the track from onProgress and needs the two in one frame.
   */
  timeline?: boolean
}

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

/** What the rail writes for css/rail.css's timeline: the band's scroll offsets and the signed travel. */
const TIMELINE_PROPERTIES = ['--rail-from', '--rail-to', '--rail-x'] as const

/** CSS scroll timelines with a length range: Chromium 115+, Safari 26+; Firefox ships them behind a flag. */
function scrollTimelines(): boolean {
  return (
    typeof CSS !== 'undefined' && CSS.supports('animation-timeline: scroll()') && CSS.supports('animation-range: 0px 1px')
  )
}

export function horizontalRail(root: HTMLElement, options: HorizontalRailOptions = {}): HorizontalRailHandle | null {
  const own = (el: Element) => el.closest('[data-scene-root]') === root
  const pin = Array.from(root.querySelectorAll<HTMLElement>('[data-scene-pin]')).find(own)
  const track = pin?.querySelector<HTMLElement>('[data-rail-track]')
  if (!pin || !track) return null
  const spacer =
    Array.from(root.querySelectorAll<HTMLElement>('[data-scene-spacer]')).find((el) => own(el) && !pin.contains(el)) ??
    null
  const panels = () => Array.from(track.querySelectorAll<HTMLElement>('[data-rail-panel]'))
  const html = root.ownerDocument.documentElement
  // What the page wrote itself, put back instead of cleared.
  const authored = { translate: track.style.translate, height: spacer?.style.height ?? '' }

  let travel = 0
  let rtl = false
  /** The translate the script wrote, px; null while none is. */
  let x: number | null = null
  /** A full-motion build is running: the rail measures, writes and follows focus. */
  let live = false
  /** This build hands the track to css/rail.css's scroll timeline. */
  let timeline = false
  let observePanels = () => {}

  /**
   * The script writes the track: no timeline, or Lenis is smoothing the scroll right now. Lenis moves the scroll from
   * the main thread, and the script's value lands in its tick (S4); css/rail.css lets go of the track meanwhile.
   */
  const scripted = () => !timeline || html.classList.contains('lenis-smooth')

  /** The translate on screen now, whoever writes it: the timeline's is only in the computed style. */
  const translateNow = () => {
    const value = getComputedStyle(track).translate
    return value === 'none' ? 0 : parseFloat(value) || 0
  }

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

  /** A distance in whole device pixels, rounded toward zero: never past the exact travel. */
  const snap = (px: number) => {
    const dpr = window.devicePixelRatio || 1
    return Math.floor(px * dpr + 1e-3) / dpr
  }

  /**
   * The script writer: the band as a translate, in whole device pixels (a crisp layer) and never past the exact travel,
   * so the end lands flush or clipped by under a pixel, never short of the edge with a hairline of page showing. While
   * the timeline has the track it writes nothing: its last value stays underneath, and a Lenis smooth scroll takes over
   * from the value it writes as the scroll starts (see buildMotion).
   */
  const write = (s: PinnedSceneHandle) => {
    if (!live || !scripted()) return
    const px = snap(travel * s.band())
    const next = rtl ? px : -px
    if (next === x) return
    x = next
    track.style.translate = `${next}px 0`
  }

  /**
   * The timeline's range and target: the band's own scroll offsets, from the scene's trigger, so the timeline and the
   * script map every scroll offset to the same translate; the travel as the script's end value. Offsets, not a view()
   * range: on iOS the viewport grows and shrinks with the toolbar as the scroll changes direction, and a range measured
   * from it would move the track with it.
   */
  const writeTimeline = (s: PinnedSceneHandle) => {
    const t = s.trigger
    if (!live || !timeline || !t) return
    const { headExit, tailEnter } = s.bounds()
    const span = t.end - t.start
    const end = snap(travel)
    const values = [`${t.start + headExit * span}px`, `${t.start + tailEnter * span}px`, `${rtl ? end : -end}px`]
    TIMELINE_PROPERTIES.forEach((property, i) => {
      if (track.style.getPropertyValue(property) !== values[i]) track.style.setProperty(property, values[i]!)
    })
    if (track.hasAttribute('data-rail-timeline')) return
    track.setAttribute('data-rail-timeline', '')
    // css/rail.css's rule has to be live on the track: with an older copy of the stylesheet, or a build that dropped
    // the rule, the script keeps writing instead of leaving the track still.
    if (!html.classList.contains('lenis-smooth') && !getComputedStyle(track).animationName.split(', ').includes('rail-slide')) {
      timeline = false
      dropTimeline()
      write(s)
    }
  }

  const dropTimeline = () => {
    track.removeAttribute('data-rail-timeline')
    TIMELINE_PROPERTIES.forEach((property) => put(track, property, ''))
  }

  const clear = () => {
    x = null
    dropTimeline()
    put(track, 'translate', authored.translate)
    if (spacer) put(spacer, 'height', authored.height)
  }

  /** Scrolls the page, through the scroll authority, by the least that brings `el` whole into the pin. */
  const show = (s: PinnedSceneHandle, el: Element, immediate = false) => {
    const t = s.trigger
    if (!live || !t || travel < 1) return
    const view = pin.getBoundingClientRect()
    const box = el.getBoundingClientRect()
    // The box's left edge in the pin with the track at rest: its rect less the translate on screen now.
    const left = box.left - view.left - pin.clientLeft - translateNow()
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
    // Under ScrollSmoother the content lags the native scroll a timeline reads, so the script writes there.
    timeline =
      options.timeline !== false && options.pin !== 'gsap' && getScrollAuthority() !== 'smoother' && scrollTimelines()
    measure()
    writeTimeline(s)

    // Lenis starts smoothing: css/rail.css lets go of the track at the next style update, so the script's value goes on
    // now. A mutation callback runs before that frame renders, whichever of Lenis and ScrollTrigger ticks first.
    const lenisWatch = timeline ? new MutationObserver(() => write(s)) : null
    lenisWatch?.observe(html, { attributes: true, attributeFilter: ['class'] })

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
      timeline = false
      lenisWatch?.disconnect()
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
    // A refresh re-measures the range (the trigger's offsets are new by then), and so does every resize and wake.
    onMeasure(s) {
      writeTimeline(s)
      options.onMeasure?.(s)
    },
    onRehydrate(state, s) {
      writeTimeline(s)
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
    debug: () => ({
      ...sceneDebug(),
      travel,
      rtl,
      writer: live ? (scripted() ? 'script' : 'timeline') : null,
      translate: live ? translateNow() : null,
    }),
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
