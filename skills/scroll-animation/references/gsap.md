# GSAP

**Purpose:** Write GSAP the way the blocks do: one setup, cleanup per route (`useGSAP` in React, `mount(routeRoot)` on
vanilla pages), section timelines, triggers created in page order and kept fresh, live reduced motion that never
throws the reader to the top, and the plugins, all free.

**Read when:** a route runs GSAP (ScrollTrigger timelines, `useGSAP`, `gsap.context`, `gsap.matchMedia`, `quickTo`,
the ticker with Lenis, a vanilla page's `mount()`, or a plugin); or triggers fire early, point at stale positions,
stack up after a navigation, or a rotation throws the page to the top.
**Skip when:** the route has no GSAP ([motion.md](motion.md), [css-scroll-effects.md](css-scroll-effects.md)), or a
block's own reference covers the job: a pinned scene ([scenes.md](scenes.md)), split text ([text.md](text.md)).

**Inputs:** the route's framework (React or none), its scroll authority, the GSAP code in question.
**Produces:** GSAP code on `gsap/setup.ts`, cleaned up per route, with triggers in page order and reduced motion
followed live.

## Contents

1. [Setup](#1-setup)
2. [React: useGSAP](#2-react-usegsap)
3. [Vanilla pages: mount](#3-vanilla-pages-mount)
4. [Section timelines](#4-section-timelines)
5. [Function values and refresh](#5-function-values-and-refresh)
6. [Creation order and refreshPriority](#6-creation-order-and-refreshpriority)
7. [The matchMedia scroll-to-top trap](#7-the-matchmedia-scroll-to-top-trap)
8. [quickTo and the ticker](#8-quickto-and-the-ticker)
9. [Pins under each authority](#9-pins-under-each-authority)
10. [GreenSock's eleven ScrollTrigger mistakes](#10-greensocks-eleven-scrolltrigger-mistakes)
11. [The plugins](#11-the-plugins)
12. [Working alongside gsap-skills](#12-working-alongside-gsap-skills)
13. [Traps](#traps)

## 1. Setup

```ts
import { setupGsap } from './gsap/setup'
import { SplitText } from 'gsap/SplitText'
setupGsap({ plugins: [SplitText] })         // once, client-side, before any block runs
```

- **`setupGsap()` is idempotent.** It registers ScrollTrigger and CustomEase, turns the measured curves in `config.ts`
  into CustomEases (`ease: EASES.entrance`), sets `ScrollTrigger.config({ ignoreMobileResize: true })` (an iOS toolbar
  isn't a layout change) and marks the engine ready, which switches off the CSS failsafe.
- **Every plugin is free** since GSAP 3.13: "100% free", every plugin, commercial use included. `npm i gsap`, import
  from `gsap/<Plugin>`, pass it to `setupGsap`. No licence setup and no `.npmrc` token. In React, register `useGSAP`
  from `@gsap/react` the same way.
- **`MOTION_CONDITIONS`** (`reduce`, `motion`) are the only conditions for a `gsap.matchMedia()` build that creates
  ScrollTriggers (§7). **`CONDITIONS`** adds `desktop` and `mobile`, for builds that create none.
- **`lineFromMargin(margin)`** turns an IntersectionObserver `rootMargin` into ScrollTrigger positions, so a GSAP
  trigger fires on the engine-free blocks' line: `TRIGGERS.reveal` (`0px 0px -20% 0px`) is `start: 'top 80%'`,
  `end: 'bottom top'`.

## 2. React: `useGSAP`

```tsx
'use client'
const root = useRef<HTMLElement>(null)
useGSAP(() => {
  const scene = pinnedScene(root.current!)   // a timeline on it: onBuild and onProgress, §4
  return () => scene.destroy()
}, { scope: root })
```

- **`useGSAP` replaces `useEffect` for GSAP.** It runs your function in a `gsap.context()`, which reverts what it made
  (tweens, ScrollTriggers, SplitText) on unmount and when Next's `<Activity>` hides the route, so React StrictMode's
  double effect never stacks duplicate triggers. `scope` confines selector text to the component.
- **The blocks are plain functions** `(el, options)` that return a handle with `destroy()`. Call them inside
  `useGSAP` and return their `destroy()`. React never needs `mount()`.
- **Animations made later** (on a click, after a timer) are outside the context: wrap the handler in the
  `contextSafe()` that `useGSAP` returns, or they outlive the component.
- `dependencies` re-run the function; `revertOnUpdate: true` reverts first. Never let React update text that SplitText
  split: key the element by its content ([text.md](text.md) §6).
- **Observed on GSAP 3.15.0, not documented:** `revert()` reverts the recorded animations before it calls the cleanup
  your function returned, and `useGSAP` (@gsap/react 2.1.2) inherits that order. So in React a block's `destroy()`
  runs after its tweens have reverted, while `mount()` destroys first (§3). Write cleanups that hold in either order.

## 3. Vanilla pages: `mount`

```ts
setupGsap({ plugins: [ScrollSmoother] })
const scroll = createSmoother(ScrollSmoother, { smooth: 1, effects: true })   // the authority first
mountHeaderTheme(document.querySelector<HTMLElement>('[data-header]')!)       // page chrome, outside the route
const unmount = mount(document.querySelector('main')!, {
  '[data-scene-root]:not([data-rail])': (el) => pinnedScene(el, { pin: 'gsap' }),
  '[data-rail]': (el) => horizontalRail(el, { pin: 'gsap' }),
  '[data-reveal]': (el) => reveal(el),
})
// unmount() when the route goes away or is hidden
```

- **`mount(root, blocks)`** runs each block function on every element its selector matches inside `root` (never
  `root` itself). A function returns a handle with `destroy()`, a cleanup function, or nothing.
- **Document order, across block types.** All matches are created top to bottom, so ScrollTrigger refreshes them in
  page order (§6). An element two selectors match gets both, in the order `blocks` lists them; keep a block off
  elements another covers (a rail is a pinned scene, so the scene's selector excludes rails).
- **One `gsap.context(…, root)`** records what the blocks make, and selector text given to GSAP inside it resolves in
  `root`. ScrollTrigger then refreshes once.
- **The cleanup** destroys every block in reverse order, even if one throws, then reverts the context. A block that
  throws while mounting leaves nothing behind. Mounting a live root returns its cleanup; after the cleanup the root
  can mount again, as a route shown again does.
- **The root is a route's root**, never `document` or `<html>` (a TypeError): Next's `<Activity>` keeps a hidden
  route's DOM in the document, and an MPA swaps the route, not the page. Start the scroll authority first, so every
  trigger binds to it. Never call `mount()` inside a `gsap.matchMedia()` callback (§7).
- **This is GreenSock's mistake #11 turned into a design:** kill a route's triggers when it goes and re-create them
  when it comes back. An MPA needs no cleanup on `pagehide`; a client router calls it.
- **Your own GSAP code** outside a block: `const ctx = gsap.context(() => { … }, root)`, then `ctx.revert()` when the
  route goes. `ctx.add()` records work that runs later, such as a click handler's tween.
- **Observed on 3.15.0:** a tween made in a `delayedCall`'s callback is recorded in the context the `delayedCall` was
  made in; one made in a `setTimeout` isn't, as the docs warn for anything that runs later. The matchMedia docs call a
  context around `gsap.matchMedia()` "redundant": `mount`'s context spans many blocks, each owning its own matchMedia,
  which is a different job.

## 4. Section timelines

- **One timeline per section, never a page master.** A master couples the sections: editing section 3 renumbers 4 to
  10. The ScrollTrigger goes on the section's top-level timeline or tween, never on a tween nested in a timeline, where
  both try to own the playhead (mistake #1).
- **A timeline pays off at about four named spans** on one ruler with relative positions. Below that, give each
  element its own trigger.
- **Labels name the spans**: `tl.addLabel('scroll', 1)`, then tweens at `'scroll'` or `'scroll+=0.2'`. Give a
  scrubbed timeline `defaults: { ease: 'none' }`: the reader's scroll is the easing.
- **Drive a paused timeline from a scene's exact progress**, which is `scrub: true` without a second trigger (one
  created inside the scene's rebuild would move the reader, §7). Build it in `onBuild`, so reduced motion is live:

```ts
let tl: gsap.core.Timeline | null = null
const scene = pinnedScene(root, {
  onBuild: (c) => {
    if (c.reduce) return                     // reduced motion: no timeline, the CSS resting state
    tl = sectionTimeline(root)               // gsap.timeline({ paused: true, defaults: { ease: 'none' } }), labelled
    return () => { tl?.revert(); tl = null }
  },
  onProgress: (p) => tl?.progress(p),
  onRehydrate: ({ p }) => tl?.progress(p),
})
```

- **Smooth once.** Under Lenis or ScrollSmoother a scrub is `scrub: true`. Under native scrolling a number is seconds
  of catch-up (`scrub: 0.5`): a lag, not a spring.
- **A scrub lasts its scroll distance** (mistake #10): lengthen `end`, not `duration`.
- **`fromTo()` on a property two triggers animate** (mistake #2): a `to()` caches its start value when it's created.
- **`easeReverse`** (3.15) gives a tween its own ease when its playhead runs backwards, so an ease-out stays an
  ease-out on the way back: `easeReverse: true`, or an ease name.

## 5. Function values and refresh

- **A value that depends on the viewport is a function** (mistake #4): `end: () => '+=' + el.offsetHeight`, with
  `invalidateOnRefresh: true` so the tween's values are re-read on every refresh. On a viewport-scaled layout use
  `scaledValue(n)` and `scaledEnd(n)` from `scale.ts` ([scenes.md](scenes.md) §12).
- **Refresh after late content** (mistake #7): fonts, images without dimensions, a late mount. The blocks keep
  themselves fresh (scenes share a ResizeObserver on `<body>`, a rail watches its track, `createSmoother` refreshes on
  a content resize), but your own triggers need `ScrollTrigger.refresh()`: a content shift above one left it 300 px
  stale (spike S5: S1–S7 are the skill's own browser measurements, September 2026).
- **Read progress in the tick after `ScrollTrigger.update`**, never straight after a programmatic `scrollTo`, where it
  still held the pre-jump value, 825 px off (S5).
- **A start before scroll 0 jumps on load** (mistake #8): `start: 'clamp(top bottom)'` (3.12+) keeps it on the page.
- **A transform on the trigger element moves its start and end** (−96 px at centre, measured): measure an untransformed
  element, or take the transform off in `refreshInit`, as `parallax` does.

## 6. Creation order and `refreshPriority`

- **Create triggers in page order**, top to bottom. ScrollTrigger refreshes them in creation order, and a pin's spacing
  moves every trigger after it. GreenSock "strongly" recommends page order, and says `refreshPriority` is then "VERY
  unlikely" to be needed. `mount()` does it for you.
- **When creation can't follow the page** (async content), set `refreshPriority`: **higher refreshes earlier**. The
  docs: `refreshPriority: 1` refreshes before `0`, the default. So the highest section on the page gets the highest
  number. GreenSock's own `gsap-skills` says "Lower = refreshed first": follow the docs. `ScrollTrigger.sort()` reorders
  them too.
- **The scroll authority first**: under ScrollSmoother every trigger binds to its wrapper. There, create
  `colour-track` after the pinned scenes, which pin through ScrollTrigger.

## 7. The matchMedia scroll-to-top trap

Measured on GSAP 3.15 in Chromium, WebKit and Firefox: when a `gsap.matchMedia()` condition changes, a ScrollTrigger
created or killed during the rebuild leaves the page at scroll 0. The rebuilt trigger's own refresh zeroes the
recorded scroll, and the refresh after it keeps it. So rotating an iPad across the desktop breakpoint throws the
reader to the top.

- **A build that creates ScrollTriggers uses `MOTION_CONDITIONS` only**, never a breakpoint. Branch on `isDesktop()`
  inside it, with function values and `invalidateOnRefresh`.
- **A reduced-motion switch rebuilds too.** A trigger that must keep the reader's place lives outside the build, and
  only its tweens swap. Every block does this: `reveal`, `split-reveal`, the recipes and the sticky scene's progress
  trigger.
- **Create blocks outside your own `gsap.matchMedia()` callbacks**, and `mount()` too.
- **Breakpoint and pointer conditions suit builds that create no trigger** (`CONDITIONS`): a tween set, or a hover
  setup such as `cursor-media`'s fine-pointer condition.
- **A revert replays recorded tweens with their events on** (observed on 3.15.0), so a catch-up tween's `onUpdate`
  writes its stale value once more. The recipes make theirs inside `ctx.ignore()` and kill them in the cleanup.
- Write `gsap.matchMedia()`, never `ScrollTrigger.matchMedia()` (deprecated in 3.11). It makes its own context: don't
  nest a `gsap.context()` in it.

## 8. `quickTo` and the ticker

- **`gsap.quickTo(target, prop, { duration, ease })`** returns a function that retargets one tween: `xTo(e.clientX)`
  on every `pointermove`, never a new `gsap.to()` per event. `xTo(v, v)` starts it at the target, for a preview that
  should appear in place. `xTo.tween` pauses or kills it. It takes one numeric property: no units, relative values or
  plugins. `gsap.quickSetter` writes at once, with no easing.
- **Catch-up on a plain object, written by hand.** The recipes ease a `{ p }` proxy with
  `quickTo(proxy, 'p', { duration: 0.5, ease: 'expo', onUpdate })` and write the style themselves. That is
  `scrub: 0.5`'s feel (`expo` is the numeric scrub's ease, read from GSAP's source, not documented), while the tween
  never touches the element.
- **The ticker drives Lenis** on GSAP pages. `gsapDriver(gsap, ScrollTrigger)` adds `lenis.raf` to `gsap.ticker`,
  calls `ScrollTrigger.update` on each Lenis scroll and sets `lagSmoothing(0)`: 0 frames late in Chromium and WebKit.
  Without the `scroll` hookup ScrollTrigger is exactly one frame behind (S4a).
- **`lagSmoothing(0)`** stops GSAP from skipping time after a stall (by default a gap over 500 ms counts as 33 ms),
  which would make Lenis jump. The driver's `destroy()` restores that default.
- Anything else that must line up with the scroll (an R3F `advance()`) goes on the ticker after Lenis. Never Lenis's
  `autoRaf` beside the ticker: two loops, a frame apart ([scroll-authority.md](scroll-authority.md) §6).

## 9. Pins under each authority

| Authority | The pin | Progress |
|---|---|---|
| native, Lenis | CSS sticky (`pinnedScene`'s default, `pin: 'sticky'`) | a ScrollTrigger with no pin on the range wrapper, equal to the wrapper's rect maths once refreshed (S5) |
| ScrollSmoother | `pin: 'gsap'`: ScrollTrigger pins, with `pinSpacing: false` | the pinning trigger |

- **Sticky never sticks inside `#smooth-content`** (S2), so ScrollSmoother pages pin through ScrollTrigger.
- **Never nest a scene in a GSAP `pin: true`**: the pin-spacer is fixed or transformed while pinned, and sticky
  resolves against it ([scenes.md](scenes.md) §5). **Never animate the pinned element itself**; animate its children.
  ScrollTrigger measures the pin ahead of time, and GSAP's docs say animating it throws those measurements off.
- `pinSpacing` defaults to `false` when the pin's container is `display: flex`. `pinReparent`, which moves the pin to
  `<body>` while pinned, is a last resort: keep scenes out of transformed ancestors instead (invariant 5).
- **Observed on 3.15.0:** `smooth/smoother.ts` passes `autoResize: false`, which the types declare and the docs'
  options table omits, and runs a full refresh on a content resize instead: the built-in one covers only the
  smoother's own trigger. And switching reduced motion on live leaves identity transforms inline
  ([layered-visuals.md](layered-visuals.md) §2).

## 10. GreenSock's eleven ScrollTrigger mistakes

From gsap.com/resources/st-mistakes, with the rule this skill applies:

| # | The mistake | The rule here |
|---|---|---|
| 1 | a ScrollTrigger on a tween nested in a timeline | on the section's timeline (§4) |
| 2 | `to()` tweens caching start values across triggers | `fromTo()`, or one timeline (§4) |
| 3 | one tween for many sections | a trigger per element, or `ScrollTrigger.batch()` as `reveal` does |
| 4 | fixed start and end on a resizing layout | function values and `invalidateOnRefresh` (§5) |
| 5 | playing mid-screen and resetting off screen on one trigger | two triggers; `reveal`'s replay resets only out of view |
| 6 | triggers created out of order | page order, else `refreshPriority`, **higher first** (§6) |
| 7 | new content without a refresh | `ScrollTrigger.refresh()` (§5) |
| 8 | a scrub jumping on load | `clamp()` on the start (§5) |
| 9 | `scroll-behavior: smooth` on `<html>` | never where ScrollTrigger or a smoother runs; `animation.css` sets none |
| 10 | a longer `duration` to slow a scrub | a longer `end` (§4) |
| 11 | triggers left behind by an SPA route | `useGSAP` or `mount()` kills them on leave and hide (§2, §3) |

Two notes. #6 says a higher `refreshPriority` calculates sooner, as the ScrollTrigger docs do; GreenSock's own
`gsap-skills` gets it backwards (§6, §12). And #11 sometimes settles for `ScrollTrigger.refresh()`; a route shown
again under `<Activity>` re-creates its triggers instead, through a fresh mount.

## 11. The plugins

All are in the `gsap` package and free: import from `gsap/<Plugin>` and pass to `setupGsap({ plugins })`.

| Plugin | For | In this pack |
|---|---|---|
| SplitText | lines and words revealed below the fold | `split-reveal` ([text.md](text.md)) |
| Flip | a layout change animated from the old box: `Flip.getState()`, change the DOM, `Flip.from(state)` | no block yet; React routes use Motion's `layoutId` ([motion.md](motion.md) §8) |
| DrawSVG | strokes drawn as the reader scrolls | `draw-on-scroll` ([layered-visuals.md](layered-visuals.md) §9) |
| MorphSVG | one path's `d` into another's; `convertToPath()` first for circles and rects | no block: log `shapeIndex` or `precompile` once, then hard-code the value |
| Observer | gestures (wheel, touch, pointer), not scroll position | `stepped-sections`; `ScrollTrigger.observe()` is the same, with nothing more to register |
| ScrollSmoother | the page's scroll authority, `data-speed` and `data-lag` | `smooth-smoother`: start it with `createSmoother`, never by hand ([scroll-authority.md](scroll-authority.md) §5) |

SplitText runs after `document.fonts.load()`: measured on 3.15.0, WebKit 26.6 (Playwright's build) never fired the
`loadingdone` event that `autoSplit` waits for (S6a, [text.md](text.md) §4). It keeps `aria: 'auto'` for headings
(S6b). CustomEase comes registered by `setupGsap`.

## 12. Working alongside `gsap-skills`

GreenSock publishes agent skills (`npx skills add https://github.com/greensock/gsap-skills`): `gsap-core`,
`gsap-timeline`, `gsap-scrolltrigger`, `gsap-plugins`, `gsap-utils`, `gsap-react`, `gsap-performance` and
`gsap-frameworks`. They teach the API; this skill decides the scroll architecture (the authority, the clock, the
block, reduced motion). With both installed, take API detail from theirs and anything scroll-driven from this one.
Where they differ, follow this one:

- **`refreshPriority`:** theirs says lower refreshes first; GSAP's docs say higher (§6).
- **Pins:** theirs pin with `pin: true`; here scenes pin with CSS sticky under native scrolling and Lenis, and through
  ScrollTrigger only under ScrollSmoother (§9).
- **Lenis:** theirs reach for `scrollerProxy()` for smooth-scroll libraries. Lenis moves the real scroll position, so
  `gsapDriver` is the whole wiring (§8).
- **Breakpoints** never go in the conditions of a build that creates ScrollTriggers (§7).
- **Smoothing:** `scrub: true` under a smoother, never a number on top.

## Traps

- [ ] `setupGsap()` runs once before any block; plugins come from `gsap/<Plugin>`, with no licence step (§1).
- [ ] React builds in `useGSAP` with a `scope`; handlers that animate later are `contextSafe` (§2).
- [ ] Vanilla routes use `mount(routeRoot)`, never `document`, after the scroll authority (§3).
- [ ] One timeline per section, its ScrollTrigger on the timeline, never on a nested tween (§4).
- [ ] Viewport-dependent values are functions with `invalidateOnRefresh`; late content gets a refresh (§5).
- [ ] Triggers are created in page order; a `refreshPriority` is higher for sections higher up (§6).
- [ ] No breakpoint in a build that creates ScrollTriggers; no block created inside your matchMedia callbacks (§7).
- [ ] `quickTo` for pointer and velocity input; Lenis on the ticker with `lagSmoothing(0)` (§8).
- [ ] ScrollSmoother pages pin with `pin: 'gsap'`; no scene inside a GSAP pin (§9).
- [ ] No `markers: true`, `scroll-behavior: smooth` or `ScrollTrigger.matchMedia()` ships.
