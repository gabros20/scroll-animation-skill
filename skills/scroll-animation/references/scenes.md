# Pinned scenes

**Purpose:** Build a pinned scene in either engine: the range wrapper and sticky pin, acts, the head/scrub/tail latch,
scroll-linked writes, camera framing and travel on a scaled layout.

**Read when:** a section pins while the reader scrolls through it: a scrubbed video or image sequence, stacked acts,
copy riding over a render, a paused GSAP timeline driven by scroll, a scroll well inside a pin.
**Skip when:** the section only enters once (a triggered reveal), or the question is the media itself: decoding and
encoding are in [video.md](video.md) and [sequences.md](sequences.md).

**Inputs:** the scene's acts and runway from the `ANIMATION.md` ledger, the route's scroll authority, the engine.
**Produces:** a `pinned-scene` block (`PinnedScene` / `pinnedScene`) with its acts, writers and reduced-motion
collapse, checked in a browser.

## Contents

1. [The range wrapper and the sticky pin](#1-the-range-wrapper-and-the-sticky-pin)
2. [Acts](#2-acts)
3. [The head, scrub and tail latch](#3-the-head-scrub-and-tail-latch)
4. [Exact and smoothed progress](#4-exact-and-smoothed-progress)
5. [Sticky or GSAP pin](#5-sticky-or-gsap-pin)
6. [Scroll-linked writes](#6-scroll-linked-writes)
7. [Camera framing](#7-camera-framing)
8. [The scroll well](#8-the-scroll-well)
9. [Creation order and refresh](#9-creation-order-and-refresh)
10. [Reduced-motion collapse](#10-reduced-motion-collapse)
11. [Riding sections](#11-riding-sections)
12. [Travel on a scaled layout](#12-travel-on-a-scaled-layout)
13. [Debugging a scene](#13-debugging-a-scene)
14. [Traps](#traps)

## 1. The range wrapper and the sticky pin

```html
<div data-scene-root>            <!-- the range wrapper: the scene measures this -->
  <div data-scene-pin>…</div>    <!-- sticky, 100lvh: media, a canvas, stacked acts -->
  <div data-scene-content>       <!-- margin-top: -100lvh: the acts ride over the pin -->
    <section>Act one</section>
    <section data-scene-spacer></section>
  </div>
</div>
```

`css/scene.css` gives both engines this geometry (import it after `animation.css`). Motion renders it with
`<PinnedScene pinned={…}>{acts}</PinnedScene>`, where `pinned` may also be a function of
`{ band, progress, mode, reduced }` (the first two exact MotionValues). With `usePinnedScene()` you render the root,
pin and content markup yourself (`rootRef`, `pinRef`), and the hook keeps `data-scene-state` current. GSAP takes the
markup with `pinnedScene(root, options)`. The maths is `assets/scene.ts`.

- **Measure the wrapper, never the pin.** A sticky element stops moving, so its rect is no ruler. Progress is
  `-rect.top / (height − innerHeight)`, which a ScrollTrigger from `'top top'` to `'bottom bottom'` matches once
  refreshed (S5).
- **The pin is `100lvh`**: a scene is read while scrolling, when iOS collapses its toolbars. An `svh` pin falls short
  and shows the page along the bottom; `dvh` resizes the pin, and every framing read, on each toolbar animation.
- **The content's `-100lvh` margin uses the pin's unit**, so the wrapper is exactly as tall as the content; mixing
  `svh` and `lvh` measures one toolbar-height wrong.
- **No transform on the root, the pin or an ancestor, and no `overflow: hidden` on an ancestor** (use `clip`): either
  becomes the pin's containing block or scroll container, and the pin stops pinning. `overflow-x: hidden` counts, since
  one hidden axis makes the other `auto`.
- The pin has `pointer-events: none`, so it never eats clicks meant for the acts riding over it.

Both engines take the holds (§3), `actHysteresis` (§2), `warmMarginPx` (600) and `wakeMarginPx` (200), and the events
`onProgress(p, scene)`, `onMode`, `onAct`, `onAwake` (start or stop per-frame work), `onWarm` (media may fetch),
`onMeasure` (re-read cached geometry) and `onRehydrate(state, scene)`. A rehydrate re-derives mode, acts and band from
the wrapper's rect on mount, wake, resize, tab return, bfcache restore, focus and a reduced-motion change, coalesced to
one frame, so a resume never waits for a scroll event. GSAP adds `pin`, `refreshPriority` and `onBuild`.

The handle's `mode`, `act`, `awake` and `reduced` are methods in Motion and getters in GSAP. Both have `progress()`,
`band()`, `bounds()`, `rangePx()` and `rehydrate()`; GSAP adds `refresh()`, `debug()` and `destroy()`, called from
`useGSAP`'s cleanup or the route's `mount(routeRoot)`.

## 2. Acts

Progress advances **1/(N−1) per viewport** of content, N being the content's height in viewports. Three one-viewport
acts land at 0, ½ and 1: halves, not thirds. Thirds need N = 4, so one act is two viewports tall, or an empty
`data-scene-spacer` act paces it.

Mark acts **stacked in the pin** with `data-scene-act`. Every act but the active one is `inert`, so a keyboard or
screen reader never lands on hidden copy; the scene writes it a frame after mount, on every resume and on every
transition. **Hide acts off that attribute**, `[data-scene-act][inert] { opacity: 0 }`, which is right from the
scene's first frame and after a reload. `onAct` fires on transitions only, never on mount or resume, so a JS writer
also applies `scene.act()` in `onRehydrate`. Use `opacity` or `visibility`, never `display: none`: the print rules force
the first two back. Under reduced motion no act is inert.

The marked acts are paced evenly over progress (one viewport of content each lines them up); the active one is the
nearest, switching `actHysteresis` (0.1 acts) past the midpoint so a resting scroll can't flap it. Never mark acts in
the content layer: they scroll into view themselves, and `inert` would trap keyboard users above.

## 3. The head, scrub and tail latch

```
p = 0   headExit                                  tailEnter       1
|- head -|------------------ scrub ------------------|---- tail ----|
```

- **Holds in px of range**, because a fraction is a different distance on every viewport height. Defaults
  (`SCENE_HOLDS`, measured on the reference build): `headHoldPx` 12, `tailLeadPx` 320, each capped at a quarter of the
  range so a bad reading can't park the scene in the head.
- **Two thresholds per boundary**: the value that enters a mode never leaves it, so a scroll resting on a boundary
  can't flap it. The gap is `hysteresisRatio` (0.7) of each hold, never a second px constant: two constants can be
  retuned into a pair whose re-entry threshold is negative and never fires.
- **The stepper crosses every boundary `p` has passed** (`stepMode`), so a jump from the head to the end lands in
  `tail` on one event. Resumes use the absolute `modeFromProgress`.
- **The band** maps `[headExit, tailEnter]` to 0..1 (`scene.band()`; Motion's `band` MotionValue). Media follows the
  band, not raw progress, so the holds own the ends and never fight the scrub for a frame.
- **Modes change per transition**, never per frame: React state and `data-scene-state` on the root. `onRehydrate` runs
  before `onMode`, so media snaps with the new mode and the handover after it is a no-op.

## 4. Exact and smoothed progress

`onProgress(p)` and `scene.progress()` are **exact**, and logic reads them: modes, acts, `inert`, URLs, analytics. A
spring or lerp settles *across* a threshold and flips it back and forth, so it never feeds one.

Smooth once per value path. Under Lenis or ScrollSmoother the scroll is already smooth: write the exact value. On a
native route, smooth only visuals at the consumer (`useSpring` on a visual, a numeric `scrub` on a tween).

In GSAP, `onProgress` runs inside ScrollTrigger's update, so with Lenis on `gsap.ticker` it lands in the scroll's frame
(S4). The ScrubVideo backdrop follows the playhead instead (`onPlayhead`): what must match the picture reads the
picture, which glides and loops while scroll stands still.

## 5. Sticky or GSAP pin

| | `pin: 'sticky'` (default, both engines) | `pin: 'gsap'` (GSAP only) |
|---|---|---|
| Routes | native and Lenis | ScrollSmoother: sticky never sticks inside `#smooth-content` (S2) |
| The pin | CSS sticky | ScrollTrigger pins `[data-scene-pin]` with `pinSpacing: false` (the content margin already cancels it); the scene sets `data-scene-pin="gsap"` |
| Progress | GSAP: a ScrollTrigger with no pin; Motion: `useScroll` | the pinning ScrollTrigger |
| Reduced motion | CSS releases the pin | the trigger is rebuilt without a pin, scroll kept |

Sticky has no pin-spacer and no reparenting, keeps the CSS collapse and shares Motion's geometry. Never nest a scene in
a GSAP `pin: true`: the spacer is fixed or transformed while pinned, and sticky resolves against it. Build no Motion
scene on a ScrollSmoother route: `useScroll` reads the unsmoothed scroll there, up to 244 px ahead of the page (S2).

## 6. Scroll-linked writes

Write scroll-linked styles by hand in `onProgress`, never bound through Motion's `style`:

```tsx
<PinnedScene onProgress={(p, scene) => { glow.current!.style.opacity = String(ramp(scene.band())) }}>
```

Motion 13.4 hands a bound `opacity`, `clipPath`, `filter`, `backgroundColor` or `transform` to a native timeline whose
keyframes stop at the input range; past it the element drifts back to its first-render value. The error measured up to
1.00, pinned or not, in Chromium and WebKit, and the hand-written control was exact (S3). `useScroll` with no target or a
preset offset (the scene's `['start start', 'end end']` is one) gets promoted.

**The alternative** pads every input range to 0 and 1 (`[0, .2, .6, 1] → [0, 0, 1, 1]`). It fixes the ends but not a
preset whose size class misses the subject (0.785 off inside the range), so it is the fallback.

- Write the first value too: Motion's `onProgress` fires on change, and `onRehydrate` (with `p` and `band`) runs on
  mount.
- Quantise a coarse write (a colour to 1/256) and skip repeats, so a still frame writes nothing.
- A binding and a hand writer may share a node, never a property: the next render clobbers the hand write.
- Reduced motion is the writer's job, because `MotionConfig` never reaches a hand write: read `scene.reduced()` or
  `useReducedMotionLive()` (exported by `usePinnedScene.ts`). Motion 13.4's `useReducedMotion()` reads once per mount.

A paused GSAP timeline is the same pattern: `pinnedScene(root, { onProgress: (p) => tl.progress(p) })`.

## 7. Camera framing

`media/camera.ts` places a subject on screen across the band, for ScrubVideo in both engines. Direct it as two shots:

```ts
camera={{ desktop: {
  crop: { x: 0.1, y: 0, w: 0.8, h: 1 },                                  // normalised to the master canvas
  subject: { head: { x: 0.58, y: 0.48 }, tail: { x: 0.48, y: 0.5 } },    // points in the master canvas
  shots: { head: { zoom: 1, at: [0.65, 0.6] }, tail: { zoom: 0.85, at: [0.72, 0.43] } },
  frameSize: { w: 178, h: 100 },                                         // svh
}, mobile: { … } }}
```

- **Two shots, not one crop**: interpolating lands on both designed frames; a single crop fits one end.
- **Size by viewport height** (`frameSize` in `svh`): viewports vary far more in aspect than in height.
- **Coverage beats the design zoom**: the zoom rises only as far as keeping the canvas edges off screen needs, so the
  composition holds wherever there is room.
- **CSS owns the size, JS only the transform**: `--scene-frame-w/-h` (a scoped `<style>` in React, inline per tier in
  GSAP), then one deduped `translate3d(…) scale(…)` per frame. Geometry is read on mount, resize and tier change only.
- **The camera reads the band, never the playhead**: the render animates its own subject, and cancelling that travel
  slides the whole frame under static copy.

Every field defaults to identity and `mobile` falls back to `desktop`; without `camera` the video simply covers the
pin. Reduced motion holds the head shot.

## 8. The scroll well

The `scroll-well` block (`PullToCentre` / `data-pull-to-centre`, still v1) adds a small step toward a centred rest each
frame, and the reader always wins.

- **Inside a pin, clamp it** (`clamp="[data-scene-root]"`, GSAP `data-clamp="[data-scene-root]"`), or a short target
  can rest outside the pin and show the previous section over the render.
- Its viewport height is a snapshot per visit: read live on iOS, the toolbar moves the target and feeds back.
- It suspends its writes for anchor clicks and `hashchange`; any other scroll it didn't start gets cancelled a frame
  at a time. Neither mount exposes `suspend()`, so a page that scrolls programmatically (a router jump,
  `scrollIntoView`) builds the pull with `createScrollPull({ target, clamp })`, starts and stops it itself, and calls
  its `suspend(ms?)` around each jump.
- Don't run it under Lenis or ScrollSmoother: it would be a second scroll writer against the smoother (the audit's
  `lenis-with-scroll-well` flags Lenis).

## 9. Creation order and refresh

GSAP only:

- **Create scenes in page order** (or set `refreshPriority`: higher refreshes earlier), so ScrollTrigger refreshes them
  top to bottom.
- **Keep ScrollTrigger fresh.** A layout change above a range with no resize (a late image, a font, an accordion) left
  it 300 px stale (S5). `pinnedScene` shares one ResizeObserver on `<body>` and refreshes 150 ms after the last change;
  call `scene.refresh()` after changing a scene's own content. Resumes read the rect, never the trigger.
- **Read progress in the tick after `ScrollTrigger.update`**, never straight after a programmatic `scrollTo` (825 px
  stale).
- **Build only on `MOTION_CONDITIONS`.** When a `gsap.matchMedia` condition changes, a trigger created in the rebuild
  leaves the page at scroll 0 (GSAP 3.15), so a breakpoint condition throws a rotating iPad to the top. Create scenes
  outside your own `matchMedia` callbacks, and branch on `isDesktop()` inside a build.

## 10. Reduced-motion collapse

The JS half holds the head (mode `head`, band 0, no act inert), and ScrubVideo shows the head frame and shot. It is
live: Motion reads `useReducedMotionLive()`, GSAP rebuilds through `gsap.matchMedia(MOTION_CONDITIONS)`.

The CSS half is `scene.css`, with `!important` because ScrollTrigger writes inline geometry:

| Element | Under `prefers-reduced-motion: reduce` |
|---|---|
| `[data-scene-root]` | `height: auto` |
| `[data-scene-pin]` | `position: relative; height: 100svh`: the media is absolutely positioned, and `auto` around it measures 0 |
| a pin holding `[data-scene-act]` | `height: auto; min-height: 100svh`, the acts in flow |
| `[data-scene-content]` | `margin-top: 0` |
| `[data-scene-spacer]` | `height: 0` |
| `[data-scene-act]` | `opacity: 1; visibility: visible` |

Mark every empty pacing act `data-scene-spacer` by hand: no engine infers it, and an unmarked two-viewport spacer left
1,800 px of empty band.

## 11. Riding sections

Sections in `data-scene-content` ride over the render:

- **No background**: it would cover the render the scene exists to show.
- **No `overflow: hidden`**: it makes the section a scroll container, which stops any sticky or scroll-timeline child
  inside it; clip with `overflow: clip`.
- **Sized in `svh`** (or fluid heights) while the pin is `lvh`, so a one-screen section never resizes mid-scroll.
- **Exits are hand-written fades**: `fade-on-exit` (`FadeOnExit` / `data-fade-on-exit`, tuned with
  `--exit-from`/`--exit-to`). Entrances stay triggered reveals.

## 12. Travel on a scaled layout

On a viewport-scaled layout (`SCALE` in `config.ts`) a drawn distance is a fraction of the composition, so **travel
scales** (a product crossing the hero, a parallax range, a ScrollTrigger `end`), while **entrance nudges of 24–40 px
stay px**: engines resolve `var()` once at animation start. In order of preference:

1. **CSS multiplies, the engine writes progress.** Write `--scene-p` from `onProgress` on the element whose CSS reads
   it: it is registered `inherits: false`, so a write on the root leaves a child at 0. CSS resolves the unit every
   frame, so a resize needs no refresh: `.peel { translate: calc(var(--scene-p) * 240 * var(--fluid, 1px)) 0; }`
2. **GSAP function values** from `assets/scale.ts`, with `invalidateOnRefresh: true` so each refresh re-reads them:
   `x: scaledValue(240)`, `end: scaledEnd(900)`, `start: () => 'top top+=' + scaledPx(120)`. A plain `x: 240` or
   `end: '+=900'` freezes at the size the page loaded at.
3. **Motion multiplies in the writer**: `p * scaledPx(240)`; the unit is cached until a resize.

- **Measured distances need nothing**: `scrollWidth − innerWidth` is already scaled. Make it a function (GSAP) or
  re-measure in `onMeasure`.
- **Pass `el` inside a limited subtree** (`fluid-grow-until-*`, `fluid-off`, `fluid-scope`), so
  `scaledPx(48, 'ui', headerEl)` reads the unit that applies there.
- **Static offsets on an animated element go through `translate`**, never `transform`, which the engine owns.
- **GSAP folds CSS `translate` into its transform** on its first transform tween, keeping `%` but freezing px and
  `calc()`: put a scaled offset or a `--scene-p` drift on a child GSAP never tweens. Motion is unaffected.
- **The pin stays `lvh`**, never fluid units: it covers the viewport, it isn't a drawn length.
- **Fluid-height acts aren't whole viewports** when width binds (four acts measured 3.42 viewports at 1024×900), so
  landmarks come from `rangePx`, never hard-coded fractions, and a well inside needs its clamp (§8).

With `SCALE = null` every helper returns its input.

## 13. Debugging a scene

1. **Rule out a stale stylesheet** ([verification.md](verification.md) §4): "frame one, then a snap to the end" is
   almost always a tab holding old CSS. The sections' height classes lose their rules, the runway collapses, and
   progress runs 0 to 1 over almost no distance.
2. **Read the DOM contract**: `data-scene-state` on the root, `inert` on acts. `verify-motion.mjs --scenes` drives every
   `[data-scene-root]` to 0, ¼, ½, ¾ and 1 and records the state.
3. **Ask the scene.** With a ScrubVideo, load the page with `?motion-debug` (or `<html data-motion-debug>`) and call
   `window.__scrub()`: a snapshot per live scene, its state plus the controller's counters (plays, rejections, wraps,
   holds, snaps, …). The counter that stopped names the layer that died. GSAP's `scene.debug()` works on any scene.

## Traps

- [ ] The wrapper is measured, never the pin; the pin is `lvh` and the content margin matches it (§1).
- [ ] No transform on the root, pin or an ancestor; no `overflow: hidden` on an ancestor, `-x` included (§1).
- [ ] Three one-viewport acts give halves, not thirds; only stacked acts carry `data-scene-act`, hidden off `[inert]`
  (§2).
- [ ] Hysteresis is a ratio of its hold; no spring or lerp feeds a mode, an act or `inert` (§3, §4).
- [ ] ScrollSmoother routes use `pin: 'gsap'`; no scene sits in a GSAP pin (§5).
- [ ] No scroll-linked value is bound to Motion's `style`; the first value is written on rehydrate (§6).
- [ ] A scroll well inside a pin is clamped to `[data-scene-root]` (§8).
- [ ] GSAP scenes are created in page order, outside breakpoint `matchMedia` builds (§9).
- [ ] Empty pacing acts carry `data-scene-spacer`; riding sections paint no background (§10, §11).
- [ ] Scaled travel goes through `--scene-p` or `scale.ts`; entrance nudges stay px (§12).
- [ ] No `content-visibility: auto` in or around a runway: it zeroes the geometry the scene measures.
