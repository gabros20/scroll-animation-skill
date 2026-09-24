---
name: scroll-animation
description: Build, fix or review web animation that is tied to page arrival or scroll. Covers triggered entrance and reveal animations, pinned sections, scroll-driven or scrubbed video, parallax and other scroll scenes, looping background video, header text colour that changes as sections scroll under it, and scroll wells that pull a section to rest. It ships measured primitives for React + Motion (framer-motion) and for GSAP/ScrollTrigger, plus the iOS Safari, video-encoding and performance fixes they need. Use it whenever someone wants things to "fade in on scroll", "animate as you scroll", "pin this section", "scrub the video with scroll", or asks about Motion, framer-motion, GSAP, ScrollTrigger or Lenis. Also use it to debug the symptoms of such work: reveals that never fire on mobile, a scrub stuck on its first frame and then snapping, a loop video that pops or stutters at its seam, a scroll-driven pin that won't hold (a plain CSS sticky layout bug is the `fluid-design` skill's), header ink that is wrong over a dark band, anchor links that stop short, animation jank, or new motion fighting existing GSAP, Lenis or header scripts. It is the companion to the `fluid-design` skill (viewport-fluid layout) and works with or without it.
---

# Scroll animation

A motion system for marketing and editorial pages. It has three clocks: **trigger** (entrances that
fire on arrival, which is the default and nearly free), **scroll** (one pinned scene per page, driven
by the reader) and **media** (a scrubbed or looping video that follows what the decoder presents).
It ships one set of primitives in two engines that share one DOM attribute contract and one set of
measured curves.

This skill is extracted from a production site whose motion layer was built three times. Most rules
here were paid for by a real bug, and the reference files say which one. When a rule seems fussy,
read its why before bending it; the cheap-looking alternative has usually been tried and removed.

## What you get

