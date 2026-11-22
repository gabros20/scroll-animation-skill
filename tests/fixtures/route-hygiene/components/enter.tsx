'use client'
// F3, an entrance against the route transition: a first screen that enters four ways (server-split words in CSS, a
// GSAP reveal on mount and at the line, the engine-free reveal, a Motion reveal on mount), reached by a link inside a
// React <ViewTransition>. tests/route-hygiene.mjs records when each element first shows and compares it with the
// transition's end.
import { useGSAP } from '@gsap/react'
import Link from 'next/link'
import { useEffect, useRef, type ReactNode } from 'react'

import '@/animation/css/animation.css'
import '@/animation/css/reveal.css'
import '@/animation/css/split.css'
import { setupGsap } from '@/animation/gsap/setup'
import { reveal } from '@/animation/gsap/reveal'
import { MotionProvider } from '@/animation/motion/MotionProvider'
import { Reveal, RevealItem } from '@/animation/motion/Reveal'
import { mountReveals } from '@/animation/reveal'

if (typeof window !== 'undefined') setupGsap({ plugins: [useGSAP] })

export function Enter({ heading }: { heading: ReactNode }) {
  const gsapRoot = useRef<HTMLDivElement>(null)
  const freeRoot = useRef<HTMLDivElement>(null)
  useGSAP(() => {
    const handle = reveal(gsapRoot.current!)
    return () => handle.destroy()
  })
  useEffect(() => mountReveals(freeRoot.current!), [])
  return (
    <div data-route="enter">
      <nav className="nav">
        <Link href="/vt" data-nav="home">
          Home
        </Link>
      </nav>
      <div data-f3="words">{heading}</div>
      <div ref={gsapRoot}>
        <div data-reveal="mount">
          <p className="line" id="e-gsap-mount" data-reveal-item data-f3="gsap-mount">
            gsap, on mount
          </p>
        </div>
        <div data-reveal="view">
          <p className="line" id="e-gsap-view" data-reveal-item data-f3="gsap-view">
            gsap, at the line
          </p>
        </div>
      </div>
      <div ref={freeRoot}>
        <div data-reveal="view">
          <p className="line" id="e-free" data-reveal-item data-f3="free">
            engine-free
          </p>
        </div>
      </div>
      <MotionProvider>
        <Reveal trigger="mount">
          <RevealItem as="p" className="line" id="e-motion">
            <span data-f3="motion">motion, on mount</span>
          </RevealItem>
        </Reveal>
      </MotionProvider>
      <section className="screen">below</section>
      <section className="tail">end</section>
    </div>
  )
}
