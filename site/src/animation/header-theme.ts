/**
 * header-theme.ts: a fixed header's ink follows the section under it, with no animation library and no scroll
 * listener. An IntersectionObserver whose root is shrunk to a 1 px band at the header's probe line reports which themed
 * section is under the line, and the header takes that section's token. IntersectionObserver fires on what the reader
 * sees, so the same code is exact under native scrolling, Lenis and ScrollSmoother, whose window.scrollY runs ahead of
 * the page on screen. motion/useHeaderTheme.ts wraps it for React; GSAP pages mount it as it is.
 *
 *   <header data-header data-header-ink-default="light">…</header>   fixed; under ScrollSmoother, outside the wrapper
 *   <section data-header-theme="dark">…</section>                     any token: dark, light, a brand name
 *
 *   const stop = mountHeaderTheme(document.querySelector('[data-header]'))     stop() on teardown
 *
 *   [data-header][data-header-ink='dark'] { color: #fff }             the page's CSS maps inks to colours
 *
 * - The header gets data-header-ink="<token>" from the section under its probe line, written only when it changes.
 *   With no themed section there it takes data-header-ink-default, or loses the attribute when there is none. Render
 *   the ink of the top of the page on the header from the server too: the first paint then needs no write.
 * - The probe line is the header's bottom edge by default (`line: 1`, a fraction of its height from its top edge; 0.5
 *   is its middle). It is read from layout (offsetTop, offsetHeight), so a transform on the header (an entrance,
 *   hide-on-scroll) doesn't move it. A ResizeObserver on the header and a window resize listener rebuild the band when
 *   the line or the viewport moves. Nothing runs while the page scrolls except the observer's own callbacks, one per
 *   section edge crossing the line.
 * - Sections that overlap at the line: the last in document order wins, so a nested section beats its parent, and a
 *   later sibling pulled over an earlier one wins where it covers it.
 * - Sections added, removed or re-themed later (a client-side navigation, a theme switch) are picked up by a
 *   MutationObserver. A section hidden with display: none (a route that Next's Activity hides) drops out on its own.
 * - An ink that depends on the breakpoint is a token, not code: give the section its own token and map it per
 *   breakpoint in CSS.
 * - css/header-theme.css holds the ink transition (none under reduced motion) and the opt-in blend variant.
 * - stop() disconnects everything and leaves the last ink in place, so a route shown again doesn't flash the default.
 * - Sections need a box: one with display: contents is never under the line.
 */

const THEME = 'data-header-theme'
const INK = 'data-header-ink'
const DEFAULT = 'data-header-ink-default'
/** Callbacks in a row whose band isn't the 1 px it was built as, corrected before the band is left as it is. */
const MAX_CORRECTIONS = 2

export interface HeaderThemeOptions {
  /** The themed sections: a selector over the header's document. Default '[data-header-theme]'. */
  sections?: string
  /** The probe line, as a fraction of the header's height from its top edge. Default 1, the bottom edge. */
  line?: number
  /** Called after every ink change with the new ink (null: none), for wrappers such as motion/useHeaderTheme.ts. */
  onChange?: (ink: string | null) => void
}

