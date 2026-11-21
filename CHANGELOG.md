# Changelog

All notable changes to `scroll-animation-skill` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

The version lives in four places that must agree: `package.json`, `.codex-plugin/plugin.json`,
the newest release heading below, and the release tag.

## [Unreleased]

### Added
- `test:route-hygiene` checks arrival (F2): Home scrolled to 2400 or 3000 px, then a link to a page of
  `gsap/reveal.ts` items and `split-reveal` headings, native and under ScrollSmoother, with and without Cache
  Components. No entrance starts with its item outside the viewport, nothing below the fold has played on arrival,
  and every item plays on screen as the page is scrolled through. `--only sequence,arrival` runs one group.
- `test:view-transitions` checks that split words committed under the root crossfade are paused while it runs and
  still fade in from 0 once it ends. `test:cli` checks that `add` keeps a require's hand edit and refuses one that
  dropped a name the blocks import.

### Changed
- entrances §5, "A callback is not an arrival", is the one home for the on-screen rule (text §3 points to it);
  page-transitions §4 and `smooth/route.ts` no longer say route blocks measure themselves as they are created
  without adding that they are created before the router places the scroll; verification §7 has the symptom
  "entrances skip after following a link from a scrolled page". Folio's `smooth/route.ts` re-synced.
- page-transitions §2: an entrance waits for the crossfade, and CSS can't hold transitions, Motion or GSAP.
- scroll-authority §1 states the Lenis-or-ScrollSmoother trade-off for a GSAP-only route where Safari or 120 Hz
  screens matter: Lenis's measured 60 fps cap in Safari, ScrollSmoother's unmeasured rate on the same ticker, and
  native touch scrolling, where a GSAP pin or scrub lags iOS's compositor (skip ScrollSmoother when
  `ScrollTrigger.isTouch === 1`; CSS sticky and scroll timelines there). Preflight §3.2 asks for it before either is
  chosen.
- verification §6: a phone jitter report is read from a screen recording cut into ffmpeg contact sheets.
- css-scroll-effects §3: each keyframe animates one property, so Lightning CSS can't merge them into a `transform`.
- scenes §11: a contrast scrim is anchored to the picture, never to the moving type.

### Fixed
- `gsap/reveal.ts` and `split-reveal` play an entrance only if its item is on screen as it would start
  (`bottom > 0 && top < innerHeight`), and otherwise keep its trigger until the reader reaches it. On a client
  navigation the page's `useGSAP` runs before Next places the scroll (an ancestor's layout effect), so the triggers
  were created at the previous page's `scrollY`: an item in that band played at once, and one above it fired
  `onEnterBack` on the jump to the top and passed the old `progress < 1` test. 4 to 12 of the check's 13 entrances
  were spent below the fold before the reader got there. Motion's `Reveal` and `mountReveals` observe with
  IntersectionObserver, which reports after layout, and are unaffected.
- `css/split.css` pauses split words under `html:active-view-transition` (Chromium 125+, Safari 18+, Firefox 144+;
  dropped elsewhere): a route's heading committed under the 0.24 s root crossfade ran its 0.17 s fade beneath it and
  surfaced already opaque. Folio's copy re-synced.
- `scroll-animation add` no longer refuses over a hand-edited file of a require (`config.ts`, which the skill tells
  you to edit for a fluid layout): it keeps the file and its lock record, and says so, unless a file it copies imports
  a name the edit dropped. The requested blocks' own files are still refused without `--force`.

## [2.1.1] - 2026-11-21

### Changed
- CI runs `test:hero` in Chromium only until it has passed in WebKit and Firefox locally, which it never has
  (`verify:all` mirrors that; `-- --browsers chromium,webkit,firefox` runs all three). In 2.1.0 a WebKit or
  Firefox failure in that step could fail the CI blocks job.
- `test:hero` measures `tail`'s promise on every publisher: the first frame after it, the moving type sits within
  1 px of rest (0.15–0.35 px in Chromium). Where the engine has Long Animation Frames (Chromium), no long frame
  falls between `tail` and `settled`, the window a live canvas reveals in (its rAF p95 is reported). A unit test
  pins that a tracker stopped before it settles publishes nothing more.

## [2.1.0] - 2026-11-21

### Added

