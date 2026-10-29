# Page transitions and route changes

**Purpose:** Animate the change from one page or view to the next with the right tool, and keep the scroll
authority, ScrollTrigger and the reader's position right across every client navigation.

**Read when:** a site wants page transitions, a shared element from a card to its detail page, a grid opening into a
detail inside one route, or a loading screen; or after a navigation the page lands at the wrong position, Lenis
glides on, back/forward restores the wrong place, or a trigger in a layout keeps the previous route's numbers.
**Skip when:** the motion stays inside one section of one page (an entrance: [entrances.md](entrances.md)), or the
transition is UI chrome laid over the content (a modal or dialog, a menu, a carousel slide: not this skill). A card
that opens into a panel in place is the content itself opening, so it stays here (`layout-morph`, §6).

**Inputs:** the framework and its router (Next App Router, Astro, SvelteKit, a vanilla page, a multi-page site), the
scroll authority per route, the profile from `ANIMATION.md`.
**Produces:** the `view-transitions` block wired for that router, route hygiene through `<RouteChange>` or
`routeChanged()`, and `flip-transition`, `layout-morph` or `preloader` where the brief calls for them.

## Contents

1. [Which tool](#1-which-tool)
2. [The view-transitions block](#2-the-view-transitions-block)
3. [Vanilla and multi-page sites](#3-vanilla-and-multi-page-sites)
4. [Route scroll hygiene](#4-route-scroll-hygiene)
5. [Framework lifecycles](#5-framework-lifecycles)
6. [Inside one route: Flip and layoutId](#6-inside-one-route-flip-and-layoutid)
7. [Preloaders](#7-preloaders)
8. [Reduced motion and pointer events](#8-reduced-motion-and-pointer-events)
9. [Traps](#traps)

## 1. Which tool

| Change | Tool | Block |
|---|---|---|
| A route change in React (Next App Router) | React's `<ViewTransition>` with the block's classes; Next 16.3.6 needs no flag (S9) | `view-transitions` (`--engine css`) |
| A same-document change on a vanilla page (a client router, a view swap) | `await transition(update, { types })` | `view-transitions` (agnostic) |
| A multi-page site: every navigation loads a document | cross-document `@view-transition`, opted in inline on every page; Firefox 155 has none and just loads | `view-transitions` (agnostic) |
| A grid opening into a detail, a reorder, a filter, inside one route; the same node must survive (a playing video, focus, an input) | GSAP Flip | `flip-transition` (gsap) |
| A card opening into a panel inside one React route | Motion `layoutId` | `layout-morph` (motion) |
| An Immersive first screen that can't work until its assets arrive | real loading progress | `preloader` |

Barba, Taxi and swup are legacy vanilla routers: where one already runs, keep it and give it §4's hygiene after
its swap; never add one to a new project. A canvas that persists across routes (Immersive, [preflight.md](preflight.md)
§3.1) has no block yet.

## 2. The view-transitions block

`scroll-animation add view-transitions` copies `view-transitions.ts`, `css/view-transitions.css` and
`css/view-transitions-mpa.css`, with `smooth/authority.ts` and `smooth/route.ts`. A React project, where React starts
the transitions, adds it with `--engine css`: the two CSS files only (without the flag it gets the vanilla set). Import `css/view-transitions.css` after `css/animation.css`; it needs no engine, and
every caller of the API shares it: `transition()`, React, and cross-document navigations.

| Element | What it does |
|---|---|
| (the root) | the whole page crossfades on `MOTION.disclosure` (0.24 s) |
| `view-transition-name: <n>; view-transition-class: vt-morph` | a shared element: the same name on both states; its box travels on `MOTION.route` (0.4 s), both snapshots `object-fit: cover`, so a 4:3 card into a 16:9 hero never shows two stretched pictures |
| `view-transition-class: vt-forward vt-back` | slides with the navigation's type (`forward`, `back`), `--vt-distance` (32px) on `MOTION.route`; with no type it crossfades |
| `view-transition-class: vt-none` | swaps at once: media that must not freeze into a picture mid-play |
| `[data-header]` | anchored: its own group, raised over the others, no fade or slide; its ink changes underneath |

- A class does nothing until the element also has a `view-transition-name`: only named elements get a group.
- Keep one `[data-header]` rendered: two elements with one name abort the transition (`transition()` still updates).
- `--vt-distance` and the timing variables work on `:root` only: the pseudo-elements inherit from the root element.

**React.** React starts the transitions itself and assigns the classes; the CSS is the same.

```tsx
import { ViewTransition } from 'react'
const PAGE_SLIDE = {
  enter: { forward: 'vt-forward', back: 'vt-back', default: 'none' },
  exit: { forward: 'vt-forward', back: 'vt-back', default: 'none' },
  default: 'none',
}
<ViewTransition {...PAGE_SLIDE}>…the page…</ViewTransition>                      // on each page.tsx, never a layout
<ViewTransition name={`cover-${slug}`} share="vt-morph" default="none"><img …/></ViewTransition>   // card and hero
<Link href={`/journal/${slug}`} transitionTypes={['forward']}>…</Link>
```

- `transitionTypes` on Next's `<Link>` passes the types to `addTransitionType`; outside a `<Link>`, call
  `addTransitionType('forward' | 'back')` inside `startTransition`. `default: 'none'` leaves a navigation with no
  type to the root's crossfade.
- The slide goes on each `page.tsx`, never on a layout: a layout persists across the navigation, so it never enters
  or exits.
- **React runs one view transition per link and none for back/forward** (S9, all three engines): never rely on one
  there. Every refresh during a link's transition ran inside it and saw the new route alone.
- Never `AnimatePresence` across App Router routes ([motion.md](motion.md) §8).

**Browser matrix** (measured in Playwright 1.63 with a probe; MDN BCD and Chrome DevRel's Feature Explorer agree):

| | Chromium | Safari | Firefox |
|---|---|---|---|
| same-document `startViewTransition` | 111+ | 18.0+ | 144+ |
| `{ update, types }`, `:active-view-transition-type()` | 125+ | 18.2+ | 147+ |
| `view-transition-class` · `document.activeViewTransition` | 125+ · 142+ | 18.2+ · 26.2+ | 144+ · 147+ |
| cross-document `@view-transition`, `pagereveal` / `pageswap` | 126+ | 18.2+ | **no** (Firefox 155) |

Browsers that take only an update callback (Safari 18.0–18.1, Firefox 144–146) still transition, without the types.

## 3. Vanilla and multi-page sites

```ts
import { transition } from './view-transitions'
await transition(() => renderArticle(slug), { types: ['forward'] })   // the DOM is updated when it resolves
transition(update).finished                                           // the animation is over; never rejects
```

- `transition()` runs `update` directly, with no transition, when there is no API, reduced motion (read at each
  call), a hidden tab, or a transition already running; a second call never starts a second one (the last wins). It
  rejects only with `update`'s own error.
- **Scroll inside `update`.** A scroll left to a later frame lands after the new snapshot. After `update`, the page's
  handle syncs (`currentSmoothScroll()?.sync()`), so a Lenis glide can't carry on toward the old page's target.
  (A raw `startViewTransition` under Lenis glided back to 2722–2940 px; `transition()` held 0.) A Lenis the site started itself has no handle: end `update` with `lenis.resize()` and
  `lenis.scrollTo(window.scrollY, { immediate: true })`.

**A multi-page site** opts in on every page (both documents must, or the navigation just loads), with the text of
`css/view-transitions-mpa.css` inline in a `<style>` in `<head>`, never only through the bundled stylesheet: measured
on Chromium 153 (the site, `/guide/` → `/`), the linked opt-in skipped 4 of 8 navigations ("ViewTransition opt-in
disabled"), the inline one ran 8 of 8. The site's build writes the file's text over a `<head>` placeholder
(`site/plugins/animation-html.ts`), so the file stays the block's. Import `css/view-transitions.css` as usual, and give
each transition its direction from a render-blocking script:

```html
<script type="module" blocking="render" src="/src/transitions.ts"></script>   <!-- mountCrossDocumentTransitions() -->
```

- `mountCrossDocumentTransitions()` adds `back` for a history step to an earlier entry and `forward` for links, none
  on a reload. Run later than the first frame, it finds the reveal over: without the blocking script Chromium lost
  `forward` on a fresh load and WebKit lost `back`; with it both pass.
- **Vite strips `blocking="render"`**: it folds every module script of a page into one entry chunk and writes the tag
  without the attribute (measured on Vite 8.3). Build the blocking script as its own entry and put the tag back after
  the bundle (a `transformIndexHtml` pair, `order: 'pre'` out and `order: 'post'` in). Keep what it imports small:
  all of it blocks rendering.
- Chromium skipped an inbound transition ("opt-in disabled") on a navigation 200 ms after load; from 300 ms it ran.

## 4. Route scroll hygiene

S9 measured Next 16.3.6 in Chromium 153, WebKit 26.6 and Firefox 155, with and without Cache Components and
`<ViewTransition>` (identical results):

| Navigation | Without the contract | With it |
|---|---|---|
| a link | the top, or its hash target at 64 px (`scroll-padding-top`) | same |
| back / forward | restored exactly, in one step, native and Lenis | same |
| a link mid-glide, one Lenis living on (two routes in one Lenis layout) | lands at the new route's bottom (1664 of 1664 px); the next link at 3750 instead of 0 | the top |
| back mid-glide, Lenis living on | 750 instead of 3000 | 3000 |
| a trigger in the persistent layout (`end: 'max'`) | keeps the previous route's numbers (0–5664 against a fresh 0–2264) | fresh |
| `history.scrollRestoration = 'manual'` | back stays at 900 instead of 3000 in all three | keep `'auto'` |
| Activity hide (Cache Components) | 0 triggers and no Lenis left on the hidden route | same |

**The contract** (`smooth/route.ts`, in the `scroll-authority` block): after each client navigation, once the new
route's blocks mounted and the router placed the scroll, the authority takes up the router's position at once
(`handle.sync()`) and the registered refreshes run once. Nothing in it scrolls: the router owns the position.

```tsx
'use client'   // components/route-scroll.tsx, rendered by app/layout.tsx around {children}; imports no GSAP
import { usePathname } from 'next/navigation'
import { RouteChange } from '@/animation/smooth/SmoothScroll'
export function RouteScroll({ children }) {
  return <RouteChange route={usePathname()}>{children}</RouteChange>
}
// each GSAP route group's layout (a client component, next to its SmoothScroll); unregistered when the route goes
useGSAP(() => onRouteRefresh(ScrollTrigger.refresh))   // onRouteRefresh from '@/animation/smooth/route'
```

- **`<RouteChange>` wraps the ROOT layout's children**, so its layout effect runs after every route's own (their
  `useGSAP` blocks and registrations, Next's scroll, `SmoothScroll`), inside the update under `<ViewTransition>`. A
  fresh load (ScrollTrigger refreshes at `load`) and StrictMode's second effect aren't changes: no sync, no refresh.
- **The GSAP routes register the refresh** (`onRouteRefresh(fn)` returns the unregister; a function registered twice
  runs once), so the root imports no GSAP and a Reading route never loads it. A `refresh` passed to the root's
  `<RouteChange>` put about 17 kB gzipped of GSAP on Folio's journal routes: /journal 248.6 kB with it, 231.8 kB
  registered (gzip -9 of every script the prerendered HTML loads). Motion-only and CSS routes register nothing, so no
  refresh starts ScrollTrigger's listeners on a page with nothing to measure.
- **A navigation is a change of `route`: the pathname.** A search-param navigation keeps the page mounted and ran no
  refresh (measured); a page whose content follows its search params (a filter, a tab) wraps that content in its own
  `<RouteChange route={useSearchParams().toString()}>`.
- **Streamed routes settle late.** Next commits a `loading.tsx` or Suspense fallback under the new pathname first.
  Refreshed then, a layout-level `end: 'max'` measured the skeleton (0–64 against a fresh 0–3464) and a trigger below
  the streamed section kept its pre-stream start (1424–2664 against 2624–3864). So for `settle` ms after a change
  (`SETTLE_MS`, 5000) the contract watches the page's height (a ResizeObserver on `<html>` and `<body>`, debounced
  `SETTLE_DEBOUNCE_MS`, 150) and runs the refreshes again, without `sync()` (the reader may be scrolling), only when it
  changed. A fresh load watches too: `<RouteChange>`'s first render runs `watchRouteSettle()`, because Chromium
  revealed streamed content after `load`, past ScrollTrigger's own refresh, on 6 of 6 loads (WebKit and Firefox on
  none). `settle={0}` turns the watch off; content that lands after it (a client fetch) calls `routeSettled()`.
- **Vanilla:** unmount the old route, swap, let the router scroll, call `routeChanged()` (register nothing), then
  `mount()` the new route, which refreshes once itself ([gsap.md](gsap.md) §3). After the first `mount()`,
  `watchRouteSettle({ refresh: ScrollTrigger.refresh })`; when late content lands,
  `routeSettled({ refresh: ScrollTrigger.refresh })`.
- **`sync()`** per authority: native does nothing; Lenis runs `resize()`, then `stop()` and `start()`, which end a
  glide (measured on 1.3.26; the README only says pause and resume); ScrollSmoother jumps with
  `scrollTo(scrollY, false)` (documented, not measured in S9).
- **Refresh once per navigation, never per block.** Route blocks measure themselves as they are created; the one
  refresh covers what the navigation doesn't re-create. Fonts and images that land after the watch still need
  `routeSettled()` (S5).
- **Keep `history.scrollRestoration` at `'auto'`** on Next, which restores nothing itself. Route code never scrolls.
- **Chromium restores back/forward against a scroll anchor**, so an anchor still moving at restore puts the reader off
  by its drift (measured on the site: a reveal item before its entrance, 1965 → 1997; a parallax on its view timeline,
  1500 → 1454). `css/reveal.css` and `css/scroll-effects.css` set `overflow-anchor: none` on exactly those states;
  give the same to any element of your own that moves with the scroll.
- **Activity** already behaves: `SmoothScroll` and `useGSAP` clean up on hide (a hidden route's registration too).

## 5. Framework lifecycles

The rule is the same everywhere: tear the old route down before the swap, call `routeChanged()` once the router has
placed the scroll, then mount the new route.

- **Next App Router:** §4.
- **Astro `<ClientRouter />`** (docs.astro.build, view transitions guide): it runs the view transition itself, so
  style it with the block's CSS and don't call `transition()`. Unmount on `astro:before-swap`; `astro:after-swap`
  fires after the history update and the scroll position are set, so call `routeChanged()` there; mount on
  `astro:page-load`, which also fires on the first load. Bundled module scripts run once only, so they listen for
  these events. An element with `transition:persist` keeps its DOM across navigations: mount its blocks once, never
  per route.
- **SvelteKit** (svelte.dev, `$app/navigation`): start the transition in `onNavigate`, the documented recipe with
  `transition()` in place of `document.startViewTransition` so the guards apply:
  ```ts
  onNavigate((navigation) => new Promise((resolve) => {
    transition(async () => { resolve(); await navigation.complete })
  }))
  afterNavigate(() => routeChanged({ refresh: () => ScrollTrigger.refresh() }))
  ```
  `afterNavigate`'s `to.scroll` is the position applied after the navigation completed, so the scroll is placed by
  then. The `'auto'` rule above is S9's, on Next: a router that restores scroll itself keeps its own setting.
- **Nuxt:** `page:finish` runs before Nuxt's own scroll (its default `scrollBehavior` scrolls a frame after
  `page:loading:end`: `router.options.ts` on main), and no public hook follows it. Nothing here is measured on Nuxt.

## 6. Inside one route: Flip and layoutId

- **`flip-transition`** (GSAP): `await flipTransition(root, { change })` records every `[data-flip-id]`, runs
  `change()`, and lands each element from its old box. Use it instead of a view transition when the same node must
  survive (a playing video, focus, an input), inside one route, inside a scroll container (view-transition snapshots
  fly above it), or without the API. Transform only (`scale: false` lays out every frame: say why where set). Never
  on a pinned or sticky ancestor. React: `change: () => flushSync(() => setOpen(true))` from an event handler, and keep the returned flip to
  `kill()` in the cleanup: `contextSafe` can't record it, because `Flip.from` runs after `change()` resolves.
- **`layout-morph`** (Motion): `<LayoutMorph>` with a `<Morph morphId>` per state. In one route only; across App
  Router routes use `<ViewTransition share="vt-morph">`, because the old route's tree is gone before the new one
  mounts. It loads `domMax` for its subtree only, on first mount (about 46 kB minified, 14 kB gzipped, measured on
  Motion 13.4); never put `domMax` on `MotionProvider`. Give a scrolling container `layoutScroll` and a fixed one
  `layoutRoot`. Under reduced motion the swap is plain ([motion.md](motion.md) §8 has the Motion bug behind that).

Both run `MOTION.route`, the route morph's timing, so an in-route change and a page change read alike.

## 7. Preloaders

- **Immersive only.** Never on a Reading or Expressive page, and never in front of a content page's LCP element
  ([craft.md](craft.md) §10).
- **Progress is real**: `mountPreloader(overlay, { assets, inert })` counts each asset equally (an image's `decode()`,
  a video's `loadeddata`, `document.fonts`, a fetched URL's bytes, any promise) and writes `--load-p` on the overlay
  (or `progressOn`), only upwards. Never a timer. No `loading="lazy"` image in the list: it never loads off screen.
- A video still without a frame 200 ms after its metadata is primed once (a muted `play()`, paused at once): iOS
  loads only metadata otherwise. Give it `muted playsinline`, or it waits out the 4 s maximum.
- A 300 ms minimum (keep it at or under that), a 4 s maximum that shows the page anyway. Start the first screen's
  entrances on `html[data-preloader-state="done"]`.
- Show the overlay only behind `GATE_SCRIPT`, with its own CSS failsafe (the snippet is in `preloader.ts`'s header),
  so a page whose script never runs never stays covered.

## 8. Reduced motion and pointer events

- `transition()` skips the API under reduced motion: the update runs at once. The cross-document opt-in sits under
  `prefers-reduced-motion: no-preference`, so the new page simply replaces the old.
- React's transitions can't be stopped by a stylesheet, so the CSS gives them the alternate scene: under `reduce`,
  groups `animation: none` (no morph, no slide) and every snapshot crossfades in place on `MOTION.entranceFade`'s
  0.17 s, linear (WCAG 2.3.3 counts movement, size and shape as motion, never opacity).
- Pointer events: the `::view-transition` overlay takes every click while a transition runs, the browser's default,
  kept on purpose: it lasts 0.4 s at most and nothing is hit through a picture that doesn't match the page yet.

## Traps

- [ ] One tool per change: a view transition between routes, Flip or `layoutId` inside one (§1, §6).
- [ ] Shared elements carry the same name on both states and `vt-morph`; one `[data-header]` rendered (§2).
- [ ] The React slide is on each `page.tsx`, never a layout; back/forward runs no React view transition (§2).
- [ ] An MPA has its opt-in inline in every page's `<head>` and its direction script render-blocking through the build (§3).
- [ ] `<RouteChange>` wraps the root layout's children, or `routeChanged()` runs after the router's scroll (§4, §5).
- [ ] One refresh per navigation; `scrollRestoration` stays `'auto'`; no route code scrolls (§4).
- [ ] A preloader only on an Immersive first screen, driven by real assets, behind the gate (§7).
