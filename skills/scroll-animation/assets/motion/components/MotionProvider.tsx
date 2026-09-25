'use client'

import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import { type ReactNode } from 'react'

import { BreakpointProvider } from '../lib/breakpoints'

/**
 * App-wide Motion runtime, mounted once in the root layout.
 *
 * - LazyMotion + `m.*` components keep the initial motion payload small
 *   (~6KB vs ~34KB for the full `motion.*` import). `strict` throws on any
 *   stray `motion.*` usage so the convention can't silently rot. Swap
 *   `domAnimation` for `domMax` if layout animations/drag are ever needed.
 * - MotionConfig reducedMotion="user" degrades transform animations to
 *   opacity for every motion component when the OS asks for reduced motion.
 * - BreakpointProvider exposes the breakpoints to JS (structural animation
 *   variants only — see the README's "Tier-1 responsive" note; a value that
 *   merely differs per breakpoint belongs in a CSS custom property, not here).
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <BreakpointProvider>{children}</BreakpointProvider>
      </MotionConfig>
    </LazyMotion>
  )
}
