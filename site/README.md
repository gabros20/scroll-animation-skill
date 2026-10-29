# site

The scroll-animation skill's storefront, and its vanilla GSAP + ScrollSmoother example: a Vite multi-page site in
plain TypeScript, no framework. The copy is placeholder facts about the skill; the design pass comes later.

| Page | Profile | Scroll authority | What moves |
|---|---|---|---|
| `/` (`index.html`) | Expressive | ScrollSmoother (`smooth: 1, effects: true`), the fixed header outside `#smooth-wrapper` | the hero headline split into words at build time, the five clocks on a pin ScrollTrigger holds, the engine-map rail, `data-speed` / `data-lag` orbs, split-reveal headings, reveal copy, count-ups, header ink |
| `/guide/` (`guide/index.html`) | Reading | native | reveal copy, one split-reveal heading, the five clocks as scrolly steps beside a sticky panel, a reading-progress bar and a parallax figure on CSS timelines, header ink |

Navigating between the two pages is a cross-document view transition: the page crossfades under the anchored header, typed `forward` on a link and `back` on the back button (Chromium, Safari; Firefox just loads the page).

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
node ../skills/scroll-animation/bin/scroll-animation add view-transitions scrolly-steps --engine agnostic
```

The site only wires them:

- `src/pages/home.ts` and `src/pages/guide.ts` start each page's scroll authority (`createSmoother`, or
  `nativeHandle` for the stamp), mount the header's ink on the fixed header, and hand the route's `<main>` to
  `mount()` (`gsap/mount.ts`), which creates every block from the markup in page order and returns the route's
  cleanup.
- `src/pages/transitions.ts` runs `mountCrossDocumentTransitions()` on both pages from a
  `<script type="module" blocking="render">`, so the direction is set before the first frame. Vite folds
  every module script of a page into one entry and drops the attribute, so `plugins/render-blocking.ts` builds
  it as an entry of its own and writes the tag back; `vite.config.ts` keeps what it imports (config,
  `smooth/authority.ts`, `view-transitions.ts`, 1.3 kB gzipped) out of the GSAP-importing `animation` chunk.
- `src/pages/clock-steps.ts` is `/guide/`'s scrolly section: the agnostic core picks the step, `guide.css`
  colours its clock from `data-scrolly-active`, and a paused GSAP timeline slides the marker to it (desktop,
  no reduced motion).
- `src/pages/clocks.ts` is the five-clocks scene: `pinnedScene(root, { pin: 'gsap' })` driving one paused timeline
  with a named span per clock, built per matchMedia build so reduced motion is live.
- `plugins/animation-html.ts` writes `GATE_SCRIPT` and the cross-document opt-in (`css/view-transitions-mpa.css`,
  inline: Chromium skipped about half the transitions into `/` with it only in the bundled stylesheet) into every
  page's `<head>`, and replaces
  `<h1 data-split-words>text</h1>` with `splitWordsHTML`'s markup, so the headline's words are in the served HTML.
- `src/styles/home.css` and `src/styles/guide.css` import `css/animation.css` first, then each block's stylesheet,
  then `css/view-transitions.css` on both, then `site.css`. `/` leaves out
  `css/scroll-effects.css`: CSS timelines never progress under ScrollSmoother.
- `vite.config.ts` ships the blocks' CSS unminified (comments stripped): Vite 8's default minifier, Lightning CSS,
  folds `transform: none; translate: none; scale: none` into one `transform` and rewrites `:dir(rtl)` as `:lang()`.
- `window.__site` (`src/pages/debug.ts`) holds each page's authority, what every block returned, `mount`,
  `ScrollTrigger` and the route's cleanup, for devtools and the checks.

## Checks

`checks/run.mjs` serves `dist/` with `vite preview` and drives both pages: each page's
`html[data-scroll-authority]`; the headline split in the served HTML and no layout shift during load; the clocks'
timeline rising through its pin; the rail's track moving its whole travel; every entrance, split heading and
count-up landing after a scroll through; the header's ink at every stop; reduced motion at load and switched on
live; JavaScript off; `mount()`'s creation order, double mount, cleanup and teardown mid-page; the
cross-document transitions (their types, the anchored header, ScrollSmoother at rest on arrival, the guide where it
was left on the way back); and the scrolly section (each step's clock, a reload seeking, reduced motion, stacked on a
phone).
`node checks/run.mjs --browsers chromium --only scene,rail` runs a subset.
