# Entrances: content that animates in

**Purpose:** Animate content in as the reader reaches it: `Reveal` in the engine the route already loads, trigger
lines, once or replay, the load veil and count-up, with the gate, failsafe and server rules that keep every word
readable.

**Read when:** sections, cards, images or stats should animate in, or a number should count up; a reveal never fires,
fires late or flashes; you're reviewing entrance code.
**Skip when:** the reader's scroll should drive the motion (a pin, a scrub, parallax: [scenes.md](scenes.md)); the
text splits into words or lines ([text.md](text.md)); the question is timing or taste ([craft.md](craft.md)).

**Inputs:** the section's markup, what the route already loads (Motion, GSAP or neither), its `ANIMATION.md` ledger row.
**Produces:** `reveal` and `count-up` blocks in the route's engine with their trigger lines, `GATE_SCRIPT` in the head,
and a passing `verify-motion.mjs --reveal`.

## Contents

1. [Triage by clock](#1-triage-by-clock)
2. [Pick the engine](#2-pick-the-engine)
3. [Groups and items](#3-groups-and-items)
4. [Effects and distances](#4-effects-and-distances)
5. [Trigger lines](#5-trigger-lines)
6. [Once, replay and exits](#6-once-replay-and-exits)
7. [The load veil](#7-the-load-veil)
8. [Count-up](#8-count-up)
9. [The gate, the failsafe and the server](#9-the-gate-the-failsafe-and-the-server)
10. [Hide and show](#10-hide-and-show)
11. [Traps](#traps)

## 1. Triage by clock

Sort a new animation by who supplies its time, not by how elaborate it looks. The clock decides the cost, what the
server can render and which traps apply.

| Clock | The motion | Use | Cost |
|---|---|---|---|
| trigger | starts when content arrives, then plays on its own | `reveal`, `count-up`, `split-words`, `split-reveal` | almost free: no scroll listener, readable without JavaScript |
| scroll | follows the reader's position, both ways | [scenes.md](scenes.md), [css-scroll-effects.md](css-scroll-effects.md) | a runway and per-frame writes; no settled state on the server |
| media | follows what a decoder shows | [video.md](video.md), [sequences.md](sequences.md) | the highest: decoding and memory |

- **Trigger is the default; scroll is a decision.** Promoting a section costs a runway, a pin, one of the 1–3 scroll
  scenes a screen can afford ([performance.md](performance.md) §3) and every trap in scenes.md. Promote it when the
  reader should drive the motion, not because the motion is elaborate.
- **Content arrives by trigger.** A scroll-linked reveal leaves text half-faded when the reader stops. Scroll-linked
  motion is for space: depth, travel, a scene.
- **Above the fold, trigger only.** A scroll-driven fade renders at progress 0 on the server, so the HTML arrives
  invisible.
- **Never demote a scroll scene to a trigger on phones without saying so** in the component and the ledger. A different
  treatment may mean re-framed rather than removed ([scenes.md](scenes.md) §7).

## 2. Pick the engine

All three versions render the same markup on one stylesheet, `css/reveal.css`, so the hidden state, the failsafe and
`verify-motion.mjs` behave the same on each. Use the one the route already loads:

| The route loads | File | Call |
|---|---|---|
| Motion (React) | `motion/Reveal.tsx` | `<Reveal>`, `<RevealItem>`, `<RevealVeil>` |
| GSAP | `gsap/reveal.ts` | `reveal(root, options)` → `{ destroy() }` |
| neither | `reveal.ts` | `mountReveals(root)` → `stop()`: an IntersectionObserver and a CSS transition |

`scroll-animation add reveal --engine motion` (or `gsap`, `agnostic`), then import `css/reveal.css` after
`css/animation.css`. One engine per element: never a GSAP tween on a `RevealItem`.

```tsx
<Reveal as="section">                          {/* the element the layout already needs */}
  <RevealItem as="h2">The workshop</RevealItem>
  <div className="columns">                    {/* plain server markup in between */}
    <RevealItem effect="fade">…</RevealItem>
  </div>
</Reveal>
```

```html
<section data-reveal="view">                   <!-- GSAP and engine-free pages -->
  <h2 data-reveal-item>The workshop</h2>
  <p data-reveal-item data-reveal-effect="fade">…</p>
</section>
```

- **Motion** needs `MotionProvider` ([motion.md](motion.md) §1). Only `Reveal` and `RevealItem` are client code, so
  the section stays a Server Component and the markup between them, images and icons included, stays on the server.
- **GSAP**: in React, `useGSAP(() => { const r = reveal(ref.current!); return () => r.destroy() })`; on a vanilla
  page, inside the route's `mount(routeRoot)` ([gsap.md](gsap.md) §3). Call it outside your own `gsap.matchMedia()`
  callbacks (Traps).
- **Neither**: `mountReveals(routeRoot)` when the route shows, `stop()` when it hides.

## 3. Groups and items

A group (`Reveal`, `[data-reveal]`) is the trigger. Items (`RevealItem`, `[data-reveal-item]`) are what moves.

- **Motion reveals per group.** When the group's top crosses the line, every item in it plays, one `stagger` apart in
  document order. So use **one `Reveal` per arrival**. A tall layer with copy at the top and a mark at its foot is two
  arrivals: in one group the mark plays while it is still a screen below the fold, and nobody sees it. A row that
  stacks into a tall column on a phone becomes several arrivals.
- **GSAP and the engine-free path reveal per item.** Each item waits for its own arrival, and items that cross the line
  together play as one staggered batch in document order (GSAP: one `ScrollTrigger.batch()` trigger per item). The
  group only carries options; an item outside any group takes the defaults.
- **A Motion item never gets its own trigger** (no `initial`, `animate` or `whileInView`) and never sits outside a
  `Reveal`: the group's state is all that moves it.
- **Stagger**: `stagger` or `data-reveal-stagger`, in seconds, default `MOTION.lineStagger` (0.067). Source order is
  the choreography.
- **Line by line**: one item per drawn line, split at the authored break, never at the rendered line (that is
  `split-reveal`, [text.md](text.md) §3). A `span` item needs `display: block` or `inline-block`: `transform` does
  nothing to an inline box.
- **`as`** renders the element the layout already needs (a `section`, a `ul`, an `h2` item), so no wrapper is added.

## 4. Effects and distances

| `effect`, `data-reveal-effect` | Hidden | Plays |
|---|---|---|
| `rise` (default) | `translateY(var(--reveal-distance, 32px))`, opacity 0 | the move, and the fade short and late |
| `fade` | opacity 0 | the fade, on the move's curve |
| `clip` | `clip-path: inset(100% 0 0 0)` | a wipe up from the bottom edge, no fade |
| `scale-in` | `scale(var(--reveal-scale, 0.95))`, opacity 0 | like `rise`, from the scale |

- The move is `MOTION.entrance`: 1.3 s on `CURVES.entrance`. The fade is `MOTION.entranceFade`: 0.17 s, linear,
  starting 0.13 s in. Both were measured, not chosen ([craft.md](craft.md) §4).
- Only `transform`, `opacity` and `clip-path` change, so a hidden item keeps its box and nothing around it moves.
- **Distances are custom properties on the item**, set by a class: `--reveal-distance` and `--reveal-scale`, varied
  per breakpoint in CSS with no prop and no JavaScript. The distance is signed: a negative value descends. A scaled
  length works, because every engine reads the computed value when the reveal starts. Never set them on a shared
  parent ([performance.md](performance.md) §8).
- **`transform` belongs to the reveal.** Centre or offset an item with the `translate` property, or on a wrapper.
  Motion and the CSS transition leave `translate` alone, and the failsafe and print reset `transform`, never
  `translate`. GSAP folds the item's `translate`, `rotate` and `scale` into its transform during the entrance, and the
  block hands them back when the item lands (observed on GSAP 3.15.0; its docs don't describe the fold).

## 5. Trigger lines

A trigger line is an IntersectionObserver `rootMargin`, never a fraction of the element. The names live in `config.ts`:

| Name | Value | For |
|---|---|---|
| `TRIGGERS.reveal` | `0px 0px -20% 0px` | the default: the top crosses 80% of the viewport's height |
| `TRIGGERS.pageEnd` | `0px` | the page's last group, such as the footer, and any group that comes to rest below the 80% line (low in a section a scroll well holds) |

- **Why `pageEnd`:** a negative bottom margin draws the line inside the viewport, and the last screenful never scrolls
  across it: the page runs out first. Nine footer items once stayed hidden at 1440×900.
- **A group at rest starves the same way** mid-page. A stat grid resting under a scroll well had its top at 40% of
  the viewport at 1440×900, but 90% at 375×667, past the default line.
- `pageEnd` trades "plays slightly early" for "never plays": early is a preference, starved is a bug.
- **Setting a line:** `margin` on `Reveal`, `data-reveal-margin` on a group, or GSAP's `margin` option. Keep it a
  static string: a new value on each render rebuilds the observer.
- **GSAP fires on the same line.** `lineFromMargin()` (`gsap/setup.ts`) turns `TRIGGERS.reveal` into
  `start: 'top 80%'`, `end: 'bottom top'`.
- An item already above the view at load (a reload mid-page) reveals when the reader scrolls back up to it.

## 6. Once, replay and exits

- **A reveal plays once.** Scrolling past it again changes nothing, and stopping a block lands a running reveal on its
  end state: triggered means shown.
- **`replay`** (`data-reveal-replay`, GSAP's `replay` option) plays it again on every return, for `view` groups only.
  The reset waits until the group (Motion) or the item (GSAP, engine-free) is entirely out of view, so nobody sees it.
  Keep the default: copy that animates again on the way back up delays re-reading ([craft.md](craft.md) §7).
- **In and out are two mechanisms.** Content enters on a trigger and leaves on scroll, with an exit fade on the whole
  group (`data-scroll-fx="exit-fade"`, [css-scroll-effects.md](css-scroll-effects.md) §9), never per item: a small element fading across its own height of scroll snaps.
  The two compose: a landed item rests at opacity 1 under the group's fade.

## 7. The load veil

`RevealVeil` (`<div data-reveal-veil>`) covers the page while the engine boots and dissolves once
`html[data-animation-ready]` is set (`MOTION.veil`: 0.13 s after 0.17 s), so the `mount` group under it is already
moving when it clears.

- **It always delays the LCP element** (the largest thing in the first screen, which load speed is judged by): it
  holds back the whole first paint until the engine boots. That breaks invariant 8, so leave it out. A `SplitWords`
  headline and a hero image paint at once, and the `mount` items join at hydration.
- **The one exception** is an intro that must show nothing until it can play, such as an Immersive site's opening.
  Record it in `ANIMATION.md` with its reason and its cost to load speed.
- It paints nothing itself: give it the page's first surface as a background class. Mount it high in `<body>`,
  outside any stacking context, so it covers a fixed header.
- It never covers without JavaScript or after a client-side navigation. If no engine boots within 4 s, the failsafe
  removes it.

## 8. Count-up

A number that counts up once as it comes into view. The server renders the final value, so readers without
JavaScript and crawlers read the real number; the count rewinds it only as it starts.

```tsx
<p className="stat">$<CountUp to={1280} />M</p>            {/* a prefix or suffix stays outside */}
```

```html
<span data-count-up data-count-locale="de-DE">12.500,75</span>   <!-- mountCountUps(routeRoot), any page -->
```

- `CountUp` (`motion/CountUp.tsx`) takes `to`, `from` and `format` (`locale`, `decimals`, `grouping`), all
  serializable, so a Server Component can render it. It prints en-US unless told otherwise, so server and browser print
  the same text. GSAP pages use `count-up.ts` as it is (`scroll-animation add count-up --engine agnostic`):
  `mountCountUps(root)` → `stop()`, with `data-count-from` (default 0), `data-count-locale` (default: the nearest
  `lang`, else en-US) and `data-count-decimals`.
- It starts once about 60% of the number is visible (a fraction is safe here: one line always fits) and plays once,
  1.3 s on the entrance curve, rewriting the number's one text node: no re-render. Set
  `font-variant-numeric: tabular-nums` so the width holds. The last frame restores the text exactly.
- `data-count-state` goes `waiting`, `counting`, `done`, and `done` never plays again, so hiding and showing is safe.
- Screen readers hear the final value: while it counts, the number is `aria-hidden` and a visually hidden copy of the
  final text (`data-count-up-label`) follows it. Never `aria-label`: ARIA doesn't allow naming a plain span.
- Under reduced motion (read live), the failsafe or a hidden tab, a count never starts: the final value shows at once.
  Reduced motion, a hidden tab and printing also land a running count. It never marks the engine ready, so the
  failsafe keeps guarding the rest of the page.

## 9. The gate, the failsafe and the server

1. **The gate.** `GATE_SCRIPT` from `config.ts`, inline in `<head>`, sets `html[data-animation="on"]` before the first
   paint. Hidden states apply only under it, so a reader with JavaScript off sees everything, with no `<noscript>` rule.
2. **Ready.** Each engine sets `html[data-animation-ready]` when it boots: `setupGsap()`, `MotionProvider`,
   `mountReveals()`.
3. **The failsafe.** If no engine is ready after 4 s, a CSS animation in `css/animation.css` reveals every item and
   removes the veil. A CSS animation outranks inline styles, so it beats whatever an engine wrote.
4. **The latch.** When it fires, `GATE_SCRIPT` sets `html[data-animation-failsafe]`, which keeps the page revealed if
   the engine boots late: engines then mark items shown without playing them, so nothing hides and plays again.

```tsx
<html lang="en" suppressHydrationWarning>
  <head>
    <script nonce={nonce} dangerouslySetInnerHTML={{ __html: GATE_SCRIPT }} />
  </head>
```

- **`suppressHydrationWarning` on `<html>`**: the gate adds an attribute React didn't render, before hydration (when
  React takes over the server's HTML). The ready stamp and the scroll authority's stamp do the same.
- **Under a Content Security Policy**, give the script the page's nonce, or allow its SHA-256 hash: the string never
  changes.
- **No inline hidden state.** Every engine hides items with CSS under the gate; Motion's hidden variant is empty, so
  the server renders items with no `style`. Entrances change `transform`, `opacity` and `clip-path`, never whether
  something renders, so crawlers and readers get the full text.
- **Never `Reveal` the LCP element**: its hidden state waits for a script. The hero headline animates from CSS in the
  first frame with `SplitWords` ([text.md](text.md) §2).
- **Branch behaviour, never the element type, on a client-only breakpoint hook.** It answers a fixed value on the
  server and during hydration, so a different element type afterwards makes React rebuild that subtree.

## 10. Hide and show

Next.js with Cache Components keeps up to three visited routes alive in `<Activity>`: a hidden route keeps its DOM,
and its effects clean up on hide and run again on show.

- **Motion** replays a group's current state when it shows again. A landed group rests in `settled`, which moves
  nothing, and a reveal cut off mid-way resumes where it stopped: a finished reveal never plays twice.
- **GSAP and engine-free**: mount on show. `destroy()` or `stop()` on hide lands every running reveal, and the next
  mount skips items already shown. They find items once, at mount, so content added later needs its own call.
- Pass the route's root, never `document`: a hidden route's DOM is still in the document.

## Traps

- [ ] No fractional `amount` (`viewport={{ amount: 0.6 }}`) or observer `threshold` as a trigger: a fraction of an
      element taller than the viewport is never visible, so it never fires, silently, mostly on phones. Use a line
      (§5); `audit-motion.mjs` flags `fractional-amount`.
- [ ] No `display: contents` (or `lg:contents`) on a group or item: it has no box to observe or move. The audit's
      `contents-reveal` flags `display: contents` in a stylesheet and a `contents` class on a group in JSX, never on
      an item: check items and HTML by hand.
- [ ] Motion: one `Reveal` per arrival, and no item with a trigger of its own (§3).
- [ ] The last group, and any group resting below the line, takes `TRIGGERS.pageEnd` (§5).
- [ ] No `transform` of your own on an item: `translate`, or a wrapper (§4).
- [ ] One `transition` declaration per element: two `transition-*` utilities both set `transition-property`, and
      stylesheet order picks the winner.
- [ ] `GATE_SCRIPT` is in `<head>` with the CSP nonce; `<html>` has `suppressHydrationWarning` (§9).
- [ ] Nothing hides the LCP element: no `Reveal` on it, and no veil unless `ANIMATION.md` records the exception (§7,
      §9).
- [ ] GSAP: `reveal()` runs outside your own `gsap.matchMedia()` callbacks. Observed on 3.15.0: creating or killing a
      ScrollTrigger during a matchMedia rebuild leaves the reader at scroll 0, so the block keeps its triggers outside.
- [ ] Your own GSAP entrance never ends in `revert()` once GSAP folded the element's `translate`: observed on 3.15.0,
      the element sticks at its hidden offset. Kill the tween, `clearProps`, restore its own inline values.
- [ ] Your own Motion variants never return a moved element to an empty variant: Motion animates the values it drops
      back to what it first read. Reset through a variant that names them (`Reveal`'s `reset`).
