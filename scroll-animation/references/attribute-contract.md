# Attribute contract

**Read when:** you need the exact, engine-neutral name of a `data-*` attribute, a CSS variable
that carries a distance or scalar range, or a motion constant, checked against what actually ships
rather than remembered.
**Skip when:** you already know the name and need the *why* behind it: that lives in
`motion-architecture.md`, `scroll-scenes.md`, `header-theme.md` and `video.md`. Layout names (the
fluid config keys, `--fluid*` custom properties, `fluid-*` utilities, `data-fit`, `--fluid-header-h`) are
the `fluid-design` skill's contract.
**Depends on:** nothing. This is the leaf reference every other doc here cites for exact names.

Every name below was checked against the shipped code in `assets/react-motion` and `assets/gsap`.
If a name here ever stops matching the code, the code is the source of truth: treat it as a doc bug
on this page, not a bug in the primitive.

## Contents

1. [Layout names](#1-layout-names)
2. [Distances and scalar ranges](#2-distances-and-scalar-ranges)
3. [DOM attributes](#3-dom-attributes)
4. [Motion constants](#4-motion-constants-identical-in-both-engines)
5. [Traps](#traps)

## 1. Layout names

The fluid config keys, the `--fluid*` custom properties, the `fluid-*` utilities, `data-fit`,
`data-verify-grid` and `--fluid-header-h` belong to the `fluid-design` skill's contract. The only ones
motion code reads are `--fluid` (the scroll well's length unit) and `--fluid-header-h` (the anchor check's
fallback offset); see `fluid-interop.md` §2 and §6. The section numbers below are kept stable
because the shipped code cites them.

## 2. Distances and scalar ranges

Not attributes: CSS custom properties set on the animated element itself (never an ancestor,
`performance.md` §8), read by both engines' variant and transform code via
`getComputedStyle(el).getPropertyValue(...)`. Any mechanism that lands the property on the element
works: an arbitrary-value utility (`lg:[--hero-lift:32px]`), a CSS module, or a plain rule with a
media query.

| Variable | Carries | Default (both engines) |
|---|---|---|
| `--hero-drop` | signed length, `drop` variant | `-96px` |
| `--hero-settle` | signed length, `settle`/`settleFade` variants | `-24px` |
| `--hero-lift` | signed length, `lift`/`liftFade` variants | `32px` |
| `--exit-from` | scalar in [0, 1], `FadeOnExit`: where the fade starts | see `FadeOnExit`'s own default |
| `--exit-to` | scalar in [0, 1], `FadeOnExit`: where the fade ends (fully hidden) | see `FadeOnExit`'s own default |
| `--header-theme` | `light \| dark`, per-breakpoint override of `data-header-theme` | unset (the attribute wins) |
| `--fill` | `<number>`, registered with `@property` for a WebKit mask sweep | `0` |

Distances stay **fixed px**, even on a fluid-scaled layout: engines resolve `var()` once at
animation start, so a scaled value would go stale on resize (`fluid-interop.md` §3).

## 3. DOM attributes

Shared by the React/Motion and GSAP primitives, the verifier and the docs. GSAP is attribute-driven
end to end: it has no props API, so every knob a React consumer would pass as a component prop is
instead a `data-*` attribute that GSAP's `init*` functions read off the DOM at mount. React exposes
the same *behaviour* through component props (`<Stage trigger="view" />`, `<StageItem variant="lift"
/>`) and only emits the subset of attributes below that something still needs to query from outside
React: CSS (the pre-JS resting state, reduced motion), the `<noscript>` safety net, or the
verification harness. The **On** column calls out where an attribute is GSAP-only.

| Attribute | On | Meaning |
|---|---|---|
| `data-stage="view"\|"mount"` | a triggered entrance group | GSAP-only: `view` fires on scroll-in, `mount` fires immediately. React's `Stage` takes the same choice as the `trigger` prop and emits no attribute for it |
| `data-stage-margin` / `data-stage-margin-lg` | a stage | GSAP-only: IntersectionObserver `rootMargin`; `-lg` overrides from `ENGAGE_QUERY` up, resolved once. React's `Stage` takes `margin`/`marginLg` props |
| `data-stage-repeat` | a stage | GSAP-only: presence replays the group on every re-entry instead of once. React's `Stage` takes a `repeat` prop |
| `data-stage-item` | an item SSR'd in its hidden state | both engines: required for the pre-JS hidden state and the `<noscript>` override. React's `StageItem` always emits `data-stage-item=""` |
| `data-variant` | a stage item | GSAP-only, on the DOM: `drop \| settle \| settleFade \| lift \| liftFade \| growY \| growX`. React's `StageItem` takes the same values as the `variant` prop |
| `data-delay` | a stage item | GSAP-only, on the DOM: seconds after the stage fires. React's `StageItem` takes a `delay` prop (default 0) |
| `data-stage-veil` | the page-load overlay | both engines: self-driving, fades on mount regardless of any stage. React's `StageVeil` always emits `data-stage-veil=""`. It paints nothing itself: give it a background (a surface token), or it is an invisible layer and the flash it exists to prevent is back |
| `data-count-up="<value>"` | a number | GSAP-only: counts 0→value on first ~60% visible; the static text must hold `<value>` (so no-JS and crawlers read the real number). React's `CountUp` takes a `value` prop |
| `data-fade-on-exit` | a group | GSAP-only: fades out as it scrolls above the viewport, tuned with `--exit-from`/`--exit-to`. React's `FadeOnExit` reads the same two CSS variables directly, no attribute needed |
| `data-pull-to-centre` | a marker, first child of the box to attract | GSAP-only: optional `data-clamp` (selector), `data-threshold`, `data-threshold-lg`. React's `PullToCentre` takes `clamp`/`threshold`/`thresholdLg`/`disabled` props |
| `data-scrub-stage` | a scroll scene's range wrapper | both engines: the outer element the scrub logic measures. React's `ScrubStage` always emits it |
| `data-scrub-pin` | the sticky pinned layer, inside the range wrapper | both engines: CSS owns the pin's resting geometry (`assets/styles/animation/animation.gsap.css` for GSAP; `assets/styles/animation/animation.css`'s reduced-motion collapse for both). React's `ScrubStage` emits it on the `position: sticky` div; see the note below on why that div's other styles stay inline |
| `data-scrub-video` | the `<video>` inside the pin | GSAP-only: `data-src`/`data-mobile-src`, `poster`/`data-mobile-poster` drive tier selection; GSAP's `animation.gsap.css` also styles the box off this attribute. React's `ScrubStage` positions and sizes its `<video>` with an inline `style` and a `src` prop instead |
| `data-scrub-gutter` | optional backdrop element, inside the pin | GSAP-only, on the DOM: painted from `backdropStops`. React's `ScrubStage` targets the same backdrop element with a `ref`, not an attribute |
| `data-scrub-content` | the flow wrapper riding over the pin | both engines: cancels the pin's height contribution (a `-100lvh` margin); also the reduced-motion reset target (`margin-top: 0`). React's `ScrubStage` emits it on that wrapper div |
| `data-scrub-spacer` | an empty pacing act inside `data-scrub-content` | both engines: marks an act with no camera move or copy of its own, added only to give the full-motion composition room to linger, so the reduced-motion collapse can zero its height instead of leaving a blank band the length of that act (measured: an unmarked 2-viewport spacer left 1800px of empty dark band under reduced motion). Neither engine emits it; author it by hand. See `scroll-scenes.md` §10 |
| `data-scrub-frame="<scoped id>"` | React only: the `<video>`, when a `camera` is supplied | scopes a per-instance `<style>` tag that sets `--frame-w`/`--frame-h` from a media query (`useId()`-based), so two `ScrubStage`s on one page never share a rule. GSAP's `scrubStage.ts` sizes the video from its own options object directly |
| `data-motion-state` | a machine root (the scrub video) | both engines: current mode (`head \| scrub \| tail`), written only on transition, never per frame |
| `data-header-theme="light"\|"dark"` | a section | both engines: what a themed header should read while this section is under it; `--header-theme` overrides it per breakpoint (`header-theme.md`) |
| `data-theme` | the header element | GSAP-only output: `initHeaderTheme` writes the resolved theme here, only on a change. React's `useHeaderTheme` returns the value instead |
| `data-loop-video` | a background loop `<video>` | GSAP-only: optional `data-loop-from-frame` + `data-fps` for the seam-loop policy. React's `InViewLoopVideo` takes `loopFromFrame`/`fps` props |
| `data-motion-debug~="markers"` | `<html>` | toggles the tier-2 marker stylesheet (`verification.md` §3) |
| `?fluid-debug` / `data-fluid-debug` | the URL / `<html>` | attaches `window.__scrub()` on a production build (`verification.md` §1) |

### `data-scrub-pin`: the one place an engine difference bites

React's `ScrubStage` writes the pin's `position: sticky; top: 0; height: 100lvh; width: 100%;
overflow: hidden` as an inline `style`, not through a class, because that geometry is load-bearing
and framework-agnostic and must ship regardless of the host's styling system. An inline style beats
**any** non-`!important` stylesheet declaration, regardless of selector specificity or source
order, so the reduced-motion structural collapse in `assets/styles/animation/animation.css` declares its rules
`!important`:

```css
@media (prefers-reduced-motion: reduce) {
  [data-scrub-stage]   { height: auto !important; }
  [data-scrub-pin]     { position: static !important; height: 100svh !important; overflow: visible !important; }
  [data-scrub-content] { margin-top: 0 !important; }
  [data-scrub-spacer]  { height: 0 !important; }
}
```

(The pin collapses to `100svh`, not `auto`: its only content is an absolutely positioned video, and
`auto` would measure to zero. `scroll-scenes.md` §10.)

The alternative, moving the pin's geometry into a scoped `<style>` tag the way `--frame-w`/
`--frame-h` are (see `data-scrub-frame` above), was rejected here. That pattern earns its keep when
the value is *per-instance* (the frame size varies with `camera.frameSize`), and it still only wins
the cascade if its `<style>` tag is guaranteed to load after the global reduced-motion rule, which is
an ordering assumption this skill does not want to make. The pin's `position`/`height`/`overflow`
are the same on every instance, so `!important` on the one shared rule is both simpler and more
robust than trying to out-order a per-instance tag.

GSAP's own `animation.gsap.css` uses the identical selectors and the identical `!important` reasoning for
the same collapse, so both engines end up structurally identical under reduced motion even though
only one of them is fighting an inline style to get there.

## 4. Motion constants (identical in both engines)

Source of truth: `assets/react-motion/lib/transitions.ts` + `lib/constants.ts` + `lib/triggers.ts`
+ `lib/scroll.ts` (React), mirrored in `assets/gsap/src/eases.ts` and `assets/gsap/src/config.ts`
(GSAP; its CustomEase is bundled with the `gsap` package and free to use).

- `entrance`: 1.3s, `cubic-bezier(0.15, 0.6, 0.2, 1)`. Measured, frame-fitted; do not turn it into
  a spring
- `entranceFade`: 0.17s, delay 0.13s, linear
- `veil`: 0.13s, delay 0.17s, linear
- `roll`: 0.3s, `cubic-bezier(0, 0, 0.58, 1)`
- `disclosure`: 0.24s, `cubic-bezier(0.23, 1, 0.32, 1)`
- `indicator`: spring, duration 0.35s, `bounce: 0` (GSAP has no spring plugin and approximates with
  `power3.out` at the same duration; that is not a measured fit, so retune by ear per use)
- line stagger (`lineStagger`): 0.067s
- `REVEAL_TRIGGER`: `0px 0px -20% 0px`; `PAGE_END_TRIGGER`: `0px`; `AT_REST_TRIGGER`: `0px`
- `scrollSpring`: stiffness 120, damping 30, restDelta 0.001, `skipInitialAnimation: true`
  (required: without it the spring animates up from 0 on mount, so a page restored mid-scroll
  visibly slides into position)
- `ENGAGE_BREAKPOINT_PX` (React) / `ENGAGE_PX` (GSAP): 1024, with `ENGAGE_QUERY` derived from it.
  It must equal the width where the desktop composition starts: the fluid config's
  `bands.desktop.minWidth` and the CSS breakpoint token for the same width. See `fluid-interop.md`
  §1 for where the value comes from.

## Traps

- [ ] A `StageItem`/`[data-stage-item]` never gets its own trigger (`motion-architecture.md` §4).
- [ ] Empty pacing acts carry `data-scrub-spacer`; no engine infers it (§3).
- [ ] The veil has a background (§3).
- [ ] `data-count-up`'s static text holds the final value (§3).
- [ ] Reduced-motion collapse rules keep their `!important` (§3).
- [ ] Distances are set on the animated element, in px (§2).
- [ ] The engage constant equals the CSS breakpoint and any fluid config (§4).
