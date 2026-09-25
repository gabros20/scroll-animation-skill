# Brownfield coexistence: working next to existing header scripts, GSAP and Lenis

**Purpose:** Work next to motion a site already has (header scripts, GSAP, Lenis, entrance libraries) without two systems fighting.

**Read when:** the site already animates: a header that hides, shrinks or changes colour on scroll,
GSAP `ScrollTrigger` timelines or pins, Lenis (or another smooth-scroll library), or an entrance
library such as AOS. Also when "the anchor link stops short", "the pin doesn't stick" or "the header
flickers between colours" on a site that mixes old and new motion.
**Skip when:** greenfield. Go straight to `motion-architecture.md`.
**Depends on:** `preflight.md` §4 for the keep / adapt / replace decision; `scroll-scenes.md` §1
and §8 for the pin and the scroll well these conflicts involve.

The default on a brownfield site is **keep**: existing motion keeps running, and new work is built
around it. Every conflict below comes from one cause, so learn the rule once:

> **One writer per property.** Two systems writing the same property on the same element (a header's
> `color`, a node's `transform`, the page's scroll position) do not blend; the last writer each frame
> wins, and which one that is changes with timing. The fix is always to pick one writer and route
> the other's decision through it, never to tune them against each other.

**Inputs:** the inventory from preflight; the site's existing motion code.
**Produces:** a keep/adapt/replace decision per system and the wiring that lets them coexist.

## Contents

