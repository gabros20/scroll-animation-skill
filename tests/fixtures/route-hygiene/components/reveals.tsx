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

const smoother = () => createSmoother(ScrollSmoother, { smooth: 1 })

/** ScrollSmoother from the route's layout: <SmoothScroll authority="smoother">, which renders the wrapper. */
export function SmootherRevealRoute({ children }: { children: ReactNode }) {
  useGSAP(() => onRouteRefresh(ScrollTrigger.refresh))
  return (
    <SmoothScroll authority="smoother" create={smoother}>
      {children}
    </SmoothScroll>
  )
}

/** A second page under the same smoother, shorter than Smoothed: the smoother lives on across the navigation. */
export function SmoothedMore() {
  return (
    <div data-route="smoothed-more">
      <nav className="nav">
        <Link href="/smoothed" data-nav="smoothed">
          Smoothed
        </Link>
      </nav>
      <section className="screen">smoothed more</section>
      {['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => (
        <section key={id} className="block" id={id}>
          {id}
        </section>
      ))}
      <section className="tail">end</section>
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
        {route === 'smoothed' && (
          <>
            <Link href="/smoothed/more" data-nav="smoothed-more">
              More
            </Link>
            <Link href="/smoothed/more#p3" data-nav="smoothed-more-hash">
              p3
            </Link>
          </>
        )}
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
