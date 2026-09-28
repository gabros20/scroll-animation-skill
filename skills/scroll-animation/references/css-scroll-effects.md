# CSS scroll effects

**Purpose:** Scroll-linked decoration with no engine: parallax, fades, scale-in, an exit fade, a progress bar, a
sticky stack and a marquee, on CSS scroll and view timelines, with a static state wherever they don't run.

**Read when:** an element should drift, fade or grow as it passes through the viewport; cards should stack; a page
wants a reading-progress bar or a marquee; or a `view()`, `scroll()` or `timeline-scope` effect freezes, works in
Safari but not Chrome, or plays on load in Firefox.
**Skip when:** the motion must stay registered to moving content, such as a pinned scene ([scenes.md](scenes.md)), or
it needs JavaScript anyway, as under ScrollSmoother ([layered-visuals.md](layered-visuals.md)).

**Inputs:** the element, the route's scroll authority (`<html data-scroll-authority>`), the header height
(`--header-h`).
**Produces:** `data-scroll-fx` markup on `css/scroll-effects.css`, tuned with `--fx-*`, on a page that reads the same
without it.

## Contents

1. [The effects and their tuning](#1-the-effects-and-their-tuning)
2. [Timelines and ranges](#2-timelines-and-ranges)
3. [Browser support and the static state](#3-browser-support-and-the-static-state)
4. [Under each scroll authority](#4-under-each-scroll-authority)
5. [Reduced motion](#5-reduced-motion)
6. [Clipping ancestors: `clip`, never `hidden`](#6-clipping-ancestors-clip-never-hidden)
7. [The sticky stack](#7-the-sticky-stack)
8. [The marquee](#8-the-marquee)
9. [Reading progress and the exit fade](#9-reading-progress-and-the-exit-fade)
10. [Traps](#traps)

## 1. The effects and their tuning

`scroll-animation add scroll-effects`, then import `css/scroll-effects.css` after `css/animation.css`.
`data-scroll-fx` takes a space-separated list, so effects compose on one element:

```html
<img data-scroll-fx="parallax" alt="…">                    <!-- drifts across its pass through the viewport -->
<figure data-scroll-fx="fade-in scale-in">…</figure>        <!-- fades and grows in while it enters -->
<div data-scroll-fx="exit-fade">…</div>                     <!-- fades as it leaves at the top (§9) -->
```

`progress`, `sticky-stack` and `marquee` have their own sections (§7–§9).

| Property | Sets | Default |
|---|---|---|
| `--fx-parallax` | the drift either side of the layout position; positive lags the page, so it reads as further away | `60px` |
| `--fx-fade-from` | the faded opacity of fade-in, exit-fade and a covered stack card | `0` (cards: `1`) |
| `--fx-scale-from` | where scale-in starts and a covered stack card ends | `0.9` |
| `--fx-range-start`, `--fx-range-end` | the `animation-range` of every effect on the element | per effect (§2) |
| `--fx-marquee-duration`, `--fx-marquee-direction` | one marquee loop; `reverse` flips it | `30s`, `normal` |

- **Tune on the element**, or on a selector that matches it (`[data-scroll-fx~='parallax'] { --fx-parallax: 40px }`),
  never on `:root`. The effect properties don't inherit, so a range tuned on a section never leaks into an effect
  nested in it. The marquee's two do inherit. A scaled length works.
- **One range per element**: nest elements for effects that need different ranges.
- **Only `translate`, `scale` and `opacity` move**, so the element's own `transform` stays free. Parallax adds to its
  `translate`.

## 2. Timelines and ranges

- **`view()`** follows one element's pass through the viewport. **`scroll(root block)`** follows the page's scroll
  (the progress bar).
- **`animation-range`** picks a part of the pass: `cover` (first pixel in to last pixel out), `entry`, `exit`,
  `contain`, and `exit-crossing` (measured against the element's own height). Defaults: parallax `cover` 0–100%, so it
  sits at its layout position when centred; fade-in and scale-in `entry` 0–100%; exit-fade `exit-crossing` 10–35%.
  Ranges use the untransformed box, so the drift and the scale never move their own range (spike S7a).
- **The top edge is the header's bottom edge.** `view()` measures inside the `scroll-padding`, which
  `css/animation.css` sets from `--header-h`.
- **`animation-timeline` and `animation-range` go after the `animation` shorthand**, which resets both (S7a).
- **Compositor properties.** Any property can animate on a timeline, but on native scroll a timeline's `transform`
  paints in the scroll's own frame in Chromium (at most a frame late in Safari 26), while `width` or `left` is always a
  frame late (S1, S7f). So the progress bar scales.
- **`timeline-scope`** lets a named `view-timeline` drive an element outside its own subtree. Declare it on a common
  ancestor, once per component instance. Chromium requires it: without it the animation has no timeline and holds its
  last keyframe. Safari 26 and Firefox bind an unscoped name to another instance's timeline, so a missing scope passes
  in Safari and fails in Chrome (S7b). In the block only the stack uses names.

## 3. Browser support and the static state

| Browser or reader | Sees |
|---|---|
| Chromium (Chrome, Edge) 115+, Safari 26+ | the effect, on the spec's range maths exactly (S7a); Safari a frame late under Lenis (§4) |
| Firefox (155 stable: timelines behind a preference) | the static state |
| reduced motion, print | the static state |

- **The static style is the finished state**: every element fully shown and in place, so no content depends on the
  effect.
- **Every scroll-driven rule sits inside `@supports (animation-timeline: view())`** and
  `@media screen and (prefers-reduced-motion: no-preference)`. Unguarded, Firefox 155 runs the keyframes on the
  document timeline: a recipe with a duration plays once at page load, even far below the fold (S7a). When Firefox
  ships timelines, the guard switches it over by itself. `npm run test:scroll-effects` checks all three browsers.
- **Lightning CSS**, the minifier in Vite 8 and the engine in Tailwind v4 (so in Next with Tailwind v4 too), keeps this
  file's keyframes and declaration order. Two rewrites matter:
  - For build targets older than Chrome 120 it rewrites `:dir(rtl)` as a `:lang(…)` list, so the progress bar's and
    the marquee's right-to-left rules follow the page's `lang`, not its `dir`. Set the build targets, or keep `lang`
    and `dir` in agreement.
  - It merges `transform`, `translate` and `scale` set in one rule into one `transform: translate(0,0) scale(1)`, so a
    reset of all three loses two and leaves an identity transform. That is why `animation.css` resets `transform`
    alone.

## 4. Under each scroll authority

- **Native:** exact.
- **Lenis: decoration only.** Frame-exact in Chromium, but Safari reads the previous frame's scroll (S1). Fades,
  progress and gentle parallax can take that; anything registered to moving content (a caption on an image, a mark on
  a line) is driven from Lenis's tick by GSAP or Motion.
- **ScrollSmoother: off.** `view()` never progresses inside `#smooth-content` (S2), so on
  `html[data-scroll-authority="smoother"]` the block shows the static state, and the stack is a column, since sticky
  never sticks there. A fixed progress bar outside the wrapper keeps running: the root still scrolls. Parallax there is
  `data-speed` or the GSAP recipe ([layered-visuals.md](layered-visuals.md) §2).

## 5. Reduced motion

- The block shows the static state, followed live. The marquee stands still; stack cards still stick, since sticky is
  layout and adds no scroll distance.
- **Reset your own with `animation: none`.** The shorthand resets `animation-timeline` and `animation-range` too, in
  all three engines (S7e).
- **Never a duration reset** (`animation-duration: 0.01ms !important`): the animation keeps scrubbing. **Never
  `animation-timeline: none`**: it stays attached, holding its last keyframe (S7e).

## 6. Clipping ancestors: `clip`, never `hidden`

- **`overflow: hidden` or `overflow-x: hidden`** on any ancestor between a `view()` subject and the page scroller
  becomes the subject's scroll container. It never scrolls, so progress freezes part-way (0.5 or 0.375) in all three
  engines (S7c). `overflow-x` counts: it turns the other axis to `auto`.
- **`overflow: clip` clips without scrolling**, and the subject keeps tracking the page: clip the frame of an image
  that drifts inside it. Or name a `view-timeline` on the clipping box and animate the child by that name.
- **Never `overflow-x: hidden` on both `html` and `body`**: `body` becomes the scroller for every `view()` on the
  page, and every effect freezes. On one of the two it is harmless.

## 7. The sticky stack

```html
<section data-scroll-fx="sticky-stack" class="stack">
  <article>…</article>                   <!-- every direct child is a card -->
  <article>…</article>
</section>
```
```css
.stack::after { content: ''; display: block; height: 50svh }   /* holds the last card for 50svh of scroll */
```

Cards stick under the fixed header (`top: var(--header-h)`). **Card N shrinks to `--fx-scale-from` and dims to
`--fx-fade-from` on card N+1's view timeline, over its `entry` range**, so it changes exactly while the next card
slides over it. Never on the stuck card's own `view()`: Chromium and Safari stretch a stuck box's ranges over its stuck
travel, and Firefox (with timelines on) freezes them (S7d). Each stack scopes its own names.

- **Cards at most `calc(100svh - var(--header-h))` tall** stay whole while stuck; a taller one is covered before its
  bottom edge shows.
- **The last card leaves with the stack** as soon as it arrives: end padding doesn't hold it, a spacer does (above).
- **12 cards have names.** Later cards stick but don't shrink; for more, add their rules and names to `timeline-scope`.
- **A tuned range ends before the next card sticks**, for the same reason.
- **Dimming fades the whole card**, background included, so the card beneath shows through. Keep `--fx-fade-from` at
  1 on opaque cards.
- **A card's own effects go on an element inside it**: the stack owns the card's animation.
- Without timelines and under reduced motion the cards stick, unscaled.

## 8. The marquee

```html
<div data-scroll-fx="marquee" id="ticker">
  <div><ul>…the items…</ul><ul aria-hidden="true" inert>…the same items…</ul></div>
</div>
<button type="button" aria-controls="ticker" aria-pressed="false">Pause the ticker</button>
```
```js
button.addEventListener('click', () => {
  const paused = button.getAttribute('aria-pressed') !== 'true'
  button.setAttribute('aria-pressed', String(paused))
  document.getElementById('ticker').toggleAttribute('data-marquee-paused', paused)
})
```

It runs on time, not scroll, so Firefox runs it too.
- **The track** (the only child) holds the items, then an identical copy that is `aria-hidden` and `inert`, so
  assistive technology and the Tab key reach each item once. It slides one copy's width and starts over, seamlessly
  when the copies match and each is at least as wide as the marquee. No gap on the track: space the items inside each
  copy, and end each copy with the same space.
- **WCAG 2.2.2 requires the pause button**: it moves by itself for more than 5 s. The page provides it, outside the
  marquee, toggling `data-marquee-paused` (on `html`, it pauses every marquee) and its own `aria-pressed`. The marquee
  also pauses on hover and while focus is inside it.
- **Under reduced motion it stands still**, so items clipped at its edge are never seen. Keep links out, or repeat
  them elsewhere: a focused link can sit clipped.
- Right to left, it runs rightward. A speed that follows the scroll is the `marquee-velocity` recipe on the same markup
  ([layered-visuals.md](layered-visuals.md) §5); never both on one row.

## 9. Reading progress and the exit fade

**Progress.** `data-scroll-fx="progress"` grows from its inline-start edge with the page's scroll. The page places,
sizes and colours it; mark it `aria-hidden`. At rest it isn't drawn (`scale: 0 1`): a frozen bar would report a wrong
position. `--fx-range-start: 600px` starts it after a hero. Under ScrollSmoother it sits outside `#smooth-wrapper`.

**Exit fade.** `data-scroll-fx="exit-fade"` fades the element over `exit-crossing` 10% to 35%: from when a tenth of it
has passed under the header, while most of it is still on screen. `--fx-range-start` and `--fx-range-end` move it.
- Fade a whole group, never item by item: a small element fading across its own small height snaps.
- It shares an element with fade-in, and a landed `reveal` item rests at opacity 1 under it
  ([entrances.md](entrances.md) §6).
- On a scene's riding copy it fades and stays gone, where a fade bound to Motion's `style` drifts back over the render
  past its range ([scenes.md](scenes.md) §6).

## Traps

- [ ] Scroll-driven rules sit inside `@supports` and the no-preference query, after the `animation` shorthand; the
      static style is the finished state (§2, §3).
- [ ] Every named timeline has a `timeline-scope` per instance, checked in Chromium (§2).
- [ ] No `overflow: hidden` or `overflow-x: hidden` between an effect and the scroller (§6).
- [ ] Reduced motion resets with `animation: none` (§5).
- [ ] Lenis: CSS timelines for decoration only. ScrollSmoother: none inside the content (§4).
- [ ] Stack cards fit under the header, a spacer holds the last one, opaque cards don't dim (§7).
- [ ] Every marquee has its pause button and no link that only it shows (§8).
