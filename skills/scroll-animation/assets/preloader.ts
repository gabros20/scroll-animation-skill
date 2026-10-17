/**
 * preloader.ts — a recipe: a loading screen whose progress is the page's own assets settling, for the Immersive
 * profile only (a WebGL scene, an image sequence, a film the first screen cannot work without). Never on a Reading
 * or Expressive page, and never in front of a content page's LCP element: an article's headline and hero must paint
 * at once (craft.md §10: no preloader on an ordinary page, never a progress bar driven by a timer). No engine.
 *
 *   <div data-preloader role="progressbar" aria-label="Loading">          in the server HTML, so it paints first
 *     <span class="bar"></span>                                         .bar { scale: var(--load-p, 0) 1 }
 *   </div>
 *
 *   const loading = mountPreloader(document.querySelector('[data-preloader]')!, {
 *     assets: [heroImage, introVideo, document.fonts, '/scene/model.glb', scene.ready],
 *     inert: [document.querySelector('main')!],
 *   })
 *   const result = await loading.done      // 'loaded' | 'timeout': the overlay is gone     loading.destroy()
 *
 * - Progress is real: each asset counts equally, and --load-p (on <html>, 0 to 1) is their mean, written only
 *   upwards. An <img> settles when decode() does (don't list a loading="lazy" one: it never loads off screen); a
 *   <video> counts its buffered fraction and settles at `canplaythrough` (give it preload="auto"); a FontFaceSet
 *   (document.fonts) at `ready`; a URL string is fetched and counts its bytes against Content-Length (it lands in the
 *   HTTP cache for the real request); any promise settles when it does. A failure settles too: a broken asset never
 *   holds the page. --load-p reaches 1 exactly when the last one settles, never before.
 * - A minimum, only to avoid a flash: once everything has settled the overlay stays until `minMs` (300) after mount.
 *   Keep it at or under 300 ms. A maximum, the failsafe: after `maxMs` (4000, the CSS failsafe's 4 s in
 *   css/animation.css) the page shows anyway and `done` resolves 'timeout'. If that failsafe already fired
 *   (failsafeFired()), the overlay is removed at once, with no fade.
 * - <html data-preloader-state>: `loading`, then `leaving` (the overlay fades out over MOTION.disclosure), then
 *   `done` (the overlay is removed). Start the first screen's entrances on `done`. The elements in `inert` are inert
 *   and aria-busy while it loads, so focus can't go under the overlay; when it is removed they're released, and focus
 *   goes back to whatever held it when the preloader mounted (a reader who tabbed early), if focus has nowhere else.
 * - Reduced motion (live): the same gating, no fade: the overlay is removed the moment it may leave.
 * - Without JavaScript, or if this script never runs, the overlay must not stay: show it only behind the pre-JS gate
 *   (config.ts GATE_SCRIPT), and give it a CSS failsafe of its own.
 *
 *     [data-preloader] { display: none }
 *     html[data-animation='on']:not([data-animation-failsafe]) [data-preloader] {
 *       display: grid; position: fixed; inset: 0; z-index: 10;
 *       animation: preloader-failsafe 0s 4.5s forwards;
 *     }
 *     @keyframes preloader-failsafe { to { visibility: hidden } }
 *
 * - destroy() stops everything (fetches aborted, listeners off, timers cleared), removes the overlay if it is still
 *   there, releases `inert` and takes its attributes off <html>. SSR-safe: nothing runs until it is called.
 */
import { MOTION, cubicBezier, failsafeFired, prefersReducedMotion } from './config'

/** What the page waits for: an image, a video, the font set, a URL to fetch, or any promise. */
export type PreloadAsset = HTMLImageElement | HTMLVideoElement | FontFaceSet | string | PromiseLike<unknown>

export interface PreloaderOptions {
  assets: PreloadAsset[]
  /** Elements behind the overlay: inert and aria-busy while it loads. */
  inert?: Element[]
  /** Ms after mount before the overlay may leave, so a fast load doesn't flash it. Default 300; keep it ≤ 300. */
  minMs?: number
  /** Ms after mount when the page shows whatever is still loading. Default 4000. */
  maxMs?: number
}

export type PreloaderResult = 'loaded' | 'timeout'

export interface PreloaderHandle {
  /**
   * Resolves once the overlay is gone: 'loaded' when every asset settled, 'timeout' when the maximum (or the CSS
   * failsafe) fired. Never, if destroy() came first.
   */
  done: Promise<PreloaderResult>
  destroy(): void
}

const STATE = 'preloaderState'
const PROGRESS = '--load-p'
/** Below 1 until the last asset has settled, however many there are. */
const UNSETTLED_MAX = 0.999

