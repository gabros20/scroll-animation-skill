'use client'
// F2, a link from a scrolled page: two routes of GSAP reveals (gsap/reveal.ts, and three gsap/split-reveal.ts
// headings between the items), reached by a link from Home scrolled
// well down. Reveals is native; Smoothed runs ScrollSmoother (smooth/smoother.ts) from its route layout. The page's
// useGSAP runs in a layout effect before Next's own (an ancestor's) places the scroll, so reveal() creates its
// triggers at the previous page's scrollY. tests/route-hygiene.mjs records where each item was when its entrance
// started.
import { useGSAP } from '@gsap/react'
import { ScrollSmoother } from 'gsap/ScrollSmoother'
import Link from 'next/link'
import { Fragment, useRef, type ReactNode } from 'react'

import '@/animation/css/animation.css'
import '@/animation/css/reveal.css'
import { gsap, ScrollTrigger, setupGsap } from '@/animation/gsap/setup'
import { reveal } from '@/animation/gsap/reveal'
import { splitReveal, type SplitRevealHandle } from '@/animation/gsap/split-reveal'
import { SmoothScroll } from '@/animation/smooth/SmoothScroll'
import { createSmoother } from '@/animation/smooth/smoother'
import { onRouteRefresh } from '@/animation/smooth/route'

declare global {
  interface Window {
    __rhSplits?: SplitRevealHandle[]
  }
}

if (typeof window !== 'undefined') {
  setupGsap({ plugins: [useGSAP] })
  gsap.registerPlugin(ScrollSmoother)
}

/** Ten items, 600 px each, below a 400 px intro: the first sits on the first screen, the rest below the fold. */
const REVEAL_ITEMS = Array.from({ length: 10 }, (_, i) => `r${i + 1}`)
/** A split heading after these items. */
const SPLIT_AFTER = ['r3', 'r6', 'r9']

export function NativeRevealRoute({ children }: { children: ReactNode }) {
  useGSAP(() => onRouteRefresh(ScrollTrigger.refresh))
  return <SmoothScroll authority="native">{children}</SmoothScroll>
}

/** ScrollSmoother from the route's layout, as scroll-authority.md §5 starts it: createSmoother, the wrapper around the page. */
export function SmootherRevealRoute({ children }: { children: ReactNode }) {
  useGSAP(() => onRouteRefresh(ScrollTrigger.refresh))
  useGSAP(() => {
    const handle = createSmoother(ScrollSmoother, { smooth: 1 })
    return () => handle.destroy()
  })
  return (
    <div id="smooth-wrapper">
      <div id="smooth-content">{children}</div>
    </div>
  )
}

export function Reveals({ route }: { route: 'reveals' | 'smoothed' }) {
  const root = useRef<HTMLDivElement>(null)
  useGSAP(() => {
    const handle = reveal(root.current!)
    const splits = Array.from(root.current!.querySelectorAll<HTMLElement>('[data-split]')).map((el) => splitReveal(el))
    window.__rhSplits = splits
    return () => {
      handle.destroy()
      splits.forEach((split) => split.destroy())
    }
  })
  return (
    <div ref={root} data-route={route}>
      <nav className="nav">
        <Link href="/" data-nav="home">
          Home
        </Link>
      </nav>
      <section className="intro">{route}</section>
      <div data-reveal="view">
        {REVEAL_ITEMS.map((id) => (
          <Fragment key={id}>
            <section className="block" id={id} data-reveal-item>
              {id}
            </section>
            {SPLIT_AFTER.includes(id) && (
              <h2 id={`h-${id}`} data-split>
                A heading after {id}, split into lines
              </h2>
            )}
          </Fragment>
        ))}
      </div>
      <section className="tail">end</section>
    </div>
  )
}
