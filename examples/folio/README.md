# Folio

The `scroll-animation` skill's example site: a fictional editorial journal, not a real
publication. Art direction, page plans and the media shot list are in
[`docs/designs/folio-art-direction.md`](../../docs/designs/folio-art-direction.md); the plan that
scoped this skeleton is `.orchestrate/briefs/task-8-folio.md` at the repo root.

Three profiles, one route each: `/` (Expressive), `/journal` + `/journal/[slug]` (Reading),
`/lab` (Immersive), plus `/blocks`, the block catalogue and fixture host.

This is currently a **structure-only skeleton**: real routes, headings and copy, no animation
wired up yet. Every place a block will attach later is marked with a
`{/* scroll-animation: ... */}` comment naming the block and the phase that adds it.

## Commands

```bash
pnpm install
pnpm dev      # http://localhost:3000
pnpm build
pnpm media    # fetch public/media/ from the media-v1 release (not published yet — see below)
pnpm lint
```

## Media

`public/media/` is gitignored. `pnpm media` downloads `media-v1.tar.gz` from a GitHub Release,
checks its SHA-256 against `media/manifest.sha256`, and unpacks it. That release does not exist
yet, so the script fails on purpose with a message pointing back to the art-direction doc, and
every page falls back to a CSS-gradient placeholder (`src/components/media-slot.tsx`) instead of
a broken image or video.

## Animation blocks

`src/animation/` is where `node ../../skills/scroll-animation/bin/scroll-animation add <block>`
copies blocks, once they exist (Phase 2 onward). It is empty now.
