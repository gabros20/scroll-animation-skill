// Shared by the static pages (native, lenis, smoother): mounts header-theme.ts on the header and puts `window.__fx`
// (what tests/header-theme.mjs drives) on the page. Each page's entry starts its scroll authority first. `?line=0.5`
// mounts with that probe line. The test's init script provides `window.__spy`, which labels the listeners and observers
// created while the block mounts.
import { mountHeaderTheme, type HeaderThemeOptions } from '../../../../skills/scroll-animation/assets/header-theme'
import { currentSmoothScroll } from '../../../../skills/scroll-animation/assets/smooth/authority'

declare global {
  interface Window {
    __fx: ReturnType<typeof controls>
    __spy?: { mark(phase: string | null): void }
  }
}

export function start() {
  const line = Number(new URLSearchParams(location.search).get('line'))
  window.__fx = controls(document.querySelector<HTMLElement>('[data-header]')!, line > 0 ? { line } : {})
}

function controls(header: HTMLElement, initial: HeaderThemeOptions) {
  let stop: (() => void) | null = null
  const mount = (options: HeaderThemeOptions = initial) => {
    stop?.()
    window.__spy?.mark('mount')
    try {
      stop = mountHeaderTheme(header, options)
    } finally {
      window.__spy?.mark(null)
    }
  }
  mount()
  return {
    mount,
    stop() {
      stop?.()
      stop = null
    },
    /** Through the page's scroll authority when it has one. */
    scrollTo(y: number, immediate = true) {
      const scroll = currentSmoothScroll()
      if (scroll) scroll.scrollTo(y, { immediate })
      else window.scrollTo({ top: y, behavior: immediate ? 'instant' : 'smooth' })
    },
  }
}
