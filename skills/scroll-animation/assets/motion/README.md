# react-motion

A React + [Motion](https://motion.dev) (`motion/react` v12) primitive set for
two timing models: a TRIGGERED page-load/reveal system (`Stage`), and a
SCRUBBED scroll-driven scene (`ScrubStage`). Ported from a production build,
generalised so any project can drop it in — every measured constant that was
previously hardcoded is now a prop with the measured value as its documented
default.

## Install

```
npm i motion@^12 react@^19 react-dom@^19
```

TypeScript project settings this folder assumes: `strict: true`,
`jsx: "react-jsx"`, `moduleResolution: "bundler"` (or `node16`/`nodenext`).

Copy the whole `motion/` folder into your project — every import inside
it is relative, so it has no dependency on a particular path alias or
bundler. If your project also has the `fluid-design` skill installed, its
Tailwind package ships a `cn` you can swap in for `lib/cx.ts`'s bare joiner
— see **Styling** below.

## Install map — file → job

```
components/
  MotionProvider.tsx   Mount ONCE near the root. LazyMotion + MotionConfig +
                        BreakpointProvider.
  Stage.tsx             Stage / StageItem / StageVeil — the triggered
                        entrance system. Default for ~everything.
  CountUp.tsx            A number that counts up on first sight.
  FadeOnExit.tsx         Fades a group out as it scrolls off — pairs with
                        ScrubStage for copy riding over a pinned render.
  PullToCentre.tsx       A continuous scroll attractor toward centring its
                        parent. Optional; mount as the parent's first child.
  ScrubStage.tsx          The one scroll-driven primitive: a pinned,
                        loop-scrub-loop background video. See the ONE-scene
                        rule below.
  InViewLoopVideo.tsx     A plain in-view background loop (no scrub) — starts
                        on view, pauses off-screen, optional intro-then-seam
                        loop policy.
  index.ts                Barrel export.

lib/
  transitions.ts    Named Transition tokens (durations/eases), several
                     measured against a motion reference capture.
  variants.ts        Entrance Variants (drop/settle/lift/liftFade/growY/growX)
                     + the load-veil's inverted variant.
  triggers.ts         The three IntersectionObserver rootMargin strings and
                     why they differ (mid-page / page-end / at-rest).
  scroll.ts            The one shared scroll spring config + the
                     `ScrollOffset` type Motion doesn't export.
  scrollPull.ts        `createScrollPull` — the imperative engine behind
                     `PullToCentre`. Read this before retuning anything.
  videoController.ts    Imperative <video> hardening (decoder priming, guarded
                     seeking, Safari play-watchdog). Used internally by
                     ScrubStage's pattern; usable standalone for a simpler
                     scrub without loops.
  breakpoints.tsx       `useBreakpoint()` for STRUCTURAL variant differences
                     only — a value difference belongs in a CSS custom
                     property, not here.
  constants.ts          `ENGAGE_QUERY` — the one breakpoint every primitive
                     agrees on. See Peer concepts below.
  cx.ts                  Dependency-free class joiner. Swap for the
                     `fluid-design` skill's Tailwind `cn` if you have it —
                     see Styling.

hooks/
  useHeaderTheme.ts   Resolves a fixed header's ink from whichever
                      `data-header-theme` section is currently under it.
  header-theme.ts      The `HeaderTheme` type + `THEME_FADE` transition class.

examples/
  TriggeredSection.tsx  A server-component section using Stage/StageItem with
                        a line stagger and CSS-var distances.
  ScrollStack.tsx        A ScrubStage with two copy acts and a spacer act,
                        demonstrating the N=4-viewports-for-thirds rule.
```

## Mount `MotionProvider` once

```tsx
// app/layout.tsx (or your framework's root layout)
import { MotionProvider } from './motion/components'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  )
}
```

## The `<noscript>` rule — required once, at the root

`StageItem` server-renders its `hidden` variant styles (opacity 0 / an
offset), so JavaScript is what reveals it. Without this rule, a visitor with
JS disabled sees every `StageItem` frozen invisible forever:

```tsx
<noscript>
  <style>{`[data-stage-item]{opacity:1!important;transform:none!important}`}</style>
</noscript>
```

Put it once, near the top of the document (root layout / `<head>`), not per
component. `StageVeil` carries its own equivalent `<noscript>` rule inline —
nothing extra needed for that one.

## The ONE-scroll-scene rule

`ScrubStage` is expensive by design: a decoder that scrub-seeks on nearly
every scroll frame, plus a per-frame rAF/`requestVideoFrameCallback` loop
while it is awake. It gates itself hard (nothing runs off-screen, nothing
fetches until warmed), which is what makes ONE instance affordable — but nest
or stack two of them live at once and you are running two decoders and two
per-frame loops simultaneously, which is not what the gating was built to
survive.

**Use at most one `ScrubStage` live per page.** Everything else — every other
reveal, every other background loop — should be `Stage`/`StageItem` (triggered)
or `InViewLoopVideo` (a plain in-view loop, no scrub). Reach for a second
scrubbed scene only if you are prepared to re-derive the "one well at a time"
style ownership token `scrollPull.ts` uses for `PullToCentre`, applied to
decoders instead of scroll writes — nobody has needed to yet.

## Styling

These primitives do not depend on Tailwind. `Stage`/`StageVeil` accept a
`className` and merge nothing themselves — pass whatever your stack uses.
Distances that need to vary per breakpoint (`--hero-drop`, `--hero-lift`,
`--exit-from`/`--exit-to`, `--header-theme`) are read from computed style via
`getComputedStyle(el).getPropertyValue(...)`, so ANY mechanism that lands a
CSS custom property on the element works — a Tailwind arbitrary-value
utility (`lg:[--hero-lift:32px]`), a CSS module, or a plain `style` attribute
with a media query in your own stylesheet.

If your project has the `fluid-design` skill (`assets/styles/tailwind-v4/`
there), swap `lib/cx.ts`'s import for its `cn.ts` in any file that imports
`cx` — that version additionally resolves Tailwind-class conflicts (e.g. two
`fluid-p-*` utilities on one element) correctly, which the bare joiner here
does not attempt.

`ScrubStage`'s own pin geometry (`position: sticky`, `height: 100lvh`, the
matching `-mt-[100lvh]`) is written as inline styles, not utility classes —
that geometry is load-bearing and framework-agnostic, so it ships regardless
of what styling system the host project uses.

