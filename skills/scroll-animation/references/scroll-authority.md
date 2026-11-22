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
8. [Placements and route changes](#8-placements-and-route-changes)
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
- **Default for a smoothed desktop page: Lenis, with one geometry.** Touch and Safari scroll natively either way,
  and there CSS sticky and CSS scroll timelines are the right tools. Lenis keeps them working on desktop too, so
  the page is built once. ScrollSmoother turns sticky and CSS timelines off inside its wrapper, so every sticky
  element, scene and parallax needs a second, GSAP-written geometry for desktop alone. Measured on one production
  page that moved from ScrollSmoother to Lenis (Chrome desktop, 4× CPU, 2026-11): paint 310 → 114 ms, raster
  32 → 11 ms, slowest frame 33 → 17 ms. One site; the direction, not the numbers, is the rule. Override when: the
  design depends on `data-speed` / `data-lag` or another ScrollSmoother-only effect, and the page has few sticky
  elements to rebuild.
- **The owner per device** (native on touch, a smoother on desktop) can't be known on the server. On React, render
  `<SmoothScroll authority="native">` first and switch after hydration (`useSyncExternalStore` with a `'native'`
  server snapshot); the blocks don't choose it for you yet.
- **GSAP-only, and Safari or 120 Hz screens matter:** a trade-off, never a default. Only native scrolling gets
  Safari's full-rate compositor scroll. Lenis is capped at 60 fps there (§2); ScrollSmoother is unmeasured, and likely
  capped too: it moves the content from the same `requestAnimationFrame` ticker. On a phone both scroll natively
  (ScrollSmoother doesn't smooth touch by default, `smoothTouch`), and a GSAP pin or scrub on content that moves with
  the page paints a frame behind iOS's compositor scroll: jitter. Until the blocks choose the scroller per device, a
  route that takes ScrollSmoother can skip it when `ScrollTrigger.isTouch === 1` and pin with CSS sticky there; keep
  GSAP scrubs off content that moves with the page.

## 2. What each owner breaks (measured)

From the skill's own browser measurements (spikes S1–S7, September 2026; Chromium 153, WebKit 26.6):

| | Native | Lenis | ScrollSmoother |
|---|---|---|---|
| `position: sticky` in content | yes | yes | **no**: pin with ScrollTrigger |
| `position: fixed` in content | yes | yes | **no**: keep fixed UI outside the wrapper |
| CSS `scroll()` / `view()` timelines | yes (Chromium 115+, Safari 26+; not Firefox stable) | frame-exact in Chromium; **Safari reads the previous frame** | **`view()` no**: it stays at 0; `scroll(root)` runs on the unsmoothed scroll |
| CSS scroll-snap | yes | **no**: use `lenis/snap` | no |
| Motion `useScroll` | yes | yes, with the Motion driver (§6) | **no while moving**: it reads the unsmoothed scroll (up to 244 px off) |
| IntersectionObserver, `whileInView` | yes | yes | yes (fires on visual entry) |
| ScrollTrigger | yes | `lenis.on('scroll', ScrollTrigger.update)` | built in |
| WebGL tracking DOM elements | lags the DOM by a frame (compositor scroll) | same frame with `advance()` (§6) | same frame |
| Frame rate | native (120 Hz ProMotion) | capped at 60 fps in Safari, 30 in Low Power Mode | GSAP ticker |
| Anchors, find-in-page | native | through `lenis.scrollTo` (our handler) | `smoother.scrollTo` |
| Iframes | yes | wheel over an iframe doesn't scroll | yes |
| Reduced motion (followed live) | native | Lenis torn down: native scrolling | native mode (`smooth: 0`): wrapper in flow, no effects |
| Touch-only screens (phones) | native | native touch (`syncTouch: false`) | native mode without `smoothTouch`; effects still run (§5) |

## 3. Native

The default. Wheel scrolling on a mouse arrives in steps, so smooth the **consumer**, not the input:
- GSAP: `scrub: 0.3`–`1` (seconds of catch-up) on scrubbed timelines.
- Motion: `useSpring` on a scroll value that feeds visuals only (never a latch or threshold).
- Render loops: three's `MathUtils.damp(current, target, lambda, dt)` (frame-rate independent), never a constant
  per-frame lerp; a lerp `k` tuned at 60 Hz converts as `1 - (1 - k) ** (dt * 60)`, `dt` in seconds.

Anchors: `html { scroll-padding-top: var(--header-h) }` keeps targets below a fixed header. Add
`scroll-behavior: smooth` only when no ScrollTrigger runs on the page; Next.js also needs
`<html data-scroll-behavior="smooth">` for its router to respect it. A ScrollTrigger refresh stops a native smooth
`scrollTo` part-way (observed on GSAP 3.15), so a jump that must land goes through the authority's handle with
`immediate`.

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
  tick (GSAP or Motion), not a CSS timeline (`css-scroll-effects.md` §4).
- **Anchors**: `createSmoothScroll` handles same-page `#hash` links itself, offset by the fixed header
  (`HEADER_HEIGHT_VAR`), and pushes the hash. It focuses the target without a scroll, so a "Skip to content" link
  works: the next Tab continues from there, as after a native fragment jump (a section gets `tabindex="-1"` while it
  holds focus). A modified click, `target="_blank"` and `download` stay the browser's. `pushState` never updates
  `:target`: style the landed section from a class the page sets, because setting `location.hash` jumps.
- **Modals and menus**: `currentSmoothScroll()?.stop()` on open, `.start()` on close. Never `position: fixed` on the
  body over a playing video (Safari drops the video's layer).
- **Nested scrollers** (a code block, a map, a chat panel): `data-lenis-prevent` on the element.
- **Scroll-snap**: CSS snap doesn't work under Lenis; use `lenis/snap`, or keep that route native.
- **Reduced motion**: followed live. While it's on there is no Lenis: the page scrolls natively and the stamp reads
  `native`. When the visitor changes the setting mid-visit, Lenis is torn down, or started again at the reader's
  position. The handle stays the same object, and a modal's `stop()` holds across the switch.
- **Two Lenis routes under one layout** keep one Lenis alive across the navigation, and a glide in flight overrides
  the router (S9: the new route landed at its bottom). The handle takes up the router's position itself (§8).
- **Reload mid-page**: the browser restores the scroll position before Lenis starts; `createSmoothScroll` starts
  Lenis there instead of jumping to 0.
- **Velocity**: `lenis.velocity` is the smoothed velocity. Logic that branches on scroll speed sees the lerp's
  curve, not the reader's gesture.
- **`lerp` or `duration`, never both.** In Lenis 1.3 a numeric `duration`, or an `easing` alone (it sets `duration`
  to 1), takes over and `lerp` is ignored, whatever the README says.

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

On React, `SmoothScroll` renders the wrapper and starts it (it imports no GSAP: you pass the factory):

```tsx
const smoother = () => createSmoother(ScrollSmoother, { smooth: 1 })   // module scope
<SmoothScroll authority="smoother" create={smoother}>{children}</SmoothScroll>
```

- **Start it with `createSmoother`**, never `ScrollSmoother.create()` by hand. The blocks read the owner from the
  `<html data-scroll-authority>` stamp, and a smoother started by hand leaves none, so every block treats the page as
  native: `data-scroll-fx="fade-in"` content stays at opacity 0, the recipes add 0.5 s of catch-up on top of the
  smoother's own, and stepped sections and the scroll well run against it.
- Every scroll-linked value comes from ScrollTrigger, pins included (`pin: true`, since sticky is off). Entrances may
  use IntersectionObserver or Motion's `whileInView`; Motion `useScroll` and `view()` are out. A `scroll(root)`
  progress bar outside the wrapper runs, a little ahead of the smoothed page (`css-scroll-effects.md` §4).
- `data-speed` (with `"auto"` for an image moving inside its frame) and `data-lag` need `effects: true`. Use
  `clamp(…)` on above-the-fold speeds so elements don't start displaced (`layered-visuals.md` §2).
- A header ink probe reads no scroll position, `smoother.scrollTop()` included. The `header-theme` block watches a 1 px
  IntersectionObserver strip, which fires on what the reader sees under every authority. Measured under
  ScrollSmoother, `window.scrollY` disagreed with the screen on 105–214 frames per pass; the ink never followed it and
  stayed within a frame of the screen in 18 runs (`layered-visuals.md` §10).
- Print: the wrapper prints one viewport unless print CSS unwraps it (`accessibility.md` §6).
- Focus: ScrollSmoother jumps a newly focused element to the viewport's centre on `focusin` (observed on 3.15). A
  block that brings focused content into view itself waits a frame for that jump to land, then corrects through the
  handle with `immediate`, as the horizontal rail does (scenes.md §14).
- **Reduced motion** runs ScrollSmoother in its native mode (`smooth: 0`) with effects off: the wrapper is back in
  flow, nothing is transformed, no `data-speed` / `data-lag`, and the handle's `scrollTo` jumps. `createSmoother`
  follows the setting live by re-creating the smoother on the same wrapper; the stamp stays `smoother`. Never kill a
  ScrollSmoother alone: every ScrollTrigger made while it runs is bound to its wrapper, and a kill strands them (they
  stop updating while the page scrolls on).
- **Touch-only screens** (`ScrollTrigger.isTouch` 1: a phone) get the same native mode unless `smoothTouch` is set
  (GSAP: "by default, ScrollSmoother will NOT apply scroll smoothing on touch-only devices"): the wrapper in flow, the
  content untransformed, the page scrolling natively. Every ScrollTrigger still reads the wrapper, a proxy the
  smoother's own trigger sets to the window's scroll first in each update, and IntersectionObserver sees the native
  scroll, so triggers fire as on a native page (measured on the iOS 18.6 simulator with touch pans). `data-speed` and
  `data-lag` keep running there, written from the main thread as the page scrolls (measured in Playwright's WebKit
  with touch emulation). A reload mid-page is a jump: iOS Safari restores the position after the scripts ran, past
  every trigger above it (`entrances.md` §5).
- **Resizes**: `createSmoother` turns off ScrollSmoother's `autoResize` and runs a full, safe
  `ScrollTrigger.refresh(true)` when the content resizes (mid-scroll it waits for the scroll to end). GSAP 3.15's own
  resize refresh covers only the smoother's trigger, so the page's other triggers keep stale positions, and one
  landing in the first 0.5 s after creation replays the scroll from the top on a page that is already scrolled (a
  reload mid-page).
- **A link with a hash** (`/page#section`) lands on its target: the browser's own fragment jump loses the race with
  the smoother (no scroll height until its first refresh, which puts back the scroll it recorded), so `createSmoother`
  jumps there itself, once, after that refresh, with a native anchor's landing (`scroll-padding-top` plus
  `scroll-margin-top`).
- ScrollSmoother is free (GSAP 3.13+). It still costs sticky, fixed and `view()` timelines inside the content, which is
  why Lenis is the choice whenever the page mixes engines.

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
| Motion `useScroll` → R3F canvas in a pin | `advance()` in Motion's `frame.render` | 0 |
| Motion `useScroll` → R3F canvas in a pin | `frameloop="demand"`, or a page rAF | 1 |

A scene's scroll-coupled values come from one engine. `frameloop="demand"` suits a canvas that doesn't track DOM
elements. A canvas in a pinned scene renders on this tick through `render-bridge`, only when something changed
([webgl.md](webgl.md) §4). Independent effects may keep their own IntersectionObserver-gated loops.

## 7. Mobile

- `setupGsap()` sets `ScrollTrigger.config({ ignoreMobileResize: true })`: an iOS toolbar show/hide fires `resize`
  without a layout change, and re-measuring would make every pin below the first jump.
- `ScrollTrigger.normalizeScroll(true)` is a separate, heavier fix for pins that still jump on iOS under native
  scrolling. Try it only there, test on a device, and never with Lenis.
- Lenis leaves touch scrolling native (`syncTouch: false`): keep it that way unless the design needs synced touch.
- Size pins in `lvh` (never `dvh`, which re-lays out while the toolbar animates).

## 8. Placements and route changes

**Law.** An authority smooths the reader's input and nothing else. A scroll it did not cause (the router's jump to
the top or a hash, the browser's back/forward restore, an anchor, find-in-page, a focus scroll) is a placement: the
handle takes it up at once (`adopt()`), never gliding toward it. Before this rule the route called `sync()` once,
from a component whose position in the tree decided whether the scroll was placed yet; measured on 2.1.2's blocks,
Chromium 157, 2026-11: with that component before the page, ScrollSmoother's content sat off the scroll position
for 56 of 95 frames after a link (up to 1911 px), and for 53 of 94 after back, wherever it sat.

| Authority | A scroll is a placement when | Why that test |
|---|---|---|
| native | always | the native position is the position |
| Lenis | Lenis is mid-glide and the native position is more than 2 px from the one it last wrote | Lenis writes the position every frame; any other is someone else's. Not gliding, Lenis takes a native scroll as its own already (source lenis@1.3.26, `onNativeScroll`) |
| ScrollSmoother | no scroll input (wheel, touch, a scroll key) came in the last 200 ms, or a visit began in the last 100 ms | it leaves the native scroll to the browser, so position can't tell; input can. A reader who flicks the wheel and clicks a link has recent input, and the router's jump is still a placement: the lifecycle's visit says so |

- **Three mechanisms, and what each is for.** (1) The tests in the table follow any placement, with or without a
  lifecycle: in-page ones (an anchor, find-in-page, a focus scroll, a late back/forward restore) have nothing else.
  (2) A visit resets the input clock and opens a 100 ms window, for ScrollSmoother only: wheel events still
  arriving between the route's commit and its placement's `scroll` event would otherwise make the router's jump
  look like input. (3) Both authorities adopt once more two frames after a visit begins, for a route change that
  doesn't move the scroll and so fires no event, but still changes the page's height (Lenis's limit). (2) could be
  dropped at the cost of up to two frames of glide before (3) corrects it; that cost is reasoned, not measured.
- The handle's own animated `scrollTo` is neither input nor placement.
- **Default.** 200 ms and 100 ms (`INTENT_MS`, `VISIT_WINDOW_MS`). Override when: a keyboard scroll is cut short
  (raise `INTENT_MS`). A scrollbar drag fires no input event in most browsers, so under ScrollSmoother the content
  follows the thumb unsmoothed (unverified per browser).
- Measured in Chromium only. WebKit and Firefox: unverified; if the rule fails there, the fallback is a re-sync over
  the two frames after a traverse.
- **Check.** `verify-motion.mjs <url> --nav`; `tests/route-hygiene.mjs` F4 and F5.

- The authority belongs to the route: `SmoothScroll` in the route group's layout (`authority="native" | "lenis" |
  "smoother"`), created in a layout effect and destroyed in its cleanup. Under Next's Cache Components that cleanup
  also runs when a route is hidden by `<Activity>`, so a hidden route never keeps a Lenis instance or a stale stamp.
- GSAP work on a route lives in `useGSAP(() => …, { scope })`, which reverts it on unmount and on hide.
- **Each client navigation is a visit of the page lifecycle** (`<PageLifecycle route={usePathname()} />` anywhere in
  the root layout, or `page.begin()` from another router's hook): it runs the refreshes the GSAP routes registered
  once, after the router placed the scroll, and again as a streamed route settles. Nothing syncs the authority: it
  follows. The router owns the position: never scroll from route code, and keep `history.scrollRestoration` at
  `'auto'`. [lifecycle.md](lifecycle.md) "Route change".
- Late fonts and images still need a refresh once they settle (`page.remeasure()`): a ScrollTrigger read before it
  is up to 300 px off after content above it moves (S5).
- A scene re-created above the viewport (a route shown again) brings its runway back there. WebKit's scroll anchoring
  then moves the page by the runway's height to keep what the reader sees in place (measured 1708 → 3645 px on a
  rail's re-create); Chromium and Firefox keep the offset. Restore the reader's place after the re-create.

## Traps

- [ ] One authority per route, stamped on `<html data-scroll-authority>`; no second smoother, no `normalizeScroll` with
      Lenis, no `scroll-behavior: smooth` with ScrollTrigger.
- [ ] Lenis runs on the page's engine clock (`gsapDriver` / `motionDriver`), never `autoRaf`; `ReactLenis` in a GSAP
      project has `autoRaf: false`.
- [ ] Smoothing happens once: `scrub: true` and raw `useScroll` under a smoother.
- [ ] ScrollSmoother starts through `createSmoother`; no sticky, no `view()`, no Motion `useScroll` inside the content;
      fixed UI outside.
- [ ] Under Lenis in Safari: CSS timelines only for decoration.
- [ ] Modals call `stop()` / `start()`; nested scrollers carry `data-lenis-prevent`.
- [ ] Nothing kills a ScrollSmoother without re-creating it: its triggers are bound to the wrapper.
- [ ] Each client navigation begins one visit (`<PageLifecycle>` or `page.begin()`); no route code syncs or scrolls;
      `scrollRestoration` stays `'auto'`.
