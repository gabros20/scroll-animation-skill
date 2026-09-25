# Scroll authority: native, Lenis or ScrollSmoother

**Purpose:** Choose who owns scrolling on each page, wire it to one clock, and know exactly what each choice breaks.

**Read when:** a design asks for smooth or inertial scroll; a page mixes a smoother with pins, CSS scroll timelines,
Motion scroll tracking or WebGL; a project already runs Lenis or ScrollSmoother; anchors, modals or route changes
misbehave under a smoother.
**Skip when:** the page scrolls natively and nothing asks for smoothing (the default), and no symptom points here.

**Inputs:** the profile and routes from `ANIMATION.md`, the engines in use, whether WebGL tracks DOM elements.
**Produces:** one authority per route, wired through `assets/smooth/` (`createSmoothScroll`, `createSmoother`,
`SmoothScroll`), stamped on `<html data-scroll-authority>`.

## Contents

1. [One owner per page](#1-one-owner-per-page)
2. [What each owner breaks (measured)](#2-what-each-owner-breaks-measured)
3. [Native](#3-native)
4. [Lenis](#4-lenis)
5. [ScrollSmoother](#5-scrollsmoother)
6. [One tick](#6-one-tick)
7. [Mobile](#7-mobile)
8. [Route changes](#8-route-changes)
9. [Traps](#traps)

## 1. One owner per page

A page has exactly one scroll authority: **native** (the browser), **Lenis** (smooths the real scroll position) or
**ScrollSmoother** (GSAP; moves a transformed content wrapper). Two owners fight over the same position every frame.
Never run Lenis and ScrollSmoother together, never add `ScrollTrigger.normalizeScroll()` on a Lenis page, and never
leave CSS `scroll-behavior: smooth` on a page where ScrollTrigger or a smoother runs (GreenSock's mistake #9: it
corrupts ScrollTrigger's refresh pass, which scrolls to measure).

Decide per route: a reading route stays native while a cinematic home page smooths. The route-level
`SmoothScroll` provider (React) or `createSmoothScroll` / `createSmoother` (vanilla) starts the owner and removes it
when the route goes away or is hidden.

**Choose:**
- **Native** for reading-first and accessibility-first pages. Smooth the consumer instead (§3).
- **Lenis** when the design wants inertial scroll, when WebGL must line up with DOM elements, or when the page mixes
  sticky, CSS scroll timelines, Motion or third-party React components.
- **ScrollSmoother** when the page is GSAP-only, leans on `data-speed` / `data-lag` effects, and its fixed UI (the
  header) can live outside the content wrapper.

## 2. What each owner breaks (measured)

From `docs/research/spikes-2026-09.md` (Chromium 153, WebKit 26.6):

| | Native | Lenis | ScrollSmoother |
|---|---|---|---|
| `position: sticky` in content | yes | yes | **no**: pin with ScrollTrigger |
| `position: fixed` in content | yes | yes | **no**: keep fixed UI outside the wrapper |
| CSS `scroll()` / `view()` timelines | yes (Chromium 115+, Safari 26+; not Firefox stable) | frame-exact in Chromium; **Safari reads the previous frame** | **no**: `view()` stays at 0 |
| CSS scroll-snap | yes | **no**: use `lenis/snap` | no |
| Motion `useScroll` | yes | yes, with the Motion driver (§6) | **no while moving**: it reads the unsmoothed scroll (up to 244 px off) |
| IntersectionObserver, `whileInView` | yes | yes | yes (fires on visual entry) |
| ScrollTrigger | yes | `lenis.on('scroll', ScrollTrigger.update)` | built in |
| WebGL tracking DOM elements | lags the DOM by a frame (compositor scroll) | same frame with `advance()` (§6) | same frame |
| Frame rate | native (120 Hz ProMotion) | capped at 60 fps in Safari, 30 in Low Power Mode | GSAP ticker |
| Anchors, find-in-page | native | through `lenis.scrollTo` (our handler) | `smoother.scrollTo` |
| Iframes | yes | wheel over an iframe doesn't scroll | yes |

## 3. Native

The default. Wheel scrolling on a mouse arrives in steps, so smooth the **consumer**, not the input:
- GSAP: `scrub: 0.3`–`1` (seconds of catch-up) on scrubbed timelines.
- Motion: `useSpring` on a scroll value that feeds visuals only (never a latch or threshold).
- Render loops: three's `MathUtils.damp(current, target, lambda, dt)` (frame-rate independent), never a constant
  per-frame lerp.

Anchors: `html { scroll-padding-top: var(--header-h) }` keeps targets below a fixed header. Add
`scroll-behavior: smooth` only when no ScrollTrigger runs on the page; Next.js also needs
`<html data-scroll-behavior="smooth">` for its router to respect it.

## 4. Lenis

```ts
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { createSmoothScroll, gsapDriver } from './smooth/lenis'

const scroll = createSmoothScroll({ driver: gsapDriver(gsap, ScrollTrigger), lenis: { lerp: 0.1 } })
// later: scroll.destroy()
```

React: `<SmoothScroll authority="lenis" driver={gsapDriver(gsap, ScrollTrigger)}>` in the route group's layout
(`motionDriver(frame, cancelFrame)` on Motion-only routes). Rules:

- **Lenis never runs its own loop.** `createSmoothScroll` forces `autoRaf: false`; the driver is the clock. Core
  `lenis` defaults `autoRaf` to false, but `lenis/react`'s `ReactLenis` defaults it to **true**: in a brownfield
  project using `ReactLenis` with GSAP, set `autoRaf: false` and hook the ticker, or it runs two loops.
- **Smooth once.** Under Lenis, GSAP scrubs use `scrub: true` and Motion reads raw `useScroll()`. Measured: a
  `useSpring` on top of Lenis trails the scroll by 16–18 frames (about 0.3 s).
- **CSS scroll timelines**: fine for decoration (progress bars, fades, gentle parallax). In Safari they read the
  previous frame's scroll under Lenis, so anything that must stay registered to moving content is driven from Lenis's
  tick (GSAP or Motion), not a CSS timeline.
- **Anchors**: `createSmoothScroll` handles same-page `#hash` links itself, offset by the fixed header
  (`HEADER_HEIGHT_VAR`), and pushes the hash.
- **Modals and menus**: `currentSmoothScroll()?.stop()` on open, `.start()` on close. Never `position: fixed` on the
  body over a playing video (Safari drops the video's layer).
- **Nested scrollers** (a code block, a map, a chat panel): `data-lenis-prevent` on the element.
- **Scroll-snap**: CSS snap doesn't work under Lenis; use `lenis/snap`, or keep that route native.
- **Reduced motion**: `createSmoothScroll` returns a native handle and never creates Lenis.
- **Reload mid-page**: the browser restores the scroll position before Lenis starts; `createSmoothScroll` starts
  Lenis there instead of jumping to 0.
- **Velocity**: `lenis.velocity` is the smoothed velocity. Logic that branches on scroll speed sees the lerp's
  curve, not the reader's gesture.

## 5. ScrollSmoother

```html
<header class="site-header">…</header>            <!-- fixed UI outside the wrapper -->
<div id="smooth-wrapper"><div id="smooth-content">…</div></div>
```
```ts
import { ScrollSmoother } from 'gsap/ScrollSmoother'
gsap.registerPlugin(ScrollTrigger, ScrollSmoother)
const scroll = createSmoother(ScrollSmoother, { smooth: 1, effects: true })
```

- Every scroll-linked value comes from ScrollTrigger, pins included (`pin: true`, since sticky is off). Entrances may
  use IntersectionObserver or Motion's `whileInView`; Motion `useScroll` and CSS scroll timelines are out.
- `data-speed` (with `"auto"` for an image moving inside its frame) and `data-lag` need `effects: true`. Use
  `clamp(…)` on above-the-fold speeds so elements don't start displaced.
- Header ink that follows sections must read `smoother.scrollTop()`, not `window.scrollY`, which runs ahead of what the
  reader sees.
- Print: the wrapper prints one viewport unless print CSS unwraps it (`accessibility.md` §6).
- ScrollSmoother is free (GSAP 3.13+). It still costs sticky, fixed and CSS timelines inside the content, which is why
  Lenis is the choice whenever the page mixes engines.

## 6. One tick

Values that must line up on screen are produced and consumed in one frame callback, producer first. Measured
(frames late, Chromium / WebKit):

| Producer → consumer | Wiring | Late |
|---|---|---|
| Lenis → ScrollTrigger scrub | `gsapDriver`: ticker → `lenis.raf` → `ScrollTrigger.update` | 0 / 0 |
| Lenis → ScrollTrigger scrub | Lenis on its own loop, no `scroll` hookup | 1 / 1 |
| Lenis → Motion `useScroll` | `motionDriver`: `frame.setup` + a dispatched `scroll` event | 0 / 0 |
| Lenis → Motion `useScroll` | Lenis driven from `frame.update` | 1 / 1 |
| Lenis → R3F plane on a DOM box | `<Canvas frameloop="never">` + `advance()` from the GSAP ticker after Lenis | 0 |
| Lenis → R3F plane on a DOM box | `frameloop="demand"` + `invalidate()` | 1 on every other frame |

A scene's scroll-coupled values come from one engine. `frameloop="demand"` suits a canvas that doesn't track DOM
elements. Independent effects may keep their own IntersectionObserver-gated loops.

## 7. Mobile

- `setupGsap()` sets `ScrollTrigger.config({ ignoreMobileResize: true })`: an iOS toolbar show/hide fires `resize`
  without a layout change, and re-measuring would make every pin below the first jump.
- `ScrollTrigger.normalizeScroll(true)` is a separate, heavier fix for pins that still jump on iOS under native
  scrolling. Try it only there, test on a device, and never with Lenis.
- Lenis leaves touch scrolling native (`syncTouch: false`): keep it that way unless the design needs synced touch.
- Size pins in `lvh` (never `dvh`, which re-lays out while the toolbar animates).

## 8. Route changes

- The authority belongs to the route: `SmoothScroll` in the route group's layout, created in a layout effect and
  destroyed in its cleanup. Under Next's Cache Components that cleanup also runs when a route is hidden by
  `<Activity>`, so a hidden route never keeps a Lenis instance or a stale stamp.
- GSAP work on a route lives in `useGSAP(() => …, { scope })`, which reverts it on unmount and on hide.
- After a transition settles (fonts loaded, images sized), call `ScrollTrigger.refresh()` once. Reading a
  ScrollTrigger's progress before that returns stale numbers (up to 300 px off after content above it moves).

## Traps

- [ ] One authority per route, stamped on `<html data-scroll-authority>`; no second smoother, no `normalizeScroll` with
      Lenis, no `scroll-behavior: smooth` with ScrollTrigger.
- [ ] Lenis runs on the page's engine clock (`gsapDriver` / `motionDriver`), never `autoRaf`; `ReactLenis` in a GSAP
      project has `autoRaf: false`.
- [ ] Smoothing happens once: `scrub: true` and raw `useScroll` under a smoother.
- [ ] Under ScrollSmoother: no sticky, no CSS timelines, no Motion `useScroll` inside the content; fixed UI outside.
- [ ] Under Lenis in Safari: CSS timelines only for decoration.
- [ ] Modals call `stop()` / `start()`; nested scrollers carry `data-lenis-prevent`.
- [ ] `ScrollTrigger.refresh()` runs once after layout settles on each route.
