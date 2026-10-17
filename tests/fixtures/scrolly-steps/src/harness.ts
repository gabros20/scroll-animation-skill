// Shared by the static pages (native, lenis, smoother): mounts scrolly-steps.ts on the section and puts `window.__fx`
// (what tests/scrolly-steps.mjs drives) on the page. Each page's entry starts its scroll authority first. Query
// parameters set the root's attributes before the mount: `?line=40`, `?live`, `?query=<media query>`, `?rtl` (the
// document's direction); `?progress` mounts with progress: true; `?defer` waits for `__fx.mount()`. The test's init
// script provides `window.__spy`, which labels the listeners and observers created while the block mounts.
import { mountScrollySteps, type ScrollyStepsHandle } from '../../../../skills/scroll-animation/assets/scrolly-steps'
import { currentSmoothScroll } from '../../../../skills/scroll-animation/assets/smooth/authority'

declare global {
  interface Window {
    __fx: ReturnType<typeof controls>
    __spy?: { mark(phase: string | null): void }
  }
}

export function start() {
  const params = new URLSearchParams(location.search)
  const root = document.querySelector<HTMLElement>('[data-scrolly]')!
  if (params.has('line')) root.setAttribute('data-scrolly-line', params.get('line')!)
  if (params.has('live')) root.setAttribute('data-scrolly-live', '')
  if (params.has('query')) root.setAttribute('data-scrolly-query', params.get('query')!)
  window.__fx = controls(root, params.has('progress'))
  if (!params.has('defer')) window.__fx.mount()
}

function controls(root: HTMLElement, progress: boolean) {
  let handle: ScrollyStepsHandle | null = null
  return {
    mount() {
      handle?.destroy()
      window.__spy?.mark('mount')
      try {
        handle = mountScrollySteps(root, { progress })
      } finally {
        window.__spy?.mark(null)
      }
    },
    destroy() {
      handle?.destroy()
      handle = null
    },
    handle: () => handle,
    /** Through the page's scroll authority when it has one. */
    scrollTo(y: number, immediate = true) {
      const scroll = currentSmoothScroll()
      if (scroll) scroll.scrollTo(y, { immediate })
      else window.scrollTo({ top: y, behavior: immediate ? 'instant' : 'smooth' })
    },
  }
}