## `ScrubStage` — bringing your own asset

Every measured constant from the reference build is now a prop with that
measured value as its default (`fps`, `headLoop`, `tailLoop`, `headHoldPx`,
`tailLeadPx`, `hysteresisRatio`, `warmMarginPx`, `wakeMarginPx`, `glide`,
`backdropStops`). Re-measure them for YOUR clip — they will not generally be
correct for someone else's:

1. **Re-encode all-intra.** Scrubbing seeks on nearly every frame; a
   long-GOP master decodes up to a GOP's worth of frames per seek.
   ```bash
   ffmpeg -i in.mp4 -c:v libx264 -preset slow -crf 22 \
     -x264-params "keyint=1:min-keyint=1:scenecut=0" \
     -pix_fmt yuv420p -movflags +faststart -an out.mp4
   ```
2. **Find your loop seams** (if you want head/tail loops rather than plain
   hold-on-first/last-frame): compare candidate frames by PSNR against your
   intended loop start; the frame that scores far above its neighbours is
   your match frame. Set `headLoop={{ fromFrame, matchFrame }}` and
   `tailLoop={{ fromFrame }}` — the tail's match frame is always the clip's
   own last frame, read from `video.duration` at runtime.
3. **Optionally build a `camera`.** Omit it for a plain `object-cover` scrub
   (no pan/zoom — often enough). To pan/zoom, cut your asset from one square
   canvas at two crops (`desktop`/`mobile`), and supply where your subject
   sits in each crop (`subject`) and where it should land on screen at each
   end of the pan (`shots`), plus the base on-screen size (`frameSize`, in a
   multiple of viewport height — height-driven, not width-driven, because
   viewports vary far more in aspect than in height). See the JSDoc on
   `CameraConfig` in `components/ScrubStage.tsx` for the full derivation.
4. **Sample your own backdrop ramp** (`backdropStops`) from your asset's top
   and bottom edges — it is only a backstop for the paint before the first
   camera frame, but should roughly match so that backstop isn't jarring.

## Peer concepts this kit assumes

- **The fluid scale** (`--fluid` and friends) — `scrollPull.ts` spends its
  reference-px tuning numbers multiplied by this unit, and falls back to a
  flat `1` when `--fluid` is absent, so this kit works without it. If the
  project has it, see the `fluid-design` skill (`references/fluid-scale.md`).
- **`ENGAGE_QUERY`** (`lib/constants.ts`) — if the project has `fluid-design`
  v2 installed, import `DESKTOP_QUERY` (its `ENGAGE_QUERY` alias) from the
  generated `fluid.ts` in the fluid output folder instead (e.g.
  `'@/styles/fluid/fluid'`), so this matches `fluid.config.json`'s
  `bands.desktop.minWidth`; otherwise set it to your desktop breakpoint.
  Whatever the source, it should also match whatever token your CSS calls the
  same width (Tailwind's `lg` in the reference build).
