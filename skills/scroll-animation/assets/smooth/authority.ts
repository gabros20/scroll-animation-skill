/**
 * smooth/authority.ts — who owns scrolling on this page, stamped where anything can read it.
 *
 * Exactly one authority per page: `native`, `lenis` or `smoother` (GSAP ScrollSmoother). The owner stamps
 * `<html data-scroll-authority="…">` while it runs and removes the stamp when it stops, so a route that is hidden
 * (Next's Activity) or left (a client navigation) can't leave a stale owner behind. `verify` and devtools read the
 * stamp; code reads `getScrollAuthority()` and `currentSmoothScroll()`.
 */
export type ScrollAuthority = 'native' | 'lenis' | 'smoother'

export interface SmoothScrollHandle {
  authority: ScrollAuthority
  /**
   * Scroll to an element, a selector or a y position, through whoever owns scrolling. Element targets land like a native
   * anchor jump: below the page's `scroll-padding-top` (the fixed header) and the target's `scroll-margin-top`.
   * `offset` then shifts the landing (negative leaves more room above), the same under every owner.
   */
  scrollTo(target: string | number | Element, options?: { offset?: number; immediate?: boolean }): void
  /** Freeze page scrolling (a modal is open) and give it back. */
  stop(): void
  start(): void
  destroy(): void
}

let current: SmoothScrollHandle | null = null

export function stampAuthority(authority: ScrollAuthority): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.scrollAuthority = authority
}

export function clearAuthority(authority: ScrollAuthority): void {
  if (typeof document === 'undefined') return
  const html = document.documentElement
  if (html.dataset.scrollAuthority === authority) delete html.dataset.scrollAuthority
}

export function getScrollAuthority(): ScrollAuthority {
  if (typeof document === 'undefined') return 'native'
  const v = document.documentElement.dataset.scrollAuthority
  return v === 'lenis' || v === 'smoother' ? v : 'native'
}

/** The running handle, or null under native scrolling. */
export function currentSmoothScroll(): SmoothScrollHandle | null {
  return current
}

/** @internal Registers the page's one handle; a second live handle is a bug (two smoothers). */
export function registerHandle(handle: SmoothScrollHandle): void {
  if (current && current !== handle && typeof console !== 'undefined') {
    console.warn(
      `[scroll-animation] a ${current.authority} scroll authority is still running while a ${handle.authority} one starts: ` +
        'destroy the first (one scroll authority per page).',
    )
  }
  current = handle
}

/** @internal */
export function unregisterHandle(handle: SmoothScrollHandle): void {
  if (current === handle) current = null
}

/** Native scrolling as a handle, so callers can use one API whoever owns the page. */
export function nativeHandle(): SmoothScrollHandle {
  const handle: SmoothScrollHandle = {
    authority: 'native',
    scrollTo(target, options = {}) {
      const y = resolveY(target) - anchorInset(target) + (options.offset ?? 0)
      window.scrollTo({ top: y, behavior: options.immediate ? 'instant' : 'smooth' })
    },
    stop() {
      document.documentElement.style.overflow = 'hidden'
    },
    start() {
      document.documentElement.style.overflow = ''
    },
    destroy() {
      clearAuthority('native')
    },
  }
  stampAuthority('native')
  return handle
}

/** Document y of a target, for handles that take numbers. */
export function resolveY(target: string | number | Element): number {
  if (typeof target === 'number') return target
  const el = typeof target === 'string' ? document.querySelector(target) : target
  if (!el) return window.scrollY
  return el.getBoundingClientRect().top + window.scrollY
}

/** The space an anchor jump leaves above an element target: the root's scroll-padding-top plus its scroll-margin-top. */
export function anchorInset(target: string | number | Element): number {
  if (typeof target === 'number') return 0
  const el = typeof target === 'string' ? document.querySelector(target) : target
  if (!el) return 0
  const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0
  return padding + margin
}
