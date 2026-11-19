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
 *   // Its own ScrollTrigger on the range (start 'top top', page order). The end is the range's travel over the sticky
 *   // box holding the canvas (a pinned scene's ruler, references/scenes.md §1), so it ends where the box releases
 *   // whatever measures the viewport ('bottom bottom' is GSAP's 100vh probe in 3.15, innerHeight under
 *   // normalizeScroll); with no sticky box between them, 'bottom bottom':
 *   frameSequence(canvas, { manifest: '/media/hero/manifest.json', mobile: true, trigger: '#hero-range' })
 *
 *   // Or any progress getter, read on gsap.ticker. In a pinned scene, its band (the scrub span as 0..1):
 *   frameSequence(canvas, { manifest, progress: () => scene.band() })
 *
 * Both read exact progress in the frame it changes: ScrollTrigger's onUpdate runs inside ScrollTrigger.update, and a
 * getter is polled on gsap.ticker, after Lenis's gsapDriver moved the scroll and ScrollTrigger updated (create the
 * scroll authority first, as the route does). No `scrub` smoothing: the canvas already holds the nearest decoded frame
 * while the exact one decodes. Reduced motion is the core's (live), so this builds the same way under it; it shows
 * `reducedMotionFrame`, by default 0: the head a pinned scene holds under reduced motion.
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
    const range = gsap.utils.toArray<HTMLElement>(trigger)[0] ?? null
    st = ScrollTrigger.create({
      trigger,
      start: 'top top',
      // A function, so every refresh re-reads the pin's box.
      end: () => {
        const pin = range ? stickyBox(canvas, range) : null
        return range && pin ? `+=${Math.max(1, range.offsetHeight - pin.offsetHeight)}` : 'bottom bottom'
      },
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

/** The sticky box holding the canvas inside the range (the canvas itself included): the pin whose height is the
 * ruler. Null when the canvas isn't pinned inside it. */
function stickyBox(canvas: HTMLCanvasElement, range: HTMLElement): HTMLElement | null {
  if (!range.contains(canvas)) return null
  for (let el: HTMLElement | null = canvas; el && el !== range; el = el.parentElement) {
    if (getComputedStyle(el).position === 'sticky') return el
  }
  return null
}
