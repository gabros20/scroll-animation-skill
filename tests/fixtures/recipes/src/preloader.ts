// preloader.html: preloader.ts (engine-free). create() builds the overlay and mounts it over <main>; the checks settle
// the listed promises one at a time and read --load-p and data-preloader-state as they go.
import { expose } from './harness'
import {
  mountPreloader,
  type PreloadAsset,
  type PreloaderHandle,
  type PreloaderResult,
} from '../../../../skills/scroll-animation/assets/preloader'

const params = new URLSearchParams(location.search)
const main = document.getElementById('content')!
const html = document.documentElement
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#c9c0ad"/></svg>'
const IMAGE = `data:image/svg+xml,${encodeURIComponent(SVG)}`

if (params.has('failsafe')) html.dataset.animationFailsafe = ''

interface Deferred {
  promise: Promise<void>
  resolve(): void
}
function deferred(): Deferred {
  let resolve = () => {}
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

let deferreds: Deferred[] = []
let mountedAt = 0
let result: PreloaderResult | null = null
/** Every write to <html>'s style and state, with the ms since mount. */
const log: Array<{ t: number; p: string; state: string }> = []
const watcher = new MutationObserver(() => {
  log.push({
    t: Math.round(performance.now() - mountedAt),
    p: html.style.getPropertyValue('--load-p'),
    state: html.dataset.preloaderState ?? '',
  })
})

function assets(): PreloadAsset[] {
  if (params.has('fast')) return [Promise.resolve(), document.fonts]
  if (params.has('hang')) return [new Promise(() => {}), document.fonts]
  const image = new Image()
  image.src = IMAGE
  deferreds = [deferred(), deferred(), deferred()]
  return [...deferreds.map((d) => d.promise), image, document.fonts, './preloader.html']
}

expose<PreloaderHandle>({
  create() {
    const overlay = document.createElement('div')
    overlay.dataset.preloader = ''
    overlay.setAttribute('role', 'progressbar')
    overlay.setAttribute('aria-label', 'Loading')
    overlay.innerHTML = '<span class="bar"></span>'
    document.body.append(overlay)
    document.getElementById('first')!.focus()
    log.length = 0
    result = null
    mountedAt = performance.now()
    watcher.observe(html, { attributes: true, attributeFilter: ['style', 'data-preloader-state'] })
    const maxMs = Number(params.get('max')) || undefined
    const handle = mountPreloader(overlay, { assets: assets(), inert: [main], maxMs })
    handle.done.then((r) => (result = r))
    return handle
  },
  destroy(handle) {
    handle.destroy()
    watcher.disconnect()
    document.querySelector('[data-preloader]')?.remove()
  },
  census: () => ({ animations: document.getAnimations() }),
  extras: {
    settle(i: number) {
      deferreds[i].resolve()
    },
    state() {
      const overlay = document.querySelector<HTMLElement>('[data-preloader]')
      return {
        t: Math.round(performance.now() - mountedAt),
        p: html.style.getPropertyValue('--load-p'),
        state: html.dataset.preloaderState ?? '',
        overlay: !!overlay,
        fading: overlay ? overlay.getAnimations().length : 0,
        valuenow: overlay?.getAttribute('aria-valuenow') ?? null,
        inert: main.inert,
        busy: main.getAttribute('aria-busy'),
        focused: document.activeElement?.id || document.activeElement?.tagName.toLowerCase(),
        result,
      }
    },
    log: () => log.slice(),
  },
})
