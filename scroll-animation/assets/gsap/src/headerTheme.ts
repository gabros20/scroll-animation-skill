/**
 * Resolves a fixed/sticky header's ink from whatever section is currently
 * underneath it. Port of `useHeaderTheme`.
 *
 * A header that paints no background of its own can no longer have its
 * colour be a property of the page once it leaves the flow — a black nav
 * pinned over a dark section would simply disappear. Sections opt in with
 * `data-header-theme="light" | "dark"` (`references/attribute-contract.md` §3); this module probes
 * whichever one sits under the header's own vertical middle and writes
 * `data-theme` on the header element, ONLY when it changes.
 *
 * A section whose darkness depends on the breakpoint overrides the
 * attribute with the `--header-theme` custom property, settable per
 * breakpoint by a plain CSS utility with zero JS:
 *
 * ```html
 * <section data-header-theme="dark" style="--header-theme: light" class="lg:[--header-theme:dark]">
 * ```
 *
 * The variable wins where it is set; otherwise the attribute's value is
 * used. Unmarked sections fall back to `base`.
 *
 * ## Why scroll subscription and not IntersectionObserver
 *
 * The natural IO approach shrinks the root to a one-pixel band at the
 * header's height via `rootMargin`, but `rootMargin` takes no `calc()`, so
 * that band would need computing from `innerHeight` and the observer
 * rebuilding whenever it changes — which on mobile is every time the URL
 * bar collapses. Subscribing to scroll instead is exact at every offset and
 * never needs rebuilding.
 *
 * It stays cheap because the per-tick work touches no DOM: section extents
 * are measured once into document coordinates and re-measured only on
 * resize, so a scroll frame is a handful of numeric comparisons. The
 * `data-theme` write only happens when the resolved theme actually
 * CHANGES — a few times per page, not per frame.
 */

export type HeaderTheme = 'light' | 'dark'

export interface HeaderThemeOptions {
  /** The header element, or a selector for it. Defaults to the first
   * `<header>` in `root`. */
  header?: HTMLElement | string
  /** The page's own theme — used where no `[data-header-theme]` section is
   * currently under the header. */
  base?: HeaderTheme
}

export interface HeaderThemeController {
  destroy(): void
  /** Force a re-measure — e.g. after content is injected without a resize. */
  refresh(): void
}

interface Band {
  top: number
  bottom: number
  theme: HeaderTheme
}

export function initHeaderTheme(root: ParentNode = document, options: HeaderThemeOptions = {}): HeaderThemeController {
  const header =
    typeof options.header === 'string'
      ? root.querySelector<HTMLElement>(options.header)
      : (options.header ?? root.querySelector<HTMLElement>('header'))

  if (!header) {
    return { destroy() {}, refresh() {} }
  }

  const base: HeaderTheme = options.base ?? 'light'
  let bands: Band[] = []
  let probeY = 48
  // Not `base` — a sentinel outside HeaderTheme's own two values, so the
  // FIRST resolve() always writes `data-theme`, even when it resolves to
  // `base` itself. Initialising this to `base` meant a page that starts
  // over a light (base) section never got `data-theme` at all until the
  // first flip: resolve()'s `next !== current` guard was already true on
  // load, so the write was skipped — the CSS then had to treat "no
  // attribute" as meaning base, which is undocumented and easy to get
  // wrong. The React port does not have this gap: `useState<HeaderTheme>
  // (base)` returns `base` from the very first render, so the header
  // always has a defined theme from render one.
  let current: HeaderTheme | null = null

  const measure = () => {
    // offsetTop/offsetHeight are LAYOUT metrics, immune to a still-running
    // entrance transform on the header — `getBoundingClientRect` here would
    // probe mid-drop and read too high.
    probeY = header.offsetTop + header.offsetHeight / 2

    const scroll = window.scrollY
    bands = Array.from(document.querySelectorAll<HTMLElement>('[data-header-theme]')).map((el) => {
      const rect = el.getBoundingClientRect()
      const override = getComputedStyle(el).getPropertyValue('--header-theme').trim()
      const declared = override || el.dataset.headerTheme
      return {
        top: rect.top + scroll,
        bottom: rect.top + scroll + rect.height,
        theme: (declared === 'dark' ? 'dark' : 'light') as HeaderTheme
      }
    })
  }

  const resolve = (scroll: number) => {
    const probe = scroll + probeY
    let next: HeaderTheme = base
    // Last match wins, so a marked section nested inside another resolves
    // to the inner one (document order puts it later).
    for (const band of bands) {
      if (probe >= band.top && probe < band.bottom) next = band.theme
    }
    if (next !== current) {
      current = next
      header.setAttribute('data-theme', next)
    }
  }

  const sync = () => {
    measure()
    resolve(window.scrollY)
  }
  sync()

  const resizeObserver = new ResizeObserver(sync)
  resizeObserver.observe(document.body)
  window.addEventListener('resize', sync)

  let raf = 0
  const onScroll = () => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      resolve(window.scrollY)
    })
  }
  window.addEventListener('scroll', onScroll, { passive: true })

  return {
    refresh: sync,
    destroy() {
      resizeObserver.disconnect()
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }
}