export function mountPreloader(overlay: HTMLElement, options: PreloaderOptions): PreloaderHandle {
  const html = document.documentElement
  const htmlHadStyle = html.hasAttribute('style')
  const minMs = options.minMs ?? 300
  const maxMs = options.maxMs ?? 4000
  const start = performance.now()
  const focused = document.activeElement
  const returnFocus = focused instanceof HTMLElement && focused !== document.body ? focused : null
  const held = (options.inert ?? []).filter((el) => !el.hasAttribute('inert'))
  const busy = held.filter((el) => !el.hasAttribute('aria-busy'))
  const progressbar = overlay.getAttribute('role') === 'progressbar'

  const fractions = options.assets.map(() => 0)
  const settled = options.assets.map(() => false)
  const cleanups: Array<() => void> = []
  const timers: number[] = []
  let p = 0
  let phase: 'loading' | 'leaving' | 'done' | 'destroyed' = 'loading'
  let fade: Animation | null = null
  let resolveDone: (result: PreloaderResult) => void = () => {}
  const done = new Promise<PreloaderResult>((resolve) => (resolveDone = resolve))

  const write = () => {
    html.style.setProperty(PROGRESS, String(Math.round(p * 1000) / 1000))
    if (progressbar) overlay.setAttribute('aria-valuenow', String(Math.round(p * 100)))
  }

  const report = (i: number, fraction: number) => {
    if (phase !== 'loading' || settled[i]) return
    fractions[i] = Math.max(fractions[i], Math.min(fraction, UNSETTLED_MAX))
    update()
  }
  const settle = (i: number) => {
    if (phase !== 'loading' || settled[i]) return
    settled[i] = true
    fractions[i] = 1
    update()
  }
  const update = () => {
    const all = settled.every(Boolean)
    const mean = fractions.length ? fractions.reduce((sum, f) => sum + f, 0) / fractions.length : 1
    p = all ? 1 : Math.max(p, Math.min(mean, UNSETTLED_MAX))
    write()
    if (!all) return
    const wait = minMs - (performance.now() - start)
    if (wait > 0) timers.push(window.setTimeout(() => leave('loaded'), wait))
    else leave('loaded')
  }

  const leave = (result: PreloaderResult) => {
    if (phase !== 'loading') return
    phase = 'leaving'
    timers.forEach((timer) => clearTimeout(timer))
    cleanups.forEach((cleanup) => cleanup())
    if (prefersReducedMotion() || typeof overlay.animate !== 'function') return finish(result)
    html.dataset[STATE] = 'leaving'
    fade = overlay.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: MOTION.disclosure.duration * 1000,
      easing: cubicBezier(MOTION.disclosure.curve),
      fill: 'forwards',
    })
    fade.finished.then(
      () => finish(result),
      () => {},
    )
  }

  const release = () => {
    held.forEach((el) => el.removeAttribute('inert'))
    busy.forEach((el) => el.removeAttribute('aria-busy'))
  }

  const finish = (result: PreloaderResult) => {
    if (phase === 'destroyed' || phase === 'done') return
    phase = 'done'
    fade?.cancel()
    fade = null
    overlay.remove()
    release()
    html.dataset[STATE] = 'done'
    // Focus that fell to <body> while the page was inert goes back where the reader left it.
    const focus = document.activeElement
    if (returnFocus?.isConnected && (!focus || focus === document.body || overlay.contains(focus))) {
      returnFocus.focus({ preventScroll: true })
    }
    resolveDone(result)
  }

  html.dataset[STATE] = 'loading'
  write()
  held.forEach((el) => el.setAttribute('inert', ''))
  busy.forEach((el) => el.setAttribute('aria-busy', 'true'))
  // The CSS failsafe already showed the page: no fade over what is already there.
  if (failsafeFired()) {
    finish('timeout')
  } else {
    timers.push(window.setTimeout(() => leave('timeout'), maxMs))
    options.assets.forEach((asset, i) => cleanups.push(track(asset, (f) => report(i, f), () => settle(i))))
    if (!options.assets.length) update()
  }

  return {
    done,
    destroy() {
      if (phase === 'destroyed') return
      const wasDone = phase === 'done'
      phase = 'destroyed'
      timers.forEach((timer) => clearTimeout(timer))
      cleanups.forEach((cleanup) => cleanup())
      fade?.cancel()
      if (!wasDone) {
        overlay.remove()
        release()
      }
      if (progressbar) overlay.removeAttribute('aria-valuenow')
      delete html.dataset[STATE]
      html.style.removeProperty(PROGRESS)
      if (!htmlHadStyle && html.getAttribute('style') === '') html.removeAttribute('style')
    },
  }
}

/** Follows one asset: `progress(fraction)` as it loads, `settled()` once (loaded or failed). Returns the cleanup. */
function track(asset: PreloadAsset, progress: (fraction: number) => void, settled: () => void): () => void {
  let live = true
  const once = () => {
    if (!live) return
    live = false
    settled()
  }
  if (typeof asset === 'string') {
    const abort = new AbortController()
    fetchBytes(asset, abort.signal, (f) => live && progress(f)).then(once, once)
    return () => {
      live = false
      abort.abort()
    }
  }
  if (asset instanceof HTMLVideoElement) {
    // HAVE_ENOUGH_DATA is what canplaythrough announces.
    if (asset.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
      queueMicrotask(once)
      return () => (live = false)
    }
    const onProgress = () => {
      const { buffered, duration } = asset
      if (!buffered.length || !Number.isFinite(duration) || duration <= 0) return
      progress(buffered.end(buffered.length - 1) / duration)
    }
    const events = ['canplaythrough', 'error'] as const
    asset.addEventListener('progress', onProgress)
    events.forEach((type) => asset.addEventListener(type, once))
    return () => {
      live = false
      asset.removeEventListener('progress', onProgress)
      events.forEach((type) => asset.removeEventListener(type, once))
    }
  }
  const pending =
    asset instanceof HTMLImageElement
      ? asset.decode()
      : typeof FontFaceSet !== 'undefined' && asset instanceof FontFaceSet
        ? asset.ready
        : asset
  Promise.resolve(pending).then(once, once)
  return () => (live = false)
}

/** Fetches `url` to the end, reporting received bytes against Content-Length when the server sends one. */
async function fetchBytes(url: string, signal: AbortSignal, progress: (fraction: number) => void): Promise<void> {
  const response = await fetch(url, { signal })
  const total = Number(response.headers.get('content-length')) || 0
  if (!response.body || !total) {
    await response.arrayBuffer()
    return
  }
  const reader = response.body.getReader()
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    received += value.byteLength
    progress(received / total)
  }
}
