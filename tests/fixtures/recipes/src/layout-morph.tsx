// layout-morph.html: motion/LayoutMorph.tsx under MotionProvider, rendered on the client: a card that opens into a
// panel with one morphId. "Destroyed" renders a plain card in its place, so the markup matches before and after.
import { frame, cancelFrame, m } from 'motion/react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'

import { expose, frames } from './harness'
import { MotionProvider } from '../../../../skills/scroll-animation/assets/motion/MotionProvider'
import { LayoutMorph, Morph } from '../../../../skills/scroll-animation/assets/motion/LayoutMorph'

function Page({ on, open }: { on: boolean; open: boolean }) {
  return (
    <MotionProvider>
      {/* The page's other Motion element: it registers Motion's once-per-page listeners before the spy arms. */}
      <m.div id="chrome" />
      <main>
        <div id="stage">
          {!on ? (
            <div id="morph" className="card" />
          ) : (
            <LayoutMorph>
              {open ? (
                <Morph key="panel" morphId="work" id="morph" className="panel" />
              ) : (
                <Morph key="card" morphId="work" id="morph" className="card" />
              )}
            </LayoutMorph>
          )}
        </div>
      </main>
    </MotionProvider>
  )
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}
const round = (n: number) => Math.round(n * 10) / 10
function box(): Box & { transform: string; opacity: number } {
  const el = document.getElementById('morph')!
  const r = el.getBoundingClientRect()
  return {
    x: round(r.left),
    y: round(r.top),
    w: round(r.width),
    h: round(r.height),
    transform: el.style.transform,
    opacity: Number(getComputedStyle(el).opacity),
  }
}

const root = createRoot(document.getElementById('root')!)
let state = { on: false, open: false }
const render = () => flushSync(() => root.render(<Page {...state} />))
render()

/** Every frame, after Motion has written its styles. */
const samples: ReturnType<typeof box>[] = []
const sample = () => samples.push(box())
const layoutChunks = () =>
  performance
    .getEntriesByType('resource')
    .filter((entry) => entry.name.includes('layout-features'))
    .map((entry) => Math.round(entry.startTime))

function mount() {
  const exposedAt = Math.round(performance.now())
  expose<true>({
    create() {
      state = { on: true, open: false }
      render()
      return true
    },
    destroy() {
      cancelFrame(sample)
      state = { on: false, open: false }
      render()
    },
    extras: {
      box,
      exposedAt: () => exposedAt,
      layoutChunks,
      /** Opens or closes the morph and samples every frame from here on. */
      toggle(open: boolean) {
        samples.length = 0
        cancelFrame(sample)
        frame.postRender(sample, true)
        state = { ...state, open }
        render()
      },
      samples: () => samples.slice(),
      stop: () => cancelFrame(sample),
    },
  })
}

/**
 * A page's first morph, before the spy arms: once domMax has loaded, Motion's layout projection keeps one window
 * resize listener for the page's life, and Vite adds a modulepreload link for the chunk. Neither is the recipe's.
 */
async function firstMorph() {
  state = { on: true, open: false }
  render()
  await import('../../../../skills/scroll-animation/assets/motion/layout-features')
  await frames(3)
  state = { on: false, open: false }
  render()
}

if (location.search.includes('lazy')) setTimeout(mount, 600)
else firstMorph().then(mount)
