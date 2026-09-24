# iOS Safari: the motion-specific fixes

**Read when:** a scroll scene, scrubbed or looping video, mask sweep or scroll-linked effect
misbehaves on an iPhone or in Safari; or a device report says "the video froze", "the wipe pops" or
"the pin jitters".
**Skip when:** the bug is layout or rendering only: viewport units for ordinary sections, safe areas,
the toolbar tint policy for ordinary pages, the hero overshoot, SVG painting, input zoom. Those live
in the `fluid-design` skill's `references/ios-safari.md` and `references/media.md` when it is
installed.
**Depends on:** `scroll-scenes.md` §1 (why the pin is `lvh`) and §8 (the scroll well's viewport
snapshot); `video.md` §14 (the imperative controller).

Chrome DevTools' device emulation **cannot** reproduce most of what's in this document. Several of
these are Safari/WebKit sampling and rendering behaviours with no emulated equivalent. Verify on a
real device or the matching iOS Simulator (§6).

## Contents

1. [The pin and the toolbar](#1-the-pin-and-the-toolbar)
2. [Video play watchdog](#2-video-play-watchdog)
3. [Toolbar collapse feeds back into scroll geometry](#3-toolbar-collapse-feeds-back-into-scroll-geometry)
4. [`@property` for a mask sweep](#4-property-for-a-mask-sweep)
5. [Overscroll and smooth scroll](#5-overscroll-and-smooth-scroll)
6. [Device discipline for video and scroll](#6-device-discipline-for-video-and-scroll)
7. [Traps](#traps)

## 1. The pin and the toolbar

**Unit.** A scrub scene is read while scrolling, which is when Safari collapses its toolbar and the
visible area grows to `lvh`. Size the pin in `lvh` and its cancelling negative margin in the same
unit (`scroll-scenes.md` §1); an `svh` pin leaves a band of page background along the bottom edge.
Never `dvh` for anything inside the scene: it tracks the toolbar animation live, a layout thrash on
exactly the surface (a scrubbed video) that can least afford one.

**Tint: a negative result. Do not re-chase this.** On iOS 26 ("Liquid Glass") Safari ignores
`theme-color` and samples the background of `fixed`/`sticky` elements near the viewport edges. A
full-viewport `position: sticky` *pinned scrub scene* (as opposed to a modal sheet) was found to
lose tab-bar transparency on a real device no matter what was tried: a declared background on the
pin, a scroll-tracked background, and a restructure to a zero-height sticky hook with the full-screen
box as a child all failed identically. This is likely related to a WebKit bug in fixed-overlay tint
sampling that was fixed in a later iOS 26 point release, so check the test device's exact iOS
version before spending more time on it. The pragmatic options if this resurfaces: accept the opaque
bar during the pinned scene, or tint the edge strips to match the scene's own edge colours rather
than chasing native glass through it. (The general tint policy, and the edge-strip pattern for
full-screen overlays, are rendering concerns: the `fluid-design` skill's `references/ios-safari.md`.)

## 2. Video play watchdog

Safari/WebKit can silently **demote a video's GPU compositing layer**, and pause it, around events
like a window or viewport resize, without the pause arriving through any event a framework's own
state would normally react to. The result is a machine that believes a loop is running while the
decoder is actually paused: a frozen frame with a healthy `readyState` and a "playing" mode.

The fix is a watchdog, not a one-time `play()` call: something that runs regardless of state (a
tick inside an already-gated rAF loop, or a periodic imperative check) and re-issues `play()`
whenever the tracked "should be playing" intent disagrees with the element's actual `paused` state.
Throttle the re-issue so a `play()` promise that's still resolving isn't spammed every frame, and
skip it when the video has legitimately ended or the tab is hidden. The shipped shape is
`ensurePlaying()` in `videoController.ts` (`video.md` §14), plus `pause` and `visibilitychange`
listeners that resume only while the intent is set.

Two related WebKit behaviours the same controller covers: iOS won't paint `currentTime` seeks on a
never-started video (prime it with a muted `play()`/`pause()`), and Safari silently drops a `play()`
issued while a seek is resolving (wait for `seeked`, with a 150ms fallback). Keep the video's
`translateZ(0)` anchor inside its composed transform string (`video.md` §6): it is what keeps the
layer from being demoted in the first place.

## 3. Toolbar collapse feeds back into scroll geometry

iOS's toolbar collapse feeds back into scroll geometry, not just viewport height. A
`ResizeObserver`/`resize` handler that reads and caches scroll-scene geometry (the range measurement
in `scroll-scenes.md` §2) should **defer its read by one animation frame** on resize. Safari can
service a `resize` event carrying the *new* `innerHeight` while layout still holds `svh`-sized
children at their *old* size, and reading geometry synchronously inside that event reads back a
range far shorter than reality. One `requestAnimationFrame` deferral (coalesced, so a drag produces
one measurement per frame rather than one per event) puts the read after layout has actually settled
to the new toolbar state.

The same toolbar is why a scroll well captures the viewport height as a snapshot and refreshes it
only on a resize that clearly isn't chrome (a width change, or a height change over roughly a
quarter of the viewport): read live, a well scrolling up re-reveals the toolbar, which shrinks the
viewport, which moves the target, a feedback loop (`scroll-scenes.md` §8).

## 4. `@property` for a mask sweep

A custom property that drives a continuously-interpolating paint input (a `mask-image` gradient
stop, for instance) needs to be **registered** via `@property` with a numeric `syntax`. A plain,
unregistered custom property written repeatedly via `style.setProperty()` is treated by WebKit as a
**discrete restyle** rather than an animatable, interpolating value: the gradient's stops jump on
each recalculation instead of sweeping smoothly, so the effect visibly "pops" instead of wiping.
Chromium interpolates a plain custom property either way; this is specifically a WebKit gap.

```css
@property --fill {
  syntax: '<number>';
  inherits: false;
  initial-value: 0;
}
```

`syntax: '<number>'` (matched to whatever type the value actually is) is what makes the browser
treat updates to it as a typed, animatable value instead of an opaque string token.
`assets/styles/motion/motion.css` registers `--fill`; use the same shape for any other custom property that
feeds a gradient, filter or other paint input that needs to tween a number.

## 5. Overscroll and smooth scroll

`overscroll-behavior: none` on the root element kills the rubber-band overscroll at scroll
boundaries. Set it deliberately on any page with a scroll-driven scene: momentum bouncing past a
scroll boundary otherwise feeds jitter directly into whatever reads scroll position for a pin or a
latch (`scroll-scenes.md` §3, §5). It is a global decision, set once on the document root. (When the
`fluid-design` skill's base layer is installed it already sets this, for a rendering reason as well:
no canvas gap behind the page.)

`html { scroll-behavior: smooth }` (in `assets/styles/motion/motion.css`, reset to `auto` under reduced
motion) makes anchor jumps glide. It has two motion consequences: every write a scroll well makes
must pass `behavior: 'instant'`, and any stepped harness must force `auto` while it steps
(`scroll-scenes.md` §8, `verification.md` §5). Next.js App Router additionally wants
`data-scroll-behavior="smooth"` on `<html>` so its own route-change scroll jumps instantly instead of
gliding; the comment in `motion.css` has the detail.

## 6. Device discipline for video and scroll

- **Only a real device verifies video compositing, the watchdog, `lvh` shortfall and scroll
  feedback.** Device emulation doesn't attempt WebKit's compositing or toolbar behaviour. A build
  that "looks right" in emulation says nothing about them.
- **Confirm the deployed chunk contains the fix before asking for a device test.** A CDN or build
  propagation delay of even a minute is enough for a device test to run against the *previous*
  deployment and produce a false negative. This specific failure mode (testing a build that didn't
  yet contain the fix) has cost real cycles. Check the deployed asset hash or a visible marker before
  handing a device over.
- **A result from one iOS version is not verified on another** if the WebKit behaviour changed
  between them (§1's tint caveat is the concrete example).
- **Rule out a stale stylesheet first.** "The pin holds the first frame, then snaps to the last" is
  far more often a dev tab running an old stylesheet (section heights collapsed to `auto`, so the pin
  has almost no travel) than a scroll-math bug. Close the tab and open a fresh one before reading any
  scrub code (`verification.md` §4).

## Traps

- [ ] The pin is `lvh`, never `svh` or `dvh`; its margin matches (§1).
- [ ] No more time spent chasing native glass through a pinned scene; check the iOS version (§1).
- [ ] Every playing video has a watchdog for silent WebKit pauses (§2).
- [ ] Scene geometry read on resize is deferred one animation frame (§3).
- [ ] A custom property driving a mask or gradient is registered with `@property` (§4).
- [ ] `overscroll-behavior: none` is on the root of any page with a scroll scene (§5).
- [ ] The deployed build is confirmed to contain the fix before a device test (§6).
