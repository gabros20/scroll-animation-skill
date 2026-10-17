// The React page: layout.ts's header, intro and scrolly section rendered with motion/ScrollySteps.tsx. A hidden span
// inside the section renders useScrollyActive() as data-hook-active / data-hook-direction, so a check can compare the
// hook with the attributes the core writes, and onStep calls land in window.__hookSteps. The section sits in its own
// <Activity> boundary, so a check can hide and show it the way Next keeps a route alive, and it can be unmounted
// outright. `?progress` passes progress. Server-rendered by motion-ssr.tsx, hydrated by motion-entry.tsx.
import { Activity, useEffect, useState } from 'react'

import {
  ScrollyGraphic,
  ScrollyInline,
  ScrollyState,
  ScrollyStep,
  ScrollyStepList,
  ScrollySteps,
  useScrollyActive,
} from '../../../../skills/scroll-animation/assets/motion/ScrollySteps'
import type { ScrollyStepDetail } from '../../../../skills/scroll-animation/assets/scrolly-steps'
import { STATES, STEPS } from './layout'

declare global {
  interface Window {
    __fx: {
      hide(): void
      show(): void
      unmount(): void
      remount(): void
      scrollTo(y: number, immediate?: boolean): void
    }
    __hookSteps: ScrollyStepDetail[]
  }
}

function HookProbe() {
  const { active, direction } = useScrollyActive()
  return <span id="hook" hidden data-hook-active={active} data-hook-direction={direction ?? 'none'} />
}

function Story({ progress }: { progress: boolean }) {
  return (
    <ScrollySteps id="scrolly" progress={progress} onStep={(detail) => (window.__hookSteps ??= []).push(detail)}>
      <ScrollyGraphic id="graphic">
        {STATES.map((v) => (
          <ScrollyState key={v} value={v} id={`state-${v}`}>
            <div className="art">State {v}</div>
            <figcaption>Caption {v}</figcaption>
          </ScrollyState>
        ))}
      </ScrollyGraphic>
      <ScrollyStepList id="steps">
        {STEPS.map((s, i) => (
          <ScrollyStep key={i} id={`step-${i}`} show={s.show}>
            <h3>Step {i}</h3>
            <p>Step {i} tells part of the story.</p>
            <a href={`#step-${i}`} id={`link-${i}`}>
              Link {i}
            </a>
            <ScrollyInline id={`inline-${i}`}>
              <div className="art">Inline {i}</div>
            </ScrollyInline>
          </ScrollyStep>
        ))}
      </ScrollyStepList>
      <HookProbe />
    </ScrollySteps>
  )
}

export function App({ progress = false }: { progress?: boolean }) {
  const [shown, setShown] = useState(true)
  const [mounted, setMounted] = useState(true)
  useEffect(() => {
    window.__fx = {
      hide: () => setShown(false),
      show: () => setShown(true),
      unmount: () => setMounted(false),
      remount: () => setMounted(true),
      scrollTo: (y, immediate = true) => window.scrollTo({ top: y, behavior: immediate ? 'instant' : 'smooth' }),
    }
  }, [])
  return (
    <>
      <header id="header" data-header="">
        <span className="logo">Folio</span>
        <nav>
          <a href="#intro">Index</a>
        </nav>
      </header>
      <main id="page">
        <section id="intro" className="intro">
          <h1>Intro</h1>
          <a href="#scrolly" id="intro-link">
            Skip to the story
          </a>
        </section>
        {mounted && (
          <Activity mode={shown ? 'visible' : 'hidden'}>
            <Story progress={progress} />
          </Activity>
        )}
      </main>
    </>
  )
}
