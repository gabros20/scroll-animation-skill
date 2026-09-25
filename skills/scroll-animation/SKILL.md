---
name: scroll-animation
description: Build, fix and review scroll-driven animation for editorial and creative websites: entrance reveals, a pinned scene with scrubbed video, looping video, header ink that follows the section underneath, and smooth scroll with Lenis or ScrollSmoother, in Motion (React) and GSAP, with the iOS Safari, video, accessibility and performance fixes they need. Use for "fade in on scroll", "pin this section", "scrub the video", "add smooth scroll", GSAP, ScrollTrigger, Lenis or Motion questions, a scrub stuck on frame one, reveals that never fire, or scroll jank. Not for UI micro-interactions.
---

# Scroll animation

## Mission and boundary

A motion system for editorial and creative pages. Every animation runs on one of four clocks: **trigger** (plays
once when content arrives), **scroll** (a function of the reader's position in a range), **media** (follows what a
video decoder presents) and **render** (a render loop). Name the clock first; it decides the cost, the engine and
which traps apply. Each job goes to the engine that does it best: CSS for decoration, Motion for React component and
section motion, GSAP for timelines and its plugins.

The skill ships tested, copy-and-own blocks (`scroll-animation list`), the references that explain every decision,
and a CLI that copies blocks, prepares media and checks the result. It was extracted from a production site whose
motion layer was built three times: most rules were paid for by a real bug, and the references say which. Copy the
prepared blocks; never rewrite them from memory.

