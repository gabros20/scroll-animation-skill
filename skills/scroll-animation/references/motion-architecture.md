# Motion architecture

**Purpose:** How to build an animated section: triage by clock, the entrance primitives, curves, reduced motion, SSR, and what was rejected.

**Read when:** you're deciding how a new animated section should be built (a component, a copied
pattern, or plain library calls), or reviewing whether an existing one follows the house rules.
**Skip when:** you already know the shape you want and only need the pin and scroll mechanics (see
`scroll-scenes.md`) or a video-specific trick (see `video.md`).
**Depends on:** `attribute-contract.md` for exact names; `fluid-interop.md` for how entrance
distances relate to a fluid-scaled layout, if the project has one.

This document is the *why* behind a shipped system, generalised from one production build (called
"the reference build" throughout). Two full generations of a more ambitious system were built and
deleted before this shape survived contact with ~30 real sections. The rules below exist because
something broke first, not because they sounded right in a planning doc.

**Inputs:** the section's design and the project's engine.
**Produces:** the clock, the primitive and the variants to use, with the reasons.

## Contents

1. [Three generations, and why two were deleted](#1-three-generations-and-why-two-were-deleted)
2. [The extraction rule](#2-the-extraction-rule)
3. [Triage by clock](#3-triage-by-clock)
4. [Stage / StageItem wiring](#4-stage--stageitem-wiring)
5. [One stage per arrival](#5-one-stage-per-arrival)
6. [Trigger lines and `amount`](#6-trigger-lines-and-amount)
7. [Variants: translate + opacity, distances in CSS vars](#7-variants-translate--opacity-distances-in-css-vars)
8. [The entrance curve and fade are measured](#8-the-entrance-curve-and-fade-are-measured)
9. [In-and-out are two mechanisms](#9-in-and-out-are-two-mechanisms)
10. [The craft table](#10-the-craft-table)
11. [Reduced motion is the writer's job](#11-reduced-motion-is-the-writers-job)
12. [The SSR rules](#12-the-ssr-rules)
13. [The GSAP escape hatch](#13-the-gsap-escape-hatch)
14. [Rejected](#14-rejected)
15. [Traps](#traps)

## 1. Three generations, and why two were deleted

| Generation | Shipped | Fate |
| --- | --- | --- |
| **1 — wrapper components** | `FadeIn`, `Parallax`, `ParallaxLayer`, `RevealText`, `StaggerContainer`, `AnimatedSection`, `AnimatedHeader` | deleted: each owned property values, so every new design needed a new prop |
| **2 — a timeline compiler** | a `timeline()` DSL, a `clock`/`latch`/`registry` runtime, `Scene`/`Scrub`/`Track`/`SceneGroup`, ~5 files of debug tooling | deleted: ~2,400 lines, one consumer, and the consumer was later rebuilt without it |
| **3 — what survives** | `Stage`/`StageItem`, a load veil, a count-up, a scroll-exit fader, one bespoke pinned scene | in production |

Generation 1's failure mode: a component that owns a property value forces every new design to add
a prop, and the props never compose. Eleven props deep, nobody could safely change one.

Generation 2's failure mode is more interesting because it looked right on paper: "Motion has no
`gsap.timeline()` equivalent, so build a container of time, and that's the whole job." It got built.
The site that shipped needed **one** scroll-driven scene, and that one scene needed none of the
compiler. It needed mode hysteresis, a frame-accurate media wrap, a handoff glide and a camera (all
covered in `scroll-scenes.md` and `video.md`). The timeline layer solved a problem the build didn't
have.

Generation 3 survives because every piece of it is **specific**: it names a job (an entrance, a
count, an exit-fade, a pinned scrubbed render) rather than a mechanism. That specificity is what the
extraction rule below turns into policy.

The entry condition for ever building a timeline compiler again, stated so it's falsifiable rather
than a vibe: **two or more sections each need four or more named spans on a shared ruler, with at
least one relative position (`'<'`/`'>'`) between them.** Until that's true, a scroll scene is a
`useScroll`/`useTransform` pair (or GSAP's `ScrollTrigger`) at the leaves, with named constants for
its landmarks. The reference build's one scrubbed scene is under 300 lines, none of which would have
been shorter with a compiler.

## 2. The extraction rule

> **A pattern graduates to a component at its SECOND consumer, never its first.**
> A component that exists for one caller is that caller, with indirection.

Both deleted generations violated this: the timeline layer and the debug panel each had at most one
consumer. The corollary is what keeps it honest: **when the second consumer appears, extract what
the two share, not what you imagine a third will want.** An exit-fade component gained a
configurable range only when a real second breakpoint needed a different one, and it gained a CSS
variable rather than a prop.

One pattern in the reference build sits at three consumers and is *still* a documented convention,
not a component: the direct style write (§9 below, full mechanics in `scroll-scenes.md` §6). The
three call sites share no code. One subscribes to a value and writes `opacity`, one writes four
quantised custom properties from an rAF tick, one writes a composed transform string from two clocks
at once. A helper general enough to cover all three would be longer and harder to read than any of
them.

> **What recurs is sometimes the rule, not the implementation.** When that's true, the artefact is
> a documented convention and a comment at each site, not a function. Counting consumers tells you
> *when* to look; it doesn't tell you *what* to extract.

## 3. Triage by clock

Sort a new animation by **who supplies time**, not by how complicated it looks. That's observable,
and it's what determines SSR behaviour, cost and which traps apply.

| Clock | The animation is… | Reach for | Cost |
| --- | --- | --- | --- |
| **Trigger** | fired once by arrival, then plays on its own | `<Stage trigger="view">`, a count-up | ~free: SSR-correct, goes quiescent, no scroll subscription |
| **Scroll** | a pure function of scroll offset, reversible | `useScroll`+`useTransform` / GSAP `ScrollTrigger` | real: main-thread, never sleeps while on screen, cannot SSR its settled state |
| **Media** | a function of what the decoder has presented | `requestVideoFrameCallback` inside a scroll scene | highest; see `video.md` |
| **Interaction** | fired by hover, press, drag, route change | `whileHover`/`whileTap` (Motion) or a plain listener | ~free |

Rules that follow directly:

- **Trigger is the default. Scroll is a decision.** Promoting a section from trigger to scroll
  costs a runway, a pin, a perf slot (see `performance.md`) and every trap in `scroll-scenes.md`.
  Do it when the reader should *drive* the motion, not because the motion is elaborate.
- **Above the fold, trigger only.** A scroll-driven fade renders at progress 0 on the server, so it
  ships invisible HTML with no recovery path. A trigger serialises its hidden state into the markup
  and a load veil covers the hydration window (§12); a scroll value can do neither.
- **One range wrapper per stack, never one per section.** Sections handing off to each other need a
  shared ruler; per-section rulers can't express the overlap (`scroll-scenes.md` §1).
- **Only 1–3 scroll-driven scenes should intersect the viewport at once.** At forty animated
  sections this triage *is* the perf budget; see `performance.md` §3.
- **Never demote a scroll scene to a trigger silently on mobile.** If mobile wants a different
  treatment, say so explicitly in the component, and note that "different" may mean *re-framed*
  rather than removed (the camera pattern, `scroll-scenes.md` §7).

And crossed with **what the unit is**, because that decides who owns the geometry:

| Unit | Trigger clock | Scroll clock |
| --- | --- | --- |
| One element | a stage item inside a stage | inline scroll hook on its own ref |
| One section | a stage around the group | one scroll hook on the section, values derived at the leaves |
| A stack of sections + a pinned layer | one stage per arrival (§5) | **one** range wrapper, sections as flow children over a sticky sibling |

## 4. Stage / StageItem wiring

The trigger-clock primitive carries the large majority of sections in the reference build (~30 of
them, against one scroll-driven scene). Two pieces:

- A **stage** sets `initial="hidden" animate="visible"` and animates nothing itself. In Motion this
  propagates through React context so every item beneath moves on one tick; in GSAP it's a
  `data-stage` root a shared observer flips.
- A **stage item** is server-rendered *in its hidden state* (`opacity: 0` plus a transform) and
  only reads the stage's state. **It must never be given its own `initial`/`animate`** (Motion) or
  its own trigger (GSAP), or it severs from the stage and fires on its own schedule.

Why the "never own it" rule matters more than it looks: propagation flows through **plain
server-rendered markup**. Column divs, an `<h1>`, a label component: none of it breaks the chain.
So the section stays a *server component* and only the animated leaves are client components; their
images and icons never enter the client bundle.

```tsx
// Motion — assets/motion/components/Stage.tsx et al.
<Stage trigger="view" className="flex flex-col gap-4">
  <StageItem variant="liftFade" className="[--hero-lift:20px] lg:[--hero-lift:24px]">
    <Eyebrow>Label</Eyebrow>
  </StageItem>
  <h2>
    <StageItem as="span" variant="liftFade" delay={0.067} className="block">Line one</StageItem>
    <StageItem as="span" variant="liftFade" delay={0.134} className="block">Line two</StageItem>
  </h2>
</Stage>
```

```html
<!-- GSAP — assets/gsap -->
<div data-stage="view">
  <p data-stage-item data-variant="liftFade" style="opacity:0;transform:translateY(20px)">Label</p>
  <h2>
    <span data-stage-item data-variant="liftFade" data-delay="0.067" style="opacity:0;transform:translateY(20px)">Line one</span>
  </h2>
</div>
```

Both read the shared attribute contract (`data-stage`, `data-stage-item`, `data-variant`,
`data-delay`; see `attribute-contract.md` §3 for the full table), so the verifier and the
`<noscript>` safety net (§12) work identically regardless of engine.

**Line-by-line entrances split at the authored break, never at the rendered lines.** Put each drawn
line in its own block span (one `StageItem` each), matching the hard break the design draws
(`<br className="hidden lg:inline" />` or equivalent). Animating *visual* lines means measuring text
layout, which is a different problem and one that re-flows with every font swap and window width.
The hard-break rule itself (why a scaled column needs a breakpoint-scoped `<br>` at all) belongs to
layout; with the `fluid-design` skill installed, see its `references/typography.md`.

## 5. One stage per arrival

> A stage fires on **its own top edge**. Scope it to one group of elements that share a moment.

A 900px content layer with copy at the top and a mark on its baseline is *two* arrivals. Wrapped in
one stage it fires once, at the top edge: the baseline mark plays its entrance while it's still most
of a screen below the fold and finishes long before anyone scrolls to it, which reads as "that
element doesn't animate." Two stages, each waiting for its own arrival, cost nothing and are the
fix. The same failure appears whenever a wide row stacks into a tall column on mobile: what was one
arrival on desktop becomes two.

## 6. Trigger lines and `amount`

Two defaults exist because of measured failures, not preference:

```
amount = 'some'                     // NOT a fraction
margin = '0px 0px -20% 0px'         // GSAP's `start: 'top 80%'`
```

- **`amount` as a fraction is a trap on tall content.** `0.6` of an element taller than the viewport
  can *never* be satisfied, so the reveal never fires, silently, and only on the viewport where the
  same content stacks tall (usually mobile). Desktop is fine; the phone ships permanently blank.
  Set the trigger line with `margin` and leave `amount` alone. (`scripts/tools/audit-motion.mjs` flags
  this as `fractional-amount`.)
- **`margin` shrinks the detection box** so a reveal fires when the element is properly on screen,
  not when it grazes the bottom edge. It must be a static string: the underlying
  `IntersectionObserver` re-reads it as `rootMargin`, so a value computed per render resubscribes
  the observer every render.

Three named constants carry the site-wide trigger policy, each an editorial decision recorded once
rather than copied per section:

| Constant | Value | For | Why not the default |
| --- | --- | --- | --- |
| `REVEAL_TRIGGER` | `0px 0px -20% 0px` | every below-the-fold section | the general default. It was `-35%` once, which read late on tall content |
| `PAGE_END_TRIGGER` | `0px` | the last group on the page (footer) | a negative bottom margin draws the line *inside* the viewport, so something must scroll *across* it. The terminal screenful never does, and the scroll runs out first. Measured: nine footer items never fired under the general default at 1440×900; on a 1400px-tall viewport the nav columns starved too, because the taller the viewport the further down the page that line reaches. |
| `AT_REST_TRIGGER` | `0px` | a group whose *resting* scroll position sits below the inset line | the second way the trap above bites, and not at the end of the page. A scroll well (`scroll-scenes.md` §8) gives a section a resting position, and content low in a section taller than the viewport never scrolls across an inset line at that rest state either |

The `AT_REST_TRIGGER` case was measured on a stat grid at its resting position. Its top, as a
fraction of the viewport: 40% at 1440×900 (fine), 58% at 768×1024 (starved), 63% at 402×874, 77% at
360×780, 90% at 375×667 (past `REVEAL_TRIGGER`'s line at 80%, so the default is not enough), 94% at
360×640.

`PAGE_END_TRIGGER` and `AT_REST_TRIGGER` are the identical value for a different reason each.
Keep them as separate names: merging them hides which fact changed if either one is revisited.
Both trade a touch of "plays slightly early" for "never plays at all," which is the correct side of
that trade: early is a preference, starved is a bug.

## 7. Variants: translate + opacity, distances in CSS vars

The entrance vocabulary in the reference build is `translateY` + `opacity` on one curve: no scale,
no mask beyond an element's own line box, no spring, no blur. (The softness in any reference capture
is camera motion blur, not a designed filter.) Keep the vocabulary that thin; the economy is the
style, and it's also what stays under `performance.md`'s per-frame budget.

Every offset reads a CSS custom property rather than a prop:

```tsx
<StageItem variant="liftFade" className="[--hero-lift:20px] lg:[--hero-lift:24px]">
```

```css
/* the variant definition */
.hidden { transform: translateY(var(--hero-lift, 32px)); opacity: 0; }
.visible { transform: translateY(0); opacity: 1; }
```

The variable carries the **signed** offset. A variant that starts *above* rest (a header dropping
in) and one that starts *below* it (a CTA lifting in) are the same mechanism with opposite signs,
which is what lets two elements converge on their design gap instead of sliding in as one block.
Vary the value with a plain breakpoint utility and zero JS, and let the runtime resolve the `var()`
at animation start. **Keep these distances in fixed px**, even on a fluid-scaled layout: engines
resolve `var()` once, so a scaled offset goes stale on resize (`fluid-interop.md`). Set the property
on the animated element itself, never on a shared ancestor (`performance.md` §8).

One variant, `growY`/`growX`, is the sanctioned exception to "never animate layout properties". See
`performance.md` §5 for why `scaleY` (not `height`) is what makes a growing bar affordable, and why
it needs `transform-origin: bottom` (or `left`, for `growX`) or it grows from the middle.

**Every variant above sets `transform`, which means `transform` is spoken for on any element
carrying `[data-variant]`/a `StageItem`.** If that same element also needs centring or another
static offset (`translateX(-50%)` to centre it horizontally, say), write it with the independent
`translate` property instead: `className="[translate:-50%_0]"` (or the equivalent inline style).
`transform: translateX(-50%)` on the same element is silently overwritten the moment the hidden
state applies, and again by whatever drives the reveal. `translate` composes with `transform`
rather than fighting it for the one declaration.

**The GSAP port folds it, with one safe case.** GSAP's first tween of an element's transform reads
the element's CSS `translate`/`rotate`/`scale`, bakes them into its own `transform` and sets them
to `none` inline. A plain percentage survives (as `xPercent`/`yPercent`), so `translate: -50% 0`
centring on a `[data-stage-item]` still works. A px or `calc()` value, including every
`fluid-translate-*` and any `--scene-p` drift (`fluid-interop.md` §3), is frozen at the moment of
the first tween and never updates again. Measured on a GSAP 3.15 build: every entrance-tweened
element carried an inline `translate: none`. On the GSAP port, keep anything but a pure-% offset on
a child or wrapper of the stage item. Motion writes only `transform` and leaves `translate` alone.

## 8. The entrance curve and fade are measured

`entrance` (a 1.3s move on `cubic-bezier(0.15, 0.6, 0.2, 1)`) and `entranceFade` (a 0.17s linear
fade, delayed 0.13s) are not chosen. They're fitted frame-by-frame against a reference capture (see
`attribute-contract.md` §4 for the exact numbers, and `assets/motion/lib/transitions.ts` for
the docblocked source of truth both engines share).

Two things worth carrying into any project that adopts these tokens rather than re-measuring its
own:

- **The fade deliberately runs on a different clock than the move.** In the reference the move
  takes 1.3s and the fade takes 0.17s, delayed 0.13s past the move's start, so a multi-line
  headline reads as staggered even though only one timing constant governs the whole group. Run
  opacity on the move's full duration instead and every line is already legible before a load veil
  clears; the stagger still technically happens, but nobody ever sees it.
- **No overshoot anywhere in the source capture.** The curve behaves like a first-order exponential
  approach: fast open, long quiet tail. Resist "improving" it into a spring; a spring reintroduces
  exactly the overshoot the measurement shows isn't there.

## 9. In-and-out are two mechanisms

Entrance and exit are deliberately different systems in the reference build: **triggered on the way
in, scroll-driven on the way out.** A stage moves items on its own tick; a scroll-bound exit-fader
fades the *group* on scroll. Never fade per element: a 46px wordmark fading across 46px of scroll
snaps instead of fading. They compose because they touch different things, and an item that has
finished its entrance sits at opacity 1 for the group fader to multiply over.

Use one mechanism for both only when the exit must stay in lockstep with something else that's
already scroll-driven, which is exactly when the extra coupling earns its cost.

## 10. The craft table

This system says **when** things happen; it says nothing about whether they look good. Distilled
craft standards, useful as a review checklist:

**Should it animate at all?**

| Frequency | Decision |
| --- | --- |
| 100+ times/day (shortcuts, command palettes) | No animation. Ever. |
| Tens of times/day (hover, list nav) | Remove or drastically reduce |
| Occasional (modals, drawers, toasts) | Standard animation |
| Rare / first-time (marketing sections, onboarding) | Delight is allowed |

Marketing sections sit in the last row, which is why a page like this can afford choreography a
product UI can't. It is not a licence for a nav or a header a returning visitor sees on every page
load.

**Easing**

| Situation | Easing |
| --- | --- |
| Entering or exiting | `ease-out` |
| Moving/morphing on screen | `ease-in-out` |
| Hover, colour change | `ease` |
| Constant motion (marquee, progress) | `linear` |
| **Scroll-driven values** | **`linear`, always** |

Never `ease-in` on UI: it starts slow, delaying the exact moment being watched. The scroll row
matters specifically: a scroll-driven value is already eased by the reader's scroll and by any
smoothing spring on the output. Easing the curve too is double-easing, the same reason GSAP requires
`ease: 'none'` whenever `scrub` is active. **Shape it with the range, not with a curve.**

**Duration**

| Element | Duration |
| --- | --- |
| Button press feedback | 100–160ms |
| Tooltips, small popovers | 125–200ms |
| Dropdowns, selects | 150–250ms |
| Modals, drawers | 200–500ms |
| Marketing / explanatory | can be longer |

UI animations stay under 300ms. Scroll-driven values have no duration at all: they have a span,
and the reader sets the pace.

**Stagger:** 30–80ms between items for time-based staggers; longer feels slow, and stagger is
decorative, so never block interaction while it plays. For a scroll-driven stagger, convert before
trusting it: `stagger_ms ≈ (stagger / total) × runway_px / typical_scroll_speed_px_per_ms`. A
stagger that reads beautifully on a trackpad can be imperceptible on a fast flick; check both.

**Physicality:** never `scale(0)`. Start from `scale(0.9–0.97)` + `opacity: 0`; nothing appears
from nothing. Scale from the trigger, not the centre (modals exempt). Press feedback:
`scale(0.97)` on `:active`, 160ms ease-out. Keep spring bounce subtle (0.1–0.3). The site's own
scroll spring is deliberately over-damped (ζ ≈ 1.37: stiffness 120, damping 30) because a scroll
spring that overshoots crosses boundaries it shouldn't (`scroll-scenes.md` §5).

**Interruptibility:** CSS transitions interrupt and retarget mid-flight; keyframes restart from
zero. For anything triggered rapidly, prefer transitions. Springs maintain velocity when
interrupted, which is why they suit gestures a user may reverse.

**Cohesion:** match motion to the page's personality and keep it consistent across sections. This
is the thing many independently-authored sections destroy first, and no shared timing code prevents
it on its own; only review does.

## 11. Reduced motion is the writer's job

A global reduced-motion config degrades transform **animations**. A scroll-linked value bound
directly to `style` is not an animation (the runtime simply writes it), and a hand-written
`element.style.transform = …` is even further out of its reach.

> **Every manual writer checks the reduced-motion media query itself and renders a settled state.**

"Settled" means the composition the section was designed around, with none of the movement: a
pinned scrub scene holds its opening loop's first frame and freezes its camera at the first shot; a
scroll-fader pins its opacity to 1. Structure collapses too (release the pin, collapse the runway),
and that half belongs in a plain `@media (prefers-reduced-motion: reduce)` block in the base
stylesheet (`assets/css/animation.css`) rather than scattered as utility classes, because a utility
collides with the runway utilities at equal specificity and which one wins becomes a build-order
accident. Mechanics in `scroll-scenes.md` §10.

Reduced motion means **gentler, not zero.** Keep opacity and colour transitions that aid
comprehension; remove movement.

## 12. The SSR rules

1. **Content is always in the DOM.** Animations change `transform`/`opacity`, never conditional
   rendering, so crawlers and readers get the full text regardless of JS.
2. **A stage serialises its hidden variant into the SSR HTML**, so there's no flash of the settled
   layout. The cost is that the entrance can't start until hydration, which is what a load veil
   covers.
3. **A `<noscript>` rule forces every stage item visible** and hides the load veil. Without it a
   visitor with JS disabled, or whose script failed to load, gets a hero and then a permanently
   blank page below the fold: nothing ever runs the reveal. A scrubbed scene needs the same rule on
   its own attribute, and it matters more there: its opacity is a pure function of scroll, so with
   no JS it has no way to ever leave 0. The rule goes in the document `<head>`, not in a stylesheet,
   because it has to apply even when the stylesheet never loads:

   ```html
   <noscript>
     <style>
       [data-stage-item] { opacity: 1 !important; transform: none !important; }
       [data-stage-veil] { display: none !important; }
     </style>
   </noscript>
   ```

   `!important` is required on both: it has to beat inline styles a motion library writes.
4. **Above the fold, trigger only** (§3). A scroll-driven fade there ships invisible HTML and
   there's no `<noscript>` escape from it.
5. **Never branch rendered structure or element type on a client-only breakpoint hook.** It reports
   a fixed value during SSR and the first client render. Branching animation *behaviour* on it is
   safe; branching the element *type* remounts the subtree at hydration and strands already-fired
   items hidden forever.

## 13. The GSAP escape hatch

The reference build's default is a single JS animation library (Motion, in that build) with no
second engine, but the decision was made falsifiable rather than dogmatic. Before committing to one
library for an unfamiliar codebase, the panel that made this call ran a real experiment: build the
first heavy pinned non-video scene with the default library only, then decide on evidence, against
kill criteria fixed *in advance*:

- more than ~150 lines of *scene-generic* scaffolding, **or**
- mid-tier-mobile frame traces losing to an equivalent GSAP `ScrollTrigger` spike of the same scene

Neither tripped in the reference build. The policy that survived:

> **If a section needs SplitText-quality line reveals, or hits a measurement problem the default
> library genuinely can't solve, add the other engine as a scoped island for that section.** One
> engine per element (never mix engines on the same node), and the rest of the page stays
> unchanged.

This is the reason a default is a default rather than a bet: the exit is cheap (adding a second
engine to one section later costs little) and the entry is disciplined (an experiment with kill
criteria, not a taste call). For a codebase that already runs GSAP, see `brownfield-coexistence.md`.

## 14. Rejected

| Rejected | Because |
| --- | --- |
| GSAP as the *default* scroll engine | The chosen default covered everything except a timeline container, and that turned out not to be needed (§1). |
| Wrapper components that own property values | Generation 1. Every new design needs a new prop; props never compose. |
| A generic timeline layer, built ahead of demand | Generation 2. ~2,400 lines, one consumer. |
| A fluent builder (`timeline().to().label()`) | Not serialisable across a server/client boundary. |
| Property values (`from`/`to`) inside a timeline spec | Requires reading computed styles to know both endpoints, which breaks determinism across SSR, resize, remount and reverse seek. |
| A string position language (`'<+=0.4'`) | Needs a parser for a language the type system can't check. |
| Nested scroll scenes | Ambiguous ownership; a stack is one range wrapper with more children. |
| One global page driver | Section heights become global coordinates; editing section 3 renumbers everything after it. Kills document flow, a11y, find-in-page, deep links. |
| A driver registry / flag store shipped to production | Fed a debug panel that never caught a bug. |
| A tier-3 visual timeline panel | Hundreds of lines, unproven; a scripted browser harness (`verification.md`) covers more, for less code. |
| A visual timeline editor that owns state | The source file is the editing UI. A tool may emit source; it must never persist its own values. |
| Adding a scroll-smoothing library (Lenis-class) | Its lerp reshapes the native velocity curve anything scroll-linked reads, and gains nothing on iOS touch. Smoothing belongs on effect *outputs* (a spring on a transform), never on the scroller. An *existing* one is a different question: `brownfield-coexistence.md` §4. |
| A momentum-handoff spring fired at a scroll crossing | Needed velocity tracking, absorb/veto budgets and a rest-detection override to avoid feeling like a scroll lock, and still read as "the page waits for you to stop, then grabs you." See the continuous attractor in `scroll-scenes.md` §8 instead. |
| Stacking the whole page as one scroll-driven narrative | Monotonous and expensive past 3–4 panels. |
| Scroll-snap or any forced beat | The scroll belongs to the reader. |
| A responsive value as one MotionValue per breakpoint | Builds N values per property per render and discards N−1. CSS variables cost nothing (§7). |
| "Normalised 0..1 everywhere" | Right inside a scroll scene's own progress. Wrong universally: pixels for thresholds and tolerances, seconds for media, named state for machines (`scroll-scenes.md`). |
| Cursor followers, WebGL added to fill out the system, horizontal scroll without a content reason, shared-element FLIP between sections | Not wanted; no problem they solved. |

## Traps

- [ ] No component built for its first caller; wait for the second (§2).
- [ ] No `amount`/similar as a *fraction*: unsatisfiable on content taller than the viewport,
  fails silently, phone-only (§6).
- [ ] A tall stage group fires on its own top edge: one stage per arrival, not one per layer (§5).
- [ ] No stage item with its own `initial`/`animate` (or its own GSAP trigger): it severs from its
  stage (§4).
- [ ] `rootMargin`/offset literals are module constants, never built per render (resubscribes every
  render).
- [ ] No easing on an already scroll-driven value: that's double-easing (§10).
- [ ] No spring output feeding a boolean/threshold test: it rings true/false/true as it settles.
  Machines read raw progress (`scroll-scenes.md` §5).
- [ ] No branching of element *type* on a client-only breakpoint hook (§12).
- [ ] No hook called inside `.map()`: it only "works" while the array length never changes. Extract
  the child component.
- [ ] Every hand-written `style` write checks the reduced-motion query itself (§11).
- [ ] At most one `transition-*` utility (or `transition` shorthand) per element: two both set
  `transition-property`, and which one wins is stylesheet-order luck.
- [ ] Centring on a stage item uses `translate`, not `transform` (§7).
- [ ] Line entrances split at authored breaks, not rendered lines (§4).
- [ ] The `<noscript>` rule is in the document head (§12).
