# Folio

The `scroll-animation` skill's example site: a fictional editorial journal, not a real
publication. Art direction, page plans and the media shot list are in
[`docs/designs/folio-art-direction.md`](../../docs/designs/folio-art-direction.md); the plan that
scoped this skeleton is `.orchestrate/briefs/task-8-folio.md` at the repo root.

Three profiles, one route each: `/` (Expressive), `/journal` + `/journal/[slug]` (Reading),
`/lab` (Immersive), plus `/blocks`, the block catalogue and fixture host.

This is currently a **skeleton**: real routes, headings and copy, and the animation foundation
wired in (the pre-JS gate, the base stylesheet, the Motion provider and each route's scroll
authority), but no animation blocks yet. Every place a block will attach later is marked with a
`{/* scroll-animation: ... */}` comment naming the block and the phase that adds it.

## Commands

```bash
pnpm install
pnpm dev      # http://localhost:3000
pnpm build
pnpm media    # fetch public/media/ from the media-v1 release (not published yet — see below)
pnpm lint
pnpm check:authority   # after pnpm build: each route's scroll authority, Chromium + WebKit
```

## Media

`public/media/` is gitignored. `pnpm media` downloads `media-v1.tar.gz` from a GitHub Release,
checks its SHA-256 against `media/manifest.sha256`, and unpacks it. That release does not exist
yet, so the script fails on purpose with a message pointing back to the art-direction doc, and
every page falls back to a CSS-gradient placeholder (`src/components/media-slot.tsx`) instead of
a broken image or video.

## Animation blocks

`src/animation/` holds what `node ../../skills/scroll-animation/bin/scroll-animation add <block>`
copied, with each file's hash in `src/animation/.scroll-animation.lock.json`. Add and update
blocks with that command, not by hand. So far it holds the foundation: `config`, `base-css`,
`gsap-setup`, `motion-provider`, `smooth-lenis` and `smooth-react`.

The scroll authority is set per route group. `/` and `/lab` run Lenis on GSAP's ticker
(`src/components/lenis-scroll.tsx`); `/journal` and `/blocks` keep native scrolling.
`pnpm check:authority` starts `next start` and checks that each route stamps the right authority,
that client navigation swaps it without leaving a second Lenis, and that a reload keeps the
scroll position.
