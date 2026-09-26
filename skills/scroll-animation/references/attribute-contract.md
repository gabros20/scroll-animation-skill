# Attribute contract

**Purpose:** The exact names both engines share: `data-*` attributes, distance variables and motion constants.

**Read when:** you need the exact, engine-neutral name of a `data-*` attribute, a CSS variable
that carries a distance or scalar range, or a motion constant, checked against what actually ships
rather than remembered.
**Skip when:** you already know the name and need the *why* behind it: that lives in
`motion-architecture.md`, `scenes.md`, `sequences.md`, `header-theme.md` and `video.md`. Layout names (the
fluid config keys, `--fluid*` custom properties, `fluid-*` utilities, `data-fit`, `--fluid-header-h`) are
the `fluid-design` skill's contract.
**Depends on:** nothing. This is the leaf reference every other doc here cites for exact names.

Every name below was checked against the shipped code in `assets/motion` and `assets/gsap`.
If a name here ever stops matching the code, the code is the source of truth: treat it as a doc bug
on this page, not a bug in the primitive.

**Inputs:** a name you need to write or check.
**Produces:** the attribute, variable or constant, with its default and owner.

## Contents

1. [Layout names](#1-layout-names)
2. [Distances and scalar ranges](#2-distances-and-scalar-ranges)
3. [DOM attributes](#3-dom-attributes)
4. [Motion constants](#4-motion-constants-identical-in-both-engines)
5. [Traps](#traps)

## 1. Layout names

The fluid config keys, the `--fluid*` custom properties, the `fluid-*` utilities, `data-fit`,
`data-verify-grid` and `--fluid-header-h` belong to the `fluid-design` skill's contract. Motion code reads
the scale units and their `--_fluid-m-*` mirrors that `FLUID_DESIGN_SCALE` names in `config.ts` (through
`scale.ts`), the scroll well's `--fluid` and the anchor check's `--fluid-header-h`; see `preflight.md` §3.6.
The section numbers below are kept stable because the shipped code cites them.

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
| `--scene-p` | `<number>` 0..1: progress you write for CSS to multiply into a scaled distance | `0` |

Entrance distances stay **fixed px**, even on a fluid-scaled layout: engines resolve `var()` once at
animation start, so a scaled value would go stale on resize. Travel scales (`scenes.md` §12).

The scene blocks write `--scene-frame-w` / `--scene-frame-h` (the camera's base media size in `svh`) and
`--scene-g-top` / `--scene-g-bottom` (the backdrop ramp's edge colours); never set them yourself.

## 3. DOM attributes

Shared by the React/Motion and GSAP primitives, the verifier and the docs. The v1 GSAP `init*`
blocks are attribute-driven: every knob a React consumer would pass as a component prop is a
`data-*` attribute they read off the DOM at mount. The v2 GSAP blocks (`pinnedScene`, `scrubVideo`,
`frameSequence`, `loopVideo`) take an options object and read only the attributes below. React exposes
the same *behaviour* through component props (`<Stage trigger="view" />`,
`<StageItem variant="lift" />`) and only emits the subset of attributes below that something still
needs to query from outside React: CSS (the pre-JS resting state, reduced motion), the `<noscript>`
safety net, or the verification harness. The **On** column calls out where an attribute is GSAP-only.

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
| `data-scene-root` | a pinned scene's range wrapper | both engines: what the scene measures, never the pin. `PinnedScene` emits it |
| `data-scene-pin` | the sticky layer inside the root | both engines: `css/scene.css` owns its geometry. `pin: 'gsap'` sets it to `gsap` (CSS then makes it `position: relative`) and restores it on `destroy()` |
| `data-scene-content` | the flow wrapper riding over the pin | both engines: its `-100lvh` margin cancels the pin's height; `0` under reduced motion |
| `data-scene-spacer` | an empty pacing act in the content | both engines: zero height under reduced motion, so no blank runway is left; hidden in print. Author it by hand (`scenes.md` §10) |
| `data-scene-act` | an act stacked in the pin | both engines: every act but the active one gets `inert`, per transition; all flow and show under reduced motion and print. Never on content-layer acts (`scenes.md` §2) |
| `data-scene-media` | the pinned `<video>` | both engines: absolute, covering, `max-width: none`; `scrubVideo` finds its video by it, with sources in `data-src`, `data-mobile-src`, `poster` and `data-mobile-poster` |
| `data-scene-gutter` | optional backdrop layer in the pin | both engines: painted from the `backdrop` stops through `--scene-g-top`/`-bottom` |
| `data-scene-frame="<scoped id>"` | React only: the `<video>`, with a `camera` | scopes the per-instance rule that sets `--scene-frame-w/-h` from the desktop query, so two scenes never share one. GSAP writes the properties inline per tier |
| `data-scene-state` | the scene root | both engines: `head \| scrub \| tail`, written per transition, never per frame. GSAP removes it on `destroy()` |
| `data-frame` | a `FrameSequence` canvas | both engines: the frame index drawn, written only when it changes |
| `data-header-theme="light"\|"dark"` | a section | both engines: what a themed header should read while this section is under it; `--header-theme` overrides it per breakpoint (`header-theme.md`) |
| `data-theme` | the header element | GSAP-only output: `initHeaderTheme` writes the resolved theme here, only on a change. React's `useHeaderTheme` returns the value instead |
| `data-loop-video` | a background loop `<video>` | GSAP-only: `data-loop-from-frame` + `data-fps` for the seam policy; the pause control shows unless `data-controls="false"`; `data-alt` for footage that carries meaning. React's `LoopVideo` takes `loopFromFrame`, `fps`, `controls`, `alt` |
| `data-loop-toggle` | the loop's pause button | GSAP-only: a sibling of the video, or anywhere in the root with `data-loop-toggle-for="<video id>"`; created when a control is due and none exists. React's `LoopVideo` renders its own |
| `data-motion-debug~="markers"` | `<html>` | toggles the tier-2 marker stylesheet (`verification.md` §3) |
| `?motion-debug` / `data-motion-debug` | the URL / `<html>` | attaches `window.__scrub()` on pages with a ScrubVideo, in any build (`verification.md` §1) |

### Why the scene collapse keeps `!important`

`css/scene.css` owns the scene geometry for both engines, but ScrollTrigger writes inline geometry on a `pin: 'gsap'`
pin, and an inline style beats any non-`!important` rule whatever its specificity or source order. So every
reduced-motion and print rule in `scene.css` is `!important`. The pin collapses to `100svh`, not `auto`: its media is
absolutely positioned, and `auto` around it measures zero (`scenes.md` §10).

## 4. Motion constants (identical in both engines)

Source of truth: `assets/motion/lib/transitions.ts` + `lib/constants.ts` + `lib/triggers.ts`
+ `lib/scroll.ts` (React), mirrored in `assets/gsap/eases.ts` and `assets/gsap/config.ts`
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
  `bands.desktop.minWidth` and the CSS breakpoint token for the same width. See `preflight.md`
  §3.6 for where the value comes from.
- Scenes (`scene.ts`): `SCENE_HOLDS` `headHoldPx` 12, `tailLeadPx` 320, `hysteresisRatio` 0.7;
  `SCENE_MARGINS` warm 600 px, wake 200 px; `ACT_HYSTERESIS` 0.1 acts.

## Traps

- [ ] A `StageItem`/`[data-stage-item]` never gets its own trigger (`motion-architecture.md` §4).
- [ ] Empty pacing acts carry `data-scene-spacer`; no engine infers it (§3).
- [ ] The veil has a background (§3).
- [ ] `data-count-up`'s static text holds the final value (§3).
- [ ] Reduced-motion collapse rules keep their `!important` (§3).
- [ ] Distances are set on the animated element, in px (§2).
- [ ] The engage constant equals the CSS breakpoint and any fluid config (§4).