Not this skill: UI micro-interactions (buttons, toasts, menus, hovers), layout scaling and viewport-unit sizing
(fluid-design's job; this skill reads its breakpoint, header height and units when a project uses it), colour systems.

## Route before acting

First pick the lane, then the reference:

| Lane | Path |
|---|---|
| Debug a symptom | [verification.md](references/verification.md) (§4 first: a stale stylesheet causes most "broken scrub" reports), then the one reference it points to |
| Add one effect | the engine map below → `scroll-animation add <block>` → that block's reference |
| Build or redesign a page or site | [preflight.md](references/preflight.md) → `ANIMATION.md` with a scene ledger → blocks by clock → verify |

| User intent | Read | Contribution |
|---|---|---|
| Any new page, site or motion system | [preflight.md](references/preflight.md) | profile, scroll authority per route, engines, budgets, layout scale, `ANIMATION.md` |
| Smooth or inertial scroll; Lenis or ScrollSmoother already present; anchors or modals under a smoother | [scroll-authority.md](references/scroll-authority.md) | the owner per route, one clock, what each owner breaks |
| Content that animates in (sections, cards, headlines, stats) | [motion-architecture.md](references/motion-architecture.md) | triage by clock, entrance wiring, trigger lines, measured curves, SSR |
| A pinned or scrubbed section, stacked acts, a scroll well, copy riding over a pin | [scenes.md](references/scenes.md) | range wrapper, sticky or GSAP pin, acts, latches, manual writes, camera, scaled travel |
| Any `<video>`: scrub, loop, conditional autoplay | [video.md](references/video.md) | encoding, loop seams, seeks, preload tiers, posters, serving, pause controls, tab-sleep recovery |
| An image sequence on scroll (Apple-style), or Lottie or Rive driven by scroll | [sequences.md](references/sequences.md) | sequence or video, the frame manifest, decode window, byte budgets |
| Reduced motion, auto-moving content, keyboard, split text, no-JS, print | [accessibility.md](references/accessibility.md) | the alternate scene per engine, pause controls, focus, screen readers |
| A transparent fixed header over light and dark sections | [header-theme.md](references/header-theme.md) | the probe, the marks, one shared transition |
| A site that already animates (header scripts, GSAP, Lenis, AOS) | [brownfield-coexistence.md](references/brownfield-coexistence.md) | keep, adapt or replace; one writer per property |
| A scene or video misbehaving on iPhone or Safari | [ios-safari-motion.md](references/ios-safari-motion.md) | toolbar, pin units, play watchdog, mask sweeps |
| Jank, budgets, before shipping | [performance.md](references/performance.md) | cost order, per-frame budgets, gating |
| Proving it works; any "it doesn't fire / holds / snaps" | [verification.md](references/verification.md) | the harness, the scripts, device checks |
| An exact attribute, CSS variable or constant name | [attribute-contract.md](references/attribute-contract.md) | the names both engines share |
| A viewport-scaled layout (fluid-design or similar) | [preflight.md](references/preflight.md) §3.6 | breakpoint, header and unit sources; scaled travel is `scenes.md` §12 |

## Engine map

| Clock | Job | Block (engine) |
|---|---|---|
| trigger | content entrance, load veil | `stage` (motion: `Stage`/`StageItem`; gsap: `data-stage`) |
| trigger | a number counting up | `count-up` (motion, gsap) |
| scroll | copy fading as it leaves over a pin | `fade-on-exit` (motion, gsap) |
| scroll | header ink per section | `header-theme` (motion, gsap) |
| scroll | a section pulled to rest | `scroll-well` (motion, gsap; not under a smoother) |
| scroll | a pinned scene: stacked acts, a scroll-driven timeline | `pinned-scene` (motion: `PinnedScene`; gsap: `pinnedScene`) |
| media | a scrubbed video on a pinned scene | `scrub-video` (motion: `ScrubVideo`; gsap: `scrubVideo`) |
| media | an image sequence scrubbed on a canvas | `frame-sequence` (motion: `FrameSequence`; gsap: `frameSequence`) |
| media | an in-view background loop with a pause control | `loop-video` (motion: `LoopVideo`; gsap: `loopVideo`) |
| — | scroll owner for a route | `smooth-lenis` + `smooth-react`, or `smooth-smoother` (GSAP-only pages) |
| — | foundation | `config`, `base-css`, `gsap-setup` or `motion-provider` |

When a route already loads GSAP, its entrances use GSAP rather than adding Motion, and the reverse. One engine per
element and per scene.

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

## Core workflow

1. **Lane.** Debug and single-effect tasks skip to their reference. A page or site starts with preflight.
2. **Preflight.** Detect first, then settle profile, authority per route, engines, budgets and layout scale; write
   `ANIMATION.md` with a scene ledger (one row per section: clock, block, runway, reduced-motion alternative).
3. **Foundation.** `scroll-animation add config base-css` plus `gsap-setup` or `motion-provider`; import
   `css/animation.css`; put `GATE_SCRIPT` from `config.ts` in the document head; add the route's scroll authority.
4. **Blocks by clock.** Trigger first; promote to scroll or media only where the reader should drive the motion.
   Media goes through `scroll-animation media probe|scrub|loop|sequence|poster` before it ships.
5. **Accessibility.** Build each ledger row's reduced-motion alternative, pause controls, focus handling.
6. **Verify.** `node <skill>/scripts/tools/audit-motion.mjs src` (fix every error), then
   `verify-motion.mjs <url>` and, with anchors or a scroll well, `anchor-check.mjs <url>`. Rule out a stale
   stylesheet before debugging a scrub.

## Artifact contract

| Artifact | Where | Owner |
|---|---|---|
| Decisions and the scene ledger | `ANIMATION.md` at the project root | preflight; updated when a decision changes |
| Blocks | `src/animation/` (same layout as `assets/`), recorded in `.scroll-animation.lock.json` | `scroll-animation add`; hand edits are yours, and `add` refuses to overwrite them without `--force` |
| Names and numbers | `src/animation/config.ts` | edit values there, never inside a block |
| Base CSS | `src/animation/css/animation.css`, imported once after the reset | shared by every engine |
| The pre-JS gate | `GATE_SCRIPT` inline in `<head>` (with the CSP nonce; `suppressHydrationWarning` on `<html>` in React) | required for hidden entrance states |
| Scroll owner at runtime | `<html data-scroll-authority>` | stamped by the smooth blocks, never authored |

Agents run the CLI as `node <skill>/bin/scroll-animation <command>`; people run `npx scroll-animation-cli <command>`
once it is published.

## Completion and handoff

Done means: the audit reports no errors, `verify-motion` passes reveals and scene states at the ledger's viewports,
the reduced-motion run shows every alternative, and `ANIMATION.md` matches what shipped. Report which checks ran and
which remain (real iPhone and Android passes for video, pins and smoothing can't be proven headlessly). Hand layout
problems (sizing, fluid scale, a stylesheet stale after a restart) to the layout owner.
