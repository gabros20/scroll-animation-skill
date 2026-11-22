---
name: scroll-animation
description: 'Build, fix and review scroll-driven animation for editorial and creative sites: reveals, split text, CSS scroll effects, pinned scenes, rails, scrubbed and looping video, scrollytelling, header ink, page transitions and smooth scroll (Lenis, ScrollSmoother), in CSS, Motion and GSAP, with iOS Safari, accessibility and performance fixes. Use for "fade in on scroll", "pin this section", "scrub the video", "transitions between pages", GSAP, ScrollTrigger, Lenis or Motion questions, a scrub stuck on frame one, reveals that never fire, or scroll jank. Not for UI micro-interactions (→ frontend).'
---

# Scroll animation

## Mission and boundary

A motion system for editorial and creative pages. Every animation runs on a clock: **trigger** (plays once when
content arrives), **scroll** (a function of the reader's position in a range), **media** (follows what a video
decoder presents), **render** (a render loop) or **route** (once per navigation or page load). Name the clock first;
it decides the cost, the engine and which traps apply. Each job goes to the engine that does it best: CSS for
decoration, Motion for React section and scroll motion, GSAP for timelines and its plugins.

The skill ships tested, copy-and-own blocks (`scroll-animation list`), the references that explain every decision,
and a CLI that copies blocks, prepares media and checks the result. Most rules were paid for by a real bug, and the
references say which. Copy the
prepared blocks; never rewrite them from memory.

