# Preflight: settle the motion decisions before code

**Purpose:** Decide the profile, the scroll authority per route, the engines, the budgets and the layout scale
before writing motion, and record them with a scene ledger in `ANIMATION.md`.

**Read when:** you're building or redesigning a page or a site (the third lane), or a task would change a recorded
decision (a new engine, a smoother, a 3D scene).
**Skip when:** you're debugging one symptom (start at [verification.md](verification.md)), or adding one effect to a
project that already has `ANIMATION.md` and the effect fits its decisions.

**Inputs:** the project: `package.json`, the source, existing motion, media files, and the brief.
**Produces:** `ANIMATION.md` at the project root with the decisions and a scene ledger, plus one batched question
for anything detection can't answer.

## Contents

1. [Which lane you're in](#1-which-lane-youre-in)
2. [Detection pass](#2-detection-pass)
3. [The decisions](#3-the-decisions)
4. [ANIMATION.md and the scene ledger](#4-animationmd-and-the-scene-ledger)
5. [Asking the questions](#5-asking-the-questions)
6. [Traps](#traps)

## 1. Which lane you're in

| Task | Do this |
|---|---|
| Debug ("the pin jumps on iPhone", "the scrub holds frame one") | skip preflight; find the symptom in [verification.md](verification.md) |
| Add one effect ("fade these cards in") | read the decisions in `ANIMATION.md` if it exists, pick the block from the engine map in SKILL.md, add it; run the full preflight only if there is no `ANIMATION.md` and the effect needs a smoother, a pin or WebGL |
| Build or redesign a page or site | this whole file, before any code |

## 2. Detection pass

Read-only, about two minutes. Inspect first, ask second.

| Look at | Tells you |
|---|---|
| `package.json` | framework (`next` and its version, `astro`, `vite`, `nuxt`, `@sveltejs/kit`, none); `motion` or `framer-motion` (the same library; blocks import `motion/react`); `gsap`, `@gsap/react`; `lenis`, `@studio-freight/lenis` (the old name), `locomotive-scroll`; `three`, `@react-three/fiber`, `@react-three/drei`, `@14islands/r3f-scroll-rig`; `lottie-web`, `@lottiefiles/dotlottie-web`, `@rive-app/*`; `@barba/core`, `@unseenco/taxi`, `swup`; `aos` |
| `next.config.*` | `cacheComponents: true` means hidden routes stay mounted under `<Activity>`: every block must clean up on hide |
| grep `ScrollTrigger`, `scrollTrigger:`, `pin: true`, `ScrollSmoother`, `new Lenis`, `ReactLenis`, `data-aos`, `IntersectionObserver` | existing motion systems and who owns scrolling today |
| CSS: `scroll-behavior`, `scroll-snap-type`, `position: sticky`, `overflow-x: hidden`, `animation-timeline` | smooth-scroll conflicts, sticky elements, the overflow trap that kills pins and timelines |
| the header | fixed or sticky, transparent or opaque, any scroll listener that hides it or changes its colours |
| every `<video>`, its size and GOP (`scroll-animation media probe <file>`) | the playback work; whether a scrub candidate is all-intra |
| `fluid.config.json` or a length-per-design-px custom property in the CSS | the layout is viewport-scaled: §3.6 |

## 3. The decisions

Each has a default. Ask only when detection is inconclusive **and** the answer changes the output.

### 3.1 Profile

| | Reading | Expressive | Immersive |
|---|---|---|---|
| Looks like | magazines, product marketing, docs | studios, launches, award sites | WebGL-led brand worlds |
| Scroll authority | native | Lenis, or ScrollSmoother on GSAP-only pages | Lenis or ScrollSmoother |
| Engines | CSS + Motion (React) or CSS + GSAP core | GSAP timelines and plugins, Motion for React components, CSS decoration | Three/R3F + GSAP, Motion for React UI |
| Scenes | at most one pinned scene | several pinned acts, rails, sequences | one persistent world in chapters |
| Page transitions | none, or cross-document CSS | view transitions, shared elements | the canvas persists across routes |

Default: **Reading** unless the brief asks for pinned storytelling, inertial scroll or 3D. A profile only sets
defaults; a route may differ from the site (the journal stays Reading on an Expressive site).

### 3.2 Scroll authority, per route

Exactly one owner per page: native, Lenis or ScrollSmoother. Default by profile; the table of trade-offs is in
[scroll-authority.md](scroll-authority.md). Record it per route (or route group), because a reading route and a
cinematic home page often want different answers. **If the project already runs a smoother, that is a keep, adapt or
replace question (§3.5), not a default to override.**

### 3.3 Engines

CSS is always available. Add engines by job, not by habit:

- **Motion** in React projects for component and section motion: entrances, in-page shared elements, presence.
- **GSAP** for timeline choreography (a section with about four or more named spans on one ruler), SplitText,
  DrawSVG/MorphSVG, Flip in vanilla code, ScrollSmoother, and every non-React project. All plugins are free.
- **Three.js / R3F** only for a 3D scene or WebGL-enhanced images.
- **Bytes already paid:** when a route already loads GSAP, its entrances use GSAP rather than adding Motion, and the
  reverse. One engine per element, and one engine per scene.

### 3.4 Budgets

Record them; `scroll-animation verify` checks the deterministic ones.

- JS transferred per route (a number in kB, per profile).
- Pinned scenes per page and their total runway (in viewports).
- Media bytes per route: the scrub file, sequence frames, loops.
- The LCP element renders at first paint: never hidden until hydration.

### 3.5 Existing motion: keep, adapt or replace

On a site that already animates, decide per system (header script, GSAP timelines, Lenis or ScrollSmoother, an
entrance library): **keep** it and build around it (the default), **adapt** the parts that conflict, or **replace** it
(only when asked, or when it is the bug). The conflicts and fixes are in
[brownfield-coexistence.md](brownfield-coexistence.md). The rule behind all of them: never two writers on one
property, never two scroll owners.

### 3.6 Layout scale

If the layout scales with the viewport, motion distances must scale with it, and motion must switch at the layout's
breakpoint and offset by its header height.

- **fluid-design** (`fluid.config.json` present): in `src/animation/config.ts`, re-export `DESKTOP_QUERY` from the
  generated `fluid.ts` and set `SCALE = FLUID_DESIGN_SCALE`; in CSS, alias the header once:
  `:root { --header-h: var(--fluid-header-h) }`. Details in [fluid-interop.md](fluid-interop.md).
- **Another scaled unit** (a custom property holding one design px as a length): describe it in `SCALE.units`.
- **Plain px**: leave `SCALE = null`; `scaledPx(n)` returns `n`.

## 4. ANIMATION.md and the scene ledger

Write it at the project root before the first block. It is for people and agents; nothing parses it.

```md
# Animation

Profile: Expressive
Scroll authority: / → Lenis (gsap driver) · /journal/* → native
Engines: CSS, GSAP 3.15 (ScrollTrigger, SplitText), Motion 13 (journal reveals)
Budgets: JS ≤ 160 kB on / · ≤ 90 kB on /journal · 1 pinned scene on / (4 viewports) · scrub file ≤ 6 MB
Reduced motion: scenes collapse to their end state, loops show posters, smoothing off
Layout scale: fluid-design (DESKTOP_QUERY from fluid.ts, SCALE = FLUID_DESIGN_SCALE, --header-h aliased)
Existing motion: header colour script kept (drives data-theme); AOS replaced by Reveal

## Scene ledger

| # | Section | Clock | Block (engine) | Runway | Reduced motion |
|---|---|---|---|---|---|
| 1 | Hero | trigger | split-word hero (CSS, first paint) | none | text visible, no motion |
| 2 | Product film | media | ScrubVideo (GSAP) on PinnedScene | 4 viewports | poster, no pin |
| 3 | Work rail | scroll | horizontal-rail (GSAP) | track width | native horizontal scroller |
```

A section that wants the scroll clock names what the reader gains by driving it; otherwise it is a trigger.

## 5. Asking the questions

One batch, each with its default, only what detection couldn't settle:

> Before I set this up: (1) profile: Expressive (pinned film, rail, inertial scroll) with the journal kept as a plain
> reading page? (2) smoothing on the home page: Lenis, driven by GSAP's ticker; the journal stays native. (3) I found
> AOS on three pages: I'd replace it with the reveal block. (4) the hero clip is not all-intra; I'll re-encode it with
> `scroll-animation media scrub`. I'll go with these unless you say otherwise.

For existing motion, name what you found and propose the least invasive option; don't offer three choices per item.

## Traps

- [ ] Detection ran before any question was asked, and the questions went out as one batch with defaults.
- [ ] The lane was right: no full preflight for a one-effect task or a debug session.
- [ ] Exactly one scroll authority per route, recorded.
- [ ] Every existing motion system has a recorded keep, adapt or replace decision.
- [ ] On a scaled layout, `config.ts` uses the layout's breakpoint, header variable and units.
- [ ] `ANIMATION.md` exists with the scene ledger before the first block is added.
