'use client'

import { useMotionValueEvent, useScroll } from 'motion/react'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import type { HeaderTheme } from './header-theme'

/**
 * Resolves a fixed header's ink from whatever section is currently underneath
 * it.
 *
 * A nav that paints no background of its own — it floats over the section
 * below — can no longer treat its colour as a property of the PAGE once it is
 * `fixed`. A black nav pinned over a dark section would simply disappear.
 * This is the mechanism that reads `data-header-theme` off sections and
 * resolves what the header should be at the current scroll position.
 *
 * ## Declaring a section's theme
 *
 * Mark any section the nav needs to inverse over:
 *
 *     <section data-header-theme="dark">
 *
 * For a section whose darkness depends on the breakpoint, override the value
 * with the `--header-theme` custom property, which a plain CSS utility can
 * vary per breakpoint (the same tier-1 pattern `variants.ts` uses for
 * `--hero-*`):
 *
 *     <section data-header-theme="dark" className="[--header-theme:light] lg:[--header-theme:dark]">
 *
 * The variable wins where it is set; otherwise the attribute's value is used.
 * A section that is light grey on mobile and solid black from a breakpoint up
 * is the case this exists for — white ink reads fine on black and badly on
 * mid grey, so the theme genuinely needs to flip with the breakpoint, not
 * just the section.
 *
 * Unmarked sections fall back to `base`, the page's own header theme, so
 * light sections need no markup at all.
 *
 * ## Why scroll subscription and not IntersectionObserver
 *
 * The natural IO approach shrinks the root to a one-pixel band at the
 * header's height via `rootMargin`, but `rootMargin` takes no `calc()`, so
 * that band has to be computed from `innerHeight` and the observer rebuilt
 * whenever it changes — which on mobile is every time the URL bar collapses.
 * Subscribing to scroll instead is exact at every offset and never needs
 * rebuilding.
 *
 * It is cheap because the per-tick work touches no DOM: section extents are
 * measured once into document coordinates and re-measured only on resize, so
 * a scroll frame is a handful of numeric comparisons. React state is written
 * only when the resolved theme actually CHANGES — a few times per page, not
 * per frame — which keeps the "never setState per scroll tick" rule intact.
 */
/**
 * `headerRef` is usually the fixed header's own root element, but it does
 * not have to be — the probe (`measure` below) reads `offsetTop +
 * offsetHeight / 2`, and for anything living inside a `position: fixed`
 * header (a nav nested in a `StageItem` inside it, say), that stays a
 * small, scroll-INDEPENDENT number either way, because `position: fixed`
 * is what makes `offsetTop` resolve near the viewport rather than the
 * document. Pointing this at the header itself or at an element nested
 * inside it both land the probe line at roughly the same screen height —
 * pick whichever element is convenient to hold a ref on; there is no need
 * to hoist a ref up to the header's outermost element just for this.
 */
export function useHeaderTheme(
  base: HeaderTheme,
  headerRef: RefObject<HTMLElement | null>
): HeaderTheme {
  const [theme, setTheme] = useState<HeaderTheme>(base)
  const bands = useRef<{ top: number; bottom: number; theme: HeaderTheme }[]>([])
  // Where on screen we ask "what is under the nav?" — the row's vertical middle.
  const probeY = useRef(48)
  const { scrollY } = useScroll()

  const measure = useCallback(() => {
    const header = headerRef.current
    if (header) {
      // offsetTop/offsetHeight are LAYOUT metrics, so they are immune to the
      // entrance transform still running on this element at first paint.
      // getBoundingClientRect here would read the header mid-drop and probe
      // ~100px too high.
      probeY.current = header.offsetTop + header.offsetHeight / 2
    }

    const scroll = window.scrollY
    bands.current = Array.from(
      document.querySelectorAll<HTMLElement>('[data-header-theme]')
    ).map((el) => {
      const rect = el.getBoundingClientRect()
      const override = getComputedStyle(el).getPropertyValue('--header-theme').trim()
      const declared = override || el.dataset.headerTheme
      return {
        top: rect.top + scroll,
        bottom: rect.top + scroll + rect.height,
        theme: declared === 'dark' ? 'dark' : 'light'
      }
    })
  }, [headerRef])

  const resolve = useCallback(
    (scroll: number) => {
      const probe = scroll + probeY.current
      let next = base
      // Last match wins, so a marked section nested inside another resolves to
      // the inner one (document order puts it later).
      for (const band of bands.current) {
        if (probe >= band.top && probe < band.bottom) next = band.theme
      }
      setTheme((prev) => (prev === next ? prev : next))
    },
    [base]
  )

  useEffect(() => {
    const sync = () => {
      measure()
      resolve(window.scrollY)
    }
    sync()

    // Body resize covers the cases that actually move sections: viewport
    // changes, font swap, images settling, accordions opening. Cheaper and more
    // reliable than a resize listener alone, which misses content reflow.
    const observer = new ResizeObserver(sync)
    observer.observe(document.body)
    window.addEventListener('resize', sync)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [measure, resolve])

  useMotionValueEvent(scrollY, 'change', resolve)

  return theme
}
