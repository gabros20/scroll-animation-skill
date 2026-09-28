# css: the skill's stylesheets

`scroll-animation add` copies these to `src/animation/css/` with the blocks that need them. Keep the file names: the
references, the block comments and the audit name them.

| File | Block | For | What it holds |
|---|---|---|---|
| `animation.css` | `base-css` | every project, both engines | the pre-JS gate and its 4 s failsafe, Lenis's rules, `scroll-padding-top` from `--header-h` (no global `scroll-behavior`), print, the typed properties `--fill` and `--scene-p` |
| `scene.css` | `scene-css` | any pinned scene (`PinnedScene`, `pinnedScene`, `ScrubVideo`, `scrubVideo`) | the `data-scene-*` geometry (the sticky `100lvh` pin, the content pulled back over it, the media, the gutter, stacked acts), its reduced-motion collapse and print |
| `reveal.css` | `reveal` | entrances in every engine (`Reveal`, `reveal()`, `mountReveals()`) | the hidden resting state of `data-reveal-item` under the gate, one per effect (rise, fade, clip, scale-in), the shown state and its transition, the load veil, reduced motion |
| `split.css` | `split-words` | `SplitWords`, `splitWordsHTML()` | the word keyframes, running from the first frame with no gate and no script, the per-word delay from `--i`, reduced motion (no animation) and print |
| `scroll-effects.css` | `scroll-effects` | `data-scroll-fx`: decoration on CSS scroll and view timelines, no engine | parallax, fade-in, exit fade, scale-in, a reading-progress bar, a sticky stack and a time-driven marquee, composable on one element and tuned with `--fx-*`. The static state is the finished one: Firefox, reduced motion, print and ScrollSmoother pages show it |
| `header-theme.css` | `header-theme` | `mountHeaderTheme`, `useHeaderTheme` | the header's ink transition (none under reduced motion) and the opt-in blend variant, reset under forced colours |
| `rail.css` | `horizontal-rail` | `horizontalRail()` | the track's row of panels on its own layer, the native snap scroller that replaces the slide under reduced motion, and print |
| `animation.gsap.css` | `gsap-css` | the v1 GSAP entrance blocks | the pre-JS resting state of the `data-stage-*` attributes, so nothing flashes before the blocks run |

Import them once, after the reset (and after fluid-design's `fluid.css` when the project has it), `animation.css`
first:

```ts
// app/layout.tsx (Next), or main.ts (Vite)
import '@/animation/css/animation.css'
import '@/animation/css/reveal.css'
import '@/animation/css/split.css'
import '@/animation/css/scroll-effects.css'
import '@/animation/css/header-theme.css'
import '@/animation/css/scene.css'
import '@/animation/css/animation.gsap.css'   // only with the v1 GSAP entrance blocks
```

`GATE_SCRIPT` (from `config.ts`) goes in the document `<head>`, not in a stylesheet: it has to apply even when these
files never load. So does the `<noscript>` rule in `animation.css`'s comments, needed only with the v1 Stage.
