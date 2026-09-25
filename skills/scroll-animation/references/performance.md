# Motion performance

**Purpose:** Keep scroll motion inside the frame budget on real devices.

**Read when:** you're adding a scroll-driven effect, reviewing whether a page's motion budget still
holds, or diagnosing dropped frames and jank on a real device.
**Skip when:** the work is a single triggered reveal with no scroll binding (`motion-architecture.md`
§3's triage already keeps that case cheap by construction). Render performance with no motion in it
(fonts, image `sizes`, Core Web Vitals budgets for layout) belongs to the `fluid-design` skill's
`references/performance.md` when it is installed.
**Depends on:** `scenes.md` for what makes a scene expensive in the first place;
`ios-safari-motion.md` for the compositing quirks this budget has to survive on WebKit.

Subscription count is the wrong metric to optimise: a scroll-position hook typically shares its
underlying measurement per container regardless of how many things read it. What actually costs, in
order, is below.

**Inputs:** the page's motion inventory or a jank report.
**Produces:** the budget check, the cost order and the fix for the hot path.

## Contents

1. [The cost order](#1-the-cost-order)
2. [Per-frame budgets](#2-per-frame-budgets)
3. [Concurrent scroll scenes](#3-concurrent-scroll-scenes)
4. [Transform shorthands are not accelerated](#4-transform-shorthands-are-not-accelerated)
5. [No layout properties on scroll](#5-no-layout-properties-on-scroll)
6. [IO-gate every rAF and video](#6-io-gate-every-raf-and-video)
7. [`content-visibility` never touches a scene](#7-content-visibility-never-touches-a-scene)
8. [No parent custom property for children](#8-no-parent-custom-property-for-children)
9. [CSS over JS for predetermined motion](#9-css-over-js-for-predetermined-motion)
10. [`will-change` policy](#10-will-change-policy)
11. [Filter blur limits](#11-filter-blur-limits)
12. [Library weight: strict feature sets](#12-library-weight-strict-feature-sets)
13. [Motion asset and JS budgets](#13-motion-asset-and-js-budgets)
14. [Traps](#traps)

## 1. The cost order

1. **Per-frame style writes.** Budget the *elements* hot in any given frame, not the number of
   effects defined in source: roughly **≤2 active springs, ≤25–30 written DOM nodes** touched per
   frame across the whole page. Phones die on paint and composite, not on interpolation maths: the
   arithmetic is nearly free; writing it to the DOM is not.
2. **Springs that never sleep.** An unclamped spring (or scroll-derived value) keeps computing even
   once its visible effect is imperceptible. Clamp every derived value's domain so it goes quiescent
   once the input leaves the range that can change its output.
3. **Main-thread contention.** Scroll-linked values that live on the main thread hitch *all at once*
   whenever anything else blocks it: a long framework commit, an image decode, a font swap. This is
   why the concurrency budget in §3 matters more than any single scene's own efficiency.

## 2. Per-frame budgets

The ≤2 springs / ≤25–30 nodes figures above are the two numbers worth keeping fixed in mind while
building a new scene, because they're easy to blow through by accretion: five sections each adding
"just one more" scroll-linked element compounds past the budget with no single commit looking
expensive on its own. Treat them as a running total across whatever can be on screen
simultaneously, not per component.

## 3. Concurrent scroll scenes

> **Only 1–3 scroll-driven scenes should intersect the viewport at once.** In practice, one
> `ScrubVideo` per page.

This is `motion-architecture.md` §3's triage restated as a hard number: at dozens of animated
sections on one page, this ceiling *is* the performance budget. It's enforced by IO-gating (§6), so
each scene's decoder and rAF loop only run while genuinely near the viewport, but the ceiling itself
is a design constraint, not just an implementation detail. Stacking more than a handful of
full-screen pinned panels, each with its own filters or video decode, costs more than forty small
opacity triggers combined. Layer count and pixel area dominate the cost, not element count.

`ScrubVideo` is expensive by design: a decoder that scrub-seeks on nearly every scroll frame, plus a
per-frame rAF/`requestVideoFrameCallback` loop while it is awake. Its gating is what makes ONE
instance affordable; two live at once means two decoders and two per-frame loops, which is not what
the gating was built to survive. If a page seems to want two independent scrubbed videos, the two
acts usually belong on one shared range wrapper instead, with loops as sub-ranges of one continuous
asset rather than separate clips.

## 4. Transform shorthands are not accelerated

A declarative animation library's `x`/`y`/`scale` convenience props are frequently implemented as
individually-interpolated values applied via the main thread on every frame, **not** as a single
hardware-accelerated `transform`. On any full-screen or pinned path this is measurable frame loss
under load. Write the full composed transform string instead:

```tsx
<AnimatedEl style={{ x }} />                                                    // main thread
<AnimatedEl style={{ transform: template`translateX(${x}px)` }} />              // accelerated
```

A hand-written transform string (the direct write, `scenes.md` §6) gets this for free by
construction, and should keep a `translateZ(0)`/`translate3d(...)` term inside that same string
rather than as a separate rule: that anchor is load-bearing for Safari's compositing specifically
(`video.md` §6).

## 5. No layout properties on scroll

`width`, `height`, `top`, `padding` and similar trigger layout, paint *and* composite on every
write; `transform`, `opacity` and `filter` trigger composite only (and `filter` is more expensive
than the other two, §11). This is why a growing or filling bar animates `scaleY`/`scaleX` rather
than `height`/`width`: on a plain filled rect with nothing else inside it, the two are
pixel-identical, and one is free while the other reflows. It needs `transform-origin: bottom` (or
`left`) or it grows from the middle.

**The one sanctioned exception is an accordion disclosure.** There is genuinely no transform that
expresses "the content below me moves down by exactly the height of what just appeared": a `scaleY`
squashes the type inside and leaves the document flow behind it teleporting into place anyway. A
short, capped duration (roughly 150–250ms; the shipped `disclosure` token is 0.24s) keeps the layout
cost bounded to a single user-triggered event rather than a per-frame scroll cost, which is the
actual distinction that matters: this exception is for a *discrete, infrequent, user-initiated*
transition, never for anything scroll-linked.

Related: size media with CSS, transform it with JS. A responsive camera crop (`scenes.md` §7)
should scale a video via a per-frame `transform` write while its box dimensions stay entirely CSS.
Letting CSS own `width`/`height` means the scaling never triggers a layout-invalidating write, no
matter how large the multiplier.

## 6. IO-gate every rAF and video

Every `requestAnimationFrame` loop and every video's decode/playback state must be gated on an
`IntersectionObserver`, with two different margins for two different jobs (`video.md` §5): a wide
margin that starts *warming* (network fetch, decoder handshake) well before arrival, and a tight
margin that starts *running* (the rAF tick, actual playback) only once genuinely on or near screen.
An ungated rAF loop measured at roughly 120 iterations/second with its owning scene three screens
away from the viewport, each iteration performing layout reads that cost nothing individually but
compound relentlessly when the loop never stops. This gating is what makes even one scrubbed video
scene affordable at all; without it, "decode only what's on screen" is a principle with no
enforcement.

## 7. `content-visibility` never touches a scene

`content-visibility: auto` (with `contain-intrinsic-size`) is a render optimisation for below-fold
flow sections, and it is **never** correct inside, or wrapping, a scroll scene's runway or a
triggered reveal group. Applied there it **zeroes the measured geometry** the scene depends on (its
own height collapses to the browser's placeholder estimate), which corrupts every downstream
calculation that assumes the real rendered height: the pin's own progress maths, a reveal's trigger
line, anything derived from `offsetHeight`. It is a strict either/or: a section is either a
`content-visibility` candidate (ordinary flow content, no scroll binding) or part of a scene's
measured geometry, never both.

## 8. No parent custom property for children

Setting a custom property on a **parent** element for descendants to read via `var()` forces a style
recalculation of every descendant on every write, because the browser cannot know in advance which
descendants consume the property; it has to re-evaluate the whole subtree. Set the property **on the
element that's actually animated**, driven by a static class rather than a JS write to an ancestor.
This is why entrance distances (`--hero-lift` and friends) live on the stage item itself, set by a
breakpoint utility, never on a shared ancestor.

## 9. CSS over JS for predetermined motion

CSS animations and transitions run off the main thread. Anything whose values are known ahead of
time (not a function of live scroll position or live user input) should be CSS, not a per-frame JS
write, specifically because CSS survives main-thread contention that would otherwise hitch a
JS-driven equivalent (§1's third cost tier). Reach for JS only when the value genuinely depends on
something CSS cannot read: live scroll offset, a decoder's playhead, a measured DOM rect.

As decoration only, and never for coordination: native CSS `animation-timeline`/`view()` scroll
timelines run entirely off the main thread on supporting engines, behind `@supports`, for flow-only
triggered reveals with no state to coordinate. This buys real free performance on the boring majority
of sections, but it is never a substitute for the JS-driven mechanisms in `scenes.md`. Its
browser-native view range is exactly the thing that disagreed with JS scroll maths in the
WAAPI-promotion bug (`scenes.md` §6); the same caution about a native timeline's range not
matching a hand-computed one applies here too.

## 10. `will-change` policy

Do not scatter manual `will-change` declarations. A capable declarative animation library already
promotes an element to its own compositing layer while actively animating it and demotes it
afterward. A permanent `will-change` instead pins the promotion (and its memory cost) for the
element's entire lifetime, for no benefit once the animation is idle.

**The one standing, documented exception:** a video's `translateZ(0)`/`translate3d(...)` compositing
anchor (`video.md` §6). This is a Safari-specific requirement to keep the video's own compositing
layer from being demoted, and it is deliberately permanent: do not "clean it up" as part of an
unrelated refactor. Every other `will-change`-shaped optimisation should be justified the same way:
a specific, documented, measured requirement, not a defensive default.

## 11. Filter blur limits

`filter: blur()` is allowed but genuinely expensive, especially over a large painted surface. Keep
it under roughly 20px and specifically measure its cost on Safari, which handles large blurred
surfaces worse than Chromium in practice. A blurred backdrop behind a floating nav bar (a common
use) is a reasonable size to budget for; a blur applied to a large hero-scale surface is not, without
measuring first.

## 12. Library weight: strict feature sets

Where the chosen animation library offers a reduced/strict feature-set import, default to it. Motion's
`domAnimation` under `LazyMotion` `strict` mode is the reference example: roughly 6KB against the full
library's ~34KB. Add only the specific feature you need when you need it (`domMax` only once layout
animations or drag are genuinely required). Import the `m` component from `motion/react` and write `m.div`,
never `motion.div`: `strict` mode throws on the non-lazy `motion.*` component API rather than silently working, and that
is a feature, not friction. It stops a future contributor from quietly reintroducing the full bundle
one import at a time. `scripts/tools/audit-motion.mjs`'s `motion-strict` rule flags any `motion.*` left in a strict project.

GSAP's equivalent: import only the modules a page uses (`initStages`, `initCountUps`, …) rather than
`initFluidMotion` when a page needs one primitive; a page with just count-up numbers has no reason to
pull in the scroll well's (`scrollPull.ts`) cost.

## 13. Motion asset and JS budgets

- **All-intra re-pays background texture every frame. Budget for it before shooting or rendering,
  not after.** Inter-frame compression is what normally makes a mostly-static background nearly
  free; an all-intra scrub asset (`video.md` §1) has none of that, so a textured, high-frequency
  background (flour on slate, visible film grain, a busy procedural pattern) is encoded from scratch
  on every single frame and the file size follows directly. Measured: a textured ground cost 37MB at
  CRF 22 / 1600×900; softening the texture and dropping to 1440×676 brought the same shot to 9MB,
  and the softening did more than the resolution cut. Prefer a flatter, less textured background for
  anything that will be scrub-encoded, and treat "the background looks a little too clean" as a
  deliberate trade against file size rather than a rendering mistake.
- **A stray large asset is a permanent cost in version control**, not just a one-time download: most
  VCS systems keep every blob forever, so an oversized commit's clone-time cost never comes back once
  someone "fixes" it later by re-encoding. Catch it before the commit, not after.
- **INP ≤ 200ms at p75** is the Core Web Vital motion can break: a long main-thread task from a
  per-frame writer or a large hydration of animated leaves shows up there. Keep sections as server
  components with only the animated leaves on the client (`motion-architecture.md` §4).
- **Wire the budget into CI** (bundle-size deltas for the animation library and motion modules,
  asset sizes for video) rather than trusting review. `verification.md` covers the runtime-behaviour
  checks a budget cannot: a value that "looks right" in a Lighthouse score but is measurably wrong
  mid-scroll.

## Traps

- [ ] ★ No scroll-linked value bound through a declarative `x`/`y`/`scale` shorthand; write the full
  `transform` string (§4).
- [ ] ★ No `content-visibility: auto` inside or around a scroll scene (§7).
- [ ] ★ Every rAF loop and video is IO-gated with two margins (§6).
- [ ] No `width`/`height`/`top`/`padding` on any scroll-linked path; accordion disclosure excepted
  (§5).
- [ ] Custom properties are set on the animated element, never a parent (§8).
- [ ] No permanent `will-change`; the video `translateZ(0)` anchor is the only standing exception
  (§10).
- [ ] `filter: blur()` stays small and is measured on Safari (§11).
- [ ] At most one pinned, scrubbed scene per page.
- [ ] Across all scroll-linked effects, no more than 1–3 intersect the viewport at once (§3).
- [ ] `LazyMotion strict` with `m`, not `motion.*` (§12).
- [ ] Scrub assets have a flat enough background to encode all-intra affordably (§13).