Not this skill: UI micro-interactions and component motion (buttons, toasts, menus, hovers, springs, gestures, layout
animation: `frontend` `ui-motion.md`, "Enter and exit" and "Hover and press", from `design`'s motion spec), layout
scaling (fluid-design's; this
skill reads its breakpoint, header height and units), colour systems.

## Standalone context check

Before producing anything the user will have to live with:
1. **Look first.** Read `digital-product/LEDGER.md` (Context), `digital-product/<pack>/`, upstream
   artifacts, the repo and this conversation. A fact found is never asked; a fact recorded is never
   re-asked.
2. **Size it.** Reversible and small → proceed, stating assumptions. New, costly or hard to undo →
   check.
3. **Ask only what the owner alone knows**, in their words: one round, at most four, highest
   leverage first, each with a recommended answer ("ok" accepts all). Two rounds at most.
4. **No or thin answers → decide as the expert.** Record each assumption with its basis and cost to
   reverse; prefer the reversible option; show the cheapest proof early.
5. **No way to ask → never block.** Proceed, and open the artifact with the assumptions and the
   answers that would change it most.
6. **Write it down.** Answers and assumptions go to the LEDGER's Context block.

This pack's questions (a pool — ask the top four that step 1 left open):
1. What should the scroll reveal — the story, in order? (Narrative briefs; otherwise propose the
   beats from the content.)
2. Which assets exist: video, 3D, stills, copy? (Detect first.)
3. How much motion: a calm reading page, an expressive one, or an immersive world? (Recommended:
   Reading, unless the brief asks for pinned storytelling, inertial scroll or 3D.)
4. What is the weakest device it must run well on? (Recommended: a mid-range phone in iOS Safari.)

Technical choices (smoothing, engines, existing motion) are detected, or stated as defaults to veto in
the same message, never counted among the four: [Preflight](references/preflight.md) "5. Asking the
questions".

## The page lifecycle

A page with a router, a busy hero or a loader adds `page` (`page-react` on React);
[lifecycle.md](references/lifecycle.md) is its home. One owner (`page.ts`) answers "is this page ready to animate"
per visit, on `<html>`; blocks read it. Without it they behave as before.

- **Visit:** one arrival, `data-visit-kind`: `load`, `push` (a link), `traverse` (back, forward), `restore`.
- **Phase:** `data-entrance`, `pending → running → tail → settled`, restarted per visit.
- **Server HTML:** `running` for a CSS first screen (it plays at first paint); `pending` when a script starts the
  entrance (a JS reveal, a loader); no attribute, no entrance.
- **Holds** keep a visit `pending`, each capped: the router placing the scroll, a view transition, a loader
  (`page.hold`). Held, CSS entrances pause and reveals wait.
- **Costly starts** (canvas, video, loops, embeds) wait for `settled`, one per task (`page.afterSettled`); fetch at
  once. A timeout counts from the entrance's start, never navigation start.
- **A push replays the first screen's entrance;** back and forward arrive settled.
- **Route changes:** `<PageLifecycle route={usePathname()} />` anywhere in the root layout (its own `<Suspense>`
  under Cache Components), or `page.begin()` elsewhere. It never scrolls: the router and the browser place the
  scroll, and the authority follows.
- **Check:** `verify-motion.mjs <url> --nav`.

## Route before acting

First pick the lane, then the reference:

| Lane | Path |
|---|---|
| Debug a symptom | [verification.md](references/verification.md) (§4 first: a stale stylesheet), then the reference it points to |
| Add one effect | the engine map below → `scroll-animation add <block>` → that block's reference |
| Build or redesign a page or site | [preflight.md](references/preflight.md) → `ANIMATION.md` with a scene ledger → blocks by clock → verify |

| User intent | Read | Contribution |
|---|---|---|
| Any new page, site or motion system | [preflight.md](references/preflight.md) | profile, authority per route, engines, budgets, `ANIMATION.md` |
| Smooth scroll; Lenis or ScrollSmoother present; anchors or modals under a smoother | [scroll-authority.md](references/scroll-authority.md) | the owner per route, one clock, what each owner breaks |
| A busy hero; any client-side router; entrances under a page transition, off screen after a link or again on back; a navigation that glides, lands wrong or leaves triggers stale | [lifecycle.md](references/lifecycle.md) | the contract, first load, the hero budget, route change, holds, the clock, migrating from `<RouteChange>` |
| Page transitions, a shared element from card to detail page, a grid opening in place, a preloader | [page-transitions.md](references/page-transitions.md) | the tool per router, `view-transitions`, Flip and `layoutId`, preloaders |
| Scrollytelling: a sticky graphic or chart beside text steps, a data story or visual essay | [scrollytelling.md](references/scrollytelling.md) | story beats, techniques and layouts mapped to blocks, `scrolly-steps`, phones |
| Content that animates in (sections, cards, images, a count-up) | [entrances.md](references/entrances.md) | triage by clock, `Reveal` per engine, trigger lines, replay, the veil, count-up, the gate |
| A headline or paragraph revealed by word or line | [text.md](references/text.md) | `SplitWords` on the server or SplitText below the fold, fonts first, aria, React keys, CJK and Thai |
| Motion (React) code: `useScroll`, springs, `LazyMotion` | [motion.md](references/motion.md) | `m` under strict, live reduced motion, hand-written scroll styles, the `frame` driver |
| GSAP code: `useGSAP`, `mount`, section timelines, triggers that fire early or stack up, plugins | [gsap.md](references/gsap.md) | setup, cleanup per route, page order, the matchMedia trap, the 11 mistakes |
| Choreography, timing, taste; motion that feels generic | [craft.md](references/craft.md) | order, durations, eases, staggers, pacing, replay, one idea per viewport, anti-slop checks |
| A pinned or scrubbed section, stacked acts, a horizontal rail, a scroll well, copy riding over a pin | [scenes.md](references/scenes.md) | range wrapper, sticky or GSAP pin, acts, latches, camera, scaled travel, rails |
| CSS decoration on scroll: parallax, fades, a card stack, a marquee, a progress bar; `view()` trouble | [css-scroll-effects.md](references/css-scroll-effects.md) | `data-scroll-fx`, ranges, the Firefox fallback, each authority, reduced motion, `overflow: clip` |
| Layers: a layered hero, JS parallax, colour tracks, a velocity marquee, cursor media, drawn lines, blend text, header ink, stepped sections, particles | [layered-visuals.md](references/layered-visuals.md) | the cheapest engine per effect, the recipes, the header's IntersectionObserver probe |
| Any `<video>`: scrub, loop, conditional autoplay | [video.md](references/video.md) | encoding, loop seams, seeks, preload tiers, posters, pause controls |
| An image sequence on scroll, or Lottie or Rive driven by scroll | [sequences.md](references/sequences.md) | sequence or video, the frame manifest, decode window, byte budgets |
| 3D (three.js, R3F) moving with scroll in a pinned section; a canvas that lags the copy or leaks contexts | [webgl.md](references/webgl.md) | real-time or rendered, the 3d skill's boundary, `render-bridge` on the authority's tick |
| Reduced motion, auto-moving content, keyboard, no-JS, print | [accessibility.md](references/accessibility.md) | the alternate scene per engine, pause controls, focus, screen readers |
| A site that already animates (GSAP, Lenis, AOS) | [brownfield-coexistence.md](references/brownfield-coexistence.md) | keep, adapt or replace; one writer per property |
| A scene or video misbehaving in Safari | [ios-safari-motion.md](references/ios-safari-motion.md) | toolbar, pin units, play watchdog, mask sweeps |
| Jank, budgets | [performance.md](references/performance.md) | cost order, per-frame budgets, gating |
| Proving it works; "it doesn't fire / holds / snaps" | [verification.md](references/verification.md) | the harness, the scripts, device checks |
| A viewport-scaled layout (fluid-design) | [preflight.md](references/preflight.md) §3.6 | breakpoint, header and unit sources |
| Where a rule or number came from | [SOURCES.md](references/SOURCES.md) | provenance and licence per source |

## Engine map

| Clock | Job | Block (engine) |
|---|---|---|
| trigger | content entrance; a load veil only as a recorded exception | `reveal` (motion: `Reveal`/`RevealItem`/`RevealVeil`; gsap: `reveal`; agnostic: `mountReveals`) |
| route | the page lifecycle, and what blocks read from it | `page` (agnostic: `page`), `page-react` (`PageLifecycle`), `entrance-signal` (agnostic: `whenEntranceOpen`, `trackEntrance`; `Reveal`'s `entrance`, `{ entrance: true }`) |
| trigger | an above-the-fold headline, its words in from the first frame | `split-words` (motion: `SplitWords`, a Server Component; agnostic: `splitWordsHTML`) |
| trigger | a heading or paragraph revealed line by line below the fold | `split-reveal` (gsap: `splitReveal`, SplitText) |
| trigger | a number counting up | `count-up` (motion: `CountUp`; agnostic: `mountCountUps`) |
| scroll | parallax, fades, reading progress, sticky stack, marquee | `scroll-effects` (css: `data-scroll-fx`; decoration; `view()` is off under ScrollSmoother) |
| scroll | JS layers: parallax where CSS can't run, a colour track, drawn lines | recipes `parallax` (gsap: `parallax`; motion: `Parallax`), `colour-track` (gsap: `colourTrack`), `draw-on-scroll` (gsap: `drawOnScroll`) |
| render, trigger | a velocity marquee, pointer media, one section per notch | recipes `marquee-velocity` (gsap: `marqueeVelocity`), `cursor-media` (gsap: `cursorMedia`), `stepped-sections` (gsap: `steppedSections`) |
| scroll | header ink per section | `header-theme` (motion: `useHeaderTheme`; agnostic: `mountHeaderTheme`) |
| scroll | a horizontal rail of panels | `horizontal-rail` (gsap: `horizontalRail`, on `pinned-scene`) |
| scroll | a section pulled to rest | `scroll-well` (motion: `ScrollWell`; gsap: `scrollWell`; agnostic: `createScrollWell`; native scrolling only) |
| scroll | a pinned scene: stacked acts, a scroll-driven timeline | `pinned-scene` (motion: `PinnedScene`; gsap: `pinnedScene`) |
| render | a real-time 3D canvas in a pinned scene, fed by the pin (the 3D is the 3d skill's) | `render-bridge` (motion: `usePinnedSceneRender`; gsap: `pinnedSceneRender`; on `pinned-scene`) |
| media | a scrubbed video on a pinned scene | `scrub-video` (motion: `ScrubVideo`; gsap: `scrubVideo`) |
| media | an image sequence scrubbed on a canvas | `frame-sequence` (motion: `FrameSequence`; gsap: `frameSequence`) |
| media | an in-view background loop with a pause control | `loop-video` (motion: `LoopVideo`; gsap: `loopVideo`) |
| trigger | a sticky graphic beside scrolling steps (scrollytelling) | `scrolly-steps` (motion: `ScrollySteps`, `useScrollySteps`; agnostic: `mountScrollySteps`) |
| trigger | a change of view inside one route: grid to detail, reorder, filter | recipes `flip-transition` (gsap: `flipTransition`), `layout-morph` (motion: `LayoutMorph`, `Morph`) |
| route | a page change: crossfade, shared elements, slides | `view-transitions` (css: React's `<ViewTransition>` with the classes; agnostic: `transition`, `mountCrossDocumentTransitions`) |
| route | a first screen held until its assets load | recipe `preloader` (agnostic: `mountPreloader`) |
| — | scroll owner for a route | `smooth-lenis` + `smooth-react`; `smooth-smoother` is legacy, for a site already on ScrollSmoother (`createSmoother`) |
| — | foundation | `config`, `base-css`, `gsap-setup` (plus `mount` on a vanilla GSAP page) or `motion-provider` |

A route that loads GSAP uses GSAP for its entrances rather than adding Motion, and the reverse. One engine per element
and per scene.

## Universal invariants

Break one and the motion breaks:

1. **One scroll authority per page:** native, Lenis or ScrollSmoother. Two owners fight every frame.
2. **Coupled values share one tick, producer first** (GSAP ticker → Lenis → ScrollTrigger). A second loop on the same
   path is exactly one frame late.
3. **Smooth once; logic reads exact progress.** A spring or lerp settles across a threshold and flips it back and
   forth. Under a smoother, scrubs are `scrub: true`.
4. **State changes per transition, never per frame.** Per-frame paths write styles, refs or uniforms, never framework
   state; damping uses elapsed time, never a constant per-frame lerp.
5. **Never animate a transform on a pin, sticky, scene or video ancestor**, and never put `overflow: hidden` on one
   (use `clip`): the pin stops pinning.
6. **Measure the range wrapper, never the pinned element.** Pins use `lvh`. GSAP triggers are created in page order.
7. **Scroll paths write `transform` and `opacity`;** anything else is budgeted.
8. **Content reads without JavaScript, and the LCP element never waits for hydration.**
9. **Reduced motion is an alternate scene in every engine and API;** auto-moving content over 5 s can be paused.
10. **Per-frame work stops off-screen, in hidden tabs and in hidden routes;** heavy media is prepared at build time
    and probed, never assumed.
11. **With the lifecycle, nothing plays before the visit is `running`:** the router places the scroll after a page's
    layout effects.

## Core workflow

1. **Lane.** Debug and single-effect tasks skip to their reference; a page or site starts with preflight.
2. **Preflight.** Detect first, then settle profile, authority per route, engines, budgets and layout scale; write
   `ANIMATION.md` with a scene ledger (per section: clock, block, runway, reduced-motion alternative).
3. **Foundation.** `scroll-animation add config base-css` plus `gsap-setup` or `motion-provider`; import
   `css/animation.css`; put `GATE_SCRIPT` from `config.ts` in the document head; add the route's scroll authority.
   With a router, a busy hero or a loader: `add page page-react`, and `data-entrance` in the server HTML.
4. **Blocks by clock.** Trigger first; promote to scroll or media only where the reader should drive the motion.
   Media goes through `scroll-animation media probe|scrub|loop|sequence|poster` before it ships.
5. **Accessibility.** Build each ledger row's reduced-motion alternative, pause controls, focus handling.
6. **Verify.** `node <skill>/scripts/tools/audit-motion.mjs src`, then
   `verify-motion.mjs <url>` (and `--nav`) and, with anchors or a scroll well, `anchor-check.mjs <url>`. Rule out a stale
   stylesheet before debugging a scrub.

## Artifact contract

| Artifact | Where | Owner |
|---|---|---|
| Decisions and the scene ledger | `ANIMATION.md` at the project root | preflight |
| Blocks | `src/animation/` (same layout as `assets/`), recorded in `.scroll-animation.lock.json` | `scroll-animation add`; hand edits are yours: it keeps an edited `config.ts` and overwrites nothing else without `--force` |
| A block's markup and names | its file header: markup, `data-*` attributes, CSS variables, options, handle | the block; read it before wiring |
| Names and numbers | `src/animation/config.ts` | edit values there, never inside a block |
| The header's height | `--header-h` on `:root` (`var(--fluid-header-h)` on fluid-design) | the page sets it; anchors and sticky tops read it |
| Base CSS | `src/animation/css/animation.css`, imported once after the reset | every engine |
| The pre-JS gate | `GATE_SCRIPT` inline in `<head>` (CSP nonce; `suppressHydrationWarning` on `<html>` in React) | required for hidden entrance states |
| Scroll owner at runtime | `<html data-scroll-authority>` | stamped by the smooth blocks, never authored |

Agents run the CLI as `node <skill>/bin/scroll-animation <command>`.

## Completion and handoff

Done means: the audit reports no errors, `verify-motion` passes reveals, scene states and `--nav` at the ledger's
viewports, the reduced-motion run shows every alternative, and `ANIMATION.md` matches what shipped. Report which
checks ran and which remain (real iPhone and Android passes can't be proven headlessly). Hand layout problems to the
layout owner.
