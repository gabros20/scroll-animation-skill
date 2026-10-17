'use client'
/**
 * motion/LayoutMorph.tsx — a recipe: one element morphing into another inside one route (a card that opens into a
 * panel, a thumbnail into its detail) with Motion's `layoutId`. One file to adapt in place, plus
 * motion/layout-features.ts, the feature chunk it loads.
 *
 *   <LayoutMorph>
 *     {open
 *       ? <Morph key="panel" morphId={slug} className="panel" onClick={close}>…</Morph>
 *       : <Morph key="card" morphId={slug} className="card" onClick={open}>…</Morph>}
 *   </LayoutMorph>
 *
 * - `Morph` is an `m.div` with a `layoutId`: when one unmounts and another with the same `morphId` mounts in the same
 *   render, Motion animates the new one from the old one's box to its own (transform only; a border-radius or
 *   box-shadow given through `style` is scale-corrected, one in CSS stretches) and crossfades the two. The same Morph
 *   re-rendered with a new layout animates too. Any `m.div` prop passes through.
 * - `LayoutMorph` scopes it: a `LayoutGroup` (pass `id` when one component renders twice on a page, so its morphIds
 *   don't meet the other copy's; siblings that move because the panel opened animate with it when they carry
 *   `layout`), and a strict `LazyMotion` that loads `domMax` for this subtree only, when it first mounts. Our
 *   MotionProvider stays on domAnimation: `layout` and `layoutId` need domMax's projection, a chunk of about 46 kB
 *   minified (14 kB gzipped; Motion 13.4, measured in a Vite build) that a page without a morph never fetches.
 *   Motion registers features for the whole page once loaded, so a second LayoutMorph reuses the chunk. Until it
 *   arrives (on the first mount only), the elements render and swap without animating.
 * - Across App Router routes, use React's `<ViewTransition name share="vt-morph">` with css/view-transitions.css (the
 *   view-transitions block), never `layoutId`: the old route's tree is gone before the new one mounts, and no client
 *   component owns both. A change inside one route that must keep the same DOM node (a playing video, focus)
 *   on a GSAP route is gsap/flip-transition.ts.
 * - Inside a scrolling container, give the container `layoutScroll`; inside a position: fixed one, `layoutRoot`.
 *   Never on a pinned or sticky ancestor: the box Motion measured moves with the scroll before the morph lands.
 * - Reduced motion (live, useReducedMotionLive): no layoutId, so the swap is instant: no transform, no crossfade.
 *   Don't lean on MotionProvider's `MotionConfig reducedMotion="user"` for this: Motion 13.4's reduced path makes the
 *   layout animation instant, and in 2 of 12 runs (WebKit, Firefox) it left the new element stuck on the old one's
 *   box for good. A panel that mounted while it was on has no layoutId, so the swap after the setting is switched off
 *   is still plain; the one after morphs.
 * - Timing: MOTION.route (0.4 s on CURVES.disclosure), the same as the route morph in css/view-transitions.css.
 * - Render under MotionProvider; nothing else to clean up: unmounting stops the animation.
 */
import { LayoutGroup, LazyMotion, m, type HTMLMotionProps, type Transition } from 'motion/react'
import type { ReactNode } from 'react'

import { CURVES, MOTION } from '../config'
import { useReducedMotionLive } from './useReducedMotionLive'

const loadLayoutFeatures = () => import('./layout-features').then((mod) => mod.default)

const MORPH: Transition = { layout: { duration: MOTION.route.duration, ease: [...CURVES[MOTION.route.curve]] } }

export interface LayoutMorphProps {
  /** Namespaces the morphIds inside, for a component rendered more than once on a page. */
  id?: string
  children?: ReactNode
}

export function LayoutMorph({ id, children }: LayoutMorphProps) {
  return (
    <LazyMotion features={loadLayoutFeatures} strict>
      <LayoutGroup id={id}>{children}</LayoutGroup>
    </LazyMotion>
  )
}

export interface MorphProps extends HTMLMotionProps<'div'> {
  /** Shared by the two states: the card and the panel it opens into. */
  morphId: string
}

export function Morph({ morphId, transition, ...props }: MorphProps) {
  const reduced = useReducedMotionLive()
  // No layoutId at all under reduced motion: a plain swap (the header says why an instant transition won't do).
  return <m.div {...props} layoutId={reduced ? undefined : morphId} transition={transition ?? MORPH} />
}
