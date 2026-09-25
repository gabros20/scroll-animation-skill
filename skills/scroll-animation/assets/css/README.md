# styles/animation — the scroll-animation skill's CSS

Copy this folder to `src/styles/animation/` (next to fluid-design's generated
`src/styles/fluid/`), the same place in every project. Keep the file names:
the skill's references, comments and the audit name them.

| File | For | What it holds |
|---|---|---|
| `animation.css` | every project, both engines: the one import | `scroll-behavior: smooth` (off under reduced motion), the reduced-motion collapse of every scroll scene, `@property --fill` / `--scene-p` |
| `animation.gsap.css` | GSAP projects only (delete it for React) | the pre-JS resting state of every `data-stage-*` / `data-scrub-*` attribute, so nothing flashes before `initFluidMotion()` |

Import order, after fluid-design's `fluid.css` and before the page's own CSS:

```css
/* globals.css — Tailwind v4 (React + Motion) */
@import 'tailwindcss';
@import '../styles/fluid/fluid.css';
@import '../styles/animation/animation.css' layer(base);
```

```ts
// main.ts — GSAP (Vite, plain CSS or SCSS)
import './styles/fluid/fluid.css'
import './styles/animation/animation.css'
import './styles/animation/animation.gsap.css'
```

Or with `<link>`: the same files in the same order, before any page content.
The `<noscript>` rule goes in the document `<head>`, not here (`SKILL.md` §3).