1. [Inventory](#1-inventory)
2. [An existing header animation or colour switcher](#2-an-existing-header-animation-or-colour-switcher)
3. [Existing GSAP ScrollTrigger](#3-existing-gsap-scrolltrigger)
4. [Existing Lenis](#4-existing-lenis)
5. [Existing entrance libraries](#5-existing-entrance-libraries)
6. [Asking the question](#6-asking-the-question)
7. [Traps](#traps)

## 1. Inventory

Read-only, before touching anything:

```bash
grep -rnE "ScrollTrigger|scrollTrigger:|pin: ?true|gsap\.(to|from|timeline)" src
grep -rnE "new Lenis|useLenis|ReactLenis|locomotive|normalizeScroll" src
grep -rnE "addEventListener\(['\"]scroll|onScroll|useScroll" src/components/*eader* src/**/*eader* 2>/dev/null
grep -rnE "data-aos|AOS\.init|whileInView|FadeIn|Reveal" src
grep -rnE "scroll-behavior|overscroll-behavior|overflow-x: ?hidden" src
```

Write down, per item: what it animates, which property it writes, on which element, and on which
routes. That list is what the one-writer rule is checked against. `scripts/tools/audit-motion.mjs` flags
the two combinations that are always wrong: `lenis-with-scroll-well` and
`gsap-pin-with-sticky-scene`.

## 2. An existing header animation or colour switcher

**Keep it.** A header's animation and colour logic is usually tuned, visible on every page, and
owned by someone. Take over only what the new work needs, and only where it doesn't collide.

- **Colour switching.** If a script already sets the header's ink (a class toggled at a scroll
  threshold, an IntersectionObserver per section, a `mix-blend-mode` trick), do **not** also mount
  `useHeaderTheme`/`initHeaderTheme` writing colour: the two flip at slightly different offsets and
  the bar flickers between them at every boundary. Choose one:
  - *Keep theirs:* mark new dark sections the way their script expects (their class or attribute),
    and add nothing.
  - *Adapt:* make the probe the single decision-maker and write its result into **their** class name
    (`header.classList.toggle('is-dark', theme === 'dark')`), deleting their scroll listener. Their
    CSS, transitions and markup stay; only the decision moves. Worth it when their script uses an
    IntersectionObserver band, which re-breaks on every mobile toolbar resize (`header-theme.md` §2).
- **Hide-on-scroll or shrink-on-scroll.** These write `transform` (or `height`, `padding`) on the
  header. The ink probe uses `offsetTop`/`offsetHeight` and is immune to the transform. Two rules:
  never put a `StageItem`/`[data-stage-item]` entrance on the same element their script transforms
  (wrap an inner element instead), and never let their transform land on an ancestor of a sticky
  element.
- **"Scrolled" opaque state.** If the header gains its own background after some scroll, its ink
  should follow that surface, not the section under it: bypass the probe's result while the scrolled
  class is on.
- **Transitions.** If their header already declares `transition: all …` or its own
  `transition-colors`, don't add `THEME_FADE` alongside it: two `transition-*` declarations on one
  element both set `transition-property`, and which wins is stylesheet order. Use one, at one
  duration, on every themed part.
- **Sizing is separate.** Header height, insets and `--fluid-header-h` are layout (the `fluid-design`
  skill converts them). Converting sizing never requires touching the header's animation or colour
  code.

## 3. Existing GSAP ScrollTrigger

Keep existing timelines. Check four things.

**Px `start`/`end` on a scaled or responsive layout.** Viewport-relative values (`start: 'top 80%'`)
and element-relative ones (`end: 'bottom top'`) follow the layout. A hard-coded distance
(`end: '+=900'`, `start: 'top+=120 top'`) does not: on a fluid-scaled page the section is 900
reference px tall only at the reference viewport, so the tween ends early on a big screen and late
on a small one. Replace with functions and let refresh re-evaluate them:

```js
scrollTrigger: {
  trigger: section,
  start: 'top top',
  end: () => '+=' + section.offsetHeight,
  invalidateOnRefresh: true,
  scrub: true,
}
// and `ease: 'none'` on any scrubbed tween: scroll is already the easing
```

**Refresh after layout moves.** ScrollTrigger re-measures on resize, which covers a fluid scale (the
units only change on resize). It does not see font swaps, late images, or components that mount
after it measured (hydration, route changes, a scene below that settles its height). Call
`ScrollTrigger.refresh()` after `document.fonts.ready`, and after new motion components mount. In
the other direction, ScrollTrigger pins insert pin-spacers that move everything below them; with the
GSAP port, re-measure after each refresh:

```js
const motion = initFluidMotion(document, { /* … */ })
ScrollTrigger.addEventListener('refresh', () => motion.refresh())
document.fonts.ready.then(() => ScrollTrigger.refresh())
```

The React primitives re-measure from a `ResizeObserver`, which fires when their own boxes resize but
not when a pin-spacer above merely shifts them; the scene reads its position live each frame, so
only cached document-coordinate bands (the header probe) need a nudge. Remount or resize-trigger
them if a GSAP pin above changes the page height after mount.

**`pin: true` versus CSS sticky: never nest the scene in a GSAP pin.** A ScrollTrigger pin wraps its
element in a pin-spacer and, while pinned, sets it to `position: fixed` (or animates a `transform` on
it, with `pinType: 'transform'` or a non-body scroller). A `ScrubStage` range wrapper, pin or video
*inside* that element then has a fixed or transformed ancestor: sticky has no scroll travel inside a
fixed box, and a transformed ancestor becomes the containing block. The scene freezes or drifts. So:

- The scene's own pin is CSS sticky; never also pin it, its range wrapper, or any ancestor with
  GSAP. (The GSAP port's `scrubStage.ts` deliberately reads a passive scroll listener, not
  ScrollTrigger, for the same reason: two pinning systems disagree about geometry on resize.)
- GSAP pins on *sibling* sections are fine. Refresh as above so the scene sees the spacer.
- If an existing GSAP pin already wraps the area where the new scene goes, **adapt**: move the new
  scene out of it, or convert that section to the CSS sticky pattern (`scroll-scenes.md` §1).

**One engine per element.** A node animated by a ScrollTrigger tween never also carries a
`StageItem`/`data-stage-item`. Existing GSAP breakpoint logic (`gsap.matchMedia()`) should use the
same `ENGAGE_QUERY` as the primitives (`fluid-interop.md` §1).

## 4. Existing Lenis

This skill never *adds* Lenis (`preflight.md` §1). If the site already runs it and the user wants it,
**keep it** and make the rest compatible.

**What keeps working unchanged.** Lenis drives the real document scroll: it writes the native scroll
position every frame. `position: sticky`, both engines' progress sources (Motion's `useScroll`, the
GSAP port's scroll listener), IntersectionObserver reveals and the header probe all keep working. On
touch devices Lenis leaves scrolling native by default (`syncTouch: false`), so everything in
`ios-safari-motion.md` applies as-is.

**The GSAP wiring.** With ScrollTrigger on the page, Lenis must drive ScrollTrigger's updates and run
on GSAP's ticker, or ScrollTrigger reads a scroll position one frame stale:

```js
const lenis = new Lenis()
lenis.on('scroll', ScrollTrigger.update)
gsap.ticker.add((time) => lenis.raf(time * 1000))
gsap.ticker.lagSmoothing(0)
```

(If Lenis was created with `autoRaf: true`, don't also add it to the ticker: that runs it twice per
frame.)

**`scroll-behavior: smooth` must be off while Lenis runs.** `animation.css` sets
`html { scroll-behavior: smooth }`; under Lenis, every per-frame write would become a native smooth
scroll chasing the last one. Include Lenis's own stylesheet (it forces `scroll-behavior: auto` while
Lenis is active), or drop the rule from `animation.css`.

**The scroll well conflicts: disable it, or route it through Lenis.** The well reads the scroll
position and writes `position + step` with `window.scrollTo({ behavior: 'instant' })` every frame.
Lenis keeps its own target and animated position and writes them back every frame. Mid-lerp, each
overwrites the other: the well's nudge is erased, or Lenis treats it as an external jump and
re-targets, and the page stutters around the rest position. Two options:

- **Disable the well (default).** `<PullToCentre disabled />`, or remove the `data-pull-to-centre`
  marker. The composition still reads; it just doesn't settle by itself.
- **Adapt**, only if the user wants the pull: change the well's single write site to
  `lenis.scrollTo(target, { immediate: true })`, so Lenis stays the one writer, and re-verify with
  `anchor-check.mjs`. Stop Lenis with `lenis.stop()` only for true scroll locks, never for the well.

**Mode switches read smoothed scroll.** Under Lenis, `window.scrollY` is Lenis's *animated* value,
not the input. Latches and thresholds still work (they read what's on screen, and hysteresis still
prevents flapping), but a crossing happens slightly after the gesture that caused it, and anything
branching on scroll *velocity* reads Lenis's reshaped curve, not the reader's. Two consequences:

- The output spring (`scrollSpring`) now smooths an already-smoothed value, so visuals feel heavier
  than tuned. If that reads as lag, drive visuals from raw progress on Lenis pages instead of adding
  a second spring.
- Where a machine truly needs the reader's intent (a velocity-sensitive handoff), read
  `lenis.targetScroll` rather than `scrollY`.

**Anchors.** A native anchor jump under Lenis (with smooth scroll off) is instant, and Lenis then
syncs to it; Lenis's `anchors` option (recent versions) instead animates anchor clicks through
`lenis.scrollTo`, which respects its easing and an `offset` you set to the header height. Either
way, if a scroll well is still active, its automatic `suspend()` on anchor clicks and `hashchange`
still applies; a programmatic `lenis.scrollTo(...)` needs an explicit `suspend(ms)` around it. Run
`anchor-check.mjs` after any change here.

The same analysis applies to `locomotive-scroll` and GSAP's `ScrollTrigger.normalizeScroll()`: both
take over the scroll writer.

## 5. Existing entrance libraries

AOS, a `FadeIn`/`Reveal` wrapper, or ad-hoc `whileInView` props on untouched sections can stay.

- Never put both systems on one node (`data-aos` and `data-stage-item`, or a wrapper's own
  `whileInView` around a `StageItem`): two writers on `opacity`/`transform`.
- Their hidden state needs the same no-JS escape as ours. If they server-render content hidden,
  extend the `<noscript>` rule to cover them (for AOS: `[data-aos] { opacity: 1 !important;
  transform: none !important; }`).
- Mixed curves and distances between old and new sections read as inconsistency (the "cohesion" row
  in `motion-architecture.md` §10). When a route migrates, migrate all its entrances together.
- Check the old library's trigger for the fractional-`amount` trap (`motion-architecture.md` §6):
  a wrapper built on `viewport={{ amount: 0.5 }}` or an observer with `threshold: 0.5` never fires
  on content taller than twice the viewport, which on a phone is most stacked grids.

## 6. Asking the question

Name what you found, propose the least invasive option, and let the user overrule it. Don't offer a
menu per item (`preflight.md`, "Phrasing the questions"):

> Your header already switches to dark ink with an IntersectionObserver, you have two ScrollTrigger
> pins on `/work`, and Lenis runs site-wide. My plan: keep all three. The new hero uses triggered
> entrances; I'll mark its dark band the way your header script expects; I'll leave the scroll well
> off because it fights Lenis; and the new pinned video goes outside your GSAP pins, as a CSS sticky
> scene. Want me to replace your header's observer with the scroll probe (it breaks when the iPhone
> toolbar resizes), or leave it?

Record the answer per item in `MOTION.md`.

## Traps

- [ ] Every animated property has exactly one writer (intro).
- [ ] No second header-colour writer beside an existing one (§2).
- [ ] No entrance on an element a header script already transforms (§2).
- [ ] No hard-coded px `start`/`end` on a scaled layout; functions plus `invalidateOnRefresh` (§3).
- [ ] `ScrollTrigger.refresh()` after fonts and late mounts; the GSAP port re-measures on refresh
  (§3).
- [ ] The scroll scene, its range wrapper and its ancestors are never inside a GSAP `pin: true` (§3).
- [ ] Lenis drives `ScrollTrigger.update` and runs on the GSAP ticker, once (§4).
- [ ] `scroll-behavior: smooth` is off while Lenis runs (§4).
- [ ] The scroll well is disabled or routed through `lenis.scrollTo` on a Lenis page (§4).
- [ ] Anchors are verified with `anchor-check.mjs` after any scroll-writer change (§4).
- [ ] Legacy entrance libraries are covered by the `<noscript>` rule and never share a node with a
  stage item (§5).
