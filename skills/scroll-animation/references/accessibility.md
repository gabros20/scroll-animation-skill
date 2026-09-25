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
| Horizontal rail | a native horizontal scroller with scroll-snap, or a vertical stack |
| Parallax, velocity effects | none |
| Smooth scroll (Lenis, ScrollSmoother) | not created: native scrolling |
| Page transition | an instant swap, or a crossfade without movement |
| WebGL world | the poster image; the canvas is never mounted |
| Loop video, marquee | stopped, poster or first frame |

Record the alternative in the ledger's reduced-motion column before building the scene. A reader who asked for less
motion must never scroll a multi-viewport runway past a frozen frame.

## 2. Per engine and API

Each engine covers only its own animations. Anything you write by hand checks the query itself.

- **CSS.** Put decorative keyframes inside `@media (prefers-reduced-motion: no-preference)`, or reset them under
  `reduce`. For scroll-driven CSS reset the timeline too: `animation: none` alone leaves `animation-timeline`
  attached.
  ```css
  @media (prefers-reduced-motion: reduce) {
    .parallax { animation: none; animation-timeline: auto; }
  }
  ```
- **GSAP.** Build inside `gsap.matchMedia()` with the shared conditions; when the visitor changes the setting, GSAP
  reverts what was built and runs the function again.
  ```ts
  gsap.matchMedia().add(CONDITIONS, (ctx) => {
    const { reduce } = ctx.conditions as Conditions
    if (reduce) { gsap.set(items, { autoAlpha: 1 }); return }
    // full motion
  })
  ```
- **Motion.** `MotionConfig reducedMotion="user"` (in `MotionProvider`) drops transform and layout animation. A
  `useMotionValueEvent` writer, a typewriter or any timing-only sequence calls `useReducedMotion()` itself.
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
  `:hover` and `:focus-within` too for marquees. Under reduced motion it doesn't start.
- **WCAG 2.3.1, three flashes.** No shader, glitch or strobe effect flashes more than three times in any second.
- Autoplaying video is muted, `playsinline`, and IO-gated; a video with sound plays only from a click.

## 4. Keyboard and focus

- **Hidden acts are inert.** In a pinned scene, acts that are not on screen get `inert`, written by the scene's mode
  latch on each transition (never per frame). Otherwise Tab lands on invisible links and a screen reader reads copy
  the reader can't see.
- **Focus follows transformed content.** A horizontal rail moves panels with `transform`, so focusing a link on an
  off-screen panel doesn't scroll it into view. On `focusin`, scroll the page to that panel's progress through the
  scroll authority (`currentSmoothScroll()?.scrollTo` or native `scrollTo`).
- **WCAG 2.4.11, focus not obscured.** A fixed header covers focused elements below it: set
  `html { scroll-padding-top: var(--header-h) }` (the header variable from config) so keyboard and anchor scrolling
  land below it.
- **Scroll-jacked presentations** (GSAP Observer stepping one slide per wheel notch) must also step on arrow keys,
  Page Up/Down, Space and Home/End, never trap screen-reader navigation, and fall back to normal scrolling under
  reduced motion. Prefer ordinary scrolling unless the brief is explicitly a presentation.
- A modal or menu that stops page scrolling uses the authority's `stop()`/`start()`; never `position: fixed` on the
  body over a playing video (Safari drops the video's layer).

## 5. Split text and screen readers

- **Headings:** GSAP SplitText `aria: "auto"` puts the full text in `aria-label` on the heading and hides the pieces.
  That works on headings; ARIA doesn't allow naming generic or paragraph elements, so don't rely on it for a `<p>` or
  a `<div>`.
- **Paragraphs and other elements:** `aria: "hidden"` plus a visually hidden copy of the text, or `revert()` the split
  when the entrance finishes. Reverting also stops browser translation from garbling split spans.
- **Server-split words** (React): render the words as `aria-hidden` spans inside an element whose accessible name is
  the full sentence, or keep the sentence in a visually hidden span.
- Never split running text into characters, and never split Arabic or Indic scripts below the word: it breaks
  letter joining and shaping. For CJK and Thai, segment with `Intl.Segmenter`, not spaces.

## 6. Content without JavaScript, print and reader mode

- Hidden entrance states apply only under `html[data-animation="on"]`, set by the inline head script; a reader with
  JavaScript off sees everything. For Motion's server-rendered `initial` styles, include the `<noscript>` rule from
  `assets/css/animation.css`.
- The CSS failsafe reveals content if no engine marks itself ready within 4 seconds.
- `@media print`: hidden states, pin spacers and scene runways reset so every act prints in flow. A ScrollSmoother
  wrapper prints only one viewport unless print CSS unwraps it.
- Reader mode and translation read the DOM: keep real text in the DOM (not only in a canvas or an image), and revert
  splits after entrances.

## 7. Vestibular triggers

The motions most likely to cause discomfort: large-scale zoom, parallax with big depth differences, rotation, and
directional slides that fill the viewport. Keep parallax ranges modest, avoid full-viewport zooms tied to fast
scrolling, and remove all of these under reduced motion.

## Traps

- [ ] Every ledger row has a reduced-motion alternative, and it was checked with the setting emulated.
- [ ] CSS scroll-driven animations reset `animation-timeline` under reduced motion.
- [ ] Loops, marquees and ambient WebGL longer than 5 s have a pause control.
- [ ] Off-screen acts are `inert`; rails scroll focused panels into view.
- [ ] `scroll-padding-top` matches the fixed header.
- [ ] Split text: `aria: "auto"` only on headings; paragraphs reverted or given a hidden copy; no character splits
      of running text.
- [ ] The page reads with JavaScript off and prints every act.