- `entrance-signal` (agnostic): the page-load entrance's clock on the DOM, so a busy hero's costly starts wait on it
  instead of fixed times. `data-entrance="pending|running|tail|settled"` on a scope (default `<html>`; the author
  writes `pending` into the server HTML, and no attribute means no entrance) and a bubbling `entrance:phase` event,
  dispatched after the attribute is written, never backwards. `publishEntrance(phase, scope?)`;
  `trackEntrance(root, { scope, tailAt })` waits on `getAnimations({ subtree: true })` (running, finite,
  document-timeline animations: loops, paused, scroll-driven and the failsafe's own are left out), with `tail` at
  `TAIL_AT` (0.8) of the last-ending animation. Reduced motion and a fired failsafe publish `settled` at once; a
  teardown publishes nothing (StrictMode). The 3d skill's canvas consumes it from the DOM alone.
- The reveal engines publish it: Motion `<Reveal entrance>`, `reveal(root, { entrance: true })`,
  `mountReveals(root, { entrance: true })` (through `trackEntrance`); `SplitWords`/`css/split.css` through
  `trackEntrance(heading)` from a client effect.
- `tests/hero.mjs` (`npm run test:hero`, in `verify:all` and the CI blocks job): a busy hero per publisher with a stub
  live canvas, a blurred nav and a loop strip. It checks the phase order, settled only once landed, the playing
  marker and no `will-change` after, the stub's stages against the phases (early and late), the strip held until
  settled, the nav never moving, and settled at once under reduced motion and the failsafe. A unit test covers
  `publishEntrance`.
- References: `performance.md` §14 the hero budget (compositor-only while `running`, costly starts queued on
  `settled` one per task with timeouts, fonts before the entrance, one tick, 60 fps on 120 Hz, Long Animation
  Frames); `entrances.md` §11 the hero entrance and its signal; `webgl.md` §8 "On a trigger or route clock" (the
  canvas's prepare, reveal and run cues); `ios-safari-motion.md` §8 a blurred element during an entrance (the Safari
  streak's cause marked unverified; the Backdrop Root rule), linked from `css-scroll-effects.md`; `verification.md`
  §7 rows for stepping at the settle, the backdrop streak and a scene lagging during the entrance; a cue row in the
  `ANIMATION.md` ledger template; a `busy-hero` traversal eval.

### Changed

- Reveal holds a layer only while a group plays: every engine marks the group `data-reveal-playing` for its
  entrance, and `css/reveal.css` §5 gives only its rising and scaling items `will-change: transform`, dropped when
  the last item lands. Motion before 14.2 drives `y` and `scale` from JavaScript (motion-dom 13.4 accelerates only
  `opacity`, `clipPath`, `filter`, `transform` and `backgroundColor`) and its automatic `will-change` is dormant, so
  display type could step in whole pixels as it settled.
- `performance.md` §10 rewritten: before Motion 14.2 `x`/`y` are never accelerated (14.2's `TransformAnimation`
  joins time-based ones into a WAAPI `transform` where the browser has CSS `linear()`, read in motion-dom 14.2, as
  §4 already said), the scoped rule, the layer-memory arithmetic (a 400 × 120 word at DPR 3 is about 1.7 MB).
  `entrances.md` and `SKILL.md`: a hero entrance runs on the compositor (CSS, or Motion's `transform` string; no
  `x`/`y` on display type before 14.2). `craft.md` §5: a move-only entrance is for items at t≈0 or masked; delayed
  items fade.
- The clock: a consumer's failsafe counts from navigation start (`performance.now()`), never from its own mount,
  which runs at hydration, hundreds of ms after the entrance began at first paint (`entrances.md` §11,
  `performance.md` §14, `webgl.md` §8, the fixture's stub consumer). The publisher's own timers already run on the
  animation's clock (`entrance-signal.ts` says so).
- `entrances.md` §11: cues on the entrance's clock (count from navigation start; never reveal a cued layer through
  Suspense, which React 19 holds ~300 ms after its fallback), a heavy DOM layer's stages, a teardown publishing
  nothing, and a CSS entrance's server HTML may say `running`; `page-transitions.md` §7 points there. The
  blurred-element rule points to its home in `ios-safari-motion.md` §8, and `webgl.md` §8 to the 3d skill's stages
  instead of restating them.
- `performance.md` §11: a blur placeholder is a filter blur over the image's whole box, never on a full-bleed or hero
  image (a measured production hero: ~3.5 s of raster and two ~360 ms frames, none without it); §14: a heavy
  client-only component mounts one composition, picked by `matchMedia`. `verification.md`: page-load jank by
  attribution (§1), a server that stopped compiling CSS (§4), and rows for a raster freeze, a late cue and copy
  vanishing over a background layer (§7). `ios-safari-motion.md` §9: copy under a background canvas or video after
  its entrance in Safari (a stacking level on the copy's wrapper; cause untraced). `preflight.md` §3.2: name Lenis's
  Safari frame-rate cost before choosing it for a Reading route. `css-scroll-effects.md` §2: the hero lift on
  `scroll(root)`, with its reduced-motion reset pointing to `accessibility.md` §2 to keep the file's budget.
  `css/split.css`: the var() in its keyframes stays (a theory that Safari won't composite it is unproven).

## [2.0.1] - 2026-11-20

### Fixed

- `SKILL.md` frontmatter: the description is quoted, so strict YAML parsers (the `skills` CLI) accept it; an
  unquoted `: ` inside it read as a nested mapping and the skill was skipped on install.

## [2.0.0] - 2026-11-20

### Known issues

- iOS Safari draws thin edge lines on a GSAP `frameSequence()` canvas: the clip is documented but not yet set by the
  block (the Motion `FrameSequence` and scene video are clipped).
- WebKit and Firefox suites were not run for this release; Chromium suites and an iPhone (iOS 26.6, Low Power Mode)
  device pass were.
- Still on the v2 roadmap: the structure refactor (one reveal, one scene core, one loop-video core), the canvas
  presenter for `ScrubVideo`, `verify` v2, the reference splits, and the Folio coverage scenes.


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
- The browser suites share `tests/lib/harness.mjs`: `settle` (a page read polled once per frame until it holds,
  returning the reading it settled on), `until`, `frames`, `snapshot` (scroll position, page clock and the value under
  test from one evaluate), `scrollToProgress`, and time as a subject (Playwright's clock; `seekAnimations` for a CSS
  animation's own clock). `HARNESS_CHROME` runs Chromium on an installed browser, a channel (`chrome`) or an
  executable's path, where Playwright's own browsers are not installed; `tests/lib/chrome-preload.mjs` carries it into
  the smoke run's `verify-motion.mjs`. `npm run test:harness` checks the library itself in a browser (CI, every engine).
- `npm run test:lint` bans fixed waits in the suites and the Folio checks (`tests/lib/eslint-no-fixed-wait.mjs`):
  `waitForTimeout`, `hold`/`sleep`/`wait` and a hand-built `setTimeout` sleep. A wait that is about time itself carries
  a `fixed-wait: <reason>` comment; the ones still to convert say `fixed-wait: unconverted`.
- `npm run verify:all` runs what CI runs, every browser suite, the Folio checks and the storefront's included, with
  `--browsers`, `--skip` and `--only`, and a summary; a step whose install is missing is skipped and says why.

### Fixed

- Scene media no longer shows iOS Safari's edge lines: thin black or gray lines along a composited video's or
  canvas's own edge, visible on the phone and never in a screenshot. `css/scene.css` clips `[data-scene-media]`,
  every `[data-scene-poster]` and the `[data-scene-canvas]` slot 1 px in (`clip-path: inset(1px)`), and
  FrameSequence's canvas carries the clip inline. Of ten variants on an iPhone (iOS 26.6.2) only this clip and a
  canvas presenter were clean. `ios-safari-motion.md` §7 has the evidence and the rule; `video.md` §6 and
  `sequences.md` §5 point at it.
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
- Four CI flakes, each two readings taken at different times with a guess between them:
  - `scrolly-steps` "loading with #step-4" reads the page once it has come to rest, not 600 ms after step 4 activates
    (ScrollSmoother's landing follows its first refresh, and its content eases behind `scrollY`);
  - `recipes` "--load-p reaches 1 exactly when the last asset settles" asks what was written before the last settle by
    the write log's order, not by comparing a write's millisecond with a read's taken a task later;
  - `sequence` p = 0: the fixture's producer re-reads the layout at each jump, so a first read taken before the layout
    settled (WebKit at 2×: 0.027, frame 2) no longer stands when the jump scrolls nowhere;
  - Folio `check:authority` leaves no page while one of its `<Link>` prefetches is in flight (WebKit reports a
    cancelled RSC prefetch as an uncaught "access control checks" error).
- The preloader's 300 ms minimum and maximum, the count-up's mid-count reads and both failsafes run on a moved clock
  (Playwright's, and the failsafe animation's `currentTime`), so the checks assert exact times and no longer wait 4 s.
- A branded Chrome's own `/favicon.ico` request no longer fails a suite's "no console errors" check: the harness
  filters that one 404 by its URL and text, and any other 404 still fails.

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

[Unreleased]: https://github.com/gabros20/scroll-animation-skill/compare/v2.0.1...HEAD
[2.0.1]: https://github.com/gabros20/scroll-animation-skill/releases/tag/v2.0.1
[2.0.0]: https://github.com/gabros20/scroll-animation-skill/releases/tag/v2.0.0
[1.0.0]: https://github.com/gabros20/scroll-animation-skill/commits/v1.0.0
