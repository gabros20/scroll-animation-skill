'use client'
// The fixture's routes: Home (Lenis on GSAP's ticker, a ScrollTrigger pin with spacing, three triggers below it, a
// hash target), More (Lenis too, under the same layout, so Lenis lives on across the navigation) and Journal (native,
// two triggers, a hash target). More and Journal are shorter than Home, so a restore measured against the wrong page
// clamps. Every trigger logs its refreshes to window.__rhLog for tests/route-hygiene.mjs.
import { useGSAP } from '@gsap/react'
import type Lenis from 'lenis'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRef, useState, type ReactNode } from 'react'

import { gsap, ScrollTrigger, setupGsap } from '@/animation/gsap/setup'
import { gsapDriver, type Driver } from '@/animation/smooth/lenis'
import { RouteChange, SmoothScroll } from '@/animation/smooth/SmoothScroll'

declare global {
  interface Window {
    __rhST?: typeof ScrollTrigger
    __rhLenis?: Lenis | null
    __rhLog?: Array<Record<string, unknown>>
    __rhVT?: boolean
  }
}

if (typeof window !== 'undefined') {
  setupGsap({ plugins: [useGSAP] })
  window.__rhST = ScrollTrigger
}

const gsapDrive = gsapDriver(gsap, ScrollTrigger)
// The checks read the live Lenis through this window.
const driver: Driver = (lenis) => {
  window.__rhLenis = lenis
  const detach = gsapDrive(lenis)
  return () => {
    detach()
    if (window.__rhLenis === lenis) window.__rhLenis = null
  }
}

const refresh = () => ScrollTrigger.refresh()

/**
 * The route hygiene, around the root layout's children (smooth/route.ts). The checks turn it off through
 * sessionStorage to measure what happens without it: a route that never changes never runs it.
 */
export function RouteScroll({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [off] = useState(() => typeof window !== 'undefined' && sessionStorage.getItem('rh:contract') === 'off')
  return (
    <RouteChange route={off ? 'off' : pathname} refresh={refresh}>
      {children}
    </RouteChange>
  )
}

/** A trigger in the persistent layout: a reading progress over the whole page, which no navigation re-creates. */
export function LayoutProgress() {
  useGSAP(() => {
    ScrollTrigger.create({ id: 'layout-progress', start: 0, end: 'max', onRefresh: logRefresh })
  })
  return null
}

export function LenisRoute({ children }: { children: ReactNode }) {
  return (
    <SmoothScroll authority="lenis" driver={driver}>
      {children}
    </SmoothScroll>
  )
}

export function NativeRoute({ children }: { children: ReactNode }) {
  return <SmoothScroll authority="native">{children}</SmoothScroll>
}

const visibleRoutes = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-route]'))
    .filter((el) => el.getClientRects().length > 0)
    .map((el) => el.dataset.route)

function logRefresh(self: ScrollTrigger) {
  window.__rhLog?.push({
    kind: 'refresh',
    id: self.vars.id,
    start: self.start,
    end: self.end,
    routes: visibleRoutes(),
    vt: window.__rhVT ?? false,
    y: window.scrollY,
    t: performance.now(),
  })
}

function Nav({ links }: { links: Array<[string, string, string]> }) {
  return (
    <nav className="nav">
      {links.map(([key, href, label]) => (
        <Link key={key} href={href} data-nav={key}>
          {label}
        </Link>
      ))}
    </nav>
  )
}

export function Home({ base }: { base: string }) {
  const root = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      // Page order: the pin first, then what its spacing moves.
      ScrollTrigger.create({
        id: 'home-pin',
        trigger: '[data-pin]',
        pin: true,
        start: 'top top',
        end: '+=1600',
        onRefresh: logRefresh,
      })
      for (const id of ['m1', 'm2', 'm3']) {
        ScrollTrigger.create({ id: `home-${id}`, trigger: `#${id}`, start: 'top 80%', end: 'bottom top', onRefresh: logRefresh })
      }
    },
    { scope: root },
  )
  return (
    <div ref={root} data-route="home">
      <Nav
        links={[
          ['journal', `${base}/journal`, 'Journal'],
          ['journal-hash', `${base}/journal#notes`, 'Notes'],
          ['more', `${base}/more`, 'More'],
        ]}
      />
      <section className="screen">Home</section>
      <section className="pin" data-pin>
        Pinned for 1600 px
      </section>
      <section className="block" id="m1">
        m1
      </section>
      <section className="block" id="m2">
        m2
      </section>
      <section className="block" id="m3">
        m3
      </section>
      <section className="block" id="after">
        after (hash target)
      </section>
      <section className="screen">end</section>
    </div>
  )
}

export function Journal({ base }: { base: string }) {
  const root = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      for (const id of ['j1', 'j2']) {
        ScrollTrigger.create({ id: `journal-${id}`, trigger: `#${id}`, start: 'top 80%', end: 'bottom top', onRefresh: logRefresh })
      }
    },
    { scope: root },
  )
  return (
    <div ref={root} data-route="journal">
      <Nav
        links={[
          ['home', base || '/', 'Home'],
          ['home-hash', `${base || '/'}#after`, 'After'],
        ]}
      />
      <section className="screen">Journal</section>
      <section className="block" id="notes">
        notes (hash target)
      </section>
      <section className="block" id="j1">
        j1
      </section>
      <section className="block" id="j2">
        j2
      </section>
      <section className="tail">end</section>
    </div>
  )
}

export function More({ base }: { base: string }) {
  const root = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      for (const id of ['k1', 'k2']) {
        ScrollTrigger.create({ id: `more-${id}`, trigger: `#${id}`, start: 'top 80%', end: 'bottom top', onRefresh: logRefresh })
      }
    },
    { scope: root },
  )
  return (
    <div ref={root} data-route="more">
      <Nav
        links={[
          ['home', base || '/', 'Home'],
          ['journal', `${base}/journal`, 'Journal'],
        ]}
      />
      <section className="screen">More</section>
      <section className="block" id="k1">
        k1
      </section>
      <section className="block" id="k2">
        k2
      </section>
      <section className="tail">end</section>
    </div>
  )
}
