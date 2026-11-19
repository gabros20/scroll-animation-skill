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

- SKILL.md **Standalone context check** (before routing): the family's common core (look first,
  size it, ask at most four owner-only questions with recommended answers, decide as the expert,
  never block, record in the LEDGER) and four scroll-animation questions (the story in order, assets
  on hand, how much motion, the weakest device); technical choices are detected or stated as
  defaults to veto, never counted among the four (`preflight.md` "5. Asking the questions" now says
  so). Output eval `standalone-context-check`.

- `scrolly-steps`: `data-scrolly-fade="cover"` fades an opaque state in over the held outgoing one;
  a symmetric crossfade measured 0.52/0.48 midway, a quarter of the page showing through.
- `verify-motion.mjs`: `--channel` (a branded Chromium; Playwright's own before 1.57 decodes no
  H.264); `--scenes` fails a scene video that never reaches `readyState` 2, and shoots the pin
  entering and leaving.

### Fixed

- `media/video-controller.ts`: a prime refused in Low Power Mode retries inside the reader's next
  `touchend`, `pointerup`, `click` or key press while the scene runs, on every one of them until a frame
  shows (a tap's pointerup no longer uses up the touchend or click that carries the gesture, and a refusal
  that settles late or never no longer leaves the clip without a retry), and again after the clip loses its
  data, where it was never retried; a
  band seek the element still reports `seeking` after 700 ms (`STUCK_SEEK_MS`) is sent again instead
  of freezing the frame for the visit; a source that has shown a frame is never primed mid-seek (it
  played a held tail to the clip's end: the `holds` flake, 3 of 6 runs in Chrome, now 16 of 16).
- ScrubVideo (both engines): the poster is its own image (`<img data-scene-poster>`, in the video's box and camera),
  lifted only once the video presents the scroll's frame (`data-scene-media="live"` on the video), so the unlock no
  longer flashes a blank and frame 0; a refused play reads `data-scene-media="blocked"`; the prime runs at the warm
  margin where the network idles without a frame; and a tap anywhere before the scene runs unlocks it with `load()`
  inside the gesture. Under iOS Low Power Mode a video still can't move before a tap: WebKit refuses it by design.
- ScrubVideo after a lock or a hidden page (iPhone: the frame stopped following the scroll after a wake): the cover
  returns the moment the data goes (`emptied`), a seek left pending from before the hide no longer blocks the
  re-prime, a source still claiming data is primed once to prove it, a refusal reads `blocked` with the tap retry
  re-armed, and the retry runs until the video is live rather than until any frame exists. `debug()` adds `vis`,
  `wakes` and `lost`.
- ScrubVideo after a short lock (iPhone, a 1-2 s lock: the picture stopped following the scroll while `readyState`,
  `currentTime` and frame callbacks all read healthy). WebKit keeps the layer on its old frame until the element
  plays, and no page-visible signal reports it, so every return from hidden now runs a kick behind the poster: two
  frames, `play()`, the `playing` event as proof, `pause()`, a seek to the band's frame, the lift when it lands plus a
  frame. With no `playing` in 300 ms (`KICK_PLAYING_MS`) it retries once, then `load()` and a fresh prime, then
  `blocked` with the tap armed. It never clones the element and never plays mid-scrub. The load recovery's counter is
  now `loads`, and `debug()` adds `kicks`, `kickOk`, `kickFail` and `kicking`.
- ScrubVideo refreshed with the scene in view under Low Power Mode (iPhone: no tap unlocked it; `primes 2 refused 2`,
  `unlocked -`). The tap retry was skipped whenever the element read `paused` false, which a refused WebKit element can
  do for good. While `blocked`, every tap (a `touchend` that didn't pan, a click, a key) now calls `load()` and then
  the prime inside the event, starting at the band's frame; a touch that moved more than 10 px is ignored, and an
  earlier refusal (the tap's `pointerup`) no longer reads `blocked` over the play that followed. Folio's `?motion-debug`
  readout moves to the top (its "Tap to play" hint was under it) and adds `paused` and `unlocks`, and its act caption
  follows the scene's mode (on a phone the tail starts while the band's line is still on screen).
- ScrubVideo after that tap (iPhone: unlocked by play, `readyState` 4, the band seeks stuck, one frame callback, the
  poster never lifted and `data-scene-media` stayed empty). Covered over a frame with no lift for 600 ms
  (`LIFT_STALL_MS`), the controller now kicks behind the cover; a kick whose `seeked` never comes lifts once the seek
  has landed on the band's frame; after two stalled kicks the scene reads `blocked` for the next tap. The kick's
  last rung starts at the band's frame, not frame 0. `debug()` adds `stalls`.
- `verify-motion.mjs`: the entry slide is sampled ¾ visible, a `preload="none"` video never asked to
  load no longer fails the decode check, and a clip frozen through the scrub steps fails.

## [1.0.0] - 2026-09-23

The first skill, extracted from a production marketing site: triggered entrances, one pinned
scrubbed-video scene per page, looping video, header ink that follows the section underneath,
scroll wells, and brownfield coexistence with GSAP and Lenis, for Motion and GSAP, plus the
static audit, the runtime verifier and the anchor check.

[Unreleased]: https://github.com/gabros20/scroll-animation-skill/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/gabros20/scroll-animation-skill/commits/v1.0.0