| Piece | Where |
|---|---|
| The method, the rules and the reasons behind them | `references/*.md` (read on demand; see the map below) |
| React + Motion primitives: `Stage`/`StageItem`/`StageVeil`, `CountUp`, `FadeOnExit`, `ScrubStage`, `PullToCentre`, `InViewLoopVideo`, `useHeaderTheme`, `useFluidUnit` | `assets/react-motion/` (README inside) |
| Scaled travel on a fluid layout: `fluidPx`, `fluidValue`, `fluidEnd`, `useFluidUnit`, `--scene-p` | `assets/{gsap/src,react-motion/lib}/fluid.ts`, `references/fluid-interop.md` §3 |
| The same primitives for GSAP, framework-agnostic and attribute-driven | `assets/gsap/` (README inside) |
| The CSS, one folder: `animation.css` (both engines: smooth scroll, reduced-motion collapse, `@property --fill`) and `animation.gsap.css` (GSAP's pre-JS resting states) | `assets/styles/animation/` (README inside) → the project's `src/styles/animation/` |
| Static motion audit, runtime reveal and scene verifier, real-smooth-scroll anchor check | `scripts/{audit-motion,verify-motion,anchor-check}.mjs` |

Copy the prepared artifacts; do not rewrite them from memory. They carry measured numbers and
comment trails that a from-scratch rewrite loses.

## Workflow

### 1. Preflight: inspect first, then ask only what you cannot infer

Read `package.json` (`motion`/`framer-motion`, `gsap`, `lenis`), grep for `ScrollTrigger`,
`pin: true`, `new Lenis`, header scroll listeners and existing entrance libraries, count the videos,
and check for a `fluid.config.json`. Then settle the decisions in `references/preflight.md`, each of
which has a default:

- **Engine:** Motion (`motion/react`) in React projects; GSAP otherwise, or for timeline-heavy or
  SplitText-quality work. One engine per element.
- **Smooth scroll:** never add Lenis or any scroll hijack. If one already runs, that's a
  keep/adapt/replace question (below), not a removal.
- **Scroll-driven scene:** none by default; at most one per page.
- **Header:** a transparent fixed header whose ink follows the section underneath.
- **Existing motion (brownfield):** keep, adapt or replace each existing header animation, GSAP
  timeline and Lenis setup. The default is keep.

Batch the open questions into one message. Record the answers in `MOTION.md` (or the project's
`FLUID.md` if the `fluid-design` skill keeps one).

### 2. Triage every animation by its clock

Before writing any animation, ask **who supplies time** (`references/motion-architecture.md` §3).
Trigger is the default. Scroll is a deliberate promotion that costs a runway, a pin and a perf slot:
use it when the reader should *drive* the motion, not because the motion is elaborate. Media is the
most expensive. Above the fold, use trigger only.

### 3. Install the foundation

1. Copy the engine folder into the project: `assets/react-motion/` or `assets/gsap/`. Follow its
   README. React: mount `MotionProvider` once at the root (`LazyMotion strict`, so write `m.div`,
   never `motion.div`). GSAP: call `initFluidMotion()` once.
2. Copy `assets/styles/animation/` to `src/styles/animation/`, beside fluid-design's `src/styles/fluid/`
   (React: delete `animation.gsap.css`). Import `animation.css` once, after your reset and after
   `fluid.css`; with Tailwind v4, into `layer(base)`. It holds `scroll-behavior: smooth` (reset
   under reduced motion; the file notes Next.js's `data-scroll-behavior`), the reduced-motion
   collapse of any scroll scene, and `@property --fill`. GSAP: import `animation.gsap.css` right
   after it, before any page content. The folder's README has the import lines per stack.
3. Put the `<noscript>` rule in the document `<head>`, not in a stylesheet. Without it, a reader
   whose JS failed gets a permanently blank page below the hero:
   ```html
   <noscript><style>
     [data-stage-item] { opacity: 1 !important; transform: none !important; }
     [data-stage-veil] { display: none !important; }
   </style></noscript>
   ```
4. Set the engage breakpoint constant (`ENGAGE_BREAKPOINT_PX` in React, `ENGAGE_PX` in GSAP) from
   the fluid config if there is one, otherwise from the site's desktop breakpoint
   (`references/fluid-interop.md` §1).
5. Set `overscroll-behavior: none` on `<html>` if the page has a scroll scene.

### 4. Build entrances

`Stage`/`StageItem` (or `data-stage`/`data-stage-item`): translate plus opacity on the measured
`entrance` curve (1.3s, `cubic-bezier(0.15, 0.6, 0.2, 1)`) and the separately clocked
`entranceFade`.

- **One stage per arrival.** A stage fires on its own top edge, so copy at the top and a mark on the
  baseline are two stages.
- Trigger lines use `margin` (`REVEAL_TRIGGER`, `PAGE_END_TRIGGER` for the last group,
  `AT_REST_TRIGGER` under a scroll well), **never a fractional `amount`**, which can't be satisfied
  on content taller than the viewport and leaves phones blank.
- Distances go in CSS variables on the item (`[--hero-lift:20px] lg:[--hero-lift:24px]`), in fixed
  px. Centre an item with `translate`, never `transform`. On the GSAP port only a plain % survives
  there: GSAP folds `translate` into its transform and freezes px/`calc()` values
  (`references/motion-architecture.md` §7).
- Split line entrances at the authored breaks, one item per line.
- A stage item never gets its own `initial`/`animate`/trigger; the section stays a server component.

### 5. Build the one scene (only if the design has one)

Read `references/scroll-scenes.md` and `references/video.md` first.

- The pin pattern: measure the outer range wrapper; the sticky layer is `100lvh`, the content's
  cancelling margin is `-100lvh`, and no ancestor has `overflow-x: hidden` or an animated
  `transform`.
- N one-viewport acts put landmarks at 1/(N−1), so three acts give halves; thirds need N=4.
- Mode changes are latches with two thresholds, px tolerances and hysteresis as a ratio; state is
  written per transition, never per frame. Machines read raw progress; springs feed only visuals.
- Anything scroll-linked over the pin is written by hand (`FadeOnExit`), never bound through a
  declarative `style` prop.
- Copy sections riding over the pin paint no background and have no `overflow-hidden`.
- Mark empty pacing acts `data-scrub-spacer`. Scroll wells inside the pin take a `clamp`.

### 6. Media playback

- Scrub assets are **all-intra** (`keyint=1`) with `qcomp=1`; forward-only clips are not.
- Loops wrap on `requestVideoFrameCallback`, seeks are coalesced, seams are verified on the
  **encoded** file, and loop re-entry points get a forced keyframe.
- Every video is `muted playsInline` with a deliberate `preload`, IO-gated with a wide warm margin
  and a tight play margin, and never `.load()`ed on the warm tier.
- A sound-carrying video plays only from a click. After a tab sleeps, the scene rehydrates from
  scroll and never resumes in place.

### 7. Header theme

Mark every section that departs from the page's base ink with `data-header-theme` (and
`--header-theme` if it changes by breakpoint). Mount `useHeaderTheme` / `initHeaderTheme`. Give every
themed part one shared 200ms colour transition (`references/header-theme.md`). If a colour script
already exists, don't add a second writer.

### 8. Brownfield coexistence

Keep existing header animation and colour logic, GSAP timelines and Lenis unless the user asks
otherwise, and apply `references/brownfield-coexistence.md`: replace px `start`/`end` with functions
and refresh; never nest the scene in a GSAP `pin: true`; on a Lenis page turn `scroll-behavior:
smooth` off, wire Lenis to `ScrollTrigger.update` and the ticker, and disable the scroll well or
route it through `lenis.scrollTo`.

### 9. Verify

- `node <skill>/scripts/audit-motion.mjs src`: fix every error.
- `node <skill>/scripts/verify-motion.mjs <url>`: every reveal reaches full opacity and each scene
  reports `data-motion-state` at progress 0, .25, .5, .75 and 1.
- `node <skill>/scripts/anchor-check.mjs <url>` if the page has anchors or a scroll well. The reveal
  check forces `scroll-behavior: auto`, so it proves nothing about real anchor jumps.
- If "the scrub holds frame one, then snaps", **rule out a stale stylesheet first**: close the tab
  and open a new one before reading scroll code (`references/verification.md` §4).
- Video compositing, the play watchdog and toolbar feedback can only be verified on a real device.
  Confirm the deployed build contains the fix before asking for a device test.

## Invariants: break one and the motion breaks

1. **Nothing animates a transform on a sticky ancestor, a scene wrapper or a video ancestor.** A
   transformed ancestor becomes the containing block, and the pin stops pinning. The same goes for a
   GSAP pin around the scene.
2. **A spring never feeds a threshold.** It settles across the line and flips true, false, true.
3. **One pinned, scrubbed scene per page.** Separately, count every scroll-linked effect (fades on
   exit, parallax, the scene itself): no more than 1–3 may intersect the viewport at once.
4. **One writer per property.** A declarative binding and a manual writer may share a node, never a
   property; a new system and an existing script never both write a header's colour or the scroll
   position.
5. **State is written per transition, never per frame.**
6. **Measure the range wrapper, never the sticky element**, and cancel the pin in the same unit it is
   sized in (`lvh`).
7. **Reveals trigger on `margin`, never on a fractional `amount`.**
8. **Every hand-written style write handles reduced motion itself**; the structural collapse lives in
   `animation.css` with `!important`.
9. **Only `transform` and `opacity` on scroll paths.** Keep the video's `translateZ(0)` anchor inside
   its composed transform string, and add no other permanent `will-change`.
10. **A component is extracted at its second consumer, never its first.**

## Reference map

| Read | When |
|---|---|
| `references/preflight.md` | always, first: detection, the decisions and their defaults, the keep/adapt/replace question |
| `references/motion-architecture.md` | any animation: triage by clock, stages, trigger lines, variants, measured curves, craft, reduced motion, SSR, what was rejected |
| `references/scroll-scenes.md` | pins, progress maths, latches, the three clocks, direct writes, the camera, scroll wells, riding sections |
| `references/video.md` | any `<video>`: all-intra, loop seams, rVFC, seeking, preload tiers, posters, autoplay, tab-sleep rehydrate, encoding |
| `references/header-theme.md` | header ink that follows the section underneath |
| `references/brownfield-coexistence.md` | a site that already has header scripts, GSAP, Lenis or an entrance library |
| `references/ios-safari-motion.md` | a scene or video misbehaving on iPhone or Safari |
| `references/performance.md` | before shipping motion; jank; budgets |
| `references/verification.md` | proving it works; the three bugs the harness caught; the scripts |
| `references/attribute-contract.md` | the exact name of a `data-*` attribute, a CSS variable or a motion constant |
| `references/fluid-interop.md` | a project that also uses `fluid-design`, or one without a fluid scale |

## Companion skill

`fluid-design` makes the desktop composition scale as one drawing from both viewport axes. It owns
layout, type, tokens and rendering, including iOS render fixes and media sizing. When both are
installed, each points to the other by name. They meet only at the fluid units, the engage
breakpoint and `--header-h` (`references/fluid-interop.md`).
