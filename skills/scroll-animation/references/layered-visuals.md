# Layered visuals

**Purpose:** Build the layers of an editorial page, each on the cheapest engine that does it right: depth parallax,
clip and scale reveals, a sticky stack, marquees, cursor media, blend text, colour tracks, drawn lines, header ink per
section and stepped sections.

**Read when:** layers should drift at different depths; a colour should hand over between sections; a ticker, a
preview that follows the pointer or lines that draw themselves are wanted; a fixed or sticky header's ink must follow
dark and light sections ("the nav disappears over the dark section"); or one of these misbehaves.
**Skip when:** content only animates in ([entrances.md](entrances.md)), the section pins ([scenes.md](scenes.md)), or
the effect is plain CSS decoration ([css-scroll-effects.md](css-scroll-effects.md)).

**Inputs:** the effect, the route's engine and scroll authority (`<html data-scroll-authority>`), the header and each
section's ink.
**Produces:** a block or recipe per effect (`parallax`, `colour-track`, `marquee-velocity`, `cursor-media`,
`draw-on-scroll`, `stepped-sections`, `header-theme`), its reduced-motion state, and one writer per property.

## Contents

1. [Pick the cheapest layer](#1-pick-the-cheapest-layer)
2. [Depth parallax](#2-depth-parallax)
3. [Clip, mask and scale reveals](#3-clip-mask-and-scale-reveals)
4. [The sticky stack](#4-the-sticky-stack)
5. [Marquees](#5-marquees)
6. [Cursor media](#6-cursor-media)
7. [Blend text](#7-blend-text)
8. [Colour tracks](#8-colour-tracks)
9. [Draw on scroll](#9-draw-on-scroll)
10. [Header ink per section](#10-header-ink-per-section)
11. [Stepped sections](#11-stepped-sections)
12. [Horizontal rails](#12-horizontal-rails)
13. [Traps](#traps)

## 1. Pick the cheapest layer

| Effect | Cheapest | Step up to |
|---|---|---|
| Parallax | `data-scroll-fx="parallax"` (CSS) | `parallax` (GSAP), `<Parallax>` (Motion) or `data-speed` (ScrollSmoother) where CSS timelines don't run |
| A colour between sections | each section paints its own background | `colour-track`, blended in step with the scroll |
| A ticker | `data-scroll-fx="marquee"` | `marquee-velocity`, its speed following the scroll |
| A preview beside a link | a thumbnail in the row, shown on `:hover` | `cursor-media`, following the pointer |
| A line drawing itself | `stroke-dashoffset` on a `view()` timeline | `draw-on-scroll`, on a GSAP route |
| One screen per idea | CSS scroll snap, `proximity` | `stepped-sections`, for an explicit presentation only |

The recipes are GSAP files to copy and adapt (`scroll-animation add parallax`); `<Parallax>` is the Motion twin. Four
rules hold for all of them:

- **Create them after the route's scroll authority.** The scroll-linked ones ask `getScrollAuthority()` as they
  build (the `<html data-scroll-authority>` stamp, or the `lenis` class a site's own Lenis sets): 0.5 s of catch-up
  under native scrolling (what `scrub: 0.5` gives), none under Lenis or ScrollSmoother, which already smooth. A
  ScrollSmoother started by hand leaves no stamp and reads as native: start it with `createSmoother`
  ([scroll-authority.md](scroll-authority.md) §5).
- **Call them outside your own `gsap.matchMedia()` callbacks.** GSAP 3.15 throws the reader to the top when a
  ScrollTrigger is created or killed during a rebuild, so their triggers live outside it ([gsap.md](gsap.md) §7).
- **One writer per property.** Each owns the properties its header names, and `destroy()` puts back what the page
  wrote. Never two movers on one element: wrap it.
- **React:** `useGSAP(() => { const p = parallax(ref.current!); return () => p.destroy() })`. Vanilla: inside the
  route's `mount()` ([gsap.md](gsap.md) §3).

## 2. Depth parallax

A layer that moves slower than the page reads as further away.

| Engine | Markup | Writes |
|---|---|---|
| CSS | `data-scroll-fx="parallax"`, `--fx-parallax` | `translate` on a `view()` timeline |
| GSAP | `data-parallax data-parallax-speed="0.15"`, then `parallax(routeRoot)` | `translate`, in % of its height |
| Motion | `<Parallax speed={0.15}>…</Parallax>` | `transform` |
| ScrollSmoother | `data-speed="0.8"`, `data-lag="0.35"`, with `effects: true` | its own transform |

- **Use CSS unless it can't run**: Firefox has no `view()` yet, ScrollSmoother stops it, and under Lenis Safari draws
  it a frame late ([css-scroll-effects.md](css-scroll-effects.md) §4). CSS needs no JavaScript, and the compositor
  runs it.
- **A recipe's speed is a fraction of the pass** (from the element's top meeting the viewport's bottom to its bottom
  leaving the top). It drifts speed × pass, centred, so it sits at its layout position when centred. Positive lags and
  reads as further away. Default 0.1; **keep it within ±0.2**, because big depth differences are a vestibular trigger
  ([accessibility.md](accessibility.md) §7).
- **GSAP** re-measures at every refresh with the drift taken off: a translate on a trigger element shifts its own
  start and end (−96 px at centre, measured). Its `translate` composes with the element's `transform`.
- **Motion** writes the transform by hand from `useScroll`: a bound `style` stops at the input range and drifts back
  (spike S3: S1–S7 are the skill's own browser measurements, September 2026; [motion.md](motion.md) §4). It
  uses a spring on native routes and the raw scroll under Lenis. **Never under ScrollSmoother**, where `useScroll`
  reads the unsmoothed scroll (S2). It owns its element's `transform`, so style it through `className` and put any
  other mover on a wrapper.
- **`data-speed`** is the element's own speed: `0.8` moves at 0.8 of the page's, like a recipe speed of 0.2. `"auto"`
  moves an image inside its frame, and `data-lag` is seconds of catch-up. Wrap above-the-fold speeds in `clamp()` (GSAP
  3.12+) so they start in place: `data-speed="clamp(0.75)"`. Effects must not nest. Reduced motion runs the smoother
  in native mode, with no effects. Observed on 3.15.0: switching it on live leaves an identity `transform` and
  `will-change: transform` inline on each effect (from ScrollSmoother's `kill()`): nothing moves, a known leftover.
- **Reduced motion: no drift** and nothing inline, in every engine, followed live, except the ScrollSmoother leftover
  above.
- **Never a drift on an element something else moves** (a reveal, a pin, a scene): put it on a wrapper or the media
  inside.

## 3. Clip, mask and scale reveals

- **Content arrives by trigger.** A scroll-linked reveal leaves text half-shown when the reader stops, so copy uses
  `reveal`'s `clip` (a wipe up from the bottom edge) or `scale-in`, once ([entrances.md](entrances.md) §4).
- **Images and decoration may follow the scroll**: `data-scroll-fx="fade-in scale-in"` while a figure enters, or a
  `clip-path` written by hand from a scene's exact progress ([scenes.md](scenes.md) §6).
- **A mask sweep runs on a registered number**, such as `--fill` from `css/animation.css`: WebKit steps an
  unregistered custom property, and the sweep jumps instead of wiping ([ios-safari-motion.md](ios-safari-motion.md)
  §4).

## 4. The sticky stack

Cards that stick under the header and shrink while the next one covers them are `data-scroll-fx="sticky-stack"`: card
N runs on card N+1's `entry` range, never its own `view()` (S7d). The rules are in
[css-scroll-effects.md](css-scroll-effects.md) §7. When a card's content should change while it is covered, build a
pinned scene with acts instead ([scenes.md](scenes.md) §2).

## 5. Marquees

The CSS marquee runs at a steady speed ([css-scroll-effects.md](css-scroll-effects.md) §8). `marqueeVelocity` makes the
speed and direction follow the scroll. It takes the same copies and pause button, with `data-marquee` on the root
(style it `overflow: clip`) and `data-marquee-track` on the track (`display: flex; width: max-content`):

```ts
const marquee = marqueeVelocity(el, { toggle: button })   // .paused  .pause()  .play()  .destroy()
```

- **Speed:** each scroll update asks for 1 + |velocity| ÷ 600 px/s resting speeds, at most 5, in the scroll's
  direction, so scrolling up runs it backwards. When the scroll stops it eases back to the resting speed (30 s a
  loop), keeping the last direction.
- **`quickTo` on the loop's `timeScale`** (0.6 s): one tween retargeted, never a new tween per event.
- **The toggle** (WCAG 2.2.2) is wired for you, and the reader's pause outranks everything. The row also pauses on
  hover, with focus inside and off screen; keyboard focus on a clipped item moves the row until the item shows.
- **Reduced motion:** stopped, the toggle pressed. A press still starts it at the resting speed, since clipped items
  only show by moving.

## 6. Cursor media

A list of links whose media follows a fine pointer. It is decoration: touch and keyboard readers get the list as it
is, so the links carry the names and the preview is `aria-hidden`, with empty `alt`s.

```html
<div data-cursor-media>
  <ul><li><a href="/work/harbour" data-cursor-media-item="harbour">Harbour</a></li>…</ul>
  <div data-cursor-media-preview aria-hidden="true"><img data-cursor-media-for="harbour" src="…" alt="">…</div>
</div>
```
```css
[data-cursor-media] { position: relative }
[data-cursor-media-preview] { position: absolute; top: 0; left: 0; width: 18rem; aspect-ratio: 4 / 3;
  translate: 1.5rem -50%; pointer-events: none; opacity: 0; transition: opacity 0.2s }
[data-cursor-media-preview][data-cursor-media-state='shown'] { opacity: 1 }
[data-cursor-media-for] { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0 }
[data-cursor-media-for][data-cursor-media-active] { opacity: 1 }
```

- `cursorMedia(listRoot)` writes only the preview's `transform` and the two attributes. Your CSS does the rest: its
  `translate` picks the part of the preview that sits on the point, and `opacity` carries the fade.
- **It follows through `quickTo` on x and y** (0.5 s) and appears where the pointer is, never gliding in.
- **Only under `(hover: hover) and (pointer: fine)`**: on touch screens nothing shows.
- **Keyboard focus** shows the media beside the item, at its inline end. Keep items `width: fit-content`, so the
  preview never covers the focus ring. Under reduced motion, hover places it there too, at once.

## 7. Blend text

White text with `mix-blend-mode: difference` paints the inverse of whatever passes under it, so it needs no ink per
section. The header's opt-in is `data-header-blend` (`css/header-theme.css`).

- **Blend on the element that shares a stacking context with the page.** A fixed element is its own stacking context,
  so `data-header-blend` goes on the header itself; a part inside it would blend with the header's empty backdrop.
- **Forced colours reset it** to a normal blend: Windows High Contrast substitutes the reader's colours, and a
  difference blend would invert them.
- Difference over mid-grey lands near grey: check contrast over every section it crosses.

## 8. Colour tracks

`colourTrack(routeRoot)` hands a page colour from section to section in step with the scroll, blended in OKLCH:

```html
<section data-colour-track="#f4efe6">…</section>
<section data-colour-track="oklch(0.3 0.06 255)">…</section>
<section data-colour-track="var(--paper)">…</section>      <!-- a var() resolves on the target: define it on :root -->
```

- **The target** (`<body>` by default) gets `--track-a`, `--track-b` and `--track-p`, and its `background-color`
  becomes `color-mix(in oklch, var(--track-a), var(--track-b) calc(var(--track-p) * 100%))`. OKLCH keeps the
  midpoints' lightness and chroma, where an RGB mix goes muddy. `property: null` writes only the variables.
- **A handover runs while the next section's top travels** from 'top 75%' to 'top 25%'; between handovers the colour
  holds. The variables don't inherit, so a write on `<body>` restyles `<body>` alone.
- **Cost:** `background-color` repaints the target on every frame of a handover. Budget it
  ([performance.md](performance.md)) and keep the target to the element that needs the colour.
- **Reduced motion:** a colour change isn't movement, so the track stays, exact, with no catch-up. Without
  `color-mix()` it does nothing. Under ScrollSmoother, create it after the pinned scenes.

## 9. Draw on scroll

`drawOnScroll(routeRoot)` draws SVG strokes as the reader scrolls, with DrawSVGPlugin:

```html
<svg viewBox="0 0 600 120" aria-hidden="true">          <!-- or role="img" with a <title>, if it means something -->
  <path data-draw d="…" fill="none" stroke="currentColor" />
</svg>
```

- **One pen per drawing.** Every `[data-draw]` shape draws over its `<svg>`'s pass, from its top at 80% of the
  viewport to its bottom at 50%, one after another, each for a share as long as its stroke.
- **Stroke only**: a fill shows at once. Keep it below the fold, where nobody sees the strokes fully drawn before the
  script runs.
- **GSAP's caveats:** Firefox can measure a `<path>` short, so it stops early at `100%` (add anchors, or draw to
  `102%`), and iOS Safari can draw a `<rect>`'s stroke wrong (use a `<path>`).
- **Reduced motion, no JavaScript and print:** fully drawn.
- **Without GSAP:** `pathLength="1"` on each shape and `stroke-dashoffset` from a registered `--draw` on a `view()`
  timeline; the recipe's header has the CSS.

## 10. Header ink per section

A transparent fixed or sticky header has no surface of its own, so its ink must follow the section under it: a black
nav over a black section disappears. `scroll-animation add header-theme`, then import `css/header-theme.css`.

```html
<header data-header data-header-ink-default="light" data-header-ink="light">…</header>
<section data-header-theme="dark">…</section>                <!-- any token: dark, light, a brand name -->
```
```css
[data-header][data-header-ink='dark'] { color: #fff }
```
```ts
const stop = mountHeaderTheme(header)        // vanilla and GSAP pages: page chrome, outside mount()'s root
const ink = useHeaderTheme(headerRef)        // React: the token, the default, or null on the server
```

- **The probe is a 1 px IntersectionObserver strip** at the header's probe line, with no scroll listener under any
  authority. The header takes the token of the themed section under the line as `data-header-ink`, written only when
  it changes. IntersectionObserver fires on what the reader sees, so the same code is exact under native scrolling,
  Lenis and ScrollSmoother. Measured under ScrollSmoother, `window.scrollY` disagreed with the screen on 105–214
  frames per pass, and the ink never followed it; across the measured runs it stayed within a frame of the screen.
- **The line** is `line` × the header's height from its top: 1 (the default) is its bottom edge. It is read from
  layout (`offsetHeight` and the top below), so a transform on the header (an entrance, hide-on-scroll) never moves it.
  A resize rebuilds the strip, and the observer's own bounds correct it when iOS's toolbars thicken it.
- **Fixed or sticky.** A fixed header's top is its `offsetTop`. A sticky one is probed where it sticks, at its CSS
  `top`: once stuck, its `offsetTop` runs with the scroll. Until it sticks (below a banner, say), the line waits where
  it will stick. Under ScrollSmoother the header is fixed and outside `#smooth-wrapper`, since sticky never sticks
  inside it.
- **Mark only the sections that differ**; the rest take `data-header-ink-default`. **An unmarked dark band is a bug:**
  check copy riding over a dark render in a pinned scene too, which paints no background of its own.
- **Overlaps:** the last section in document order wins, so a nested section beats its parent. A section needs a box:
  `display: contents` never matches.
- **An ink that changes with the breakpoint is a token** mapped per breakpoint in CSS: a band mid-grey on phones and
  black from `lg` gets its own (white ink on that grey measured 2.2:1, black 5.6:1). v1's `--header-theme` is gone.
- **Render the first ink on the server** (`data-header-ink`), so the first paint needs no write.
- **Or skip the mapping:** `data-header-blend` inverts white ink over whatever passes under it (§7).
- **Sections that come and go** (a client-side navigation, a theme switch) are picked up with one write and no flash
  of the default; a section hidden by Next's `<Activity>` drops out. `stop()` leaves the last ink, so a route shown
  again doesn't flash.
- **React:** `useHeaderTheme(ref, { sections, line })` returns the ink, null on the server and through hydration. The
  core writes the attribute, so CSS needs no React state; use `ink` only for what CSS can't do, such as swapping a
  logo.
- **One 200 ms ease-out transition for the whole bar** (`css/header-theme.css`), none under reduced motion. 200 ms is
  the compromise between a dissolve and link hover, which rides on `color` too. Paint the parts in `currentColor`.
- **Inherited colours move on the header alone.** `color`, `fill` and `stroke` transition on the header, and its parts
  take the moving value, so nested links land with it. Parts transition only what doesn't inherit: backgrounds,
  borders, outlines, underlines. A part that transitioned an inherited colour itself would restart every frame and
  trail the header (420–600 ms instead of 200; `test:header-theme`'s `trail` check measures it).
- **A page's own `color` transition on an inheriting link brings the trail back** (Tailwind's `transition-colors`):
  keep those off the header's links. A part that sets its own colour per ink transitions it itself. The rules have
  zero specificity, so a transition you set on a part replaces them.
- **One writer.** Never beside a script that already switches the header's colours: they flip at different offsets
  and the bar flickers ([brownfield-coexistence.md](brownfield-coexistence.md) §2). Anything else that follows the
  page's colour reads the same ink rather than probing twice.
- Header sizing (`--header-h`, insets) is layout: the `fluid-design` skill's when installed ([preflight.md](preflight.md)
  §3.6).

## 11. Stepped sections

**Read this first: ordinary scrolling is almost always better.** Stepping takes the reader's pace away (a notch always
moves a whole viewport, and trackpad momentum is swallowed), and it fights anything else that owns the wheel. Use it
only when the brief is explicitly a presentation: a deck, a tour, one screen per idea. The cheaper choice is CSS scroll
snap, `scroll-snap-type: y proximity` on `html` and `scroll-snap-align: start` on each section: no JavaScript, and the
reader keeps their pace. (`mandatory` can strand content in a section taller than the viewport.) Never snap and step
together: a snap re-targets every scroll the recipe writes.

```ts
const deck = steppedSections(main)      // [data-step] sections; .index .goTo(i) .next() .previous() .destroy()
```

- **It replaces gestures, never scrolling.** Sections stay in flow and the page scrolls natively, so the scrollbar,
  find in page, anchors and a screen reader's cursor all work. Nothing is hidden, `inert` or locked, and keyboard
  focus scrolls its section into place at once.
- **Steps** come from a wheel notch or a swipe (Observer, through `ScrollTrigger.observe()`), the arrow, Page and Space
  keys, once per gesture; Home and End go to the ends. A tall section adds a stop per viewport. A step is a 0.8 s
  tween of the page's scroll that yields at once to any scroll it didn't write.
- **Left alone:** keys in fields and widgets, Space on a button, a nested scroller that can still scroll, Ctrl+wheel,
  horizontal swipes, pinches, a zoomed-in page. Past the last stop a gesture scrolls on natively.
- **Native scrolling only:** under Lenis or ScrollSmoother, which own the wheel, it steps nothing and warns. It finds
  the owner the way the recipes do (§1), so start a ScrollSmoother with `createSmoother`.
- **Reduced motion and no JavaScript:** normal scrolling; the handle's methods jump.

## 12. Horizontal rails

A rail is a pinned scene whose band slides a track of panels sideways: `horizontal-rail` (`gsap/horizontal-rail.ts`,
on `pinned-scene`). Its markup, measured travel, RTL, focus-follow and reduced-motion scroller are in
[scenes.md](scenes.md) §14.

## Traps

- [ ] Each effect runs on the cheapest engine that does it right (§1).
- [ ] Recipes start after the scroll authority (a ScrollSmoother through `createSmoother`), outside your
      `gsap.matchMedia()` callbacks (§1).
- [ ] One writer per property: no drift on an element a reveal, pin or scene moves (§2).
- [ ] Parallax speeds within ±0.2; `clamp()` on above-the-fold `data-speed`; no Motion `useScroll` under
      ScrollSmoother (§2).
- [ ] Every marquee has its pause toggle (§5); cursor media never covers a focus ring (§6).
- [ ] Blend text resets under forced colours (§7); a colour track's `var()` colours live on `:root` (§8).
- [ ] The header is fixed or sticky (fixed under ScrollSmoother), every dark band is marked, no `color` transition
      sits on a link that inherits the ink, and no other script writes the header's colour (§10).
- [ ] Stepped sections only for a presentation, on native scroll, never with snap (§11).
