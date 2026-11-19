# Changelog

All notable changes to `scroll-animation-skill` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

The version lives in four places that must agree: `package.json`, `.codex-plugin/plugin.json`,
the newest release heading below, and the release tag.

## [Unreleased]

### Changed

- The repository moved onto the skill template: the runtime pack is `skills/scroll-animation/`,
  with the gate scripts, evaluation layers, installer and CI around it. v2 (a multi-engine rebuild
  for editorial and creative sites) is in progress on this line.
- Design-fold: craft from outside motion skills folded into the references, each checked against
  the pack's code and measurements. Verification gains path independence, dead scroll, the slides,
  contrast over moving media, a route-cycle probe and a device diagnostic; layered visuals gain a
  layered hero with pointer depth, a particle layer's scroll budget (the renderer is the 3d skill's)
  and a progress line through steps; scenes gain the
  runway floor, rail travel per width and jumps across scenes; video gains a portrait mobile tier
  and footage preparation; craft gains overlapping beats, one entrance per container, the peak and
  the ending. `performance.md` §4 now says what Motion 14.2 changed: time-based `x`/`y`/`scale`
  are accelerated, scroll-linked values still run on the main thread. UI micro-interactions and
  component motion point at the `frontend` skill. New `references/SOURCES.md` records provenance.

### Added

- `scrolly-steps`: `data-scrolly-fade="cover"` fades an opaque state in over the held outgoing one;
  a symmetric crossfade measured 0.52/0.48 midway, a quarter of the page showing through.
- `verify-motion.mjs`: `--channel` (a branded Chromium; Playwright's own before 1.57 decodes no
  H.264); `--scenes` fails a scene video that never reaches `readyState` 2, and shoots the pin
  entering and leaving.

### Fixed

- `media/video-controller.ts`: a prime refused in Low Power Mode retries inside the reader's next
  `touchend`, `pointerup`, `click` or key press, where it was never retried; a band seek with no
  `seeked` after 700 ms (`STUCK_SEEK_MS`) is sent again instead of freezing the frame for the visit.

## [1.0.0] - 2026-09-23

The first skill, extracted from a production marketing site: triggered entrances, one pinned
scrubbed-video scene per page, looping video, header ink that follows the section underneath,
scroll wells, and brownfield coexistence with GSAP and Lenis, for Motion and GSAP, plus the
static audit, the runtime verifier and the anchor check.

[Unreleased]: https://github.com/gabros20/scroll-animation-skill/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/gabros20/scroll-animation-skill/commits/v1.0.0
