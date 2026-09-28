# Craft: choreography, timing and taste

**Purpose:** Decide whether, when and how things move, so the motion reads as designed: choreography order,
durations, eases and staggers by content, pacing per act, replay, one idea per viewport, what juries reward, the
anti-slop checks and when a pattern earns a component.

**Read when:** planning a page's motion after preflight, turning a brief's adjectives into numbers, reviewing whether
motion is good rather than whether it works, or tempted to build a shared component.
**Skip when:** the question is how a block is wired ([entrances.md](entrances.md), [text.md](text.md),
[scenes.md](scenes.md)) or why something is broken ([verification.md](verification.md)).

**Inputs:** the design, the `ANIMATION.md` scene ledger and the page's profile.
**Produces:** timing and order decisions for each ledger row, with their reasons, and a review against the checks in
§10.

## Contents

1. [Should it move at all](#1-should-it-move-at-all)
2. [Choreography order](#2-choreography-order)
3. [Durations](#3-durations)
4. [Eases: the measured curves](#4-eases-the-measured-curves)
5. [Staggers](#5-staggers)
6. [Pacing per act](#6-pacing-per-act)
7. [Replay](#7-replay)
8. [One idea per viewport](#8-one-idea-per-viewport)
9. [What juries reward](#9-what-juries-reward)
10. [Anti-slop checks](#10-anti-slop-checks)
11. [Extract at the second consumer](#11-extract-at-the-second-consumer)

## 1. Should it move at all

| How often the reader sees it | Motion |
|---|---|
| on every page, many times a visit (the nav, the header) | none beyond feedback |
| often (a list, a repeated card) | little: short and small |
| occasionally (a section on a page) | a standard entrance |
| once (a hero, a launch, a chapter of a story) | choreography is allowed |

Editorial and marketing sections sit in the last two rows, which is why a page can afford motion a product screen
can't. That is no licence for chrome the reader sees on every page load.

Every motion needs a purpose: where something came from, what changed, what to look at, or a first-time moment that
sets the tone. "It looks cool" survives only in the last row.

A brief's adjectives are not numbers. Convert them before choosing any:

| The brief says | Build |
|---|---|
| premium, calm, editorial | the measured entrance, small distances, no bounce, few moving things |
| cinematic | a pinned scene the reader scrubs ([scenes.md](scenes.md)) |
| snappy | shorter durations and staggers and small distances, on the same curve shape |
| playful | a slight overshoot on objects, if the brand allows it; never on text |
| subtle | opacity and small scale only |

## 2. Choreography order

- **Media, headline, supporting copy, then the call to action**, a short beat between each, never all at once. One
  focal point moves at a time: competing entrances read as noise, not energy.
- Every block staggers in document order, so write the markup in reading order. `SplitWords`' `delay` places the
  headline after the hero media, and a lede's `delay` after the headline.
- **Converge on the design.** Two elements that meet, such as a header that drops and a button that rises, take
  opposite signs of `--reveal-distance` and settle into their gap instead of arriving as one block.
- **Content enters on a trigger and leaves on scroll**: an exit fade on the group, never per item
  ([entrances.md](entrances.md) §6).

## 3. Durations

| Motion | Duration |
|---|---|
| an entrance: a reveal, a split word or line, a count | 1.3 s move; the fade 0.17 s, starting 0.13 s in (`MOTION.entrance`, `MOTION.entranceFade`) |
| the load veil's dissolve | 0.13 s, after 0.17 s (`MOTION.veil`) |
| a label roll | 0.3 s (`MOTION.roll`) |
| a disclosure opening or closing | 0.24 s (`MOTION.disclosure`) |
| header ink changing colour | 0.2 s ease-out: a colour usually carries a link's hover too, and longer lags the pointer |
| anything scroll-driven | no duration: a span of scroll, and the reader sets the pace |

- A 1.3 s entrance feels quick because the curve front-loads the move: about three quarters of the distance is
  covered in the first third of a second, then a long quiet settle (§4).
- If something feels slow, shorten the duration before sharpening the curve. A sharp curve on a long duration reads as
  a jolt, not speed.
- Change the numbers in `config.ts`, never inside a block's code. `css/reveal.css` and `css/split.css` repeat them in
  plain CSS, so change those to match, or the engines stop agreeing.

## 4. Eases: the measured curves

- **`CURVES.entrance` is `[0.15, 0.6, 0.2, 1]`, fitted frame by frame to a reference capture**, not chosen by eye (29
  samples, error 0.0017). It behaves like an exponential approach: a fast open, a long quiet tail and no overshoot.
- **Not a spring.** A spring brings back the overshoot the capture shows isn't there. Don't "improve" the curve into
  one.
- **The fade runs on its own clock**, short and late against the move. Each line becomes legible a beat after it
  starts moving, so a multi-line headline reads as staggered. Fade over the full 1.3 s instead and every line is
  legible before its move reads, and the stagger disappears.
- `CURVES.roll` (`[0, 0, 0.58, 1]`, 17 samples, 0.48 px error) and `CURVES.disclosure` (`[0.23, 1, 0.32, 1]`, a strong
  ease-out that doesn't creep at the end) cover the rest. Stylesheets write the `cubic-bezier()` literal (script builds
  it with `cubicBezier(name)`), GSAP takes `EASES.entrance` (a custom ease `setupGsap()` registers) and Motion the
  arrays.

| The motion | Ease |
|---|---|
| entering or leaving | ease-out: the measured entrance curve |
| moving while on screen | ease-in-out |
| a colour change | ease, or ease-out |
| constant motion: a marquee, a progress bar | linear |
| **anything scroll-driven** | **linear, always** |

- **Never ease-in** on something the reader is waiting for: it starts slow and delays the moment being watched.
- **A scroll-driven value is already eased** by the reader's hand and any smoothing. A curve on top eases it twice,
  which is why GSAP scrubs take `ease: 'none'`. Shape it with the range instead.
- **A spring on a scroll value stays over-damped** (damping above 2√stiffness, at a mass of 1), so it settles without
  overshooting and never crosses a boundary twice.
- **Retriggered motion uses transitions.** A CSS transition turns around mid-flight; a keyframe animation restarts
  from zero.

## 5. Staggers

- **30–80 ms between items** (`MOTION.lineStagger` is 67 ms). Up to about 50 ms reads as one group; past about 150 ms
  it reads as a wait, not a cascade.
- **Scale it to the count.** Twenty words at 67 ms spend 1.3 s just starting: give a lede 30–40 ms, or reveal it by
  line. A stagger is decoration, so nothing waits on it: a link is clickable while it plays.
- **A scroll-driven stagger has no time.** Convert it before trusting it: stagger in ms ≈ (stagger ÷ total) × runway
  in px ÷ scroll speed in px per ms. Try a trackpad and a fast flick: a stagger that reads on one can vanish on the
  other.

## 6. Pacing per act

- **A scene's time is scroll distance**, counted in viewports. Plan about a viewport per act of copy, enough to read
  it at an ordinary scroll. A pause is an empty pacing act (`data-scene-spacer`), not a slower tween.
- **Keep the page's total runway in view.** The ledger shows it. One pin at a time, and pins followed by more pins
  tire the reader: a whole page told as one scroll-driven story turns monotonous, and expensive, past three or four
  panels.
- **A stack of sections handing off over one pinned layer is one range wrapper** with more children. Never nest scroll
  scenes: who owns the scroll becomes ambiguous.
- **One timeline per section, never a page master.** A page-wide timeline couples every section, so editing section 3
  renumbers everything after it.
- **A GSAP section timeline earns its place** at about four named spans on one ruler, with relative positions between
  them. Below that, per-element triggers, or a scene's `onProgress` with named constants for its landmarks, stay
  simpler.
- **No forced beats on the page's own scroll.** No snapping the document, no locking it while something plays: the
  scroll belongs to the reader. A slide-per-notch presentation is a deliberate exception with its own keyboard and
  reduced-motion duties ([accessibility.md](accessibility.md) §4).

## 7. Replay

- **Content arrives once; space follows the scroll.** Triggered entrances play once, and scroll-linked effects run
  both ways by nature.
- `replay` is for a section the page is about, staged again on each return. Never body copy: text that re-animates on
  the way back up delays re-reading. A count and a split heading never replay at all.
- A route shown again after it was hidden replays nothing: the blocks guarantee it ([entrances.md](entrances.md) §10).

## 8. One idea per viewport

- Each screenful carries one focal motion. If two things want attention, one of them waits or doesn't move.
- **One signature moment per page** (a scrubbed scene, a rail, a WebGL hero), not twenty effects, and one scrubbed
  video per page ([performance.md](performance.md) §3).
- **Keep the vocabulary thin**: rise, fade, clip and scale-in on one curve. The economy is the style, and it keeps the
  page inside its frame budget. Nothing grows from `scale(0)`: start at 0.9–0.97 with opacity 0 (`scale-in` starts at
  0.95). Keep blur small and rare ([performance.md](performance.md) §11).
- **Cohesion**: the same curves and distances in every section. Old and new entrances mixed on one route read as
  inconsistency, so migrate a route's entrances together ([brownfield-coexistence.md](brownfield-coexistence.md) §5).
  No shared code prevents drift on its own; review does.

## 9. What juries reward

- Awwwards scores design 40%, usability 30%, creativity 20% and content 10%: usability outweighs creativity.
- One bespoke moment tied to the subject's story beats a library effect dropped in. Judges spot templates.
- Performance is part of the design: a scene that drops frames on a mid-range phone reads as broken, however good it
  looks on the studio's laptop.
- The floor still applies: a reduced-motion alternative for every scene, keyboard access, and no meaning carried by
  motion alone ([accessibility.md](accessibility.md)).

## 10. Anti-slop checks

A generated page gives itself away through its motion as much as its copy. Before shipping, check:

- [ ] Not every section fades up the same way: images clip, text arrives by line, a number counts, and some things
      don't move at all.
- [ ] No text split into letters, and nothing split beyond headlines and a lede or two: body copy just arrives.
- [ ] No bounce or overshoot on content.
- [ ] No parallax on every image: depth only where there is a real foreground and background.
- [ ] No horizontal rail, cursor effect or WebGL without a content reason.
- [ ] No scroll-jacking and no snapping of the page's own scroll.
- [ ] Nothing the reader sees on every page load (the nav, the header) plays an entrance.
- [ ] No preloader on an ordinary page, and never a progress bar driven by a timer instead of real loading.
- [ ] The first screen paints at once: no veil over the headline, nothing above the fold waiting for the bundle.
- [ ] Staggers and durations fit the count: no three-second word cascade.
- [ ] Hover-only effects are limited to devices that hover, and nothing is lost on touch.
- [ ] Reduced motion was switched on and looked at.

## 11. Extract at the second consumer

- **A pattern becomes a component at its second consumer, never its first.** A component that exists for one caller
  is that caller with a detour. Two generic layers were built ahead of demand and deleted: wrapper components that
  owned property values, and a timeline system of about 2,400 lines with a single user.
- **When the second consumer arrives, extract what the two share**, not what a third might want. A new need gets a CSS
  variable before it gets a prop.
- **A component names a job** (an entrance, a count, a scene), never a mechanism, and never owns a property value: a
  component that owns values needs a new prop for every design, and the props never compose.
- **Sometimes what recurs is the rule, not the code.** Three hand-written style writers that share nothing but the rule
  stay three, each with a comment. A helper general enough to cover them would be longer than any one of them.
- The pack follows the same rule: a block gets a second engine only when a second real consumer needs it.
