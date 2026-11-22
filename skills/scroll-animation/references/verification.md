# Verifying motion

**Purpose:** Prove scroll-dependent motion works: the scripted harness, the three bugs it caught, the scripts, device checks.

**Read when:** you've built or changed a scroll scene, an entrance group, a scroll well or anything
else whose correctness depends on scroll position, and need to prove it works; or a reveal "doesn't
fire" or a scene "is broken".
**Skip when:** the change is a static tweak with no scroll or viewport dependency; a plain visual
diff is enough. Layout verification (the viewport matrix for overflow and one-screen fit, unit
maths) belongs to the `fluid-design` skill's `references/verification.md` when it is installed.
**Depends on:** `scenes.md` for what a scene's "progress" means as a value to drive
programmatically.

Three tiers, cheapest and most automatable first. The order matters: a bug tiers 1–2 can catch
should never wait for tier 3, because a real device is the scarcest resource in this list.

**Inputs:** a URL or a built page.
**Produces:** pass/fail evidence per reveal, scene and anchor.

## Contents

1. [Tier 1: the scripted browser harness](#1-tier-1-the-scripted-browser-harness)
2. [The three bugs it caught](#2-the-three-bugs-it-caught)
3. [Tier 2: marker CSS](#3-tier-2-marker-css)
4. [Before debugging a scene: rule out a stale stylesheet](#4-before-debugging-a-scene-rule-out-a-stale-stylesheet)
5. [The scripts](#5-the-scripts)
6. [Tier 3: a real device](#6-tier-3-a-real-device)
7. [Symptom index](#7-symptom-index)
8. [Traps](#traps)

## 1. Tier 1: the scripted browser harness

This is the tier that finds bugs. An in-browser dev panel (a timeline scrubber, live spring sliders, a driver
registry shipped to production) was built and caught nothing before it was deleted; what catches bugs is **a script
driving a real headless browser and reading numbers out of it.**

**Scroll to a scene's *progress*, never to a raw pixel offset.** Pixel offsets rot the moment
content above the scene changes height, while progress (0→1 across the scene's own measured range)
stays meaningful regardless of what's above it:

```js
const base = await page.evaluate(() => {
  const s = document.querySelector('[data-scene-root]')
  const pin = s.querySelector('[data-scene-pin]')
  return { top: s.getBoundingClientRect().top + scrollY, range: s.offsetHeight - (pin?.offsetHeight ?? innerHeight) }
})
for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
  await page.evaluate(y => scrollTo(0, y), base.top + base.range * progress)
  await page.waitForTimeout(2500)                 // let any glide or spring settle: see below
  await page.screenshot({ path: `sweep_${progress}.png` })
}
```

The wait matters: a value still gliding (a mode handoff, a loop's handover) needs real time to settle before a
screenshot means anything; a couple of seconds covers the exponential approaches used here.

**Then tile the screenshots into one contact sheet**: a problem arguable on one frame is obvious across six side by
side (it caught "the reveal plays too early" faster than stepping through).

**Read state, not just pixels.** `getAnimations()`, a computed `style.transform`, `offsetWidth`,
`getBoundingClientRect()`, a video's `currentTime`, `data-scene-state`: these turn "it looks a bit
off" into a specific, falsifiable claim: "`offsetWidth` is 402 where it should be 1128." Every real
bug found this way (§2) was found by reading one of these, not by looking harder at a screenshot.

**`window.__scrub()` needs `?motion-debug`, in every build.** ScrubVideo's debug readout (both
engines) is internal state, so it stays off unless the URL has `?motion-debug` or `<html>` carries
`data-motion-debug` (set it from a tiny head script before the scene mounts, for a harness that
can't control the URL). It returns one snapshot per live ScrubVideo: the scene's mode, progress,
wake state and range, and the controller's counters (ticks, frame callbacks, plays, refused plays,
wraps, recoveries, snaps). The counter that stopped moving names the layer that died. A bare
`pinnedScene` has `scene.debug()` instead, and `rail.debug()` adds a rail's travel, direction and
translate. Without the flag, read the DOM contract:
`data-scene-state` on `[data-scene-root]`, `inert` on the acts, the video's `currentTime`, the
camera's computed `transform`. `scripts/tools/verify-motion.mjs` reads the contract, so it works
without the flag.

**Scene checks.** With the default holds, on a range over 1,280 px, progress 0, ¼, ½, ¾ and 1 read
`head`, `scrub`, `scrub`, `scrub`, `tail` (on a shorter range the tail hold is capped at a quarter, so ¾
sits on its boundary); only the active stacked act lacks `inert`; a reload or a resize mid-scene lands in
the state the scroll position implies without any scrolling; and under reduced motion the root is
`height: auto`, no act is `inert` and the video holds its head frame (`scenes.md` §10).

- **Path independence.** Record a signature (the moving parts' computed `transform` and `opacity`,
  `data-scene-state`, `inert`, `currentTime`) at about 20 progress points scrolling down, again scrolling up, again
  jumping straight to each, and after a reload at three depths. The four sets match; a mismatch is state kept in
  JavaScript instead of derived from the scroll.
- **Dead scroll.** Between neighbouring samples inside a scene something visible changes: copy, the playhead, a
  rail's translate, a wipe, the camera. Sample at fractions of each scene, never evenly down the document (every
  position moves when a section above changes height). An intended pause is a `data-scene-spacer` act named in the
  ledger, so authored silence reads apart from a stall.
- **The slides**: `--scenes` shoots the pin ¾ on screen entering and leaving ([video.md](video.md) §14).
- **Contrast over moving media.** Copy riding a scrub, loop or canvas is graded at every sample, not on the poster:
  hide the copy and any fixed chrome, shoot the same frame, read the pixels under each line (clamped to the
  viewport), and grade light ink against the brightest patch, dark ink against the darkest. The worst frame decides.
  A stronger scrim that leaves the number unchanged isn't in the frame you measured.
- **Page-load jank, by attribution, not guessing.** (1) Observe `long-animation-frame` from an init script and sum
  each frame's `scripts[].duration`: a long frame with almost no script time is raster, paint or decode, not
  JavaScript. (2) Trace with CDP (`Tracing.start`, categories `devtools.timeline,disabled-by-default-devtools.timeline`)
  and sum the `RasterTask` durations. (3) Switch suspects off one at a time with an injected rule
  (`img { background-image: none !important }`, `mask-image: none`, `animation: none`) and compare raster totals and
  long frames: a cause with a number in minutes (it found a blur placeholder: [performance.md](performance.md) §11).
  A per-frame `getBoundingClientRect()` is the main thread's view, so it can neither prove nor rule out a composited
  animation stepping (§7).

## 2. The three bugs it caught

Concrete, because "measure state, not pixels" is abstract until you see what it actually found:

| Symptom | Cause | Found by |
| --- | --- | --- |
| Copy faded out, then faded back in | A scroll-linked value had been promoted to a native accelerated timeline whose keyframes stopped at the input range (`scenes.md` §6) | `getAnimations()` showed a real, running native animation with keyframes at the component's declared range, visible nowhere in source |
| A stat grid sat permanently invisible | A `display: contents` wrapper generates no box, so the `IntersectionObserver` watching it had nothing to observe and the reveal never fired | Computed style plus a direct IO check; invisible from reading the component's JSX, which looked entirely correct |
| "Animates too early and too fast" | The trigger fired at roughly a third of the element visible and settled hundreds of pixels before the element had actually arrived | Scripted scroll plus screenshots at fixed progress steps; not reproducible by scrolling manually at normal speed |

None of the three were visible from reading the source code in isolation. All three were found in
minutes once the harness existed. (The second is now a static check: `scripts/tools/audit-motion.mjs`'s
`contents-reveal` rule flags a reveal trigger on a `contents` wrapper, including a responsive
`lg:contents`.)

## 3. Tier 2: marker CSS

A zero-JS stylesheet (about 90 lines) toggled by one attribute on the root: it needs no dev panel, survives a
screenshot and works on a USB-connected device:

```css
:root[data-motion-debug~='markers'] [data-scene-root]         { outline: 1px dashed #f59e0b; }
:root[data-motion-debug~='markers'] [data-reveal]             { outline: 1px solid  #34d399; }
:root[data-motion-debug~='markers'] [data-scene-state='head'] { outline-color: #22c55e; }
:root[data-motion-debug~='markers'] [data-scene-media],
:root[data-motion-debug~='markers'] [data-scene-media] *      { outline: 2px solid #ef4444; }
```

`data-scene-state` is written only on transition (the latch rule, `scenes.md` §3), so a mode flip shows as a
discrete colour change at no extra cost.

**If this tier is ever extended, the rule that keeps it safe is: the tool must not change what it
measures.** No `border` (it changes box size, which changes exactly the geometry being debugged), no
`position: relative` added purely to anchor a label (it creates a stacking context that didn't exist
before), no wrapper elements (they change the DOM structure a sticky/pin calculation depends on), no
`overflow: hidden` (it kills sticky, `scenes.md` §1). Outlines only, because `outline` is the
one visual debug affordance that never participates in layout.

## 4. Before debugging a scene: rule out a stale stylesheet

**Symptom:** the pinned scrub holds the first frame while you scroll, then snaps to the last frame
at the bottom; often alongside a full-bleed render with no gutters, or copy that is missing,
unstyled or the wrong size. **It is almost always a stale stylesheet in an open dev tab, not a
scrub bug.** A dev server pushes CSS over its HMR socket; restarting the server kills that socket,
and a tab that was already open does not reliably re-fetch the stylesheet on reconnect. Safari
holds hardest: a plain reload often re-runs the page against the cached CSS. The class names are
still in the HTML with no rules behind them, so a section-height utility collapses to
`height: auto`, the pin loses its travel, and progress still runs 0→1 over almost no distance:
frame one all the way down, then a snap to the tail.

The check, before reading any scroll code: read back a recently-touched custom property with
`getComputedStyle(document.documentElement).getPropertyValue('--fluid')` (or any property your
stylesheet defines). A fresh, current value means keep debugging; an empty string or an older form
means stop. **Close the tab and open a new one**; if the symptom survives, clear the build cache and
restart the server. Closing the tab fixing it is proof the code is fine: a real bug doesn't care
which tab you're in. (With the `fluid-design` skill installed, `fluid probe <url>` automates this
check: a STALE verdict means the tab holds an old stylesheet.)

**When a fresh browser is stale too, the server is.** A dev server can stop compiling CSS edits (seen on Next 16 with
Turbopack: the old `@keyframes` kept being served, and touching the file woke nothing). Walk `document.styleSheets`
in a fresh headless browser or a new profile for one selector you just added; if it is missing there too, the tab is
innocent: restart the server with a clean build cache (`.next`).

## 5. The scripts

Check each script's own `--help` for the current flag surface; the shapes below are the intended
contract.

- **`scripts/tools/audit-motion.mjs <srcDir>`**: a static source scanner for the silent motion failure
  modes. Each finding carries a rule id, `file:line`, the snippet, a *why* and a *fix*. Rules:
  `motion-strict` (a `motion.*` component in a project running `LazyMotion strict`, where it
  throws at runtime), `fractional-amount` (a fractional `amount`, unsatisfiable on tall content),
  `contents-reveal` (a reveal trigger on a `display: contents` wrapper), `video-attrs` (a video
  missing `muted`/`playsInline`/a deliberate `preload`), `scroll-well-vs-smooth-scroll` (info: a
  scroll well alongside page-wide smooth scrolling), `lenis-with-scroll-well` (a scroll well, v1's
  included, in a project that depends on Lenis), `gsap-pin-with-sticky-scene` (`pin: true` in a file
  that also holds a scene: `data-scene-root` or `-pin`, `PinnedScene`, `ScrubVideo`, `pinnedScene()`,
  `scrubVideo()` or v1's), and `fixed-travel-on-fluid` (a drawn distance of 80 px or more typed as a
  plain number on a fluid layout, `scenes.md` §12). `--selftest` runs every rule over its positive and
  negative fixtures and asserts each trips (or doesn't).
- **`scripts/tools/verify-motion.mjs <url> --nav [href]`**: a navigation between two pages, which a fresh load never
  tests (three route bugs once passed every other check). It scrolls the page down, clicks a link (the first visible
  same-site link to another path, or the one given), then goes back and forward. It fails when a landing is wrong,
  when the page shows a position between the old one and the landing or a smoother's content trails the scroll (a
  glide), when a reveal starts with its item off screen, when something on the new first screen is part-way through
  its fade while a view transition still covers it, or when the first screen is still hidden 2 s after arriving.
  Asked for by name: it needs a second page ([lifecycle.md](lifecycle.md) "Route change").
- **`scripts/tools/verify-motion.mjs <url> --font-swap`**: a fresh load with the fonts held back 1.5 s; fails when
  the layout shifts as they land ([lifecycle.md](lifecycle.md) "The hero budget"). Chromium only.
- **`scripts/tools/verify-motion.mjs <url>`**: the runtime check. It step-scrolls the page with rAF plus a
  pause per step (a fast scroll outruns `IntersectionObserver` and gives false blanks), then gives the
  last entrances up to 6 s to land. Every `[data-reveal-item]` must reach `data-reveal-state="shown"` and
  end at full opacity: opacity alone can't tell, since a `clip` item rests hidden at opacity 1. An item
  in a `data-reveal-replay` group only has to have been shown once, because it resets out of view. Each
  failure names its group and reason. It drives each `[data-scene-root]` to progress
  `[0, 0.25, 0.5, 0.75, 1]`, records `data-scene-state` at each step, and checks the states run `head`,
  `scrub`, `tail` without stepping back, leaving `head` by progress 1; a scene video with a source that never reaches
  `readyState` 2 (unless still `preload="none"`) or whose playhead never moves while scrubbing fails it, and the two
  slides are shot and reported. A check with nothing to find
  reports SKIP, never PASS. **It forces
  `document.documentElement.style.scrollBehavior = 'auto'` for the duration of its stepped `scrollTo`
  calls and restores the old value afterwards.** A page with `html { scroll-behavior: smooth }` would
  otherwise have each step's `scrollTo` cancel the previous step's still-in-flight smooth animation (the same
  mechanism as the scroll-well trap, `scenes.md` §8), and the harness would stall partway
  down the page. Measured: this made the reveal check fail in every cell (30/54 items read as
  hidden) on a page that set `scroll-behavior: smooth` globally, with no reveal bug in the actual
  components.
- **`scripts/tools/anchor-check.mjs <url>`**: the one check that exercises a REAL smooth scroll through
  the page's own `scroll-behavior` and scroll-well setup, which the reveal check deliberately does
  not. Because that check forces `auto`, 27/27 green cells there prove nothing about whether an
  actual anchor click survives a scroll well sitting between it and its target. For each same-page
  anchor (href starts with `#`, or same path with a hash), up to a per-viewport limit, it clicks with
  smooth scrolling left on, waits for `scrollend` or for `scrollY` to sit still for 300ms (10s cap),
  and asserts the target's landed `rect.top` matches its `scroll-margin-top` (plus the root's
  `scroll-padding-top`), or a `--fluid-header-h` fallback when both are zero, within 2px. Viewports at
  480px wide or less are emulated as touch.

Both browser scripts resolve Playwright from the target project's `node_modules` first (run them from
inside the project), then a skill-local install, then print an install hint. Exit codes: `0` pass,
`1` a check failed, `2` usage error or Playwright unavailable.

- **The browser must decode the clip.** Before Playwright 1.57 (1.63 on Linux arm64) its bundled Chromium has no
  H.264: a scrub never paints, and every screenshot shows the poster. There, pass `verify-motion.mjs --channel chrome`
  or `--browser webkit`; later versions bundle Chrome for Testing.
- **The run tests this build.** A dev server that failed on a busy port leaves another project answering: check the
  served `<title>` and that a known media URL answers `206` before trusting a clean report. Serve over http: a
  `file://` page breaks the sequence and preloader fetches.

**The blocks arrive tested.** In the skill's own repository, `npm run test:reveal`, `test:text`,
`test:scroll-effects`, `test:header-theme`, `test:count-up`, `test:rail` and `test:recipes` drive each
entrance, text and layered block, and each recipe, through its fixtures in Chromium, WebKit and
Firefox; in `site/`, `pnpm build && pnpm check` does the same for the storefront, the vanilla GSAP
and ScrollSmoother example. Between them they cover the gate and the failsafe, reduced motion switched
mid-play, hide and show, print, layout shift, and a `destroy()` that leaves nothing behind. A
project's own checks cover what those suites can't: where the blocks sit, their trigger lines, and
each ledger row's reduced-motion alternative. On a client-routed site add a **route-cycle probe**: count canvases,
`<video>`s, running `getAnimations()` and `ScrollTrigger.getAll()`, navigate away and back five times, idle 20 s,
and count again; every number returns to its baseline.

## 6. Tier 3: a real device

Connect a physical phone, hit a dev server by local IP and use the browser's remote-debugging console. Neither
emulation nor a simulator reproduces the bugs `ios-safari-motion.md` documents, and this is the step most often
skipped, so budget for it: video compositing demotion, the play watchdog and toolbar feedback into scroll geometry
were only ever reproducible here.

Disciplines that cost real cycles when skipped:

- **Confirm the deployed build actually contains the fix before asking for a device test.**
  Build/CDN propagation lag is enough for a device test to run against the previous deployment and
  produce a false negative that reads as "the fix didn't work."
- **A result is only trustworthy from the device class and OS version it claims to fix.** A fix
  verified on one iOS version is not verified on another if the underlying WebKit behaviour changed
  between them (`ios-safari-motion.md` §1).
- **Send a diagnostic with the first device round.** A standalone page beside the site that plays the suspect clip
  next to a known-good one and prints, per pane, whether frames advance (painted frames, refused `play()`s, seeks)
  answers in one screenshot what rounds of guessed fixes don't. When one clip works and another doesn't on the same
  phone, list every way the two differ (which loaded first, while the reader's first touch was spent) before blaming
  the platform.
- **"It jitters on my phone": ask for a screen recording** and read it frame by frame. No harness here sees per-frame
  misalignment between content and the compositor's scroll. Cut it into contact sheets,
  `ffmpeg -i rec.mov -vf "fps=30,scale=360:-1,tile=6x5" sheet-%02d.png`, and compare the moving parts' positions
  across neighbouring frames: a part a frame behind the page is JavaScript-driven against native scrolling.

## 7. Symptom index

| Symptom | Where |
| --- | --- |
| After a link the page lands at the new route's bottom, or back/forward lands at the wrong position, under Lenis | a glide outlived the navigation: [scroll-authority.md](scroll-authority.md) "Placements and route changes"; `verify-motion --nav` |
| A layout-level trigger (a reading progress) keeps the previous route's numbers | no refresh after the navigation, or a streamed route refreshed at its fallback: [lifecycle.md](lifecycle.md) "Route change" |
| Entrances skip after following a link from a scrolled page: items below the fold are already shown when the reader gets there | GSAP triggers created at the previous page's scroll, before the router placed it: [entrances.md](entrances.md) §5 |
| Back/forward in Chromium lands a few dozen px off | a scroll anchor still moving at restore: [lifecycle.md](lifecycle.md) "Route change" |
| A page transition never runs, or the page just swaps | reduced motion, two `[data-header]`s, Firefox on a multi-page site, an MPA opt-in only in the bundled CSS: [page-transitions.md](page-transitions.md) §2–§3 |
| A multi-page transition crossfades but never slides forward or back | a stripped `blocking="render"`: the direction type is lost, the transition still runs ([page-transitions.md](page-transitions.md) §3) |
| A Motion `layoutId` swap sticks on the old box | reduced motion under Motion 13.4: [motion.md](motion.md) §8 |
| A scrolly graphic doesn't stick, or the last step never activates | an `overflow: hidden` ancestor, ScrollSmoother, the tail removed: [scrollytelling.md](scrollytelling.md) §5 and its traps |
| A 3D canvas in a scene draws a frame behind the copy or the scroll | rendered on its own loop (`demand`, a page rAF, a `scroll` listener) or fed by a 3d adapter: [webgl.md](webgl.md) §3–§4 |
| A canvas sweeps from 0 or shows a default pose on reload | fed outside `render-bridge`, or the mesh takes its pose only in `onFrame`: [webgl.md](webgl.md) §6 |
| A canvas is blank or black after load or in a view transition | the new canvas never rendered (a late canvas without `requestRender()`); the old snapshot keeps its last frame: [webgl.md](webgl.md) §6 |
| WebGL contexts pile up across routes | a canvas kept mounted on leave or a renderer never disposed; under Cache Components, one per kept route: [webgl.md](webgl.md) §6 |
| Display type wobbles or steps in whole pixels as an entrance settles | a JavaScript-driven move with no layer (Motion `x`/`y`): move it to the compositor, or scope the layer to the playing group ([performance.md](performance.md) §10). Check the precondition (computed `will-change` on the items while the group is `data-reveal-playing`, or a running animation in `el.getAnimations()`) and compare cropped screenshots of consecutive frames; `getBoundingClientRect()` reports the float either way and can't see it |
| A blurred nav drags a white or yellow streak as it enters (Safari) | a `backdrop-filter` element moved in from off-screen, or under a fading ancestor: [ios-safari-motion.md](ios-safari-motion.md) §8 |
| A live scene lags, or the headline jumps at its end, while the hero's entrance plays | costly starts inside the entrance (a compile, hydration, video, a blur over the canvas): [lifecycle.md](lifecycle.md) "The hero budget" and "What the 3d skill reads" |
| The hero entrance freezes for hundreds of ms with no script in the long frame | raster: a blur placeholder on the hero image is the usual one ([performance.md](performance.md) §11); attribute it first (§1) |
| A cued layer (a canvas, a demo) lands hundreds of ms after its cue | a timer started at hydration, or a reveal through Suspense (`next/dynamic`, `React.lazy`): [lifecycle.md](lifecycle.md) "The hero budget", "The clock" |
| Hero copy fades out again in Safari once its entrance ends, over a background canvas or video | the copy has no stacking level above the background layer: [ios-safari-motion.md](ios-safari-motion.md) §9 |

## Traps

- [ ] Sweeps scroll to scene *progress*, never raw pixel offsets (§1).
- [ ] Each sweep step waits for glides and springs to settle before a screenshot (§1).
- [ ] Claims are backed by read state (`getAnimations()`, rects, `currentTime`,
  `data-scene-state`), not by screenshots alone (§1).
- [ ] Probes append `?motion-debug` or read the DOM contract (§1).
- [ ] Debug markers use `outline` only: no border, wrapper, positioning or overflow (§3).
- [ ] "First frame, then snap" is checked against a stale stylesheet before any scroll code is read
  (§4).
- [ ] A green reveal run is not an anchor check; run `anchor-check.mjs` on pages with anchors or a
  scroll well (§5).
- [ ] `audit-motion.mjs --selftest` is green before trusting the audit (§5).
- [ ] State is path-independent (down, up, jumps, reloads agree); no dead scroll inside a scene; copy over media
  passes contrast at its worst frame (§1).
- [ ] Media checks ran in a browser that decodes the clip (§5).
- [ ] The deployed build contains the fix before a device test (§6).
