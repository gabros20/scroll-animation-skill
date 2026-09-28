# Motion (React)

**Purpose:** Use Motion 13 in React the way the blocks do: `m` under `LazyMotion strict`, reduced motion read live,
scroll-linked styles written by hand, Lenis driven from Motion's frame loop, and the vanilla API where there is no
React.

**Read when:** a React route animates with Motion (`useScroll`, `useTransform`, `useSpring`, `whileInView`, `layoutId`,
`MotionConfig`); Motion runs under Lenis; a scroll-linked style fades back in, drifts or lags a frame; the bundle grew
after a `motion.*` import.
**Skip when:** the route runs GSAP; or the job is a ready block, such as an entrance ([entrances.md](entrances.md)) or
a pinned scene ([scenes.md](scenes.md)), whose file already follows these rules.

**Inputs:** the route's React tree, its scroll authority (`<html data-scroll-authority>`), the Motion code in question.
**Produces:** Motion code under the provider, with live reduced motion, hand-written scroll styles and Lenis on
Motion's clock.

## Contents

1. [The provider](#1-the-provider)
2. [Reduced motion, live](#2-reduced-motion-live)
3. [Scroll values](#3-scroll-values)
4. [Never bind a scroll value to style](#4-never-bind-a-scroll-value-to-style)
5. [Writing by hand](#5-writing-by-hand)
6. [Motion under Lenis](#6-motion-under-lenis)
7. [Without React: inView, scroll, animate](#7-without-react-inview-scroll-animate)
8. [Layout and view transitions](#8-layout-and-view-transitions)
9. [Hide and show](#9-hide-and-show)
10. [Traps](#traps)

## 1. The provider

`MotionProvider` (`motion/MotionProvider.tsx`, the `motion-provider` block) goes once near the root of every React
tree that uses Motion blocks:

```tsx
<MotionProvider>{children}</MotionProvider>                      // domAnimation
<MotionProvider features={domMax}>{children}</MotionProvider>    // adds layout and layoutId
```

- **`LazyMotion strict`.** Render `m.div` (import `m` from `motion/react`), never `motion.div`. The full `motion`
  component weighs about 34 kB; `m` is a small shell that loads its features separately. `strict` makes a stray
  `motion.*` throw instead of silently loading the full bundle, and `audit-motion.mjs` flags one as `motion-strict`.
- **Features.** `domAnimation`, the default, covers entrances, gestures and exits. Pass `domMax` for `layout` and
  `layoutId`, or a loader, `features={() => import('./motion-features').then((mod) => mod.default)}`, to fetch the
  bundle after hydration.
- **`MotionConfig reducedMotion="user"`**: Motion drops transform and layout animation for a visitor who asked for less
  motion. It reaches only Motion's own animations (§2).
- It marks the engine ready (`html[data-animation-ready]`), which switches off the CSS failsafe
  ([entrances.md](entrances.md) §9).

## 2. Reduced motion, live

- Motion 13.4's `useReducedMotion()` reads the setting once per mount, so a visitor who changes it mid-visit keeps the
  old answer: a scene collapses in CSS while its JavaScript still scrubs. `useReducedMotionLive()`
  (`motion/useReducedMotionLive.ts`, in the `motion-provider` block) subscribes to `REDUCED_MOTION_QUERY`, the query
  the CSS uses, so the two always agree. On the server it answers false, and the CSS covers reduced motion until
  hydration.
- `MotionConfig` never reaches a value bound through `style` or written by hand. **Every hand writer checks
  `useReducedMotionLive()` itself** and renders a settled state: the composition the section was designed around,
  with no movement (a scene holds its first frame, an exit fade holds opacity 1).
- Reduced motion removes movement. The blocks go further and settle entrances at once; an effect of your own may keep
  an opacity or colour change that carries meaning.
- Structure, such as a pin and its runway, collapses in CSS, in `css/scene.css` ([scenes.md](scenes.md) §10).

## 3. Scroll values

```tsx
const RANGE = ['start start', 'end end'] as const satisfies [string, string]   // module scope, or it resubscribes
const { scrollYProgress } = useScroll({ target: wrapperRef, offset: RANGE })
```

- **Measure the range wrapper, never a sticky element.** A sticky element stops moving, so its own box is no ruler.
- **Map progress linearly.** A scroll value is already eased by the reader's hand; shape it with `useTransform`'s
  input range, never with an ease ([craft.md](craft.md) §4).
- **Smooth once.** On a native route, a `useSpring` on the visual consumer is the smoothing; keep it over-damped.
  Under Lenis, read raw `useScroll()`: Lenis already smooths, and a spring on top trailed the scroll by 16–18 frames,
  about 0.3 s (spike S4). Under ScrollSmoother, `useScroll` reads the unsmoothed scroll, up to 244 px ahead of the
  screen (S2), so scroll-linked values there come from ScrollTrigger.
- **A spring never feeds a threshold.** It settles across the boundary and flips it back and forth. Modes, acts and
  `inert` read exact progress.
- **Units by job.** Progress (0 to 1) drives visuals inside one scene's range; thresholds and tolerances are pixels,
  media time is seconds, and a mode is a named state.
- **A responsive value is a CSS variable**, never one MotionValue per breakpoint, which builds a value for every
  breakpoint on each render and throws all but one away.

## 4. Never bind a scroll value to style

Measured on Motion 13.4 (spike S3, Chromium and WebKit): bound through `style`, a scroll-linked `opacity`, `clipPath`,
`filter`, `backgroundColor` or `transform` is handed to a native scroll timeline when `useScroll` has no target or uses
one of its preset offsets. Motion passes `useTransform`'s input range through as keyframe offsets with nothing at 0 and
1, so outside the range the element drifts back to its first-render value: an opacity that should hold at 1 fades back
to 0, pinned or not. Padding the input to `[0, …, 1]` fixes the ends, but the preset ranges still match Motion's own
maths for only one element size. `x`, `y` and `scale` are never handed over, but they run on the main thread every
frame ([performance.md](performance.md) §4).

So write every scroll-linked style by hand.

## 5. Writing by hand

```tsx
const reduced = useReducedMotionLive()
useMotionValueEvent(scrollYProgress, 'change', (p) => {
  const el = ref.current
  if (!el) return
  // Reduced motion writes the settled state, never the last frame.
  el.style.opacity = reduced ? '1' : String(Math.min(1, Math.max(0, (0.35 - p) / 0.25)))
  el.style.transform = reduced ? 'none' : `translate3d(0, ${-40 * p}px, 0)`
})
```

- Per-frame paths write styles and refs, never React state. State changes per transition (a mode, an act), which
  costs one render instead of sixty a second.
- Write one composed `transform` string, never separate `x` and `y`.
- A change of the reduced-motion setting fires no scroll event, so write the settled state from an effect on
  `reduced` too. The scene blocks re-derive everything on that change.
- The blocks read scroll this way: `usePinnedScene`'s `onProgress` ([scenes.md](scenes.md) §6). Hand writers that
  share nothing but this rule stay separate, with a comment at each ([craft.md](craft.md) §11).

## 6. Motion under Lenis

```tsx
import { cancelFrame, frame } from 'motion/react'
import { SmoothScroll } from './smooth/SmoothScroll'
import { motionDriver } from './smooth/lenis'

const driver = motionDriver(frame, cancelFrame)          // module scope: the driver is read once

<SmoothScroll authority="lenis" driver={driver}>{children}</SmoothScroll>     // in the route group's layout
```

- **Lenis never runs its own loop**; the driver is its clock. `motionDriver` runs Lenis in Motion's `frame.setup`
  step and dispatches a window `scroll` event on each Lenis scroll, so `useScroll` measures in the same frame: 0
  frames late in Chromium and WebKit (spike S4b).
- **Not `frame.update`.** Motion re-measures `useScroll` only on a window `scroll` event, which the browser dispatches
  in the frame after Lenis scrolls, so Lenis driven from `frame.update` leaves every `useScroll` value one frame
  behind.
- The recipe relies on how Motion 13 measures scroll. Check it again when Motion changes major version.
- Lenis moves the real scroll position, so `useScroll` needs no `container` under it.
- **One driver per page.** A route whose scenes run on GSAP drives Lenis from GSAP's ticker instead
  ([scroll-authority.md](scroll-authority.md) §6). Its Motion entrances ride IntersectionObserver and don't depend on
  the tick; values that must line up on screen come from one engine.

## 7. Without React: inView, scroll, animate

```ts
import { inView, scroll } from 'motion'
import { animate } from 'motion/mini'
import { CURVES, MOTION, TRIGGERS } from './config'

const stop = inView('.card', (el) => {
  animate(el, { opacity: [0, 1] }, { duration: MOTION.entrance.duration, ease: CURVES.entrance })
}, { margin: TRIGGERS.reveal })
const cancel = scroll((progress) => { bar.style.transform = `scaleX(${progress})` })
```

- **An entrance on a page with no engine is `mountReveals`** ([entrances.md](entrances.md) §2): it brings the gate,
  the failsafe, replay and live reduced motion, which a bare `inView` call doesn't. Keep `inView` for a one-off.
- `inView(target, onStart, { root, margin, amount })` returns a stop function, and a function returned from `onStart`
  runs when the element leaves. Same rule as the blocks: a `margin` line, and `amount` left at its default, `"some"`,
  on anything that can be taller than the viewport.
- `scroll(onScroll, { target, offset, container, axis })` hands you progress: write the style by hand (§5).
- `animate` from `motion/mini` animates HTML and SVG styles through the browser's own animation engine, and is the
  smallest build. `animate` from `motion` adds independent transforms (`x`, `y`), CSS variables, SVG paths, sequences
  and plain objects (Motion's docs).
- There is no `MotionConfig` here: read `prefersReducedMotion()` from `config.ts` each time, never cached.

## 8. Layout and view transitions

- `layout` and `layoutId` (shared-element motion inside a page) need `domMax` (§1).
- Motion 13.4 adds `AnimateView` (`import { AnimateView } from 'motion/react-animate-view'`, React 19.3 or later),
  which animates React's view transitions: enter, exit, share and update.
- **Never `AnimatePresence` across App Router routes.** The router renders layouts and pages as separate server
  subtrees, so no one client component owns the route key that exit animations need. Keep it for presence inside a
  page: a panel, a list item.
- The pack has no page-transition block yet. Route changes follow [scroll-authority.md](scroll-authority.md) §8.

## 9. Hide and show

Next.js with Cache Components hides visited routes in `<Activity>`: the DOM stays, and effects clean up on hide and run
again on show.

- Build everything in effects (`useMotionValueEvent` subscribes in one) and undo it in their cleanup. Nothing but
  constants lives at module scope.
- Motion replays an element's current variant when it shows again, so a finished entrance should rest in a variant
  that moves nothing, as `Reveal`'s `settled` does ([entrances.md](entrances.md) §10).
- A hidden `<video>` keeps playing: the video blocks pause it in their cleanup ([video.md](video.md) §16).
- `SmoothScroll` destroys its Lenis in its cleanup, so a hidden route keeps no instance and no stale stamp.

## Traps

- [ ] `m.*` under `LazyMotion strict`, never `motion.*` (§1).
- [ ] Reduced motion is read live (`useReducedMotionLive`) wherever code decides what moves, and every hand writer
      renders a settled state (§2, §5).
- [ ] No scroll-linked value bound to `style` (§4).
- [ ] `useScroll` measures the range wrapper; offsets and margins are module constants (§3).
- [ ] Smooth once: raw `useScroll` under Lenis, a spring only on native routes, no spring feeding a threshold (§3).
- [ ] A Motion route under Lenis uses `motionDriver`: never Lenis on its own loop or on `frame.update` (§6).
- [ ] No React state per frame, and no hook inside `.map()`: it only works while the array's length never changes.
      Extract the child component.
- [ ] No `AnimatePresence` across App Router routes (§8).
