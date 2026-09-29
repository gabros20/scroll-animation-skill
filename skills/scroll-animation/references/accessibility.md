# Accessibility for scroll-driven motion

**Purpose:** Make motion safe and usable for everyone: reduced motion as an alternate scene in every engine and API,
pausable auto-motion, keyboard and screen-reader access to pinned and transformed content, split text that still reads.

**Read when:** you're building any motion that moves more than a small element, pins, auto-plays, splits text, or
transitions between pages; or reviewing a motion build before shipping.
**Skip when:** the change is a pure timing tweak to an existing, already-reviewed effect.

**Inputs:** the scene ledger in `ANIMATION.md` (each row has a reduced-motion column) and the blocks in use.
**Produces:** a reduced-motion alternative per scene, pause controls where WCAG requires them, and the keyboard,
focus and screen-reader fixes, each checked in a browser.

## Contents

1. [Reduced motion is an alternate scene](#1-reduced-motion-is-an-alternate-scene)
2. [Per engine and API](#2-per-engine-and-api)
3. [Auto-moving content and flashes](#3-auto-moving-content-and-flashes)
4. [Keyboard and focus](#4-keyboard-and-focus)
5. [Split text and screen readers](#5-split-text-and-screen-readers)
6. [Content without JavaScript, print and reader mode](#6-content-without-javascript-print-and-reader-mode)
7. [Vestibular triggers](#7-vestibular-triggers)
8. [Traps](#traps)

## 1. Reduced motion is an alternate scene

`prefers-reduced-motion: reduce` doesn't mean "the same animation, faster". It means a composition with no
positional movement that still tells the story:

| Scene | Reduced alternative |
|---|---|
| Triggered entrance | content visible at rest; a short opacity fade at most |
| Pinned or scrubbed scene | the pin collapses to normal flow; each act shows its end state; empty pacing acts collapse to 0 |
| Scrub video / image sequence | a poster (or the chosen end frame), no pin |
| Horizontal rail | a native horizontal scroller with mandatory snap, focusable, with a focus ring ([scenes.md](scenes.md) §14) |
| Parallax, velocity effects | none |
| Colour track | stays, exact, with no catch-up: a colour change isn't movement |
| Draw on scroll | fully drawn |
| Smooth scroll (Lenis, ScrollSmoother) | native scrolling, followed live: Lenis is torn down; ScrollSmoother, started by `createSmoother`, runs in its native mode (`smooth: 0`, no `data-speed` / `data-lag`) |
| Page transition | an instant swap, or a crossfade without movement |
| WebGL world | the poster image; the canvas is never mounted |
| Loop video, marquee | stopped, poster or first frame; `marquee-velocity`'s toggle can still start it, since clipped items only show by moving |
| Header ink per section | the ink changes at once, with no colour transition |
| Count-up | the final number at once |

Record the alternative in the ledger's reduced-motion column before building the scene. A reader who asked for less
motion must never scroll a multi-viewport runway past a frozen frame.

## 2. Per engine and API

Each engine covers only its own animations. Anything you write by hand checks the query itself.

- **CSS.** Put decorative keyframes inside `@media (prefers-reduced-motion: no-preference)`, or reset them under
  `reduce` with `animation: none`. For scroll-driven animations that shorthand is a full reset, timeline and range
  included (spike S7e: S1–S7 are the skill's own browser measurements, September 2026). Never reset with a near-zero
  duration (the animation keeps scrubbing) or with `animation-timeline: none` (it holds the last keyframe).
  ```css
  @media (prefers-reduced-motion: reduce) {
    .parallax { animation: none; }
  }
  ```
- **GSAP.** Build inside `gsap.matchMedia()` with `MOTION_CONDITIONS` (reduced motion only); when the visitor
  changes the setting, GSAP reverts what was built and runs the function again. Keep the breakpoint out of the
  conditions of any build that creates ScrollTriggers: in GSAP 3.15 a condition change leaves the page at scroll 0.
  ```ts
  gsap.matchMedia().add(MOTION_CONDITIONS, (ctx) => {
    const { reduce } = ctx.conditions as MotionConditions
    if (reduce) { gsap.set(items, { autoAlpha: 1 }); return }
    // full motion; branch on isDesktop() inside if the layout differs
  })
  ```
- **Motion.** `MotionConfig reducedMotion="user"` (in `MotionProvider`) drops transform and layout animation. A
  `useMotionValueEvent` writer, a typewriter or any timing-only sequence reads the setting itself, live, with
  `useReducedMotionLive()` (`motion/useReducedMotionLive.ts`): Motion 13.4's `useReducedMotion()` reads it once, at mount.
- **View Transitions.** CSS can't intercept `document.startViewTransition()`: guard the call in JS, and shorten the
  pseudo-element animations under `reduce`.
  ```css
  @media (prefers-reduced-motion: reduce) {
    ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) {
      animation-duration: 0s !important;
    }
  }
  ```
- **WebGL.** Check the query (and WebGL support) once before mounting the canvas; under `reduce`, render the poster
  and never load the 3D bundle.

Verify it: with reduced motion emulated, `document.getAnimations().filter((a) => a.playState === 'running')` is empty
once the page settles, and no element inside a scene is still `position: sticky`.

## 3. Auto-moving content and flashes

- **WCAG 2.2.2, Pause, Stop, Hide.** Anything that moves by itself for more than 5 seconds next to other content (a
  loop video, a marquee, an ambient WebGL loop) needs a visible pause control, or it stops within 5 seconds. Pause on
  `:hover` and `:focus-within` too for marquees. `marquee-velocity` also pauses off screen, and keyboard focus on an
  item it clips moves the row until the item shows. Under reduced motion it doesn't start by itself.
- **WCAG 2.3.1, three flashes.** No shader, glitch or strobe effect flashes more than three times in any second.
- Autoplaying video is muted, `playsinline`, and IO-gated; a video with sound plays only from a click.

## 4. Keyboard and focus

- **Hidden acts are inert.** In a pinned scene, acts that are not on screen get `inert`, written by the scene's mode
  latch on each transition (never per frame). Otherwise Tab lands on invisible links and a screen reader reads copy
  the reader can't see.
- **Focus follows transformed content.** A rail moves its panels with `translate`, so a Tab to a link on an off-screen
  panel doesn't bring it into view. `horizontal-rail` follows keyboard focus only (`:focus-visible`): a frame later it
  jumps the page through the scroll authority until the panel is fully in view. A click moves nothing, and panels are
  never `inert` ([scenes.md](scenes.md) §14).
- **WCAG 2.4.11, focus not obscured.** A fixed header covers focused elements below it: set
  `html { scroll-padding-top: var(--header-h) }` (the header variable from config) so keyboard and anchor scrolling
  land below it.
- **Stepped presentations** (`stepped-sections`, [layered-visuals.md](layered-visuals.md) §11) step on the arrows,
  Page Up/Down and Space (Shift+Space back), and Home and End go to the ends. Keys in fields and widgets, Space on a
  button, a nested scroller that can still scroll, Ctrl+wheel, pinches and a zoomed-in page stay native, so zoom
  always works. Nothing is hidden, `inert` or locked, and a step yields to any scroll it didn't write: a screen reader
  is never trapped. Keyboard focus jumps to the stop that shows it. Native scrolling only, and normal scrolling under
  reduced motion; prefer ordinary scrolling unless the brief is explicitly a presentation.
- **Cursor media** (`cursor-media`) shows a keyboard-focused item's media beside it, at its inline end, never over its
  focus ring: keep items `width: fit-content` ([layered-visuals.md](layered-visuals.md) §6).
- **Safari's Tab skips links** unless Option is held: test keyboard paths there with Option+Tab.
- A modal or menu that stops page scrolling uses the authority's `stop()`/`start()`; never `position: fixed` on the
  body over a playing video (Safari drops the video's layer).

## 5. Split text and screen readers

The blocks and the measurements behind these rules are in [text.md](text.md) §5.

- **Headings with nothing focusable inside:** GSAP SplitText `aria: "auto"` names the heading with `aria-label` and
  hides the pieces. Only there: ARIA prohibits naming generic and paragraph elements, and a link inside a labelled
  heading drops out of the tree while staying in the Tab order. A heading that contains a link is running text.
- **Running text** (paragraphs, list items, headings with links): keep the element's own nodes as its visually hidden
  content (the same nodes, so links keep their listeners and one Tab stop), and split an `aria-hidden` wrapper of
  copies with `aria: "hidden"`, its focusables at `tabindex="-1"`. Put `aria: "hidden"` on that inner wrapper, never on
  the element, or it hides the real text too. Put the original nodes back when the entrance ends (split-reveal's
  `revertAfter`), which also stops browser translation from garbling split spans.
- **Server-split words** (`SplitWords`, `splitWordsHTML`): the sentence once in a visually hidden span, the words as
  `aria-hidden` spans. `innerText` and copy-paste see the sentence twice; that is the price of splitting with no
  JavaScript.
- Never split running text into characters, and never split Arabic or Indic scripts below the word: it breaks
  letter joining and shaping. For Chinese, Japanese and Thai, segment with `Intl.Segmenter`, not spaces.
- **A number that counts up** (`count-up`): while it counts, the number is `aria-hidden` and a visually hidden copy
  of the final text follows it, so a screen reader hears the final value once. Never `aria-label` on the number's
  span: ARIA doesn't allow naming a generic element, and screen readers skip it ([entrances.md](entrances.md) §8).

## 6. Content without JavaScript, print and reader mode

- Hidden entrance states apply only under `html[data-animation="on"]`, set by the inline head script; a reader with
  JavaScript off sees everything, with no `<noscript>` rule ([entrances.md](entrances.md) §9).
- The CSS failsafe reveals content if no engine marks itself ready within 4 seconds.
- `@media print`: hidden states, pin spacers and scene runways reset so every act prints in flow. A ScrollSmoother
  wrapper prints only one viewport unless print CSS unwraps it.
- Reader mode and translation read the DOM: keep real text in the DOM (not only in a canvas or an image), and revert
  splits after entrances.
- **Forced colours** (Windows High Contrast) replace the page's colours with the reader's. `header-theme`'s blend
  variant (`data-header-blend`: white ink, `mix-blend-mode: difference`) resets to a normal blend there, because a
  difference blend would invert the reader's colours ([layered-visuals.md](layered-visuals.md) §7).

## 7. Vestibular triggers

The motions most likely to cause discomfort: large-scale zoom, parallax with big depth differences, rotation, and
directional slides that fill the viewport. Keep parallax ranges modest, avoid full-viewport zooms tied to fast
scrolling, and remove all of these under reduced motion.

## Traps

- [ ] Every ledger row has a reduced-motion alternative, and it was checked with the setting emulated.
- [ ] CSS scroll-driven animations reset with `animation: none` under reduced motion, never a near-zero duration.
- [ ] Loops, marquees and ambient WebGL longer than 5 s have a pause control.
- [ ] Off-screen acts are `inert`; a rail follows keyboard focus; keyboard paths were tried in Safari with Option+Tab.
- [ ] `scroll-padding-top` matches the fixed header.
- [ ] Split text: `aria: "auto"` only on headings; paragraphs reverted or given a hidden copy; no character splits
      of running text.
- [ ] The page reads with JavaScript off and prints every act.
