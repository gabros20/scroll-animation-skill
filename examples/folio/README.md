# Folio

The `scroll-animation` skill's example site: a fictional editorial journal, not a real
publication. Art direction, page plans and the media shot list are in
[`docs/designs/folio-art-direction.md`](../../docs/designs/folio-art-direction.md); the plan that
scoped this skeleton is `.orchestrate/briefs/task-8-folio.md` at the repo root.

Three profiles, one route each: `/` (Expressive), `/journal` + `/journal/[slug]` (Reading),
`/lab` (Immersive), plus `/blocks`, the block catalogue and fixture host.

The animation foundation is wired in (the pre-JS gate, the base stylesheet, the Motion provider
and each route's scroll authority), and so are the scene, media, entrance and text blocks: on `/`
the split headline, the pinned scrub scene, the horizontal rail, the sticky stack under the header's
ink; in the journal the card and body entrances, the reading-progress bar, the parallax figure and
the loop videos; a fixture per block on `/blocks`. Every place a later block will attach is marked
with a `{/* scroll-animation: ... */}` comment naming the block and the phase that adds it.

## Commands

```bash
pnpm install
pnpm dev      # http://localhost:3000
pnpm build
pnpm media    # fetch public/media/ from the media-v1 release; run it before pnpm build
pnpm lint
pnpm check:authority   # after pnpm build: each route's scroll authority, Chromium + WebKit
pnpm verify:scenes     # the motion on /, the article and /blocks, Chromium + WebKit + Firefox (see below)
```

## Media

`public/media/` is gitignored. `pnpm media` downloads `media-v1.tar.gz` from the
[`media-v1` release](https://github.com/gabros20/scroll-animation-skill/releases/tag/media-v1),
checks its SHA-256 against `media/manifest.sha256`, and unpacks it. Run it before `pnpm build`:
the pages are prerendered, and a page built without its media shows a CSS-gradient placeholder
(`src/components/media-slot.tsx`) instead of a broken image or video. `media-src/` is the
pipeline that made the media, and `CREDITS.md` says where each file came from.

## Animation blocks

`src/animation/` holds what `node ../../skills/scroll-animation/bin/scroll-animation add <block>`
copied, with each file's hash in `src/animation/.scroll-animation.lock.json`. Add and update
blocks with that command, never by hand: the copies pass `pnpm lint` as they are. It holds the
foundation (`config`, `base-css`, `gsap-setup`, `motion-provider`, `smooth-lenis`,
`smooth-react`) and:

- `scrub-video` for GSAP, with `pinned-scene`, `scene-core`, `scene-css` and
  `video-controller`: the camera's orbit on `/` (`src/components/camera-orbit.tsx`). GSAP,
  because the route runs Lenis on GSAP's ticker and a scene takes its scroll from one engine.
- `horizontal-rail` (GSAP, on the same `pinned-scene`): the six objects on `/` and a fixture on
  `/blocks`, through `src/components/rail.tsx`. Under reduced motion the same track is a native
  horizontal snap scroller.
- `split-words` (Motion's `SplitWords`, a Server Component): the headline on `/` and each
  article's title, split on the server and risen by CSS from the first frame.
- `reveal` for Motion: the hero's eyebrow and standfirst on mount, the section headings and the
  rail's captions on `/`, the journal's cards and every paragraph and figure of an article, by
  trigger.
- `scroll-effects` (CSS): the sticky stack in the dark section on `/`, the article's
  reading-progress bar and parallax figure. Scroll-driven parts run where scroll timelines do
  (Chromium, Safari 26); Firefox and reduced motion show the finished, static state.
- `header-theme` for Motion (`useHeaderTheme`): the fixed header's ink turns dark-paper over the
  dark section (`src/components/site-header.tsx`, colours in `globals.css`).
- `count-up` for Motion, and `pinned-scene`, `frame-sequence`, `scrub-video` and `loop-video` for
  Motion: fixtures on `/blocks` (`src/app/blocks/`), on their defaults, and the loop videos with
  their pause control in the journal (`src/components/media-slot.tsx`).

The scroll authority is set per route group. `/` and `/lab` run Lenis on GSAP's ticker
(`src/components/lenis-scroll.tsx`); `/journal` and `/blocks` keep native scrolling.
`pnpm check:authority` starts `next start` and checks that each route stamps the right authority,
that client navigation swaps it without leaving a second Lenis, and that a reload keeps the
scroll position.

`pnpm verify:scenes` fetches the media and builds if either is missing, starts `next start`, and
runs the skill's `verify-motion.mjs --scenes --reveal` on `/`, `/journal/what-rust-is-for` and
`/blocks` at 1440×900 and 390×844, holding every scene to head, scrub, scrub, scrub, tail. Around
it, in Chromium and WebKit:

- the served HTML of `/` holds the split headline, named by its sentence; with JavaScript off the
  words still rise and the rail's track scrolls natively to its last panel; the load shifts
  nothing (CLS under 0.01 in Chromium, and the content below the headline never moves in either
  engine);
- entrances on `/` and the article wait below the fold and are all shown after a scroll through
  the page; under reduced motion everything is visible and still from the start;
- the rail's track follows the scroll and lands flush, and under reduced motion is a native
  horizontal scroller; the header's ink flips over the dark section and back; the article's
  progress bar tracks the scroll;
- under reduced motion `/` shows the poster and no pin and fetches no video, and with motion its
  video lands on the frame its band asks for.

Firefox, which has no scroll-driven animations, runs the article: `verify-motion --reveal`, then
the static fallback (everything shown, nothing left hidden, nothing attached to the parallax).
Screenshots and reports go to `test-results/`.
