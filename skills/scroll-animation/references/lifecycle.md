# The page lifecycle

**Purpose:** One owner of "is this page ready to animate", for the first load and for every route change: what the
server HTML says, what holds an entrance back, when costly things start, who places the scroll and who follows it.

**Read when:** building any page with a load entrance or a client-side router; a hero shares its first seconds with
a canvas, video or loops; entrances play under a page transition, off screen after a link, or again on back; a
navigation lands with a glide; a consumer starts too early or too late.
**Skip when:** one effect on a static page with no router and nothing costly beside it.

**Inputs:** the router, the scroll authority per route, whether the first screen's entrance is CSS or a script's,
any loader, the heavy layers on the first screen.
**Produces:** the server HTML's `data-entrance`, `page` and `page-react` wired once, costly starts queued on
`settled`, and a passing `verify-motion --nav`.

Each topic reads: **Law** (a mechanism and its consequence, with its evidence), **Default** (a value, and when to
override it), **Code** (the block, and what to keep if you rewrite it), **Check**. Evidence tags: `source
<package@version>`, `measured <browser, date>`, `spec`, `unverified`. WebKit and Firefox were not run for anything
dated 2026-11 here.

## Contents

1. [The contract](#the-contract)
2. [First load](#first-load)
3. [The hero budget](#the-hero-budget)
4. [Route change](#route-change)
5. [Holds](#holds)
6. [The clock](#the-clock)
7. [What the 3d skill reads](#what-the-3d-skill-reads)
8. [Loaders](#loaders)
9. [Migrating from RouteChange](#migrating-from-routechange)
10. [Traps](#traps)
11. [Checks](#checks)

## The contract

**Law.** Every block on a page asks the same question (may I start?) and without the lifecycle each answers it alone: the
gate, the entrance signal, the loader, the route component, the view transition. An entrance then starts under a
crossfade, or against the previous page's scroll position (measured Chromium 157, 2026-11: 7 of 73 reveals spent
below the fold after one link). One owner answers once, and the rest read it.

```html
<html data-entrance="pending | running | tail | settled" data-visit="3" data-visit-kind="push">
```

| On `<html>` | Written by | Means |
|---|---|---|
| `data-entrance` | the server HTML, then `page.ts` | the phase of this visit's entrance; absent: no entrance, start at once |
| `data-visit`, `data-visit-kind` | `page.ts` | a counter, and `load`, `push` (a link), `traverse` (back, forward) or `restore` (bfcache) |
| `data-entrance-held` | `page.ts` | entrances wait: `pause` on a route change, `restart` under a loader on a load |
| `data-entrance-started` | `page.ts` | `performance.now()` at `running`: the clock consumers count from |
| `data-entrance-claimed` | a block that publishes | this visit's `tail` and `settled` come from that block |
| event `entrance:phase` | whoever writes the phase | bubbles; `detail` is `{ phase, visit, kind }`; the attribute is set first |

- **Phases** go `pending → running → tail → settled` and never backwards within a visit. A new visit restarts them.
  `tail`: the display type is within about 1 px of rest (`TAIL_AT`, 0.8 of the last move; curve arithmetic, not a
  measurement).
- **Blocks never import the lifecycle.** They read the attributes through `entrance-signal.ts`: `entranceHeld()`,
  `whenEntranceOpen(fn)`, `arrivesSettled()`, `entranceStartedAt()`. A page without `page.ts` behaves as in 2.1.
- **A visit's kind decides what plays:**

| Kind | Entrance | Mount reveals | Reveals at their line | Scroll owner |
|---|---|---|---|---|
| `load` | plays | play | play on arrival | the browser |
| `push` | held, then plays | held, then play | play on arrival | the router |
| `traverse`, `restore` | arrives `settled` | land without playing | play on arrival | the browser's restoration |

**Default.** A push replays the first screen's entrance; back and forward do not. Override when: the design wants an
entrance on every arrival (call `page.begin('push')` yourself), or none after the first (`page.begin('traverse')`).
Record the choice in `ANIMATION.md`. Reveals already shown on a route Next kept mounted stay shown (a later PR makes
that a recorded choice too).

**Code.** `scroll-animation add page` (and `page-react` on React). `page.ts`:

```ts
page.begin()                                   // a router adapter, once per committed navigation
page.placed()                                  // the router placed the scroll (optional)
await page.when('settled', { timeoutMs })      // 'phase' | 'timeout' | 'stale'
const release = page.hold('loader', loaded)    // keeps the visit pending
page.entrance(heroEl)                          // this element's animations are the entrance
page.afterSettled(() => video.play(), { order: 2 })
page.onRemeasure(ScrollTrigger.refresh); page.remeasure()
```

Keep if you rewrite: `begin()` runs before the commit's layout effects; every hold has a cap; a new visit
invalidates every timer of the last.

**Check.** `tests/unit/page.test.mjs`; `tests/route-hygiene.mjs --only lifecycle`.

## First load

**Law.** A CSS animation starts at first paint, before any script: nothing can hold it, and anything that waits for
hydration to hide the LCP element delays it (spec; [entrances.md](entrances.md) "The gate, the failsafe and the
server"). So the server HTML says which kind of entrance the page has, and the lifecycle adopts it.

| Server HTML | When | The lifecycle |
|---|---|---|
| `data-entrance="running"` | the first screen enters in CSS (`SplitWords`, your own `[data-enter]` keyframes) | adopts it; its clock is first contentful paint; tracks its animations to `tail` and `settled` |
| `data-entrance="pending"` | a script starts it: a Motion or GSAP `mount` reveal, a loader | opens it one frame after its first call, unless something holds it |
| no attribute | no entrance | consumers start at once |

- **A hero entrance runs on the compositor:** `SplitWords` (CSS keyframes from the first frame,
  [text.md](text.md) §2), or in Motion an animated `transform` string, which runs on WAAPI. No Motion `x`/`y` for
  display type before 14.2 (it drives them from JavaScript every frame; [performance.md](performance.md) §10).
- **One publisher per visit.** With nothing claimed, the lifecycle tracks the CSS and WAAPI animations under
  `[data-entrance-root]`, else `<body>` (finite ones on the document timeline; loops, paused and scroll-driven ones
  don't count). A JavaScript entrance is invisible to that, so it claims: `<Reveal trigger="mount" entrance>`,
  `reveal(root, { entrance: true })`, `mountReveals(root, { entrance: true })`, or `page.entrance(el)` for a subtree.
- **Reduced motion, or the failsafe fired:** `settled` at once. **No JavaScript:** the server's phase stays, none of
  the `held` attributes exists, and every CSS entrance plays.
- **A blurred element fades in place** ([ios-safari-motion.md](ios-safari-motion.md) §8).

**Default.** `running` in the server HTML and a CSS first screen. Override when: the first screen cannot work
without its assets (a loader: [Loaders](#loaders)).

**Code.** `<PageLifecycle />` starts the lifecycle on React; elsewhere any `page.*` call does (`page.visit()`).

**Check.** `tests/hero.mjs` (the phases per publisher).

## The hero budget

**Law.** A busy hero starts hydration, a JavaScript entrance, a shader compile, video decode, blur over live pixels
and loops in the same two seconds. Each is fine alone; the order is the budget, and the entrance owns the clock.
Fetching is not the cost, evaluating is: a chunk fetched during `running` costs the main thread nothing until it runs
(unverified as a measurement; it follows from where script evaluation happens).

- **While `running`, compositor work only:** the entrance, opacity fades. Nothing that compiles, decodes, lays out
  or evaluates a large chunk. `import()` and `fetch()` may start at once.
- **On `settled`, costly starts queue one per task, two frames apart, never in a hidden tab:**
  `page.afterSettled(start, { order })`. The default order: 1. the WebGL run; 2. video `play()`; 3. the loop strip;
  4. embeds. A CSS loop needs no script: `html[data-entrance]:not([data-entrance='settled']) .strip {
  animation-play-state: paused }`.
- **A heavy DOM layer** (a product demo) takes the canvas's stages: its box reserved at its final size from first
  paint, `import()` early, mounted with an opacity-only fade at `tail`, its story started at `settled`. Never reveal
  it through Suspense: once a fallback has shown, React 19 reveals the boundary no sooner than about 300 ms later
  (`FALLBACK_THROTTLE_MS`, cited from react-dom 19.3, not re-read here), and `next/dynamic` and `React.lazy` both
  suspend. Keep the loaded module in state (measured on a demo: the attach moved from 2.0–2.3 s to 1.6–1.7 s).

```tsx
const load = () => import('./Demo')                      // at mount: void load()
const [Demo, setDemo] = useState<ComponentType | null>(null)
// at tail: page.when('tail').then(() => load()).then((m) => setDemo(() => m.Demo))
return Demo ? <Demo /> : <DemoPlaceholder />           // the placeholder holds the final size
```

- **A heavy client-only component mounts one composition,** picked by `matchMedia(DESKTOP_QUERY)` in its first
  render, never a desktop and a phone tree with one `display: none` (measured in WebKit: its mount frame went from
  113–122 ms to 73–98 ms).
- **Fonts before the entrance:** preload the display font with a metric-matched fallback (`size-adjust`,
  `ascent-override`). A swap mid-entrance re-lays-out split words and re-rasterises every word layer. A JavaScript
  entrance may wait for them: [Holds](#holds).
- **One tick:** Lenis with `autoRaf: false` on the page's clock, the scene advanced from the same authority
  ([webgl.md](webgl.md) §4).
- **No blur over live media until `settled`**, and no blur placeholder on the hero's image
  ([performance.md](performance.md) §11).

**Default.** The scene caps at 60 fps on a 120 Hz display. Override when: the subject follows the pointer.

**Check.** Long Animation Frames (`PerformanceObserver`, type `long-animation-frame`, Chromium only); elsewhere
sample rAF deltas. A long frame during `running` is the stutter; attribute it before fixing anything
([verification.md](verification.md) §1).

## Route change

**Law 1.** Next places the scroll in a layout effect of an ancestor of the page, after the page's own layout
effects (source next@16.3.6, `layout-router.js`, `InnerScrollHandlerNew`, a `useLayoutEffect`). Anything a page's `useGSAP` or
`useLayoutEffect` reads from the scroll position is the previous page's.

**Law 2.** React runs every insertion effect of a commit before any layout effect, and every layout effect before
any passive effect, anywhere in the tree (source: the React compiled into next@16.3.6,
`commitMutationEffectsOnFiber`). So a component that begins the visit in an insertion effect, and confirms the
placement in a passive one, is right wherever it sits. Under a React `<ViewTransition>` passive effects wait for the
transition's `finished` (same source, `startViewTransition`), so nothing that must happen before the new page shows
may live in one.

**Law 3.** Next commits a back or forward synchronously inside its own `popstate` handler (measured, next@16.3.6,
Chromium 157). A listener added later hears the event after the commit.

**Law 4.** The router owns a push's position and the browser a traverse's. Nothing in this skill scrolls on a route
change, and `history.scrollRestoration` stays `'auto'` (measured S9: `'manual'` left back at 900 instead of 3000).
The scroll authority follows; see [scroll-authority.md](scroll-authority.md) "Placements and route changes".

```tsx
'use client'   // components/lifecycle.tsx
import { usePathname } from 'next/navigation'
import { PageLifecycle } from '@/animation/react/PageLifecycle'
export function Lifecycle() {
  return <PageLifecycle route={usePathname()} />
}
// app/layout.tsx, anywhere in <body>; with Cache Components a pathname reader needs its own boundary
<Suspense fallback={null}><Lifecycle /></Suspense>
// each GSAP route group's layout (a client component); unregistered when the route goes
useGSAP(() => page.onRemeasure(ScrollTrigger.refresh))
```

What one push does, in order:

1. **Insertion effect:** `page.begin()`. The visit is `pending` and held before any block's layout effect runs.
2. **Layout effects:** the page's blocks mount; reveals and split headings wait (`whenEntranceOpen`); CSS entrances
   are paused at their first frame (`html[data-entrance-held='pause']`). The router places the scroll.
3. **Placement:** `page.placed()` from the passive effect, or two frames, whichever is first. The registered
   refreshes run once (`ScrollTrigger.refresh`), then the page's height is watched for `SETTLE_MS` (5 s) and each
   burst of change refreshes again (a streamed section landing; measured S9: refreshed at the skeleton, a layout's
   `end: 'max'` kept 0–64 against 0–3464).
4. **The view transition ends** (if one runs) and the tab is visible: `running`. Entrances play.
5. **`tail`, `settled`:** from the claimed publisher, or the page's own animations. The start queue drains.

- **A traverse** arrives `settled`: no hold, no replay; the same one refresh at placement.
- **Search params** keep the pathname and the visit. A page whose content follows them calls `page.remeasure()` in an
  effect keyed on them: one debounced refresh, then the same settle watch.
- **One refresh per visit, never per block.** Route blocks measure themselves as they are created; the refresh covers
  what the navigation doesn't re-create (a trigger in a persistent layout kept 0–5664 against a fresh 0–2264).
  Register it from the GSAP routes, not the root: passed at the root it put about 17 kB gzipped of GSAP on a
  reading route.
- **Chromium restores back/forward against a scroll anchor**, so an anchor still moving at restore puts the reader
  off by its drift (measured: a reveal item before its entrance, 1965 → 1997). `css/reveal.css` and
  `css/scroll-effects.css` set `overflow-anchor: none` on those states; give the same to any element of yours that
  moves with the scroll.
- **Activity** (Cache Components keeps three routes mounted and hidden): `SmoothScroll` and `useGSAP` clean up on
  hide, and effects run again on show, so a kept route's blocks see the new visit like a mounted one.
- **Other routers:** `page.begin()` after the swap and before the new page's blocks mount, from the router's own
  hook (Astro `astro:after-swap`, SvelteKit `afterNavigate`, a vanilla router after its swap). Load `page.ts` before
  the router starts listening, or pass the kind: `page.begin('traverse')`.

**Default.** `begin()` reads the kind: a traverse when a `popstate` changed the path since the last placement, else
a push. Override when: your router knows better; pass it.

**Code.** `page-react` (`react/PageLifecycle.tsx`). Keep if you rewrite: `begin()` before the commit's layout
effects; nothing in the adapter reads or writes the scroll position.

**Check.** `verify-motion.mjs <url> --nav`; in the repository, `tests/route-hygiene.mjs` F3 (no entrance under the
transition), F4 (one landing wherever the adapter sits) and F5 (back and forward without a glide).

## Holds

**Law.** An entrance that starts before the page is ready is spent unseen. Measured Chromium 157, 2026-11: a root
crossfade lasts 245 ms from commit, a split heading's fade is over 300 ms after it, so the words surface already
opaque; a GSAP reveal created at the previous page's scroll position plays below the fold. While the lifecycle holds,
the visit stays `pending` and nothing enters.

| Hold | On | Releases when | Cap |
|---|---|---|---|
| `placement` | every visit but a load | `page.placed()`, or two frames after `begin()` | 100 ms |
| `transition` | a push | no view transition is active (`document.activeViewTransition.finished` where it exists, else `html:active-view-transition` polled per frame) | 1 s |
| `fonts` | only with `<html data-entrance-fonts>`, and only while fonts are loading | `document.fonts.ready` | 400 ms |
| tab hidden | a push | `visibilitychange` | none |
| yours | `page.hold(reason, promise?, { capMs })`, while `pending` | the release, or the promise | 4 s unless given |

- **What a hold stops:** CSS entrances on `[data-split-word]` and `[data-enter]` (paused at their first frame, hidden
  by their `backwards` fill); the engine-free, GSAP and Motion reveals and `splitReveal` (they start through
  `whenEntranceOpen`); `trackEntrance`. A GSAP reveal asks its triggers again when the hold lifts, so its on-screen
  test reads the placed page.
- **What it cannot stop:** a CSS entrance on a load (it began at first paint). A hold on a load is a loader's, and
  restarts those entrances when it lifts.
- **Your own CSS entrance** joins with one attribute: `[data-enter]` on the animated element (`css/animation.css`).
- **In-page view transitions** (a filter, a tab) hold nothing: only a visit holds. Without the lifecycle on the
  page, `css/split.css` falls back to 2.1.2's rule and pauses its words under any view transition.

**Default.** No fonts hold. Override when: a JavaScript entrance splits text below a slow display font.

**Code.** `page.ts`. Keep if you rewrite: every hold has a cap, so `running` always comes.

**Check.** `tests/route-hygiene.mjs --only lifecycle` (F3: split words, GSAP on mount and at the line, the
engine-free reveal and Motion, each first shown after the transition ended).

## The clock

**Law.** A consumer that waits for `settled` needs a timeout, or a page whose entrance never publishes never starts
it. Counted from navigation start, that timeout includes the network: on a slow phone first paint lands near 1.5 s
and a 1.3 s entrance is still running at 2.5 s, so the timeout fires in the middle of the entrance, on the devices
it exists for; under a loader it always fires early (reasoned, unverified as a measurement). After a client
navigation "navigation start" is the first page's, long past.

**Default.** `ENTRANCE_TIMEOUT_MS` is 2500, counted from the entrance's start, `entranceStartedAt()`: the
lifecycle's stamp at `running` (`data-entrance-started`), else first contentful paint (where a CSS entrance
starts), else navigation start. While the visit is `pending` no timeout runs: the holds' caps bound that. Override
when: the entrance is longer than about 2 s with its stagger (raise it).

- `page.when(phase, { timeoutMs })` counts the same way and resolves `'timeout'`; `'stale'` if a new visit began.
- The start queue uses it: an entrance that has run `ENTRANCE_TIMEOUT_MS` without settling is settled by the
  lifecycle, and the queue drains.
- **Cues, not seconds.** A consumer runs at hydration, hundreds of ms after a CSS entrance began. Wait for a phase;
  a fixed cue survives only as a timeout.

**Code.** `entrance-signal.ts` (`entranceStartedAt`, `ENTRANCE_TIMEOUT_MS`), `page.ts` (`when`).

**Check.** `tests/unit/page.test.mjs` ("timeout counted from running").

## What the 3d skill reads

**Law.** Neither skill imports the other; the DOM is the interface. The 3d skill's `SceneCanvas
startAfter="entrance"` reads `data-entrance` on `<html>` and `entrance:phase`. Because the lifecycle restarts the
phase before the new route's effects run, a canvas mounted by a client navigation reads that visit's `pending`, not
the last page's `settled` (before per-visit phases it started at once on every route after the first).

- **Stages** are the 3d skill's (`threejs-orchestration.md` "Stages"): prepare outside the entrance, reveal a still
  frame, run at `settled`. On the main thread a CSS entrance starts at first paint, so there is no "before" without a
  loader: the reveal lands after `settled`. Fetching and worker work may run during `running`.
- **Its timeout** counts from `data-entrance-started`, else first contentful paint, else navigation start.
- **Standalone,** the 3d skill carries a small publisher of its own (`trackEntranceAlone`). With this skill's
  lifecycle on the page (`data-visit` on `<html>`), theirs stands down.
- A route change held at `pending` counts as mid-entrance for it: its prepare waits for `settled`.
- As a background behind the copy, the canvas sits below a copy wrapper with its own stacking level
  ([ios-safari-motion.md](ios-safari-motion.md) §9).

**Check.** The 3d skill's `tests/web`; here, `tests/hero.mjs` (the stub scene's stages against the phases).

## Loaders

**Default.** No loader. Override when: the first screen cannot work without its assets, or the loader is the
concept ([page-transitions.md](page-transitions.md) "Preloaders" for the block, `design` for whether the brief
earns one).

A loader is a hold on a load. Write `data-entrance="pending"` in the server HTML and take the hold in the task that
mounts the loader:

```ts
const loader = mountPreloader(overlay, { assets })
page.hold('loader', loader.done, { capMs: 4000 })
```

Until it lifts, JavaScript entrances wait and CSS entrances that ran unseen beneath the overlay are restarted
(`html[data-entrance-held='restart']`). Then `running`: the first screen enters as the overlay leaves.

## Migrating from RouteChange

`<RouteChange>` and `routeChanged()` (2.1) still work and are deprecated. They had to wrap the page, which a
pathname reader cannot do under Cache Components, and rendered before the page they synced to the old position.

1. `scroll-animation add page-react`.
2. Delete `<RouteChange route={usePathname()}>` and render `<PageLifecycle route={usePathname()} />` in its own
   `<Suspense fallback={null}>` anywhere in the root layout.
3. Keep each GSAP route's `onRouteRefresh(ScrollTrigger.refresh)`; `page.onRemeasure` is the same registry.
4. A page that wrapped its content in `<RouteChange route={useSearchParams().toString()}>` calls `page.remeasure()`
   in an effect keyed on them. `routeSettled()` becomes `page.remeasure()`.
5. Server HTML: a CSS first screen writes `data-entrance="running"` (2.1 wrote `pending` and tracked from a client
   effect; that still works).
6. Remove any hand-written sync after navigation (`handle.sync()`, a re-sync over frames): the authority follows.
7. Don't mix the two on one page: `watchRouteSettle({ settle: 0 })` ends the lifecycle's watch.

`audit-motion` flags a `<RouteChange>` that wraps nothing (`route-change-before-page`).

## Traps

- **Begin in a passive effect:** the page's layout effects have already created entrances under the last visit's
  `settled`, and under a view transition the effect runs after the crossfade.
- **Read the hold during render:** the visit begins after render. Read it in a layout effect (`motion/Reveal.tsx`).
- **A `popstate` listener added after the router's:** every traverse reads as a push (Law 3).
- **A hold taken after `running`:** a no-op. Take a loader's hold in the task that mounts it.
- **A timeout counted from a consumer's own mount, or from navigation start:** see [The clock](#the-clock).
- **A second publisher:** the first to settle wins. One claim per visit.
- **`suppressHydrationWarning` missing on `<html>`:** the attributes above are written before and after hydration.

## Checks

| Check | Proves |
|---|---|
| `verify-motion.mjs <url> --nav [href]` | a link from a scrolled page, back and forward: landings, no glide, no reveal started off screen, nothing entering under a view transition, the first screen visible |
| `audit-motion.mjs src` | `route-change-before-page` |
| `tests/route-hygiene.mjs` (repository) | F2 arrival, F3 entrance against the transition, F4 placement, F5 traverse; `--variants before` reruns F3 to F5 on 2.1.2's blocks |
| `tests/unit/page.test.mjs` (repository) | visits, holds and caps, `when()`, the start queue |

Not provable headlessly: WebKit and Firefox (not run for this file), a real phone, bfcache (`restore` is wired and
untested), a hidden tab at load.
