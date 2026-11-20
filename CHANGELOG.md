# Changelog

All notable changes to `scroll-animation-skill` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

The version lives in four places that must agree: `package.json`, `.codex-plugin/plugin.json`,
the newest release heading below, and the release tag.

## [Unreleased]

### Changed

- Pinned scenes (both engines) write `data-scene-awake` on the root while awake, one write per transition, and the
  rail's track takes `will-change: transform` only then (and never under reduced motion). The track is as wide as
  every panel together; its layer was held for the whole visit, on screen or not. `performance.md` §10 updated.
- `config.ts` drops three tokens no block reads: `TRIGGERS.atRest` (an alias of `pageEnd`), `CURVES.roll` and
  `MOTION.roll` (and `EASES.roll` in `gsap/setup.ts`). A project's own copy keeps them until it re-copies; `craft.md`
  §4 keeps the measured label roll as a number.
- `scrolly-steps` writes `--step-p` on `[data-scrolly-graphic]` (the root without one), not on the root: the property
  inherits, so on the root every step's text restyled each frame a step progressed. Read it inside the graphic; CSS
  that read it outside the graphic now sees the registered initial `0`.
- `usePinnedScene().progress` and `PinnedScene`'s `progress` render argument are the scene's own MotionValue, no longer
  `useScroll`'s `scrollYProgress`: progress over the pin's box, set by hand on the main thread (never handed to a
  native timeline), 0 until the scene mounts, with `getVelocity()` following the scene's writes. Read it in an event
  as before; a value bound through `style` now updates on the main thread (`scenes.md` §1).
- `gsap/frame-sequence.ts` with its own `trigger` ends its ScrollTrigger at the range's travel over the sticky box
  holding the canvas, not `'bottom bottom'`; with no sticky box between them, `'bottom bottom'` as before. A caller's
  `scrollTrigger.end` still wins. `motion.md` §3 and `FrameSequence` point a pinned range at the scene's progress.
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

- `npm run generate:check` also checks the examples: every copy an example's `.scroll-animation.lock.json` records
  equals its asset and the lock's hash, so a block change that wasn't re-copied with `scroll-animation add`, or a
  hand edit, fails it.
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

- The Motion scene checks its cached box once the scroll rests (150 ms after the last `scrollend`), not at every
  `scrollend`: Chromium fires one after each instant programmatic scroll, so under Lenis every Motion scene read two
  rects a frame while smoothing. `tests/sequence.mjs` `scene`: 0 root reads over 60 such frames (120 before), one per
  scene at rest.
- Both parallax recipes (`gsap/parallax.ts`, `motion/Parallax.tsx`) cache each layer's height (GSAP at each refresh,
  Motion on mount and on a resize of the element or the window) instead of reading `offsetHeight` in the write: with
  N layers a frame was read, write, read, write, and every read after a write forced a style recalculation.
  `tests/recipes.mjs` `reads`: 0 height reads over 40 scrolled frames (110 and 82 before, two layers).
- `webgl.md` §5: the canvas slot's snippet gates the canvas on the scene's `onWarm` flag and reduced motion
  (`warm && !reduced`), as Folio's lab scene does. Gated on `!useReducedMotionLive()` alone, it mounted the canvas
  for one commit for a reduced-motion reader: the hook answers `false` in the hydration render.
- `css/animation.css` reserves the scrollbar gutter on `<html>` (`scrollbar-gutter: stable`): a modal's `stop()` hides
  the page's overflow, and on classic-scrollbar systems the scrollbar went with it, widening the page under the modal
  and firing the scenes' `<body>` ResizeObserver (a ScrollTrigger refresh during the modal's entrance).
- Lenis anchors (`createSmoothScroll`) focus the target without a scroll, so a skip link works: the next Tab continues
  from the target, as after a native fragment jump (a section gets `tabindex="-1"` while it holds focus). An Alt-click,
  `target="_blank"` and `download` links are left to the browser. `scroll-authority.md` §4: `pushState` never updates
  `:target`; style the landed section from a class.
