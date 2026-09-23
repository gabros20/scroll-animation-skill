# Header theme: ink that follows the section underneath

**Read when:** a fixed or sticky header floats over the page without its own background and its
text, logo or icons must switch between light and dark ink as sections scroll under it; or the
header ink is wrong over some band ("the nav disappears over the dark section").
**Skip when:** the header paints an opaque bar of its own, or the page has no fixed header. If the
site already has a script that switches header colours, read `brownfield-coexistence.md` §2 first.
**Depends on:** `scroll-scenes.md` §3 for the "state per transition, not per frame" rule this obeys.
Header *sizing* (`--header-h`, the resting inset, safe areas) is layout and belongs to the
`fluid-design` skill when it is installed (`fluid-interop.md` §6).

A transparent fixed header has no surface of its own, so its ink cannot belong to the page. A black
nav pinned over a black section disappears. The header needs to know the declared ink of whichever
section is under it, continuously, as the page scrolls.

## Contents

1. [Declaring a section's theme](#1-declaring-a-sections-theme)
2. [Why scroll subscription, not IntersectionObserver](#2-why-scroll-subscription-not-intersectionobserver)
3. [The probe](#3-the-probe)
4. [One transition for the whole bar](#4-one-transition-for-the-whole-bar)
5. [Wiring it](#5-wiring-it)
6. [Traps](#traps)

## 1. Declaring a section's theme

- Sections declare themselves with `data-header-theme="light|dark"`. Only sections that depart from
  the page's base theme need marking: unmarked sections fall back to `base`, so leave light fields
  unmarked on a light-base page.
- If the darkness changes by breakpoint, use a custom property that a plain utility can vary, with
  zero JS:

  ```tsx
  <section data-header-theme="dark" className="[--header-theme:light] lg:[--header-theme:dark]">
  ```

  The variable wins where it is set; otherwise the attribute's value is used. The case this exists
  for is a section that is mid-grey on mobile and black from `lg`: white ink on that grey measures
  2.2:1 where black measures 5.6:1, so the theme genuinely needs to flip with the breakpoint, not
  just the section.
- **An unmarked dark band is a bug:** the nav keeps light-page ink over it. Check each dark section,
  including the ones inside a pinned scene (a copy section riding over a dark render is dark, even
  though it paints no background).

## 2. Why scroll subscription, not IntersectionObserver

The natural instinct is an `IntersectionObserver` shrunk to a band at the header's own height. It
doesn't work cleanly: `rootMargin` takes no `calc()`, so that band has to be computed from
`window.innerHeight` and the observer rebuilt whenever it changes, which on mobile is *every time
the URL bar collapses*.

**Subscribe to scroll instead.** Measure every themed section's vertical extent once, into document
coordinates, and re-measure only on resize. A `ResizeObserver` on `document.body` catches viewport
changes, font swaps, images settling and accordions opening; it is more reliable than a bare resize
listener, which misses content reflow. A scroll frame then costs a handful of numeric comparisons
against those cached bands: no DOM read, exact at every scroll offset, and nothing to rebuild.

## 3. The probe

```ts
const probe = header.offsetTop + header.offsetHeight / 2   // offsetTop/offsetHeight: layout
                                                              // metrics, immune to an entrance
                                                              // transform still running on the
                                                              // header at first paint — a rect
                                                              // read there would probe too high
function resolve(scroll: number) {
  const y = scroll + probe
  let next = base
  for (const band of bands) if (y >= band.top && y < band.bottom) next = band.theme  // last match wins
  setTheme(prev => prev === next ? prev : next)   // write only on an actual change
}
```

- **Probe with layout metrics (`offsetTop`/`offsetHeight`), not `getBoundingClientRect`.** The
  header is mid-entrance-transform at first paint, and a rect probe reads about 100px too high. The
  same immunity holds for a header that hides on scroll-down with a `transform`.
- The probe line is the header row's vertical middle. For an element inside a `position: fixed`
  header (a nav nested in a `StageItem`, say), `offsetTop` stays a small, scroll-independent number
  either way, because `position: fixed` is what makes it resolve near the viewport rather than the
  document. Hold the ref on whichever element is convenient; there is no need to hoist it to the
  header's outermost element.
- **Write framework state only when the resolved theme changes**: a handful of times per page load,
  never per scroll frame. That keeps this inside the latch rule (`scroll-scenes.md` §3).
- `refresh()` (GSAP controller) or a remount forces a re-measure after content is injected without
  a resize.

## 4. One transition for the whole bar

Every themed part of the header (logo, links, triggers, hamburger, any scrolled surface) uses **one**
colour transition, `transition-colors duration-200 ease-out` (`THEME_FADE` in
`assets/react-motion/hooks/header-theme.ts`). The probe flips the theme the instant it crosses a
boundary, so without a shared transition the bar hard-cuts from black ink to white mid-scroll.

200ms is the compromise between a theme dissolve (which wants 300ms or more) and link hover (which
must feel instant: `color` usually carries hover too, and a 300ms colour makes every hover lag the
pointer). **If different parts use different durations, the bar comes apart mid-flip**, each piece
arriving on its own clock. And only one `transition-*` utility per element: two both set
`transition-property`, and which wins is stylesheet-order luck.

## 5. Wiring it

- **React:** `useHeaderTheme(base, headerRef)` in `assets/react-motion/hooks/useHeaderTheme.ts`
  returns `'light' | 'dark'`; map it to classes on the header.
- **GSAP / vanilla:** `initHeaderTheme` in `assets/gsap/src/headerTheme.ts` (or
  `initFluidMotion(document, { headerTheme: { header: 'header', base: 'light' } })`) writes
  `data-theme` on the header element, only when it changes. Style from `header[data-theme='dark']`.
- The resolved theme is also a natural signal for anything else that must follow the page's
  dominant colour (a per-section toolbar tint, for example); reuse it rather than probing twice.

## Traps

- [ ] Every dark band carries `data-header-theme` (or the page base is dark) (§1).
- [ ] A section whose darkness changes by breakpoint uses `--header-theme`, not a JS branch (§1).
- [ ] No `IntersectionObserver` band for the probe (§2).
- [ ] The probe uses `offsetTop`/`offsetHeight`, not a rect (§3).
- [ ] State is written only on a change, never per scroll tick (§3).
- [ ] Every themed part of the bar shares one 200ms colour transition (§4).
- [ ] Only one writer owns the header's colour; an existing colour script and this probe never
  both write it (`brownfield-coexistence.md` §2).
