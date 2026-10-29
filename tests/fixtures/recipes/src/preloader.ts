// preloader.html: preloader.ts (engine-free). create() builds the overlay and mounts it over <main>; the checks settle
// the listed promises one at a time and read --load-p (on the overlay) and data-preloader-state as they go. ?video[=
// metadata|auto] lists one muted inline <video> of ./clip.mp4 alone; ?chunks lists a fetch whose body the checks feed
// (`feed(n)`: n chunks of a thousandth each) and a promise that never settles, so most chunks leave --load-p unchanged.
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
let overlay: HTMLElement | null = null
// The page's own video, in the HTML before anything mounts.
let videoPlays = 0
let video: HTMLVideoElement | null = null
if (params.has('video')) {
  video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = params.get('video') || 'metadata'
  video.src = './clip.mp4'
  video.addEventListener('play', () => (videoPlays += 1))
  main.append(video)
}
const progressOf = () => overlay?.style.getPropertyValue('--load-p') ?? ''
/** Every write to the overlay's style and <html>'s state, with the ms since mount. */
const log: Array<{ t: number; p: string; state: string }> = []
const watcher = new MutationObserver(() => {
  log.push({ t: Math.round(performance.now() - mountedAt), p: progressOf(), state: html.dataset.preloaderState ?? '' })
})

// Every --load-p and aria-valuenow write, wherever it lands (the checks want one per new value, none on <html>).
const writes = { overlay: [] as string[], html: 0, valuenow: [] as string[] }
const setProperty = CSSStyleDeclaration.prototype.setProperty
CSSStyleDeclaration.prototype.setProperty = function (name: string, value: string | null, priority?: string) {
  if (name === '--load-p') {
    if (this === html.style) writes.html++
    else if (overlay && this === overlay.style) writes.overlay.push(String(value))
  }
  return setProperty.call(this, name, value, priority)
}
const setAttribute = Element.prototype.setAttribute
Element.prototype.setAttribute = function (name: string, value: string) {
  if (name === 'aria-valuenow' && this === overlay) writes.valuenow.push(value)
  return setAttribute.call(this, name, value)
}

// ?chunks: a fetch of 100 000 bytes that arrive only as the checks feed them.
let feeder: ReadableStreamDefaultController<Uint8Array> | null = null
const realFetch = window.fetch
window.fetch = (input, init) => {
  if (String(input) !== './stream') return realFetch(input, init)
  const body = new ReadableStream<Uint8Array>({ start: (controller) => void (feeder = controller) })
  return Promise.resolve(new Response(body, { headers: { 'content-length': '100000' } }))
}

function assets(): PreloadAsset[] {
  if (params.has('fast')) return [Promise.resolve(), document.fonts]
  if (params.has('hang')) return [new Promise(() => {}), document.fonts]
  if (params.has('chunks')) return ['./stream', new Promise(() => {})]
  if (video) return [video]
  const image = new Image()
  image.src = IMAGE
  deferreds = [deferred(), deferred(), deferred()]
  return [...deferreds.map((d) => d.promise), image, document.fonts, './preloader.html']
}

expose<PreloaderHandle>({
  create() {
    overlay = document.createElement('div')
    overlay.dataset.preloader = ''
    overlay.setAttribute('role', 'progressbar')
    overlay.setAttribute('aria-label', 'Loading')
    overlay.innerHTML = '<span class="bar"></span>'
    document.body.append(overlay)
    document.getElementById('first')!.focus()
    log.length = 0
    result = null
    mountedAt = performance.now()
    writes.overlay.length = 0
    writes.valuenow.length = 0
    writes.html = 0
    watcher.observe(html, { attributes: true, attributeFilter: ['data-preloader-state'] })
    watcher.observe(overlay, { attributes: true, attributeFilter: ['style'] })
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
      const shown = document.querySelector<HTMLElement>('[data-preloader]')
      return {
        t: Math.round(performance.now() - mountedAt),
        p: progressOf(),
        state: html.dataset.preloaderState ?? '',
        overlay: !!shown,
        fading: shown ? shown.getAnimations().length : 0,
        valuenow: shown?.getAttribute('aria-valuenow') ?? null,
        inert: main.inert,
        busy: main.getAttribute('aria-busy'),
        focused: document.activeElement?.id || document.activeElement?.tagName.toLowerCase(),
        result,
      }
    },
    log: () => log.slice(),
    writes: () => ({ overlay: writes.overlay.slice(), html: writes.html, valuenow: writes.valuenow.slice() }),
    feed(n: number) {
      for (let i = 0; i < n; i++) feeder?.enqueue(new Uint8Array(100))
    },
    video: () =>
      video && {
        readyState: video.readyState,
        paused: video.paused,
        currentTime: video.currentTime,
        plays: videoPlays,
      },
  },
})