- The scrub video's `destroy()` puts the element back as the markup had it: `data-scene-media` (it wrote `""`), the
  `muted` attribute (`defaultMuted`, which it sets for autoplay policies), the `muted`, `playsInline` and `loop`
  properties, and a `poster` attribute its poster image replaced. The source, the preload hint and a tier's poster stay
  (media state: a route shown again doesn't fetch the clip again). `tests/usegsap-teardown.mjs` `scrub-video` passes
  again (6 FAILs in Chromium), and two unit tests pin it.
- Pinned scenes (both engines) measure progress against the pin's own box: wrapper height minus the pin's `100lvh`,
  never `innerHeight`. On iOS `innerHeight` follows the toolbar, so the range was one toolbar longer while it showed,
  and on a GSAP page ScrollTrigger's cached `'bottom bottom'` (a `100vh` probe in 3.15) and the live rehydrate
  (`innerHeight`) used two rulers at once: each
  toolbar step rewrote a rail's `--rail-from`/`--rail-to` and moved its cards 4.5–10.3 px (50–120 px toolbar). The
  ScrollTrigger `end` is `+=` that range; Motion's scene takes `scrollY` as its tick and computes progress over a
  cached wrapper top (re-measured on a resize of the wrapper or `<body>`), and its `progress` is that value, not a
  `useScroll` offset. Desktop traces are unchanged (a `100lvh` pin is `innerHeight` tall there). `tests/rail.mjs`
  `toolbar` emulates the toolbar and checks the track holds.
- A height-only, toolbar-sized resize on touch (the same width, under a quarter of the height:
  `isChromeResize` in `scene.ts`, the `3d` skill's rule plus the scroll well's quarter) no longer rehydrates a scene,
  so the media and a canvas no longer snap and re-prime on every toolbar step. A resize no longer measures
  synchronously either: Safari can report the new `innerHeight` while layout holds the old units, and the Motion
  scene wrote the band from that read.
- `ScrollTrigger.refresh(true)` (safe: mid-scroll it waits for the scroll to end) on a content resize in
  `pinnedScene`'s `<body>` observer, the rail's track observer and `createSmoother`, so a lazy image decoding under
  the reader's finger no longer re-measures the page, or re-pins a `pin: 'gsap'` scene, mid-scroll.
- `createSmoother` lands a link's hash (`/page#section`): the browser's fragment jump lost the race with the smoother
  and the page stayed at the top. It jumps to the target once, after the first refresh, with a native anchor's inset.
  The `scrolly-steps` hash check is strict again under ScrollSmoother.
- Folio's article scrolly crossfades its opaque photographs with `data-scrolly-fade="cover"`: the page no longer
  shows through mid-fade on every step change.
- `css/scroll-effects.css`: the parallax composes with `replace`, not `add`. On an iPhone (iOS 26.6, Low Power
  Mode on or off) an additive scroll-driven translate flicked vertically at every change of scroll direction, while
  `replace` was smooth (device A/B). The drift now owns the element's `translate`: put an element's own offset on
  `transform`, which still applies, or on a wrapper. `tests/scroll-effects.mjs` checks that every scroll-driven effect
  composes with `replace`.
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
- ScrubVideo's tap recovery (iPhone: a white picture for about 0.5 s as the poster lifted, then a scrub that skipped
  frames through six stuck-seek resends). The metadata's rehydrate cut the tap's play before `playing`, so the reloaded
  element was lifted having painted and buffered nothing. A tap's `load()` now owes the kick: the cover stays until a
  `playing` and the band's landed seek. `debug()` adds `buf` (buffered ranges) and `preload`, and Folio's readout
  prints them.
- ScrubVideo's catch-up after that tap (iPhone: slow, and sometimes the video visibly played its way from the head to
  the parked frame). After the reload a `playing` proves the layer only on the band's frame; the kick seeks the band
  before it plays, in one direct seek; and a scene no loop owns pauses any play that starts while it is live.
- `verify-motion.mjs`: the entry slide is sampled ¾ visible, a `preload="none"` video never asked to
  load no longer fails the decode check, and a clip frozen through the scrub steps fails.

## [1.0.0] - 2026-09-23

The first skill, extracted from a production marketing site: triggered entrances, one pinned
scrubbed-video scene per page, looping video, header ink that follows the section underneath,
scroll wells, and brownfield coexistence with GSAP and Lenis, for Motion and GSAP, plus the
static audit, the runtime verifier and the anchor check.

[Unreleased]: https://github.com/gabros20/scroll-animation-skill/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/gabros20/scroll-animation-skill/commits/v1.0.0
