'use client'
// The fixture's routes: Home (Lenis on GSAP's ticker, a ScrollTrigger pin with spacing, three triggers below it, a
// hash target), More (Lenis too, under the same layout, so Lenis lives on across the navigation) and Journal (native,
// two triggers, a hash target). More and Journal are shorter than Home, so a restore measured against the wrong page
// clamps. Streamed (Lenis, same layout) streams in: loading.tsx first, then the page, then a section inside it, and
// `?long=1` lengthens it without changing the pathname. Every trigger logs its refreshes to window.__rhLog for
// tests/route-hygiene.mjs. Home links to Reveals and Smoothed, the arrival check's pages (components/reveals.tsx).
import { useGSAP } from '@gsap/react'
import type Lenis from 'lenis'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'

import { gsap, ScrollTrigger, setupGsap } from '@/animation/gsap/setup'
import { page } from '@/animation/page'
import { gsapDriver, type Driver } from '@/animation/smooth/lenis'
import { PageLifecycle } from '@/animation/react/PageLifecycle'
import { onRouteRefresh } from '@/animation/smooth/route'
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

// The checks choose the route contract through sessionStorage, per page load:
//   rh:contract   on (default): the page lifecycle, <PageLifecycle> · legacy: 2.1's <RouteChange> · off: neither
//   rh:place      where it sits in the root layout: before the page (the default), after it, or around it
// A route that never changes never runs the legacy contract, and `settle={0}` keeps a fresh load from watching.
type Contract = 'on' | 'legacy' | 'off'
type Place = 'before' | 'after' | 'around'
const read = (key: string) => (typeof window === 'undefined' ? null : sessionStorage.getItem(key))
const useContract = () => useState<Contract>(() => (read('rh:contract') as Contract | null) ?? 'on')[0]
const usePlace = () => useState<Place>(() => (read('rh:place') as Place | null) ?? 'before')[0]

function Contracted({ at, children }: { at: Place; children?: ReactNode }) {
  const pathname = usePathname()
  const contract = useContract()
  const active = usePlace() === at
  if (!active || contract === 'off') return <>{children}</>
  if (contract === 'on') {
    return (
      <>
        {children}
        <PageLifecycle route={pathname} />
      </>
    )
  }
  return <RouteChange route={pathname}>{children}</RouteChange>
}

/** The route contract around the root layout's children: 2.1's documented place for <RouteChange>. */
export function RouteScroll({ children }: { children: ReactNode }) {
  return <Contracted at="around">{children}</Contracted>
}

/** The route contract as a self-closing sibling of the page, in its own boundary (the Cache Components pattern). */
export function RouteSlot({ at }: { at: 'before' | 'after' }) {
  return (
    <Suspense fallback={null}>
      <Contracted at={at} />
    </Suspense>
  )
}

/** Every route here makes triggers, so each route layout registers the refresh while it's shown. */
function useRouteRefresh() {
  useGSAP(() => onRouteRefresh(ScrollTrigger.refresh))
}

/** A trigger in the persistent layout: a reading progress over the whole page, which no navigation re-creates. */
export function LayoutProgress() {
  useGSAP(() => {
    ScrollTrigger.create({ id: 'layout-progress', start: 0, end: 'max', onRefresh: logRefresh })
  })
  return null
}

export function LenisRoute({ children }: { children: ReactNode }) {
  useRouteRefresh()
  return (
    <SmoothScroll authority="lenis" driver={driver}>
      {children}
    </SmoothScroll>
  )
}

export function NativeRoute({ children }: { children: ReactNode }) {
  useRouteRefresh()
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
          ...(base ? ([['enter', `${base}/enter`, 'Enter']] as Array<[string, string, string]>) : []),
          ...(base
            ? []
            : ([
                ['streamed', '/streamed', 'Streamed'],
                ['reveals', '/reveals', 'Reveals'],
                ['smoothed', '/smoothed', 'Smoothed'],
              ] as Array<[string, string, string]>)),
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

export function Streamed({ long, children }: { long: boolean; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  // The page's content follows its search params, so a change of them is a route change here (smooth/route.ts).
  const search = useSearchParams().toString()
  const contract = useContract()
  const off = contract !== 'legacy'
  // The lifecycle: the same visit, so the page asks for a re-measure itself.
  useEffect(() => {
    if (contract === 'on') page.remeasure()
  }, [contract, search])
  useGSAP(
    () => {
      // s2 sits below the streamed section and the `long` blocks, so both move it.
      for (const id of ['s1', 's2']) {
        ScrollTrigger.create({ id: `streamed-${id}`, trigger: `#${id}`, start: 'top 80%', end: 'bottom top', onRefresh: logRefresh })
      }
    },
    { scope: root },
  )
  const content = (
    <div ref={root} data-route="streamed" data-streamed={long ? 'long' : 'short'}>
      <Nav
        links={[
          ['home', '/', 'Home'],
          ['streamed-long', '/streamed?long=1', 'Long'],
          ['streamed-short', '/streamed', 'Short'],
        ]}
      />
      <section className="screen">Streamed</section>
      <section className="block" id="s1">
        s1
      </section>
      {children}
      {long &&
        ['l1', 'l2', 'l3'].map((id) => (
          <section key={id} className="block">
            {id} (?long=1)
          </section>
        ))}
      <section className="block" id="s2">
        s2
      </section>
      <section className="tail">end</section>
    </div>
  )
  // 2.1: the page wraps its content in its own <RouteChange>, keyed on the search params.
  if (contract === 'on') return content
  return (
    <RouteChange route={off ? 'off' : search} settle={off ? 0 : undefined}>
      {content}
    </RouteChange>
  )
}

/** The section that streams in after the page: three blocks where the fallback held one. */
export function StreamedSection() {
  return (
    <div data-streamed-section>
      <section className="block">streamed 1</section>
      <section className="block">streamed 2</section>
      <section className="block">streamed 3</section>
    </div>
  )
}
