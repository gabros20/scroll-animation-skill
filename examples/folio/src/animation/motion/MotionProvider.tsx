'use client'
/**
 * motion/MotionProvider.tsx — mount once at the root of every React tree that uses Motion blocks.
 *
 * - `LazyMotion strict`: blocks render `m.div`, never `motion.div`. The full `motion` component pulls ~34 kB; `m` plus a
 *   feature bundle is a fraction of that, and `strict` turns a stray `motion.*` into an error instead of a silent
 *   bundle regression. `domAnimation` covers entrances, gestures and exit; pass `features={domMax}` for `layout` /
 *   `layoutId` (shared-element motion inside a page), or a loader
 *   (`features={() => import('./motion-features').then((m) => m.default)}`) to defer the bundle past hydration.
 * - `MotionConfig reducedMotion="user"`: Motion drops transform and layout animation for visitors who asked for less
 *   motion. It only covers Motion's own animations: every hand-written style writer still checks
 *   `prefersReducedMotion()` itself.
 * - It marks the engine ready (`html[data-animation-ready]`), which switches off the CSS failsafe in css/animation.css.
 */
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react'
import { useEffect, useLayoutEffect, type ComponentProps, type ReactNode } from 'react'

import { markAnimationReady } from '../config'

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface MotionProviderProps {
  children?: ReactNode
  features?: ComponentProps<typeof LazyMotion>['features']
}

export function MotionProvider({ children, features = domAnimation }: MotionProviderProps) {
  useIsomorphicLayoutEffect(() => {
    markAnimationReady()
  }, [])

  return (
    <LazyMotion features={features} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  )
}
