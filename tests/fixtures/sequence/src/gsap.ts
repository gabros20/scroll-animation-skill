// gsap/frame-sequence.ts inside a gsap.context: ?mode=trigger (default) gives it the range as its own trigger,
// ?mode=getter hands it a separate ScrollTrigger's progress to poll. Reverting the context must destroy it.
import { frameSequence, type FrameSequenceGsap } from '../../../../skills/scroll-animation/assets/gsap/frame-sequence'
import { gsap, ScrollTrigger, setupGsap } from '../../../../skills/scroll-animation/assets/gsap/setup'
import { expose, params, SCENE_HTML } from './fixture'

document.getElementById('root')!.innerHTML = SCENE_HTML
const canvas = document.getElementById('seq') as HTMLCanvasElement
setupGsap()

// GSAP keeps its ticker listeners on the ticker; the types don't say so.
const listeners = () => (gsap.ticker as unknown as { _listeners: unknown[] })._listeners.length
const listenersBefore = listeners()

const getter = params.get('mode') === 'getter'
let handle: FrameSequenceGsap | null = null
let probe: ScrollTrigger | null = null
const ctx = gsap.context(() => {
  if (getter) {
    probe = ScrollTrigger.create({ trigger: '#range', start: 'top top', end: 'bottom bottom' })
    const st = probe
    handle = frameSequence(canvas, { manifest: 'seq/manifest.json', progress: () => st.progress })
  } else {
    handle = frameSequence(canvas, { manifest: 'seq/manifest.json', trigger: '#range' })
  }
})

expose({
  handle: () => handle,
  progress: () => (getter ? probe?.progress : handle?.scrollTrigger?.progress) ?? 0,
  revert: () => ctx.revert(),
  tickerListeners: () => ({ before: listenersBefore, now: listeners() }),
  triggers: () => ScrollTrigger.getAll().length,
})
