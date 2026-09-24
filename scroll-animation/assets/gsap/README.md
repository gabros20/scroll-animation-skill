# scroll-animation / gsap

A framework-agnostic port of the scroll-animation motion system's behaviour,
built on GSAP 3.13+ (CustomEase, all free since April 2025). Plain TypeScript
modules, driven entirely by data attributes — works in Vite, Astro, a static
page, or anything else that can run a script tag.

This is a port of *behaviour*, not of the reference build's React
components. If you are looking for the React/Motion version, see
`../react-motion`.

## Install

```bash
npm i gsap
```

Nothing else is required — CustomEase is bundled with the `gsap` package
and is free to use (Webflow's "no charge" licence; see `SKILL.md`/the
skill's `references/` for the full note).

## Setup

1. Include `motion.gsap.css` (in the skill's `assets/styles/motion/`, copied to
   `src/styles/motion/` with `motion.css`) right after `motion.css`, before any page content:

   ```ts
   import './styles/motion/motion.css'
   import './styles/motion/motion.gsap.css'
   ```

   It gives every attribute below its pre-JS resting state, so nothing
   flashes the settled layout before the script below runs, and nothing is
   permanently broken if JS never runs.

2. Ship the two `<noscript>` snippets `motion.gsap.css` calls out, next to the
   elements they cover — one page using `[data-stage-item]` and
   `[data-stage-veil]`:

   ```html
   <noscript>
     <style>
       [data-stage-item] { transform: none !important; opacity: 1 !important; }
       [data-stage-veil] { display: none; }
     </style>
   </noscript>
   ```

3. Call the init function once, after the DOM you want wired is present:

   ```ts
   import { initFluidMotion } from 'scroll-animation/gsap'
   // or, from source: import { initFluidMotion } from './assets/gsap/src'

   const motion = initFluidMotion(document, {
     headerTheme: { header: 'header' }, // omit if the page has no themed header
     scrubStage: (el) => (el.id === 'hero-scene' ? heroSceneOptions : undefined)
   })

   // Vite/webpack HMR: re-running initFluidMotion on the same root tears
   // down the previous instance first, so this is safe to call again.
   if (import.meta.hot) {
     import.meta.hot.accept(() => motion.destroy())
   }
   ```

`initFluidMotion` returns `{ destroy(), refresh() }`. It is idempotent per
root — a second call on the same `root` (default `document`) tears the
first one down before mounting again, which is what makes it HMR-safe.
Everything it wires reads its own attribute selector; call the individual
`init*` exports directly if you only need one primitive (e.g. a page with
just count-up numbers has no reason to pull in `scrubStage.ts`'s cost).

## The DOM attribute contract

Shared with `../react-motion` — `references/attribute-contract.md` §3. This is the whole surface
area; there is no separate props API.

| Attribute | On | Meaning |
| --- | --- | --- |
| `data-stage="view"\|"mount"` | a triggered entrance group | `view` fires on scroll-in, `mount` fires immediately |
| `data-stage-margin` / `data-stage-margin-lg` | a stage | IntersectionObserver `rootMargin`; `-lg` overrides from `ENGAGE_QUERY` up, resolved once |
| `data-stage-repeat` | a stage | presence replays the group on every re-entry instead of once |
| `data-stage-item` | an item SSR'd/authored in its hidden state | required for `motion.gsap.css`'s hidden-state rules and the `<noscript>` override |
| `data-variant` | a stage item | `drop \| settle \| settleFade \| lift \| liftFade \| growY \| growX` |
| `data-delay` | a stage item | seconds after the stage fires |
| `data-stage-veil` | the page-load overlay | self-driving; fades on mount regardless of any stage |
| `data-count-up="<value>"` | a number | counts 0→value on first ~60% visible; static text must hold `<value>` |
| `data-fade-on-exit` | a group | fades out as it scrolls above the viewport; tune with `--exit-from`/`--exit-to` |
| `data-pull-to-centre` | a marker, first child of the box to attract | optional `data-clamp` (selector), `data-threshold`, `data-threshold-lg` |
| `data-scrub-stage` | a scroll scene's range wrapper | the outer element `scrubStage.ts` measures |
| `data-scrub-pin` | the sticky pinned layer, inside the range wrapper | CSS owns the pin; see `motion.gsap.css` |
| `data-scrub-video` | the `<video>` inside the pin | `data-src`/`data-mobile-src`, `poster`/`data-mobile-poster` |
| `data-scrub-gutter` | optional backdrop element, inside the pin | painted from `backdropStops` |
| `data-scrub-content` | the flow wrapper riding over the pin | cancels the pin's height contribution |
| `data-scrub-spacer` | an empty pacing act inside `data-scrub-content` | mark any act with no camera move or copy of its own so `motion.gsap.css`'s/`motion.css`'s reduced-motion collapse can zero its height, instead of leaving a blank band the length of that act. Author it by hand — neither engine infers it |
| `data-motion-state` | a machine root (the scrub video) | current mode, written only on transition |
| `data-header-theme="light"\|"dark"` | a section | what a themed header should read while this section is under it; `--header-theme` overrides per breakpoint |
| `data-loop-video` | a background loop `<video>` | optional `data-loop-from-frame` + `data-fps` for the seam-loop policy |

Distances live in CSS custom properties on the animated element —
`--hero-drop`, `--hero-settle`, `--hero-lift` (signed lengths, `motion.gsap.css`
reads them with the reference build's own defaults). Scalar ranges for
`FadeOnExit` are `--exit-from`/`--exit-to`.

## Two things `motion.gsap.css` cannot do for you

- **The load veil needs a background from the page.** `[data-stage-veil]` is
  positioned, `z-index`ed and set to `opacity: 1`, but it paints nothing —
  the right colour is a page decision (a surface token), not this
  stack-agnostic file's. Without one, the veil is an invisible fixed layer
  and the flash it exists to prevent is back, silently: `<div
  data-stage-veil class="bg-surface-dark">` (or an inline
  `background-color`).
- **Centring a stage item needs `translate`, not `transform`.** Every
  `[data-variant]` rule in `motion.gsap.css` sets `transform`
  (`translateY`/`scaleY`/`scaleX`), so `transform` is already spoken for on
  any element carrying one. A `transform: translateX(-50%)` meant to centre
  that same element is silently overwritten the instant the hidden-state
  rule applies, and again by GSAP's own tween. Use the independent
  `translate` property instead — `translate: -50% 0;` — which composes with
  `transform` rather than fighting it for the one declaration.

## One scroll-driven scene per page

`scrubStage.ts` is real main-thread cost: a gated rAF loop, a per-frame
transform write, a decoder held ready. `references/performance.md` §3
sizes the whole system around
**only 1–3 scroll-driven scenes intersecting the viewport at once** — in
practice, on the reference build, exactly one per page. Everything else
should be a triggered `[data-stage]`, which is close to free: it goes
quiescent after firing and holds no per-frame subscription.

If a page seems to want two independent scrubbed videos, that is usually a
sign the two acts belong on one shared range wrapper instead (see
`scrubStage.ts`'s docblock on why loops are sub-ranges of one continuous
asset, not separate clips).

## Module map

| File | Job | React/Motion counterpart |
| --- | --- | --- |
| `src/eases.ts` | CustomEase registration + the `attribute-contract.md` §4 motion constants | `lib/transitions.ts`, `lib/constants.ts` |
| `src/stage.ts` | Triggered entrances, IntersectionObserver-based | `components/Stage.tsx` |
| `src/veil.ts` | The page-load overlay | `components/Stage.tsx`'s `StageVeil` |
| `src/countUp.ts` | Counting numbers | `components/CountUp.tsx` |
| `src/fadeOnExit.ts` | Manual scroll-linked group fade | `FadeOnExit.tsx` (reference build) |
| `src/scrollPull.ts` | The scroll-well attractor, ported wholesale + a mount | `lib/scrollPull.ts` + `PullToCentre.tsx` |
| `src/scrubStage.ts` | The one scroll-driven scene: pin, modes, camera, loops | `ScrubStage.tsx` |
| `src/headerTheme.ts` | Resolves a fixed header's ink from the section beneath it | `hooks/useHeaderTheme.ts` |
| `src/inViewLoopVideo.ts` | A gated background loop video | `InViewLoopVideo.tsx` (reference build) |
| `src/videoController.ts` | Imperative `<video>` hardening, framework-free | `videoController.ts` (reference build) |
| `src/index.ts` | `initFluidMotion()` — wires everything above at once | `MotionProvider.tsx` (mount point, not behaviour) |

## What does NOT carry over 1:1

- **GSAP has no spring-physics plugin.** `MOTION.indicator` (a critically
  damped spring in the reference) is approximated with `power3.out` at the
  same duration — retune by ear per use, it is not a measured fit the way
  the three CustomEases are.
- **`FadeOnExit`'s original bug (a WAAPI-promoted scroll-linked value
  running backwards) is Motion-specific** — GSAP does not hand scroll-linked
  values to the browser's native scroll-timeline API the way Motion can.
  `fadeOnExit.ts` still writes `style.opacity` by hand, both because it is
  the safer pattern regardless of engine and to keep one mental model
  across both ports.
- **The reference build's `ScrubStage` camera numbers (`SHOTS`, `SUBJECT`,
  `CROP`, the backdrop colour stops) are that render's own measured
  composition** and are not shipped here. `scrubStage.ts` defaults every
  camera field to identity (a plain covering video, no pan/zoom) and grows
  into the full camera once you supply your own measured `ScrubStageOptions`
  — see `references/video.md` (posters, placement, encoding) and §15 (bringing your own asset)
  for how those numbers get measured in the first place.
- **Progress source for the scrub stage is a passive scroll listener + rAF,
  not GSAP ScrollTrigger.** See the docblock at the top of `scrubStage.ts`'s
  progress-source section for the reasoning (the pin is CSS `sticky`, not a
  ScrollTrigger pin, and a second scroll-observation system alongside the
  module's own IntersectionObserver-gated loop buys nothing a direct
  `getBoundingClientRect` read doesn't already give).