export function mountHeaderTheme(header: HTMLElement, options: HeaderThemeOptions = {}): () => void {
  const selector = options.sections ?? `[${THEME}]`
  const fraction = options.line ?? 1
  const doc = header.ownerDocument
  const view = doc.defaultView ?? window
  /** Every section the band watches, and those of them in the band now. */
  const watched = new Set<Element>()
  const under = new Set<Element>()
  let io: IntersectionObserver | null = null
  let margin = ''
  let line = 0
  let rootHeight = 0
  let corrections = 0
  let fresh = false
  let reported = header.getAttribute(INK)

  const isSection = (el: Element) => el.matches(selector) && !header.contains(el)

  /** The token of the last section in the band, in document order, else the header's default. */
  function resolve() {
    let top: Element | null = null
    for (const el of under) if (!top || top.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) top = el
    const ink = top?.getAttribute(THEME) || header.getAttribute(DEFAULT) || null
    if (header.getAttribute(INK) !== ink) {
      if (ink === null) header.removeAttribute(INK)
      else header.setAttribute(INK, ink)
    }
    if (ink !== reported) {
      reported = ink
      options.onChange?.(ink)
    }
  }

  function onEntries(entries: IntersectionObserverEntry[]) {
    // The band must be the one pixel it was built as. The viewport height its margin came from can differ from the root
    // the browser measures (iOS's toolbars), so correct it from rootBounds, which IS that root, and wait for the new
    // band instead of trusting entries from a thick or inverted one. Chromium clamps an inverted band to zero height
    // at the line, which still reports the section there (edge-adjacent), so it passes as it is.
    const bounds = entries[0]?.rootBounds
    if (bounds && !(Math.abs(bounds.top - line) < 0.1 && bounds.height < 1.5) && corrections < MAX_CORRECTIONS) {
      corrections++
      // The root's real bottom edge: an inverted band reads as its mirror image (WebKit) or a negative height (Firefox).
      const bottom = bounds.top < line ? bounds.top : bounds.top + bounds.height
      rootHeight += bottom - line - 1
      build()
      return
    }
    corrections = 0
    // A new band's first callback reports every section: it replaces what the old band knew.
    if (fresh) under.clear()
    fresh = false
    for (const entry of entries) {
      if (entry.isIntersecting) under.add(entry.target)
      else under.delete(entry.target)
    }
    resolve()
  }

  function measure() {
    line = header.offsetTop + header.offsetHeight * fraction
    // The smaller reading: too short a root only makes the band thick, which rootBounds corrects in one step.
    rootHeight = Math.min(view.innerHeight, doc.documentElement.clientHeight || view.innerHeight)
    corrections = 0
  }

  /** The band [line, line + 1] as margins on the document's viewport; a new observer only when they change. */
  function build() {
    const next = `${px(-line)} 0px ${px(line + 1 - rootHeight)} 0px`
    if (io && next === margin) return
    margin = next
    if (io) {
      io.takeRecords()
      io.disconnect()
    }
    // Entries from a disconnected observer never count: only the current one reaches onEntries.
    const observer: IntersectionObserver = new IntersectionObserver(
      (entries) => {
        if (observer === io) onEntries(entries)
      },
      { root: doc, rootMargin: margin },
    )
    io = observer
    fresh = true
    watched.forEach((el) => observer.observe(el))
  }

  /** Starts or stops watching one element; true when the ink may have changed. */
  function track(el: Element, on: boolean): boolean {
    if (on && !watched.has(el)) {
      watched.add(el)
      io?.observe(el)
      return false
    }
    if (!on && watched.has(el)) {
      watched.delete(el)
      io?.unobserve(el)
      return under.delete(el)
    }
    // A section still in the band changed its token.
    return on && under.has(el)
  }

  const mutations = new MutationObserver((records) => {
    let changed = false
    let added = false
    for (const record of records) {
      if (record.type === 'attributes') {
        const el = record.target as Element
        if (el === header) changed = true
        else changed = track(el, isSection(el)) || changed
        continue
      }
      record.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return
        const root = node as Element
        for (const el of [root, ...root.querySelectorAll(selector)]) {
          if (watched.has(el) || !isSection(el)) continue
          track(el, true)
          added = true
        }
      })
      record.removedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return
        for (const el of watched) if (node === el || node.contains(el)) changed = track(el, false) || changed
      })
    }
    // New sections report with the observer's next callback, which resolves: resolving now, without them, would flash
    // the default between one route's sections leaving and the next one's arriving.
    if (changed && !added) resolve()
  })

  const onResize = () => {
    measure()
    build()
  }

  doc.querySelectorAll(selector).forEach((el) => isSection(el) && watched.add(el))
  measure()
  build()
  mutations.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [THEME, DEFAULT],
  })
  view.addEventListener('resize', onResize)
  // The header's own box: a taller header moves the line. Its first callback, on observe, changes nothing.
  const resizes = new ResizeObserver(onResize)
  resizes.observe(header)

  return () => {
    view.removeEventListener('resize', onResize)
    resizes.disconnect()
    mutations.disconnect()
    io?.disconnect()
    io = null
  }
}

const px = (v: number) => `${Math.round(v * 100) / 100}px`
