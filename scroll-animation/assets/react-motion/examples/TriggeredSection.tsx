/**
 * A worked example of the default entrance pattern: `Stage` + `StageItem`.
 *
 * This file is a SERVER component — nothing here has `'use client'`. That is
 * the point of the `Stage`/`StageItem` design: they are client components
 * themselves, but Motion's variant propagation flows through the plain
 * `<div>`/`<h2>`/`<p>` wrappers in between without requiring them to opt in,
 * so a whole section can stay server-rendered around a handful of animated
 * leaves. Drop this into any React Server Components framework (Next.js App
 * Router, etc.) as-is.
 *
 * ## What it demonstrates
 *
 * - `trigger="view"` — the stage fires when it scrolls into frame, not at
 *   page load. Pair `trigger="mount"` with a `StageVeil` instead for a hero.
 * - A three-line heading staggered by `delay`, each line 0.067s after the
 *   last — the reference build's own stagger interval.
 * - Distances carried in CSS custom properties (`--hero-lift`) rather than
 *   hardcoded into the variant, so the same `StageItem` reads a different
 *   travel distance per breakpoint with zero JS. This is the "tier-1
 *   responsive" pattern documented on `variants.ts` — set the variable with a
 *   plain utility class, Motion resolves it from computed style at animation
 *   start.
 */
import { Stage, StageItem } from '../components/Stage'

export function TriggeredSection() {
  return (
    <Stage as="section" trigger="view" className="mx-auto max-w-3xl px-6 py-24">
      <StageItem
        as="h2"
        variant="liftFade"
        className="text-4xl font-semibold [--hero-lift:24px] lg:[--hero-lift:32px]"
      >
        A heading that arrives
      </StageItem>
      <StageItem
        as="p"
        variant="liftFade"
        delay={0.067}
        className="mt-4 text-lg text-gray-600 [--hero-lift:24px] lg:[--hero-lift:32px]"
      >
        The second line follows the first by one stagger interval, so the
        reveal reads as one gesture rather than two unrelated animations.
      </StageItem>
      <StageItem
        as="div"
        variant="lift"
        delay={0.134}
        className="mt-8 [--hero-lift:16px]"
      >
        <a
          href="#"
          className="inline-block rounded-full bg-black px-6 py-3 text-white"
        >
          Call to action
        </a>
      </StageItem>
    </Stage>
  )
}
