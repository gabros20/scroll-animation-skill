# Scrollytelling

**Purpose:** Tell a story whose text and visuals change as the reader scrolls, at the reader's own pace: pick the
technique and layout per beat, map each to a clock and a block, and keep it readable on phones, without JavaScript
and with assistive technology.

**Read when:** a brief asks for scrollytelling, a sticky graphic or chart beside text steps, a data story, a visual
essay, a map that zooms as the story moves; or a scrolly graphic doesn't stick, a step never activates, or the
graphic flickers.
**Skip when:** the section only arrives once (an entrance: [entrances.md](entrances.md)), or it is a pinned scene with
no text steps beside it ([scenes.md](scenes.md)).

**Inputs:** the story beats from `ANIMATION.md` (preflight's story-beats question), the visuals per beat, the route's
engine and scroll authority.
**Produces:** a scene ledger with one row per beat, `scrolly-steps` (or the pinned, rail or layered block a beat
needs) wired with its stacked fallback, reduced-motion behaviour and focus handling.

## Contents

1. [What it is, and the boundary](#1-what-it-is-and-the-boundary)
2. [Story first](#2-story-first)
3. [The five techniques](#3-the-five-techniques)
4. [The four layouts](#4-the-four-layouts)
5. [The scrolly-steps block](#5-the-scrolly-steps-block)
6. [Phones and the stacked layout](#6-phones-and-the-stacked-layout)
7. [Accessibility](#7-accessibility)
8. [Driving the graphic: GSAP and Motion](#8-driving-the-graphic-gsap-and-motion)
9. [Traps](#traps)

## 1. What it is, and the boundary

Text and visuals change as the reader scrolls, and the reader keeps the pace: stopping stops the story, scrolling
back replays it. **The page always scrolls natively.** Nothing here handles the wheel, snaps the document or holds
the scroll while something plays (craft.md §6: no forced beats). `scrolly-steps` can't scroll-jack by design: it
only watches. The one exception in the pack is `stepped-sections`, which is a presentation mode with its own
keyboard and reduced-motion duties ([layered-visuals.md](layered-visuals.md) §11), not scrollytelling.

## 2. Story first

- **Beats before blocks.** Write the story as beats (one idea each, in order) and give each a ledger row with its
  `beat` ([preflight.md](preflight.md) §4). The technique and layout follow from what the beat shows.
- **One idea per step.** A step is a short paragraph that says what the graphic now shows; two ideas are two steps.
  The steps are the content: everything the graphic shows is said in a step or in an inline figure's caption.
- **Pacing is runway.** Each step's height plus `--scrolly-gap` (default 50svh) is the time a reader spends on it.
  Keep the page's total runway in view and alternate scrolly sections with plain reading ([craft.md](craft.md) §6).
- **When not to.** Brief content, no strong visuals, or no sequence to reveal: a scrolly section adds runway and
  nothing to read. Use entrances and a figure.
- **A long piece gets a progress indicator**: `data-scroll-fx="progress"` from `scroll-effects`
  ([css-scroll-effects.md](css-scroll-effects.md) §9).

## 3. The five techniques

| Technique | What the reader sees | Clock | Block |
|---|---|---|---|
| Graphic sequence | the graphic swaps to a new state per step | trigger | `scrolly-steps`: its states crossfade, opacity only, on `MOTION.disclosure` (0.24 s) |
| Animated transition | the graphic animates from one state to the next (bars grow, a line draws, points move) | trigger, once per transition | `scrolly-steps` `onStep` or `useScrollyActive()` driving the route's engine (§8) |
| Pan and zoom | the camera moves across one picture or map | trigger per step, or scroll within a step | a per-step `animate` from `onStep` (§8); within a step, `progress: true` and `--step-p` writing a transform; a full-bleed version is `scrub-video`'s camera on `pinned-scene` ([scenes.md](scenes.md) §7) |
| Moviescroller | video or frames scrubbed by scroll | media | `scrub-video` or `frame-sequence` on `pinned-scene` ([video.md](video.md), [sequences.md](sequences.md)) |
| Show and play | a clip plays when its step arrives | media, started on a trigger | `loop-video`, or a play started from `onStep`, with a pause control for anything over 5 s ([accessibility.md](accessibility.md) §3) |

State changes once per step, never per frame: `onStep` and `useScrollyActive()` fire on a change, and `--step-p`
is exact and written only when it moves.

## 4. The four layouts

| Layout | Block |
|---|---|
| Side by side: a sticky graphic beside scrolling steps | `scrolly-steps` (`data-scrolly-side="start"` puts the graphic first) |
| Full width: text cards over a full-bleed visual | `pinned-scene` with stacked acts, or riding sections over its pin ([scenes.md](scenes.md) §2, §11) |
| Layered parallax: foreground and background at different speeds | `parallax` or `scroll-effects` ([layered-visuals.md](layered-visuals.md) §2): one subtle parallax per page, a static fallback |
| Multi-directional: the story turns sideways | `horizontal-rail` ([scenes.md](scenes.md) §14) |

A sticky graphic that changes per step is `scrolly-steps`, never a pin: the column is read whole beside the text.

## 5. The scrolly-steps block

`scroll-animation add scrolly-steps` copies `scrolly-steps.ts` and `css/scrolly.css` (plus `motion/ScrollySteps.tsx`
on React routes). Import the CSS after `css/animation.css`; `GATE_SCRIPT` must be in the head.

```html
<section data-scrolly>
  <div data-scrolly-graphic>
    <figure data-scrolly-state="map">…</figure>
    <figure data-scrolly-state="zoom">…</figure>
  </div>
  <ol data-scrolly-steps>
    <li data-scrolly-step data-scrolly-show="map">…text…<figure data-scrolly-inline>…</figure></li>
    <li data-scrolly-step data-scrolly-show="zoom">…</li>
  </ol>
</section>
```

- **The active step** is the last whose top has reached the line, `data-scrolly-line` (a percentage of the viewport
  below the header, default 50). Before the first step it is step 0; after the last, the last stays. A step without
  `data-scrolly-show` shows the state with its own index.
- **Two IntersectionObservers**, one above the line and one below, so a jump (an anchor, Page Down, a reload
  mid-page) still resolves, under native scrolling, Lenis and ScrollSmoother alike. No scroll listener, nothing per
  frame. A jump reports one change, never the steps it skipped.
- **Writes**: `data-scrolly-active` on the root; `data-step-state="before|active|after"` on steps, in sticky mode
  only (so dimming CSS keyed on it never dims stacked content); `data-state-active` on the shown state, `inert` and
  `aria-hidden` on the others; a bubbling `scrolly:step` event and `onStep` with `{ index, previous, direction }`.
- **`previous: null` means the page landed** (the mount, a `#fragment`, a restored position): seek to the step,
  never animate.
- **The graphic sticks under `--header-h` and is `100svh` less the header**, measured on the iOS 18.3 simulator: at
  `lvh` its bottom 82 px (axes, captions) sat under the expanded toolbar. A column is read whole; a full-bleed pin is
  the opposite case and uses `lvh` ([scenes.md](scenes.md) §1). The steps end in a tail of (1 − line) × the viewport
  in `lvh`, so the last step reaches the line at the page's end.
- **Under ScrollSmoother** sticky can't stick: the CSS leaves the graphic unpositioned and the page pins it
  (`ScrollTrigger.create({ trigger: graphic, pin: true, pinSpacing: false, start: 'top top+=<header>', endTrigger:
  section, end: 'bottom bottom' })`).
- `destroy()` leaves the last state in place, so a route shown again under `<Activity>` doesn't flash state 0.

## 6. Phones and the stacked layout

- **Stacked is the default**: phones, no JavaScript, print and a failed boot. The graphic column is hidden and each
  step's `data-scrolly-inline` figure reads in flow. Sticky needs the gate and `DESKTOP_QUERY` (1024 px), or the
  root's own `data-scrolly-query`, which costs one layout shift at mount.
- A breakpoint change switches live and keeps the reader on the same step.
- **Keep, simplify or drop the graphic per beat.** Keep the sticky layout where the graphic still reads at half the
  width (set `data-scrolly-query` lower). Simplify a chart to the states that carry the story as inline figures.
  Drop the graphic where a beat's text already says it; give that step no inline figure.

## 7. Accessibility

- **The steps are the content; the graphic illustrates.** Hidden states are `inert` and `aria-hidden`, so a screen
  reader reads the steps and the shown state once.
- **`data-scrolly-live` is off by default**: it mirrors the shown state's figcaption into a polite live region, and an
  announcement on every step talks over the text being read. Turn it on only when a state carries information the
  steps don't (a chart's value).
- No `aria-current`: a screen reader's cursor never moves the line, so it would announce a step the reader isn't on.
- **Focus**: keyboard focus inside a step makes it active while it stays on screen, so a step that can't reach the
  line still shows its state. A click doesn't.
- **Reduced motion keeps the sticky layout** with an instant swap: nothing moves and there is no runway past a frozen
  frame. Gate your own `--step-p` motion under `prefers-reduced-motion: no-preference`, and make every per-step
  animation a jump.
- **Vestibular**: zooms and deep parallax are the riskiest motions here; keep zooms modest and slow, never tied to
  fast scrolling, and drop them under reduced motion ([accessibility.md](accessibility.md) §7).

## 8. Driving the graphic: GSAP and Motion

**GSAP** (run as a test fixture against gsap 3.15; `tweenTo` pauses the timeline and tweens its time):

```ts
let go: ((label: string, seek: boolean) => void) | null = null
const scrolly = mountScrollySteps(section, { onStep: ({ index, previous }) => go?.(`s${index}`, previous === null) })
gsap.matchMedia().add({ desktop: DESKTOP_QUERY, reduce: REDUCED_MOTION_QUERY }, (context) => {
  const { desktop, reduce } = context.conditions!
  if (!desktop) return                                       // stacked: no graphic to drive
  const tl = gsap.timeline({ paused: true }).addLabel('s0').to(dot, { x: 240 }).addLabel('s1') /* … one label per step */
  tl.seek(`s${scrolly.active}`)                              // a rebuild lands on the step the core kept
  context.add('go', (label: string, seek: boolean) => (seek || reduce ? tl.seek(label) : tl.tweenTo(label, { duration: 0.6 })))
  go = context.go
  return () => { go = null }
})
```

Mount the core outside `matchMedia`: its own query switches the layout, and a destroy there would leave it sticky.

**Motion**: read the step with `useScrollyActive()` inside `<ScrollySteps>` and animate once per change. Folio's
`ScrollyPan` pans a photograph per step this way:

```tsx
const { active, direction } = useScrollyActive()
useEffect(() => {
  const el = ref.current
  if (!el || !frames[active]) return
  const jump = direction === null || !el.closest('[data-scrolly-mode="sticky"]') || prefersReducedMotion()
  const controls = animate(el, frames[active], jump ? { duration: 0 } : { duration: MOTION.entrance.duration })
  return () => controls.stop()
}, [active, direction])
```

It jumps on the landing report (`direction` null), in the stacked layout and under reduced motion (read live: an
imperative `animate` is outside `MotionConfig`). Within-step motion is `progress` plus `--step-p` in CSS or
`onProgress`, never React state.

## Traps

- [ ] The page scrolls natively; nothing snaps, locks or handles the wheel (§1).
- [ ] Every beat has a ledger row; one idea per step; the steps say what the graphic shows (§2).
- [ ] No `overflow: hidden` on the section or an ancestor: it becomes the scroll container and the graphic stops
      sticking (`overflow: clip`).
- [ ] The tail stays: removing it (or padding the steps column yourself) leaves the last step short of the line.
- [ ] Every state fits the column, `100svh` less the header, axes and captions included: the column has a fixed
      height, so a taller state spills past it.
- [ ] No transform on the section or an ancestor of the graphic (invariant 5): transform the states' contents.
- [ ] State changes per step, never per frame; `previous: null` seeks (§5, §8).
- [ ] Under ScrollSmoother the page pins the graphic (§5).
- [ ] Stacked steps carry their inline figures; dimming keys on `data-step-state` (§5, §6).
