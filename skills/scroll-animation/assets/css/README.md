# css: the skill's stylesheets

`scroll-animation add` copies these to `src/animation/css/` with the blocks that need them. Keep the file names: the
references, the block comments and the audit name them.

| File | Block | For | What it holds |
|---|---|---|---|
| `animation.css` | `base-css` | every project, both engines | the pre-JS gate and its 4 s failsafe, Lenis's rules, `scroll-padding-top` from `--header-h` (no global `scroll-behavior`), print, the typed properties `--fill` and `--scene-p` |
| `scene.css` | `scene-css` | any pinned scene (`PinnedScene`, `pinnedScene`, `ScrubVideo`, `scrubVideo`) | the `data-scene-*` geometry (the sticky `100lvh` pin, the content pulled back over it, the media, the gutter, stacked acts), its reduced-motion collapse and print |
| `animation.gsap.css` | `gsap-css` | the v1 GSAP entrance blocks | the pre-JS resting state of the `data-stage-*` attributes, so nothing flashes before the blocks run |

Import them once, after the reset (and after fluid-design's `fluid.css` when the project has it), `animation.css`
first:

```ts
// app/layout.tsx (Next), or main.ts (Vite)
import '@/animation/css/animation.css'
import '@/animation/css/scene.css'
import '@/animation/css/animation.gsap.css'   // only with the v1 GSAP entrance blocks
```

`GATE_SCRIPT` (from `config.ts`) and the `<noscript>` rule for Motion pages go in the document `<head>`, not in a
stylesheet: they have to apply even when these files never load.
