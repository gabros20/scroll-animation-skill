'use client'

/**
 * Single breakpoint source of truth for JS-side responsive animation.
 *
 * A Tailwind v4 `@theme` block (or any stylesheet that emits the same custom
 * properties) is canonical — this module reads the `--breakpoint-md` /
 * `--breakpoint-lg` custom properties off `:root` at runtime instead of
 * duplicating pixel values in TS, so a theme change can never drift from the
 * animation layer.
 *
 * Use this ONLY for STRUCTURAL animation differences (a variant with a
 * different shape, a pin that doesn't exist on mobile). For responsive
 * animation *values* (distances, durations expressed as lengths), prefer the
 * zero-JS CSS-variable pattern documented on `Stage`/`variants.ts`: a plain
 * CSS utility sets a custom property per breakpoint and Motion resolves it
 * from computed style at animation start.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Breakpoint = 'mobile' | 'tablet' | 'desktop'

// Tailwind v4 defaults, used only if the CSS variables are unreadable
// (e.g. very early paint). Kept in rem to match Tailwind's emitted units.
const FALLBACK_MD = '48rem'
const FALLBACK_LG = '64rem'

function readThemeBreakpoint(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

// SSR renders mobile-first, matching the server markup until hydration.
const BreakpointContext = createContext<Breakpoint>('mobile')

export function BreakpointProvider({ children }: { children: ReactNode }) {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>('mobile')

  useEffect(() => {
    const md = window.matchMedia(
      `(min-width: ${readThemeBreakpoint('--breakpoint-md', FALLBACK_MD)})`
    )
    const lg = window.matchMedia(
      `(min-width: ${readThemeBreakpoint('--breakpoint-lg', FALLBACK_LG)})`
    )

    const update = () => setBreakpoint(lg.matches ? 'desktop' : md.matches ? 'tablet' : 'mobile')
    update()
    md.addEventListener('change', update)
    lg.addEventListener('change', update)
    return () => {
      md.removeEventListener('change', update)
      lg.removeEventListener('change', update)
    }
  }, [])

  return <BreakpointContext.Provider value={breakpoint}>{children}</BreakpointContext.Provider>
}

/** Current breakpoint. `'mobile'` during SSR and until hydration. */
export function useBreakpoint(): Breakpoint {
  return useContext(BreakpointContext)
}

/** Pick a per-breakpoint value (variants object, config, number …). */
export function responsive<T>(map: { mobile: T; tablet?: T; desktop?: T }, bp: Breakpoint): T {
  if (bp === 'desktop') return map.desktop ?? map.tablet ?? map.mobile
  if (bp === 'tablet') return map.tablet ?? map.mobile
  return map.mobile
}
