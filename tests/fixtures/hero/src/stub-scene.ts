// A stand-in for the 3d skill's live canvas with startAfter="entrance", written from the shared contract alone (the
// DOM attribute and the event; it imports nothing from either skill). It paints nothing: it records when a real one
// would prepare, reveal and run, and the phase each stage started in, on window.__fx.scene.
//
//   prepare  before the entrance starts (pending, or no entrance), else after settled: never mid-entrance
//   reveal   prepared, and the phase is tail or later (or the timeout)
//   run      settled (or the timeout), and revealed

type Phase = 'pending' | 'running' | 'tail' | 'settled'
type Wait = 'phase' | 'none' | 'timeout'

export interface StageRecord {
  stage: 'prepare' | 'reveal' | 'run'
  /** The scope's phase when the stage started (null: no entrance). */
  phase: string | null
  /** How the wait before it ended. */
  wait: Wait
  t: number
}

const ORDER: Phase[] = ['pending', 'running', 'tail', 'settled']
const rank = (phase: string | null) => ORDER.indexOf(phase as Phase)

/**
 * The contract's consumer: resolves once the phase is at or past `phase`, 'none' without an entrance, 'timeout' once
 * `timeoutMs` has passed since navigation start (the page's clock, not the call's).
 */
function whenEntrance(phase: Phase, timeoutMs: number): Promise<Wait> {
  const html = document.documentElement
  const now = html.getAttribute('data-entrance')
  if (now === null) return Promise.resolve('none')
  if (rank(now) >= rank(phase)) return Promise.resolve('phase')
  return new Promise((resolve) => {
    const done = (wait: Wait) => {
      clearTimeout(timer)
      html.removeEventListener('entrance:phase', onPhase)
      resolve(wait)
    }
    const onPhase = (event: Event) => {
      if (rank((event as CustomEvent<{ phase: Phase }>).detail.phase) >= rank(phase)) done('phase')
    }
    const timer = setTimeout(() => done('timeout'), Math.max(0, timeoutMs - performance.now()))
    html.addEventListener('entrance:phase', onPhase)
  })
}

export function stubScene(canvas: HTMLElement, timeoutMs = 2500): StageRecord[] {
  const log: StageRecord[] = []
  const stage = (name: StageRecord['stage'], wait: Wait) => {
    canvas.setAttribute('data-scene-stage', name)
    log.push({ stage: name, phase: document.documentElement.getAttribute('data-entrance'), wait, t: performance.now() })
  }
  void (async () => {
    const now = document.documentElement.getAttribute('data-entrance')
    stage('prepare', now === null || now === 'pending' ? 'none' : await whenEntrance('settled', timeoutMs))
    stage('reveal', await whenEntrance('tail', timeoutMs))
    stage('run', await whenEntrance('settled', timeoutMs))
  })()
  return log
}
