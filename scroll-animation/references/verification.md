# Verifying motion

**Read when:** you've built or changed a scroll scene, an entrance group, a scroll well or anything
else whose correctness depends on scroll position, and need to prove it works; or a reveal "doesn't
fire" or a scene "is broken".
**Skip when:** the change is a static tweak with no scroll or viewport dependency; a plain visual
diff is enough. Layout verification (the viewport matrix for overflow and one-screen fit, unit
maths) belongs to the `fluid-design` skill's `references/verification.md` when it is installed.
**Depends on:** `scroll-scenes.md` for what a scene's "progress" means as a value to drive
programmatically.

Three tiers, cheapest and most automatable first. The order matters: a bug tiers 1–2 can catch
should never wait for tier 3, because a real device is the scarcest resource in this list.

## Contents

1. [Tier 1: the scripted browser harness](#1-tier-1-the-scripted-browser-harness)
2. [The three bugs it caught](#2-the-three-bugs-it-caught)
3. [Tier 2: marker CSS](#3-tier-2-marker-css)
4. [Before debugging a scene: rule out a stale stylesheet](#4-before-debugging-a-scene-rule-out-a-stale-stylesheet)
5. [The scripts](#5-the-scripts)
6. [Tier 3: a real device](#6-tier-3-a-real-device)
7. [Traps](#traps)

## 1. Tier 1: the scripted browser harness

This is the tier that actually finds bugs. An earlier, more elaborate approach (hundreds of lines of
in-browser dev tooling: a timeline scrubber panel, live spring sliders, a driver registry shipped to
production to feed a debug UI) was built, shipped, and never caught a single bug before being
deleted. What replaced it, and what does catch bugs, is much smaller: **driving a real headless
browser from a script and reading numbers out of it.**

**Scroll to a scene's *progress*, never to a raw pixel offset.** Pixel offsets rot the moment
content above the scene changes height, while progress (0→1 across the scene's own measured range)
stays meaningful regardless of what's above it:

```js
const base = await page.evaluate(() => {
  const s = document.querySelector('[data-scrub-stage]')
  return { top: s.getBoundingClientRect().top + scrollY, range: s.offsetHeight - innerHeight }
})
for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
  await page.evaluate(y => scrollTo(0, y), base.top + base.range * progress)
  await page.waitForTimeout(2500)                 // let any glide/spring settle — see below
  await page.screenshot({ path: `sweep_${progress}.png` })
}
```

The `waitForTimeout` matters: a value that's still gliding toward its target (a mode handoff, the
video playhead glide) needs real time to settle before a screenshot means anything. A couple of
seconds is enough for the exponential approaches this system uses, which converge to sub-visible
error well before that.

**Then tile the screenshots into one contact sheet.** A composition problem that's arguable staring
at one frame is obvious laid out across five or six side by side. This alone catches "the reveal
plays too early relative to arrival" faster than stepping through individually, because the eye
compares neighbours automatically.

**Read state, not just pixels.** `getAnimations()`, a computed `style.transform`, `offsetWidth`,
`getBoundingClientRect()`, a video's `currentTime`, `data-motion-state`: these turn "it looks a bit
off" into a specific, falsifiable claim: "`offsetWidth` is 402 where it should be 1128." Every real
bug found this way (§2) was found by reading one of these, not by looking harder at a screenshot.

**`window.__scrub()` needs `?fluid-debug` against a production build.** `ScrubStage`'s debug
readout (both engines) is off by default in production (it is internal state, not something to ship
live), which means it does not exist on the exact build a `next start`/production verification pass
runs against, only on a dev server. Append `?fluid-debug` to the URL being probed, or set
`document.documentElement.dataset.fluidDebug` before the component or module mounts (for example a
tiny inline script in the document head, for a harness that cannot control the URL), and the probe
attaches regardless of environment. The React port additionally exposes it unconditionally on a dev
build with no flag needed; the GSAP port is framework-free and has no reliable dev/production signal
to key off, so it requires the flag in both. Without the probe, a sweep script still has a fallback:
read the DOM contract directly (`video[data-motion-state]`, `currentTime`, the computed camera
`transform`) rather than calling `__scrub()`. `scripts/verify-motion.mjs` reads the contract, so it
works without the flag.

## 2. The three bugs it caught

Concrete, because "measure state, not pixels" is abstract until you see what it actually found:

| Symptom | Cause | Found by |
| --- | --- | --- |
| Copy faded out, then faded back in | A scroll-linked value had been promoted to a native accelerated timeline whose range disagreed with the JS scroll maths (`scroll-scenes.md` §6) | `getAnimations()` showed a real, running native animation with keyframes at the component's declared range, visible nowhere in source |
| A stat grid sat permanently invisible | A `display: contents` wrapper generates no box, so the `IntersectionObserver` watching it had nothing to observe and the reveal never fired | Computed style plus a direct IO check; invisible from reading the component's JSX, which looked entirely correct |
| "Animates too early and too fast" | The trigger fired at roughly a third of the element visible and settled hundreds of pixels before the element had actually arrived | Scripted scroll plus screenshots at fixed progress steps; not reproducible by scrolling manually at normal speed |

None of the three were visible from reading the source code in isolation. All three were found in
minutes once the harness existed. (The second is now a static check: `scripts/audit-motion.mjs`'s
`contents-reveal` rule flags a reveal trigger on a `contents` wrapper, including a responsive
`lg:contents`.)

## 3. Tier 2: marker CSS

A small (on the order of ~90 lines), zero-JS stylesheet toggled by one attribute on the root
element, so it works with no dev panel open, survives a plain screenshot, and works over a
USB-connected real device with no extra tooling:

```css
:root[data-motion-debug~='markers'] [data-scrub-stage]        { outline: 1px dashed #f59e0b; }
:root[data-motion-debug~='markers'] [data-stage]               { outline: 1px solid  #34d399; }
:root[data-motion-debug~='markers'] [data-motion-state='head'] { outline-color: #22c55e; }
:root[data-motion-debug~='markers'] [data-scroll-video],
:root[data-motion-debug~='markers'] [data-scroll-video] *      { outline: 2px solid #ef4444; }
```

A machine's mode attribute (`data-motion-state`, `attribute-contract.md` §3) is written only **on
transition**, not per frame, so a mode flipping is visible as a discrete colour change with nothing
else open: exactly the observability this needs, at no extra cost, because the latch rule
(`scroll-scenes.md` §3: state per transition, not per frame) already pays for it.

**If this tier is ever extended, the rule that keeps it safe is: the tool must not change what it
measures.** No `border` (it changes box size, which changes exactly the geometry being debugged), no
`position: relative` added purely to anchor a label (it creates a stacking context that didn't exist
before), no wrapper elements (they change the DOM structure a sticky/pin calculation depends on), no
`overflow: hidden` (it kills sticky, `scroll-scenes.md` §1). Outlines only, because `outline` is the
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

## 5. The scripts

Check each script's own `--help` for the current flag surface; the shapes below are the intended
contract.

- **`scripts/audit-motion.mjs <srcDir>`**: a static source scanner for the silent motion failure
  modes. Each finding carries a rule id, `file:line`, the snippet, a *why* and a *fix*. Rules:
  `motion-strict` (a `motion.*` component in a project running `LazyMotion strict`, where it
  throws at runtime), `fractional-amount` (a fractional `amount`, unsatisfiable on tall content),
  `contents-reveal` (a reveal trigger on a `display: contents` wrapper), `video-attrs` (a video
  missing `muted`/`playsInline`/a deliberate `preload`), `scroll-well-vs-smooth-scroll` (info: a
  scroll well alongside page-wide smooth scrolling), `lenis-with-scroll-well` (Lenis in the
  dependencies together with `PullToCentre`/`data-pull-to-centre`), and `gsap-pin-with-sticky-scene`
  (`pin: true` in the same file as `data-scrub-stage`/`ScrubStage`). `--selftest` runs every rule
  over its positive and negative fixtures and asserts each trips (or doesn't).
- **`scripts/verify-motion.mjs <url>`**: the runtime check. It step-scrolls the page with rAF plus a
  pause per step (a fast scroll outruns `IntersectionObserver` and gives false blanks), waits for the
  up-to-1.3s entrance to settle, and reports every `[data-stage-item]` still under full opacity. It
  drives each `[data-scrub-stage]` to progress `[0, 0.25, 0.5, 0.75, 1]` and records
  `data-motion-state` at each step. **It forces `document.documentElement.style.scrollBehavior =
  'auto'` for the duration of its stepped `scrollTo` calls and restores the old value afterwards.**
  A page with `html { scroll-behavior: smooth }` (`animation.css`'s default) would otherwise have
  each step's `scrollTo` cancel the previous step's still-in-flight smooth animation (the same
  mechanism as the scroll-well trap, `scroll-scenes.md` §8), and the harness would stall partway
  down the page. Measured: this made the reveal check fail in every cell (30/54 items read as
  hidden) on a page that set `scroll-behavior: smooth` globally, with no reveal bug in the actual
  components.
- **`scripts/anchor-check.mjs <url>`**: the one check that exercises a REAL smooth scroll through
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

## 6. Tier 3: a real device

Connect a physical phone, hit a dev server by local IP, use the browser's own remote-debugging
console. Nothing substitutes for this (not device emulation, and not a simulator for the class of
bug `ios-safari-motion.md` documents), and it remains, in practice, the least-frequently-done step
of the three, precisely because it has the most friction. Budget for it deliberately rather than
treating it as optional polish: video compositing demotion, the play watchdog, and toolbar feedback
into scroll geometry were *only* ever reproducible this way.

Two device-testing disciplines worth stating explicitly, because both have cost real cycles when
skipped:

- **Confirm the deployed build actually contains the fix before asking for a device test.**
  Build/CDN propagation lag is enough for a device test to run against the previous deployment and
  produce a false negative that reads as "the fix didn't work."
- **A result is only trustworthy from the device class and OS version it claims to fix.** A fix
  verified on one iOS version is not verified on another if the underlying WebKit behaviour changed
  between them (`ios-safari-motion.md` §1).

## Traps

- [ ] Sweeps scroll to scene *progress*, never raw pixel offsets (§1).
- [ ] Each sweep step waits for glides and springs to settle before a screenshot (§1).
- [ ] Claims are backed by read state (`getAnimations()`, rects, `currentTime`,
  `data-motion-state`), not by screenshots alone (§1).
- [ ] Production-build probes append `?fluid-debug` or read the DOM contract (§1).
- [ ] Debug markers use `outline` only: no border, wrapper, positioning or overflow (§3).
- [ ] "First frame, then snap" is checked against a stale stylesheet before any scroll code is read
  (§4).
- [ ] A green reveal run is not an anchor check; run `anchor-check.mjs` on pages with anchors or a
  scroll well (§5).
- [ ] `audit-motion.mjs --selftest` is green before trusting the audit (§5).
- [ ] The deployed build contains the fix before a device test (§6).
