# scroll-animation, a Claude skill

A skill that teaches a coding agent to build scroll-driven and arrival-driven animation for editorial and creative
sites, and to debug it: **reveals and split text**, **CSS scroll effects**, **pinned scenes and rails**, **scrubbed
and looping video**, **scrollytelling**, **header ink**, **page transitions** and **smooth scroll**, in CSS, Motion
and GSAP, with the iOS Safari, accessibility and performance fixes this work needs.

It ships tested, copy-and-own blocks (40 of them, `scroll-animation list`), the references that explain every
decision, and a CLI that copies blocks into your project, prepares media and checks the result in a real browser.
Nearly every rule in `references/` records the bug it prevents and the measurement behind it.

## What's new in 2.2

- **The page lifecycle.** One owner (`page.ts`) answers "is this page ready to animate" for the first load and
  for every route change. Each visit (`load`, `push`, `traverse`, `restore`) and its phase
  (`pending → running → tail → settled`) are written on `<html>`, and blocks read them. Holds with caps keep a visit
  `pending` while the router places the scroll, a view transition runs, fonts land or a loader shows. Costly starts
  (a canvas, video, loops, embeds) wait for `settled`, one per task. On React, `<PageLifecycle>` sits anywhere in
  the root layout. Without the lifecycle on the page, blocks behave as before.
- **Entrances never fire off screen or under a crossfade.** After a link from a scrolled page, back or forward,
  reveals play on screen, once. `verify-motion.mjs --nav` proves it in a real browser.
- **The scroll authority follows the router by rule**, so back and forward land without a glide, and the reader's
  place is kept in Firefox.
- **ScrollSmoother is legacy, opt-in only.** New builds scroll natively, with Lenis when desktop smoothing is
  wanted. ScrollSmoother transforms a content wrapper, which breaks sticky and fixed elements, jitters on iOS and
  fights scroll restoration; it stays for sites that already run it.
- **`scroll-animation remove`**, `verify-motion --font-swap` (layout shift when the web fonts land), and an act's
  copy that never overlaps the next act's.

See [CHANGELOG.md](CHANGELOG.md) for each release.

## What's inside

```
skills/scroll-animation/           the skill: ./install.sh copies this folder into your skills directory
  SKILL.md                         the router: the five clocks, the page lifecycle, the engine map,
                                   11 universal invariants, the workflow, the artifact contract
  references/                      the method and its reasons, one file per job: preflight, lifecycle,
                                   scroll authority, entrances, text, motion, gsap, craft, scenes,
                                   css scroll effects, layered visuals, video, sequences, webgl,
                                   page transitions, scrollytelling, accessibility, brownfield
                                   coexistence, iOS Safari, performance, verification, sources
  assets/                          the blocks, copied by the CLI into src/animation/ (same layout)
    *.ts                           the engine-free cores: page (the lifecycle), entrance-signal, reveal,
                                   scene, split-words, count-up, header-theme, scroll-well, scrolly-steps,
                                   view-transitions, preloader, render-bridge, config.ts, scale.ts
    motion/                        React + Motion: Reveal, SplitWords, CountUp, PinnedScene, ScrubVideo,
                                   FrameSequence, LoopVideo, ScrollySteps, LayoutMorph, useHeaderTheme…
    gsap/                          the same jobs for GSAP pages, (element, options) functions with a
                                   destroy(), mount(routeRoot) for vanilla pages, and the recipes
    react/                         PageLifecycle, the lifecycle's route adapter for React
    smooth/                        the scroll authority: native, Lenis, ScrollSmoother (legacy), and
                                   SmoothScroll for a React route
    media/                         the video decoder, the camera maths, the image-sequence player
    css/                           animation.css (the pre-JS gate and failsafe, Lenis, print) and one
                                   stylesheet per block
  bin/scroll-animation             the CLI: list, add, remove, media probe|scrub|loop|sequence|poster
  scripts/tools/
    audit-motion.mjs               static scan for the silent motion failure modes (self-tested)
    verify-motion.mjs              Playwright: every reveal fires, scene state at progress 0…1,
                                   --nav (link, back, forward), --font-swap
    anchor-check.mjs               Playwright: anchor links land under smooth scrolling and scroll wells
examples/folio/                    a Next 16 example site (Expressive, Reading and Immersive routes) built
                                   from the blocks through the CLI
site/                              the storefront: a vanilla GSAP site in Vite
tests/                             typechecks for every engine, unit tests, the CLI, the audit self-test
                                   and the browser suites (reveal, text, hero, scenes, rails, video,
                                   view transitions, route hygiene…)
```

## Install

```bash
# Claude Code (user-level)
./install.sh claude            # or: codex, cursor, agents, all
# or project-level
cp -r skills/scroll-animation .claude/skills/scroll-animation
```

Then ask for what you want, for example "fade these sections in as they scroll into view", "pin the hero and scrub
the video with scroll", "add transitions between pages" or "the reveal never fires on my phone". On a new page or
site the skill runs a short preflight (the story, the assets, how much motion, the weakest device; engines,
smoothing and any existing animation are detected) and records the decisions and a scene ledger in
`ANIMATION.md` in your project.

To run the skill's own checks: `npm ci && npm run verify` from the repository root. ffmpeg and Playwright's Chromium
are prerequisites; the browser suites also run in WebKit and Firefox (see CONTRIBUTING.md).

## The system in one paragraph

Sort every animation by who supplies time. **Trigger** is the default: a reveal fires once on arrival, its items
moving on one tick on a measured curve, with trigger lines set by `rootMargin` and never by a visibility fraction.
**Scroll** is a deliberate promotion: a CSS-sticky pin in `lvh` over a measured range wrapper, mode changes as
latches with hysteresis, and every value over the pin written by hand; decoration runs on CSS scroll timelines.
**Media** is the most expensive: an all-intra video whose loops wrap on `requestVideoFrameCallback` and whose state is
always re-derived from scroll. **Render** is a canvas loop fed by the scroll authority's own tick, awake only when
visible. **Route** happens once per visit: the page lifecycle holds entrances until the scroll is placed and any
transition has ended, and starts costly work only once the entrance has settled. One scroll authority owns each page:
native, Lenis, or ScrollSmoother on a legacy site. Read `references/lifecycle.md`, `entrances.md`, `scenes.md` and
`video.md` for why each of those choices is what it is.

## Companion skill: fluid-design

[`fluid-design`](https://github.com/gabros20/fluid-design-skill) makes a desktop composition scale
as one drawing from both viewport axes, so it matches the design frame at every screen size. It owns
layout, type, tokens and rendering; this skill owns everything that moves. Each skill works alone.
Installed together, they meet only at the fluid units, the engage breakpoint and `--fluid-header-h`
(`scroll-animation/references/preflight.md` §3.6).

The integration examples live in that repository and use both skills together:

- [`examples/pizza-next`](https://github.com/gabros20/fluid-design-skill/tree/main/examples/pizza-next):
  Next 16 + Tailwind v4 + Motion, an editorial restaurant page.
- [`examples/pizza-vite-gsap`](https://github.com/gabros20/fluid-design-skill/tree/main/examples/pizza-vite-gsap):
  Vite + SCSS + GSAP, with a non-default fluid config.

## Credits and licence

MIT licensed (see `LICENSE`). The motion system, its measurements and the fixes behind them come from
a production build and were generalised for this skill. GSAP (including CustomEase) is free to use
under its own licence; Motion is MIT.
