/**
 * gsap/frame-sequence.ts — an image sequence scrubbed on a <canvas>, on a GSAP page. The decoding, memory budget,
 * gating and reduced motion all live in media/frame-sequence.ts; read its header.
 *
 *   <section id="hero-range" style="height: 400lvh">
 *     <div style="position: sticky; top: 0; height: 100lvh">
 *       <canvas role="img" aria-label="A camera, turning" style="display: block; width: 100%; height: 100%"></canvas>
 *     </div>
 *   </section>
 *
 *   // Its own ScrollTrigger on the range (start 'top top', end 'bottom bottom' by default; page order):
 *   frameSequence(canvas, { manifest: '/media/hero/manifest.json', mobile: true, trigger: '#hero-range' })
 *
 *   // Or any progress getter, such as a pinned scene's, read on gsap.ticker:
 *   frameSequence(canvas, { manifest, progress: () => scene.progress() })
 *
 * Both read exact progress in the frame it changes: ScrollTrigger's onUpdate runs inside ScrollTrigger.update, and a
 * getter is polled on gsap.ticker, after Lenis's gsapDriver moved the scroll and ScrollTrigger updated (create the
 * scroll authority first, as the route does). No `scrub` smoothing: the canvas already holds the nearest decoded frame
 * while the exact one decodes. Reduced motion is the core's (live), so this builds the same way under it.
 *
 * Call setupGsap() first. Created inside useGSAP, gsap.context or a gsap.matchMedia callback, reverting that
 * context destroys the sequence; otherwise call destroy().
 */
import { createFrameSequence, type FrameSequence, type FrameSequenceOptions } from '../media/frame-sequence'
import { gsap, ScrollTrigger } from './setup'

type ProgressSource =
  | {
      /** Exact 0–1 progress, polled on gsap.ticker. */
      progress: () => number
      trigger?: never
      scrollTrigger?: never
    }
  | {
      progress?: never
      /** The range whose scroll drives the sequence. */
      trigger: gsap.DOMTarget
      /** More ScrollTrigger vars (start, end, endTrigger, scroller …); onUpdate and onRefresh are chained. */
      scrollTrigger?: Omit<ScrollTrigger.Vars, 'trigger'>
    }

export type FrameSequenceGsapOptions = FrameSequenceOptions & ProgressSource

export interface FrameSequenceGsap extends FrameSequence {
  /** The ScrollTrigger feeding it (trigger mode), or null (getter mode). */
  readonly scrollTrigger: ScrollTrigger | null
}

export function frameSequence(canvas: HTMLCanvasElement, options: FrameSequenceGsapOptions): FrameSequenceGsap {
  const { progress, trigger, scrollTrigger: vars, ...core } = options
  const seq = createFrameSequence(canvas, core)
  let st: ScrollTrigger | null = null
  let tick: (() => void) | null = null

  if (progress) {
    let last = NaN
    tick = () => {
      const p = progress()
      if (p === last) return
      last = p
      seq.setProgress(p)
    }
    gsap.ticker.add(tick)
    tick()
  } else {
    st = ScrollTrigger.create({
      trigger,
      start: 'top top',
      end: 'bottom bottom',
      ...vars,
      onUpdate(self) {
        seq.setProgress(self.progress)
        vars?.onUpdate?.(self)
      },
      onRefresh(self) {
        seq.setProgress(self.progress)
        vars?.onRefresh?.(self)
      },
    })
    seq.setProgress(st.progress)
  }

  let destroyed = false
  const destroy = () => {
    if (destroyed) return
    destroyed = true
    if (tick) gsap.ticker.remove(tick)
    st?.kill()
    seq.destroy()
  }
  // gsap.context() with no arguments is the context being built right now, if any (useGSAP, matchMedia included).
  const context = gsap.context() as gsap.Context | undefined
  context?.add(() => destroy)

  return {
    ready: seq.ready,
    setProgress: seq.setProgress,
    stats: seq.stats,
    destroy,
    scrollTrigger: st,
  }
}
