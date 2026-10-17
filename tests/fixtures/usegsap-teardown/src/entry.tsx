// The page: the harness first (it spies on every registration), then React 19 mounting one block under useGSAP.
// window.__t drives it: unmount / mount (a fresh element), hide / show (<Activity>), and the harness's reads.
import './harness'

import { useGSAP } from '@gsap/react'
import { Activity, StrictMode, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'

import { setupGsap } from '../../../../skills/scroll-animation/assets/gsap/setup'
import { CASES, handles } from './cases'
import { census, harness } from './harness'

setupGsap({ plugins: [useGSAP] })

const params = new URLSearchParams(location.search)
const name = params.get('block') ?? 'reveal'
const entry = CASES[name]
if (!entry) throw new Error(`unknown block: ${name}`)
harness.ignore(entry.ignore ?? [])
const { Case } = entry

const errors: string[] = []
window.addEventListener('error', (event) => errors.push(String(event.message)))
window.addEventListener('unhandledrejection', (event) => errors.push(`unhandled: ${String(event.reason)}`))

let set: { mounted(v: boolean): void; hidden(v: boolean): void; gen(): void } | null = null
/** The case element of the last mount: after an unmount it is detached, and still holds what the block left. */
let last: Element | null = null

function App() {
  const [mounted, setMounted] = useState(true)
  const [hidden, setHidden] = useState(false)
  const [gen, setGen] = useState(0)
  set = { mounted: setMounted, hidden: setHidden, gen: () => setGen((g) => g + 1) }
  if (!mounted) return null
  return (
    <Activity mode={hidden ? 'hidden' : 'visible'}>
      <div id="case" key={gen}>
        <Case />
      </div>
    </Activity>
  )
}

const app = <App />
createRoot(document.getElementById('app')!).render(params.has('strict') ? <StrictMode>{app}</StrictMode> : app)

const current = () => document.getElementById('case') ?? last

declare global {
  interface Window {
    __t: Record<string, (...args: never[]) => unknown>
  }
}

window.__t = {
  ready: () => !!document.getElementById('case'),
  unmount() {
    last = document.getElementById('case')
    flushSync(() => set!.mounted(false))
  },
  mount() {
    flushSync(() => {
      set!.gen()
      set!.mounted(true)
    })
  },
  hide: () => flushSync(() => set!.hidden(true)),
  show: () => flushSync(() => set!.hidden(false)),
  arm: () => harness.arm(),
  counts: () => harness.counts(),
  leftovers: () => harness.leftovers(current()),
  census: () => Object.fromEntries(Object.entries(census()).map(([k, v]) => [k, v.length])),
  errors: () => errors.slice(),
  handle: ((key: string) => handles[key]) as never,
}
