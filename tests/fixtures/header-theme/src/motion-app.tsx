// The React page: layout.ts's header and sections, the header's ink from motion/useHeaderTheme.ts, which the header
// also renders as data-hook-ink so a check can compare the hook's value with the attribute the core writes. The header
// sits in its own <Activity> boundary, so a check can hide and show it the way Next keeps a route alive, and it can be
// unmounted outright. Server-rendered by motion-ssr.tsx, hydrated by motion-entry.tsx.
import { Activity, useEffect, useRef, useState } from 'react'

import { useHeaderTheme } from '../../../../skills/scroll-animation/assets/motion/useHeaderTheme'
import { DEFAULT_INK, SECTIONS, type SectionSpec } from './layout'

declare global {
  interface Window {
    __fx: {
      hide(): void
      show(): void
      unmount(): void
      remount(): void
      scrollTo(y: number, immediate?: boolean): void
    }
  }
}

function Header() {
  const ref = useRef<HTMLElement>(null)
  const ink = useHeaderTheme(ref)
  return (
    <header ref={ref} id="header" data-header="" data-header-ink-default={DEFAULT_INK} data-hook-ink={ink ?? ''}>
      <span className="logo" data-logo="">
        Folio
      </span>
      <nav>
        <a href="#hero" data-link="">
          Index
        </a>
      </nav>
    </header>
  )
}

function Section({ spec }: { spec: SectionSpec }) {
  const { id, theme, height, pullUp, inner } = spec
  return (
    <section
      id={id}
      className={`band${theme ? ` t-${theme}` : ''}`}
      data-header-theme={theme}
      style={{ height, marginTop: pullUp ? -pullUp : undefined }}
    >
      {inner && (
        <>
          <div style={{ height: inner.top }} />
          <div
            id={inner.id}
            className={`band t-${inner.theme}`}
            data-header-theme={inner.theme}
            style={{ height: inner.height }}
          />
        </>
      )}
    </section>
  )
}

export function App() {
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
      {mounted && (
        <Activity mode={shown ? 'visible' : 'hidden'}>
          <Header />
        </Activity>
      )}
      <main id="page">
        {SECTIONS.map((spec) => (
          <Section key={spec.id} spec={spec} />
        ))}
      </main>
    </>
  )
}
