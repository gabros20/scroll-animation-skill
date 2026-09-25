# gsap: the GSAP blocks

Plain TypeScript for GSAP pages: Vite, Astro, a static page, or React through `useGSAP`. Each v2 block is a function
`(element, options)` that returns a handle with `destroy()`. Built on GSAP 3.15, where every plugin is free.
`scroll-animation add <block>` copies a block with what it requires into `src/animation/`, in this layout.

## Setup

1. `npm i gsap` (and `@gsap/react` in React).
2. Call `setupGsap()` (`setup.ts`) once, client-side, before any block runs. It registers ScrollTrigger and the
   measured eases, turns on `ignoreMobileResize` (an iOS toolbar isn't a layout change) and marks the engine ready.
3. Import `css/animation.css`, then `css/scene.css` for pinned scenes, then `css/animation.gsap.css` only with the v1
   entrance blocks below (`../css/README.md`).
4. Mount per route: in React inside `useGSAP(() => …, { scope })`, on a vanilla page inside the route's
   `mount(routeRoot)`, and call `destroy()` when the route goes away or is hidden.

## The v2 blocks

| File | Block | Call | Reference |
| --- | --- | --- | --- |
| `pinned-scene.ts` | `pinned-scene` | `pinnedScene(root, options)`: exact progress, head/scrub/tail modes, acts made `inert`; `pin: 'gsap'` under ScrollSmoother | `references/scenes.md` |
| `scrub-video.ts` | `scrub-video` | `scrubVideo(root, options)`: a pinned scene plus the video controller, camera and backdrop | `references/video.md` |
| `frame-sequence.ts` | `frame-sequence` | `frameSequence(canvas, { manifest, trigger })` or `{ manifest, progress: () => p }` | `references/sequences.md` |
| `loop-video.ts` | `loop-video` | `loopVideo(video, options)`, or `initLoopVideos(root)` over `[data-loop-video]`, with a WCAG 2.2.2 pause control | `references/video.md` |
| `setup.ts` | `gsap-setup` | `setupGsap({ plugins })`, `MOTION_CONDITIONS`, `CONDITIONS`, `EASES` | `references/scroll-authority.md` |

The engine-agnostic cores they drive sit one level up: `scene.ts`, `media/video-controller.ts`, `media/camera.ts` and
`media/frame-sequence.ts`, shared with the Motion blocks.

- **Build ScrollTriggers on `MOTION_CONDITIONS` only.** When a `gsap.matchMedia` condition changes, GSAP 3.15 leaves
  the page at scroll 0, so the breakpoint never goes in the conditions of a build that creates triggers; branch on
  `isDesktop()` inside it. Create scenes outside your own `matchMedia` callbacks.
- **Create scenes in page order** (or give `refreshPriority`), so ScrollTrigger refreshes them top to bottom.
- **Scenes read a ScrollTrigger with no pin** on the range wrapper, which matches the wrapper's rect maths once
  refreshed (spike S5), and keep it fresh with one shared ResizeObserver on `<body>`. On a ScrollSmoother page, where
  CSS sticky can't work, pass `pin: 'gsap'` and ScrollTrigger pins instead.
- **Reduced motion is live**: scenes rebuild through `gsap.matchMedia(MOTION_CONDITIONS)`; the frame sequence and the
  loop follow the media query themselves.
- **One scrubbed video live per page** (`references/performance.md` §3): a decoder seeking on nearly every scroll
  frame, plus a per-frame loop while awake. Two acts that want two clips usually belong on one range wrapper, with
  loops as sub-ranges of one continuous clip.

The reference build's camera numbers are not shipped: `camera` defaults to identity (a plain covering video). Measure
your own (`references/scenes.md` §7, `references/video.md` §15).

## The v1 attribute blocks

`initFluidMotion(root, { countUp?, headerTheme? })` (`index.ts`) wires the v1 attribute blocks found under `root`:
stages and the veil (`data-stage*`), count-ups (`data-count-up`), exit fades (`data-fade-on-exit`), the scroll well
(`data-pull-to-centre`), v1's background loop (`inViewLoopVideo.ts`) and, when asked, the header theme. It is
idempotent per root, so an HMR accept handler can call it again, and returns `{ destroy(), refresh() }`; `refresh()`
doesn't reach pinned scenes, whose handles have their own. Call the individual `init*` exports when a page needs one
block.

Don't run `initFluidMotion` and `initLoopVideos` on one root: both wire every `[data-loop-video]`, so each video would
get two controllers. Until v1's loop leaves the barrel, call the v1 `init*` functions you need one by one instead.

The attributes are in `references/attribute-contract.md` §3. Two things `animation.gsap.css` can't do for you:

- **The load veil needs a background.** `[data-stage-veil]` is positioned and opaque but paints nothing, since the
  colour is a page decision; without one the flash it exists to prevent is back.
- **Centre a stage item with `translate`, not `transform`.** Every `[data-variant]` rule sets `transform`, so a
  `transform: translateX(-50%)` on the same element is overwritten by the hidden state and again by the tween;
  `translate: -50% 0` composes with it.

## Differences from the Motion blocks

- **No spring plugin.** `MOTION.indicator` (a spring in Motion) is approximated with `power3.out` at the same
  duration: retune it by ear; it isn't a measured fit like the three CustomEases.
- **Scroll-linked values are written by hand** in both engines. The promotion bug that makes it necessary is
  Motion-specific (GSAP never hands scroll-linked values to a native timeline), but one pattern in both engines keeps
  one mental model.
