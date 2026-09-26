# History

The measurements, incidents and rejected approaches behind rules in the runtime references. Each rule keeps a
one-clause reason where it lives; the story behind it is here. This file is not part of the skill pack.

Most of it comes from v1, which was extracted from one production marketing site (the "reference build"). The v2
entries come from the Phase 2 worker notes in `.orchestrate/reports/` and the spikes in
`docs/research/spikes-2026-09.md`.

## Contents

1. [Video](#1-video)
2. [Scenes](#2-scenes)
3. [The scroll well](#3-the-scroll-well)
4. [Fluid interop](#4-fluid-interop)
5. [Renames from v1](#5-renames-from-v1)

## 1. Video

Runtime rules: `skills/scroll-animation/references/video.md`. It keeps the section numbers that code and docs cite
(§1–3, §5, §6, §9–15), so most match v1's: v1's §7 (the reset's `max-width`) is folded into §6, v1's §8 (source
tiers) is now §7, and §8 (serving) is new.

### All-intra, and what a file size means

- A 4-second 1080p clip that only ever played forward shipped all-intra at 26.5 MB (ffprobe: every frame a keyframe).
  A normal GOP would have been a small fraction of that for identical playback. All-intra is for scrubbing only.
- The opposite case: a "master" at GOP 28 and 51 Mbps weighed 60 MB, and an all-intra re-encode at CRF 22 came out at
  7.2 MB with better seeking. The master was wasting bits, so its size said nothing about its quality. Probe codec, GOP
  and bitrate before trusting a master.

### `qcomp=1`

x264's default `qcomp` (0.6) lets CRF spend a different quantiser on each frame. Two byte-identical master frames, the
ends of a loop built to match, decoded about 32 dB PSNR apart, entirely from that per-frame variance. It showed as a
sharpness pop at every wrap on a clip whose master was verified pixel-identical at the seam: the master check passed
and the shipped file still popped. `qcomp=1` (or constant QP with `-qp`) quantises identical input identically. It costs
bitrate: one loop held about 9 MB by moving from CRF 22 to CRF 33 with `qcomp=1`. That is why seams are verified on the
encoded file.

### Loop seams

- An eyeballed seam cost 4.12 against a 0.90 motion floor, more than four times the visible threshold. The measured
  seam sat at one sharp minimum well under the floor.
- A procedurally rendered loop can be pose-periodic (every parameter returns to its start) without being
  pixel-periodic. PIL's `Image.rotate()` returns an unresampled copy at exact multiples of 90°, so frames where a sway
  term landed on 0 came out sharper than their resampled neighbours: a periodic flicker with nothing wrong in the
  render's parameters. Verify the pixels a loop produced, not the sweep that was meant to guarantee them.
- The `loop` attribute re-enters at frame 0 and suppresses `ended`, so a mid-clip loop point can't use it.

### Wrapping on rAF

Polling `currentTime` in `requestAnimationFrame` produced a one-frame flash of the loop's first motion frame, read as
"the loop jitters", on a seam that measured seamless offline. A rAF check lands anywhere in the following ~16.7 ms, and
a seek's own latency stacks on top. `requestVideoFrameCallback` replaced it; the verification is a log of presented
frame indices that must read as a clean sawtooth.

### Preload and `load()`

- On a phone, the warm and play observers fired in the same batch, and a `load()` on the warm path left a fully
  buffered video paused forever: `load()` re-runs resource selection and aborts the `play()` in flight.
- v1's `ScrubStage` warmed a source-less element by assigning `src` and `preload = 'auto'`; assigning `src` starts
  resource selection itself, so no `load()` was needed.
- v1's mount rehydrate called `load()` with `preload = 'auto'` whenever the duration was invalid, which is always the
  case on first load, so a far-away scene fetched at page load. v2 fetches nothing until the warm margin, and only the
  picked tier (probed in both engines and browsers at 1440 and 390 px wide).

### Posters

- A JPEG poster exported from the master flashed when decoding started over it: a different colour pipeline and
  different artefacts, amplified by `mix-blend-mode: lighten`. On mobile, where decoding is slower, one alternative was
  to drop the poster and fade the video in once its first frame had decoded.
- ffmpeg's fast YUV to RGB conversion landed stills 2–3 levels dark (paper `243,239,230` instead of `245,241,233`); the
  CLI now converts limited to full range with accurate rounding. Untagged encodes let Safari and Chrome pick different
  matrices, so every encode is tagged BT.709.

### Keyframes at seams

A normally encoded loop re-entering at 13.75 s needed `-force_key_frames 13.75`. Without it the backward seek landed
mid-GOP and re-decoded from the previous keyframe: on a sub-second loop, a hitch on every repeat, and a re-encode that
dropped the forced keyframe regressed silently.

### Autoplay

Rejected: starting muted and unmuting programmatically for a video that carries sound. It depends on engine-specific
grants that can be revoked mid-playback, and a hero that flips between muted and audible depending on the browser is
worse than one consistent control. The play call belongs in the click handler.

### Tab-sleep rehydrate

Tried and rejected: scrolling the visitor back to the section on resume, forcing a full reload on focus, and persisting
mode and time in `sessionStorage`. Each fought the scroll position, which was already the durable truth, and went stale
faster than it helped. The debug probe (`window.__scrub()`) turned "the video is frozen" reports into "which counter
didn't move", the difference between a five-minute diagnosis and an unreproducible ticket.

### Encoding notes

- A mostly flat small loop dropped from CRF 20 to CRF 31 with no visible banding; the same jump on a detailed frame
  would show. Flat fields band before detail does.
- A 1.33× linear resolution bump bought +0.0008 SSIM: the limit was compressing smooth gradients, not pixel count.
- All-intra re-pays background texture every frame: a textured ground cost 37 MB at CRF 22 and 1600×900; softening the
  texture and dropping to 1440×676 brought the same shot to 9 MB.
- An 8-bit yuv420p round trip costs about 1–3 units per channel against a target hex value.
- Check a delivered file's size against what it replaces before it lands in version control: every blob stays in
  history, so an oversized asset's clone cost is permanent.

### The v1 controller and the v2 rebuild

- v1's `videoController.ts` documented decoder priming (a muted `play()` then `pause()`, because iOS may not paint
  `currentTime` seeks on a video that has never played), but its `prime()` was reserved and never called. v2 shipped
  without one until the Phase 2 real-device pass: on an iPhone the holds-only scene sat on its poster, then vanished at
  its first seek (metadata only, `readyState` 1, the seek never completed). The controller now primes once per source
  and never seeks before a frame exists.
- v1 React defaulted the loops to the reference build's frames (32, 80, 192), wrong for any other clip. v2 defaults to
  holds.
- **The WebKit tail race.** The tail's wrap sits one frame before the clip's end, and WebKit runs frame callbacks about
  0.8 of a frame after presentation (`now − expectedDisplayTime` ≈ 27 ms). With the main thread blocked for 90 ms near
  the tail's end over 12 cycles, v1 hit `ended` every cycle in both engines and browsers, sat paused about 30 frames
  until the watchdog, and in WebKit flashed frame 0, because the watchdog's `play()` on an ended video restarts from 0.
  v2 (`wrapDue` on the due frame, a rAF backstop at half a frame, an immediate re-wrap on `ended`) pauses for one frame
  and never shows frame 0. A first version that wrapped on the rounded playback position passed tolerance but cut the
  loop's last frame every cycle in WebKit (spans 55–57), so it was rejected.
- v1 GSAP piled up a `requestVideoFrameCallback` chain on every wake; v2 keeps one chain per run (measured: one callback
  per presented frame after six sleep and wake cycles).
- v1 GSAP's wake repair never restarted the loop; every wake source now goes through the controller's `setAwake`.
- v1 entered a loop from the band paused and waited for the watchdog, about 31 frames; v2 plays at once.
- v1 React's eviction path set the mode ref without committing the mode, so the attribute went stale; v1's snap could
  call `play()` after the mode had moved to scrub. v2 re-checks mode and run state at play time.
- The glide became `dt`-based: equal to v1 at 60 Hz, the same speed at 120 Hz.
- ScrubVideo's head and tail loops ran for as long as the reader rested in them. They now stop after `loopSeconds` (5)
  per visit to a region (WCAG 2.2.2); the v1 parity traces pass `loopSeconds: Infinity`, since v1's loops never
  stopped.
- v2's first LoopVideo defaulted its pause control from one cycle's length (`durationS > 5`). WCAG counts how long the
  movement lasts, and a loop moves while it is in view, so the control is now shown by default.
- Its rVFC path compared `mediaTime`, the presented frame's start, with a threshold past the last frame's start, so the
  seam only wrapped on `ended`: a pause, a seek and a play every cycle. It now tests the presented frame's end.

## 2. Scenes

Runtime rules: `skills/scroll-animation/references/scenes.md`, which keeps v1's section numbers for the pin (§1), acts
(§2), the latch (§3), the progress clocks (§4), direct writes (§6), the camera (§7), the scroll well (§8), the
reduced-motion collapse (§10) and riding sections (§11).

### The bound opacity that faded back in

A copy layer sat under a negative margin over the pin, and its opacity was bound to a scroll-derived value through
Motion's `style`. Motion promoted it to a native timeline (`getAnimations()` showed keyframes `0.10 → 1`, `0.35 → 0`,
fill both, running), and past the fade's end the copy faded back in over the render. v1 blamed the pin's view range
disagreeing with the JS maths. Spike S3 (September 2026) found the real cause: Motion passes the input range through
as keyframe offsets with no keyframes at 0 and 1, so outside the range the animation slides back toward the element's
first-render value. A page with no target and no pin fails the same way. The fix, writing by hand, stayed; the reason
changed.

### Hysteresis as two constants

A 140 px hysteresis once shipped against a 200 px tolerance. Retuning the tolerance to 100 px later made the re-entry
threshold negative, unsatisfiable by any scroll position, so the loop it gated never came back on scroll-up. Tied to
the hold as a ratio, the pair stays valid by construction. The general rule: when two constants must keep a
relationship, express one in terms of the other.

### The reduced-motion collapse

- A plain media query, not `motion-reduce:` utilities: those collided with the pin's own responsive utilities at equal
  specificity, so the winner depended on build output order.
- v1 React wrote the pin's sticky geometry as an inline style, which is why the collapse needed `!important`. v2 moved
  the geometry into `scene.css`; `!important` stays because ScrollTrigger writes inline geometry.
- v1 React collapsed the pin to `position: static`, which sized the absolutely positioned media against the wrong box.
  v2 uses `relative`.
- An unmarked two-viewport spacer left 1,800 px of empty dark band under reduced motion; hence `data-scene-spacer`.

### The camera

v1 suggested a tracking term, stored as drift from the straight interpolation between the two shots, that read the
video's `currentTime`. v2's camera reads the band only: cancelling the subject's own travel frame by frame doesn't hold
it still, it slides the whole backdrop the other way under static copy.

## 3. The scroll well

Runtime rules: `scenes.md` §8. The block (`scrollPull.ts`, `PullToCentre`) is still v1.

- **Rejected: CSS scroll-snap.** Its proximity radius is UA-defined and far from a useful trigger distance, and its
  settle is a UA-paced dart the page can't control.
- **Rejected: a spring fired at a threshold crossing.** It needed velocity tracking, absorb and veto budgets,
  deviation detection and a rest-detection override, and still read as "the page waits for you to stop, then grabs
  you".
- **The anchor trap.** The well's `behavior: 'instant'` writes cancel a smooth scroll it didn't start: a "Menu" anchor
  click from the top of the page landed 900 px short every time, and a headless harness's stepped `scrollTo` calls
  stalled partway down the page, so every cell below the well read as a reveal failure. Hence `suspend()`.
- **The suspend fallback.** A flat 1,200 ms measured tight: a real Chromium smooth scroll to `#menu` (about 5.2k
  reference px) took 1,196 ms. The fallback now scales with distance (1,200 ms floor, 0.35 reference px per ms, 4,000 ms
  ceiling) and ends early once `scrollY` has been still for 150 ms, which matters most on Safari, which lacks
  `scrollend`.
- `verify-motion.mjs` forces `scroll-behavior: auto` while it steps: on a page with global smooth scrolling, 30 of 54
  items read as hidden with no reveal bug in the components.

## 4. Fluid interop

v1's `references/fluid-interop.md` is folded into `preflight.md` §3.6 (breakpoint, header, units) and `scenes.md` §12
(scaled travel, pin units, fluid-height acts).

- v1 kept the breakpoint as `ENGAGE_BREAKPOINT_PX` / `ENGAGE_QUERY` (React) and `ENGAGE_PX` / `ENGAGE_QUERY` (GSAP). v2
  reads `DESKTOP_QUERY` from `config.ts`, re-exported from fluid-design's generated `fluid.ts` when there is one. The v1
  blocks still in the pack (the stage and the scroll well) keep reading `ENGAGE_QUERY`.
- The scroll well's tuning numbers (`maxSpeed` 800 and `minSpeed` 120 reference px per second, `releaseAwayPx` 60 and
  `reclaimPx` 320 reference px) multiply the resolved `--fluid` unit, read through a probe sized
  `calc(1000 * var(--fluid, 1px))`: `getPropertyValue` returns the unresolved token, and `parseFloat` on it is `NaN`.
- Under GSAP, the Vite example's peel drift sat at 0 until it moved from the entrance-tweened wrapper to the `<img>`
  inside it: GSAP folds CSS `translate` into its own transform on the first transform tween, freezing px and `calc()`.
- `--header-h` is fluid-design's earlier name for `--fluid-header-h`; `anchor-check.mjs` reads
  `var(--fluid-header-h, var(--header-h, 0px))`.

## 5. Renames from v1

| v1 | v2 |
|---|---|
| `ScrubStage` / `scrubStage.ts` | `PinnedScene` + `ScrubVideo` / `pinned-scene.ts` + `scrub-video.ts`, on `scene.ts` and `media/video-controller.ts` |
| `InViewLoopVideo` / `inViewLoopVideo.ts` | `LoopVideo` / `loop-video.ts` |
| `data-scrub-stage`, `-pin`, `-content`, `-spacer`, `-video`, `-gutter`, `-frame` | `data-scene-root`, `-pin`, `-content`, `-spacer`, `-media`, `-gutter`, `-frame` |
| `data-motion-state` | `data-scene-state` |
| `?fluid-debug`, `data-fluid-debug` | `?motion-debug`, `data-motion-debug` |
| `--frame-w`, `--frame-h` | `--scene-frame-w`, `--scene-frame-h` |
| `fluidPx`, `fluidValue`, `fluidEnd`, `useFluidUnit` | `scaledPx`, `scaledValue`, `scaledEnd`, `onScaleChange` (`scale.ts`) |
| `references/scroll-scenes.md`, `references/fluid-interop.md` | `references/scenes.md`, `preflight.md` §3.6 |
