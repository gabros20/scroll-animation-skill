// Shared by the sequence fixture pages: the scene markup, query params, and `window.__fx`, which tests/sequence.mjs
// drives: scroll to a progress, read the sequence's stats and data-frame, and sample the decoded bytes every frame
// (the sequence's own count, and the live bitmaps the runner's createImageBitmap wrapper counts from outside).
import type { FrameSequence } from '../../../../skills/scroll-animation/assets/media/frame-sequence'
import './page.css'

export const params = new URLSearchParams(location.search)
document.documentElement.style.setProperty('--lead', params.get('lead') ?? '0')

export const SCENE_HTML =
  '<div id="lead"></div><div id="range"><div id="pin"><canvas id="seq" role="img" aria-label="Test pattern"></canvas></div></div><div id="tail"></div>'

interface Harness {
  created(): number
  live(): number
  liveBytes(): number
}

declare global {
  interface Window {
    __bitmaps?: Harness
    __fx?: Record<string, unknown>
  }
}

export function expose(o: {
  handle: () => FrameSequence | null
  progress: () => number
  [extra: string]: unknown
}) {
  const canvas = () => document.getElementById('seq') as HTMLCanvasElement | null
  const range = () => document.getElementById('range') as HTMLElement
  let sampling = false
  let peak = { held: 0, heldPlusReserved: 0, live: 0, frames: 0 }
  const sample = () => {
    if (!sampling) return
    const s = o.handle()?.stats()
    if (s) {
      peak.held = Math.max(peak.held, s.decodedBytes)
      peak.heldPlusReserved = Math.max(peak.heldPlusReserved, s.decodedBytes + s.reservedBytes)
    }
    peak.live = Math.max(peak.live, window.__bitmaps?.liveBytes() ?? 0)
    peak.frames++
    requestAnimationFrame(sample)
  }

  window.__fx = {
    ...o,
    stats: () => o.handle()?.stats() ?? null,
    frame: () => canvas()?.dataset.frame ?? null,
    ready: () =>
      o.handle()?.ready.then(
        () => 'ready',
        (e: unknown) => `rejected: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`,
      ) ?? 'no sequence',
    rangeTop: () => Math.round(range().getBoundingClientRect().top + scrollY),
    scrollToProgress(p: number) {
      const r = range()
      const top = Math.round(r.getBoundingClientRect().top + scrollY)
      scrollTo(0, top + Math.round(p * (r.offsetHeight - innerHeight)))
    },
    startSampling() {
      peak = { held: 0, heldPlusReserved: 0, live: 0, frames: 0 }
      sampling = true
      requestAnimationFrame(sample)
    },
    stopSampling() {
      sampling = false
      return peak
    },
    // The centre pixel's alpha: 255 once a frame is painted (the pin behind is a flat #222).
    alpha() {
      const c = canvas()
      if (!c || !c.width) return -1
      return c.getContext('2d')!.getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3]
    },
  }
}
