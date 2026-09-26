# scroll-animation, a Claude skill

A skill that teaches a coding agent to build web animation tied to page arrival and scroll, and to
debug it: **triggered entrances**, **one pinned scroll-driven scene per page**, **scrubbed and
looping video**, **scroll wells** that pull a section to rest, and **header ink that follows the
section underneath**. It ships the same primitives for **React + Motion** and for **GSAP**, sharing
one DOM attribute contract and one set of curves measured frame by frame from a reference capture.

It also covers the fixes this kind of work needs: all-intra encoding for scrubbing, frame-accurate
loop seams, preload tiers, tab-sleep recovery, iOS Safari's silent video pauses and toolbar feedback,
sticky pitfalls, per-frame performance budgets, and working next to existing GSAP, Lenis and header
scripts without two systems fighting over one property.

The whole thing is extracted from a production marketing site whose motion layer was built three
times. Nearly every rule in `references/` records the bug it prevents and the measurement behind it.

## What's inside

```
skills/scroll-animation/           the skill: ./install.sh copies this folder into your skills directory
  SKILL.md                         workflow: preflight → triage by clock → foundation → entrances →
                                   the one scene → media → header theme → brownfield coexistence → verify
  references/                      the method and its reasons (preflight, motion architecture, scroll scenes,
                                   video, header theme, brownfield coexistence, iOS Safari motion,
                                   performance, verification, attribute contract, fluid interop)
  assets/
    motion/                  React + Motion primitives: Stage/StageItem/StageVeil, CountUp, FadeOnExit,
                                   ScrubStage, PullToCentre, InViewLoopVideo, useHeaderTheme, useFluidUnit
                                   (lib/fluid.ts: the fluid units as numbers)
    gsap/                          the same primitives for GSAP, framework-agnostic and attribute-driven,
                                   plus src/fluid.ts (fluidPx, fluidValue, fluidEnd) for scaled travel
    css/                 the CSS → a project's src/styles/animation/ (beside fluid-design's
                                   src/styles/fluid/): animation.css (both engines: smooth scroll,
                                   reduced-motion scene collapse, @property --fill and --scene-p) and
                                   animation.gsap.css (GSAP's pre-JS resting states)
  scripts/
    audit-motion.mjs               static scan for the silent motion failure modes (self-tested)
    verify-motion.mjs              Playwright: every reveal fires, scene state at progress 0…1
    anchor-check.mjs               Playwright: anchor links land under real smooth scrolling and scroll wells
  evals/evals.json                 test prompts used to validate the skill
tests/                             npm test: typechecks both engines, GSAP smoke page, scaled-travel
                                   distance check at four viewports, audit self-test
```

## Install

```bash
# Claude Code (user-level)
./install.sh claude            # or: codex, cursor, agents, all
# or project-level
cp -r skills/scroll-animation .claude/skills/scroll-animation
```

Then ask for what you want, for example "fade these sections in as they scroll into view", "pin the
hero and scrub the video with scroll", or "the reveal never fires on my phone". The skill runs a
short preflight (engine, any scroll scene, header behaviour, and on an existing site whether to keep,
adapt or replace its current animation) and records the answers in `MOTION.md` in your project.

To run the skill's own checks: `npm ci && npm run verify` from the repository root (ffmpeg and Playwright's Chromium are prerequisites; see CONTRIBUTING.md).

## The system in one paragraph

Sort every animation by who supplies time. **Trigger** is the default: a `Stage` fires once on
arrival and its items move on one tick, translate plus opacity, a 1.3s move on
`cubic-bezier(0.15, 0.6, 0.2, 1)` with a separately clocked 0.17s fade, trigger lines set by
`rootMargin` and never by a visibility fraction. **Scroll** is a deliberate promotion, allowed once per
page: a CSS-sticky pin in `lvh` over a measured range wrapper, mode changes as latches with
hysteresis, springs only on visuals, and every value over the pin written by hand. **Media** is the
most expensive: an all-intra video whose loops wrap on `requestVideoFrameCallback` and whose state
is always re-derived from scroll. Read `scroll-animation/references/motion-architecture.md` for why
each of those choices is what it is.

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
