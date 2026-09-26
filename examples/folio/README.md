# Folio

The `scroll-animation` skill's example site: a fictional editorial journal, not a real
publication. Art direction, page plans and the media shot list are in
[`docs/designs/folio-art-direction.md`](../../docs/designs/folio-art-direction.md); the plan that
scoped this skeleton is `.orchestrate/briefs/task-8-folio.md` at the repo root.

Three profiles, one route each: `/` (Expressive), `/journal` + `/journal/[slug]` (Reading),
`/lab` (Immersive), plus `/blocks`, the block catalogue and fixture host.

The animation foundation is wired in (the pre-JS gate, the base stylesheet, the Motion provider
and each route's scroll authority), and so are the scene and media blocks: the pinned scrub scene
on `/`, fixtures on `/blocks` and the journal's loop videos. Every place a later block will attach
is marked with a `{/* scroll-animation: ... */}` comment naming the block and the phase that adds
it.

## Commands

```bash
pnpm install
pnpm dev      # http://localhost:3000
pnpm build
pnpm media    # fetch public/media/ from the media-v1 release; run it before pnpm build
pnpm lint
pnpm check:authority   # after pnpm build: each route's scroll authority, Chromium + WebKit
pnpm verify:scenes     # the scenes on / and /blocks, Chromium + WebKit (see below)
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
blocks with that command, not by hand; `eslint.config.mjs` switches off the two findings the
copied blocks raise under Next's lint rules rather than editing them. It holds the foundation
(`config`, `base-css`, `gsap-setup`, `motion-provider`, `smooth-lenis`, `smooth-react`) and:

- `scrub-video` for GSAP, with `pinned-scene`, `scene-core`, `scene-css` and
  `video-controller`: the camera's orbit on `/` (`src/components/camera-orbit.tsx`). GSAP,
  because the route runs Lenis on GSAP's ticker and a scene takes its scroll from one engine.
- `pinned-scene`, `frame-sequence`, `scrub-video` and `loop-video` for Motion: the fixtures on
  `/blocks` (`src/app/blocks/fixtures.tsx`), on their defaults, and the loop videos with their
  pause control in the journal (`src/components/media-slot.tsx`).

The scroll authority is set per route group. `/` and `/lab` run Lenis on GSAP's ticker
(`src/components/lenis-scroll.tsx`); `/journal` and `/blocks` keep native scrolling.
`pnpm check:authority` starts `next start` and checks that each route stamps the right authority,
that client navigation swaps it without leaving a second Lenis, and that a reload keeps the
scroll position.

`pnpm verify:scenes` fetches the media and builds if either is missing, starts `next start`, and
runs the skill's `verify-motion.mjs --scenes --reveal` on `/` and `/blocks` at 1440×900 and
390×844, holding every scene to head, scrub, scrub, scrub, tail. It also checks that under
reduced motion `/` shows the poster and no pin and fetches no video, and that with motion its
video lands on the frame its band asks for. Chromium and WebKit (`--browser`); screenshots and
reports go to `test-results/`.
