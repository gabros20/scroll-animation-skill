// The engine-agnostic core on its own: progress from the range's rect in a scroll listener, the way any producer
// would hand it over. ?budget=<MiB> · ?lead=<viewports> · ?mobile=1 (the mobile/ variant) · ?list=1 (plain URLs;
// with &missing=<i>, frame i's URL 404s) · ?dprCap=<n> · ?still=<n> (reducedMotionFrame).
import {
  createFrameSequence,
  MIB,
  type FrameSequence,
} from '../../../../skills/scroll-animation/assets/media/frame-sequence'
import { expose, params, SCENE_HTML } from './fixture'

document.getElementById('root')!.innerHTML = SCENE_HTML
const canvas = document.getElementById('seq') as HTMLCanvasElement
const range = document.getElementById('range')!

let handle: FrameSequence | null = null
let progress = 0
let boot: Record<string, number> | null = null
const update = () => {
  const r = range.getBoundingClientRect()
  progress = Math.min(1, Math.max(0, -r.top / (r.height - innerHeight)))
  boot ??= { scrollY, top: r.top, height: r.height, innerHeight, progress, at: performance.now() }
  handle?.setProgress(progress)
}

const manifest: Promise<string | string[]> = params.has('list')
  ? fetch('seq/manifest.json')
      .then((res) => res.json())
      .then((m: { frames: string[] }) => m.frames.map((f, i) => (String(i) === params.get('missing') ? 'seq/missing.webp' : `seq/${f}`)))
  : Promise.resolve('seq/manifest.json')

manifest.then((source) => {
  handle = createFrameSequence(canvas, {
    manifest: source,
    mobile: params.has('mobile') || undefined,
    budgetBytes: params.has('budget') ? Number(params.get('budget')) * MIB : undefined,
    dprCap: params.has('dprCap') ? Number(params.get('dprCap')) : undefined,
    reducedMotionFrame: params.has('still') ? Number(params.get('still')) : undefined,
  })
  // A producer re-reads on resize too: a layout that settles after the first read leaves no scroll event behind.
  addEventListener('scroll', update, { passive: true })
  addEventListener('resize', update)
  update()
})

expose({ handle: () => handle, progress: () => progress, boot: () => boot, destroy: () => handle?.destroy() })
