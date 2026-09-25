# motion: the Motion (React) blocks

React 19 and Motion 13 (`motion/react`). `scroll-animation add <block>` copies a block and what it requires into
`src/animation/` in this layout; every import is relative, so no path alias or bundler setting is needed.

## Setup

1. `npm i motion react react-dom`. The TypeScript settings assumed: `strict`, `jsx: "react-jsx"`,
   `moduleResolution: "bundler"`.
2. Mount `MotionProvider` (`MotionProvider.tsx`, the `motion-provider` block) once near the root. It runs
   `LazyMotion strict`, so blocks render `m.*` and a stray `motion.*` throws instead of silently loading the full
   bundle; `MotionConfig reducedMotion="user"`; and it marks the engine ready, which switches off the CSS failsafe.
3. Import `css/animation.css`, and `css/scene.css` for pinned scenes (`../css/README.md`). The `<noscript>` rule for
   server-rendered hidden states is in `animation.css`'s comments; it belongs in `<head>`.

## The v2 blocks

| File | Block | What it is | Reference |
| --- | --- | --- | --- |
| `usePinnedScene.ts`, `PinnedScene.tsx` | `pinned-scene` | the range wrapper, sticky pin and content layer: exact progress and band (MotionValues; `pinned` can be a render function of them), head/scrub/tail modes, acts made `inert`, rehydrate from scroll; also `useReducedMotionLive()` | `references/scenes.md` |
| `ScrubVideo.tsx` | `scrub-video` | a scrubbed all-intra video on `PinnedScene`, with loops or holds, a camera and a backdrop | `references/video.md` |
| `FrameSequence.tsx` | `frame-sequence` | an image sequence on a canvas, fed a MotionValue or a number | `references/sequences.md` |
| `LoopVideo.tsx` | `loop-video` | an in-view background loop with a WCAG 2.2.2 pause control | `references/video.md` |

The engine-agnostic cores they drive sit one level up: `scene.ts`, `media/video-controller.ts`, `media/camera.ts` and
`media/frame-sequence.ts`, shared with the GSAP blocks. Each of these blocks:

- **reads scroll by hand** (`useMotionValueEvent`) and never binds a scroll-linked value to `style`: Motion 13.4 hands
  a bound value to a native timeline whose keyframes stop at the input range (spike S3);
- **sets React state per transition, never per frame**: per-frame paths write refs and styles;
- **reads reduced motion live**, because Motion 13.4's `useReducedMotion()` reads it once per mount;
- **is hide/show safe**: built in effects and torn down in their cleanup, which Next's `<Activity>` runs on hide;
  videos pause there.

**One scrubbed video live per page** (`references/performance.md` §3): its decoder seeks on nearly every scroll frame
while awake. Everything else is a triggered entrance or a `LoopVideo`.

The reference build's camera numbers are not shipped: `camera` defaults to identity (a plain covering video). Measure
your own (`references/scenes.md` §7, `references/video.md` §15).

## The v1 components

`components/` (with `lib/` and `hooks/`) holds the v1 blocks the pack still ships: `Stage`, `StageItem` and `StageVeil`
(triggered entrances), `CountUp`, `FadeOnExit` (exit fades for copy riding over a pin), `PullToCentre` (the scroll
well) and `useHeaderTheme`. Its `MotionProvider` and `InViewLoopVideo` are v1's, replaced by `MotionProvider.tsx` and
`LoopVideo.tsx` above. The v1 blocks read their breakpoint from `lib/constants.ts` (`ENGAGE_QUERY`): point it at the
same source as `config.ts` (`references/preflight.md` §3.6).

`examples/ScrollStack.tsx` is a `ScrubVideo` with two one-viewport copy acts around a two-viewport spacer: N = 4, which
puts the tops of its three acts at progress 0, ⅓ and 1, on thirds (`references/scenes.md` §2).

## Styling

The blocks don't depend on Tailwind: `PinnedScene` takes `pinClassName` and `contentClassName` (and any div prop on
the root), `ScrubVideo` takes `videoClassName`, `LoopVideo` takes `className` and `toggleClassName`. The scene geometry
itself lives in `css/scene.css`, not in class names, so it ships whatever the host styles with. Distances that vary per
breakpoint (`--hero-lift`, `--exit-from`, `--exit-to`) are read from computed style, so any way of landing a custom
property on the element works. With fluid-design installed, its Tailwind `cn` can replace `lib/cx.ts`'s bare joiner.
