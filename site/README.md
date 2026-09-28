# site

The scroll-animation skill's storefront, and its vanilla GSAP + ScrollSmoother example: a Vite multi-page site in
plain TypeScript, no framework. The copy is placeholder facts about the skill; the design pass comes later.

| Page | Profile | Scroll authority | What moves |
|---|---|---|---|
| `/` (`index.html`) | Expressive | ScrollSmoother (`smooth: 1, effects: true`), the fixed header outside `#smooth-wrapper` | the hero headline split into words at build time, the four clocks on a pin ScrollTrigger holds, the engine-map rail, `data-speed` / `data-lag` orbs, split-reveal headings, reveal copy, count-ups, header ink |
| `/guide/` (`guide/index.html`) | Reading | native | reveal copy, one split-reveal heading, a reading-progress bar and a parallax figure on CSS timelines, header ink |

## Commands

```bash
pnpm install
pnpm dev      # http://localhost:5173
pnpm build    # tsc, then vite build into dist/
pnpm check    # after pnpm build: the checks in Chromium, WebKit and Firefox against vite preview
```

## Animation blocks

`src/animation/` holds what the skill's CLI copied, with each file's hash in
`src/animation/.scroll-animation.lock.json`. Add and update blocks with the CLI, never by hand:

```bash
node ../skills/scroll-animation/bin/scroll-animation add gsap-setup base-css smooth-smoother pinned-scene horizontal-rail reveal split-reveal mount --engine gsap
node ../skills/scroll-animation/bin/scroll-animation add split-words count-up header-theme scroll-effects --engine agnostic
```

The site only wires them:

- `src/pages/home.ts` and `src/pages/guide.ts` start each page's scroll authority (`createSmoother`, or
  `nativeHandle` for the stamp), mount the header's ink on the fixed header, and hand the route's `<main>` to
  `mount()` (`gsap/mount.ts`), which creates every block from the markup in page order and returns the route's
  cleanup.
- `src/pages/clocks.ts` is the four-clocks scene: `pinnedScene(root, { pin: 'gsap' })` driving one paused timeline
  with a named span per clock, built per matchMedia build so reduced motion is live.
- `plugins/animation-html.ts` writes `GATE_SCRIPT` into every page's `<head>` and replaces
  `<h1 data-split-words>text</h1>` with `splitWordsHTML`'s markup, so the headline's words are in the served HTML.
- `src/styles/home.css` and `src/styles/guide.css` import `css/animation.css` first, then each block's stylesheet,
  then `site.css`. `/` leaves out `css/scroll-effects.css`: CSS timelines never progress under ScrollSmoother.
- `vite.config.ts` ships the blocks' CSS unminified (comments stripped): Vite 8's default minifier, Lightning CSS,
  folds `transform: none; translate: none; scale: none` into one `transform` and rewrites `:dir(rtl)` as `:lang()`.
- `window.__site` (`src/pages/debug.ts`) holds each page's authority, what every block returned, `mount`,
  `ScrollTrigger` and the route's cleanup, for devtools and the checks.

## Checks

`checks/run.mjs` serves `dist/` with `vite preview` and drives both pages: each page's
`html[data-scroll-authority]`; the headline split in the served HTML and no layout shift during load; the clocks'
timeline rising through its pin; the rail's track moving its whole travel; every entrance, split heading and
count-up landing after a scroll through; the header's ink at every stop; reduced motion at load and switched on
live; JavaScript off; and `mount()`'s creation order, double mount, cleanup and teardown mid-page.
`node checks/run.mjs --browsers chromium --only scene,rail` runs a subset.
