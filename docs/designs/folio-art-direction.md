# Folio: art direction

"Folio" is the working name for `examples/folio`, the site this skill demonstrates itself on. It
is a fictional editorial brand, invented for this repository. It is not modeled on any real
magazine, studio or person, and none of the stories, places or objects described below are real.

## Concept and voice

Folio is an independent journal about designed objects and the places that make them: furniture,
tools, buildings, and the raw materials underneath all three. Each issue commits to one subject at
a time and explains how it was made, on the assumption that a reader's attention is worth spending
slowly.

That restraint is also the brief for the site itself: one idea per viewport, nothing added because
a template had room for it.

## Palette

```css
--folio-paper: #f5f1e8; /* page background */
--folio-paper-raised: #ece5d6; /* card background, one step off paper */
--folio-line: #ddd4c0; /* hairlines, dividers */

--folio-ink: #211d18; /* headings, primary text */
--folio-ink-soft: #514a40; /* body copy */
--folio-muted: #8a8072; /* captions, meta, secondary labels */

--folio-accent: #c2410c; /* links, emphasis, the one accent */
--folio-accent-ink: #fbede3; /* text on accent */

--folio-dark-bg: #17140f; /* the one deliberately dark section */
--folio-dark-paper: #f5f1e8; /* text on dark-bg */
--folio-dark-muted: #948c7c; /* secondary text on dark-bg */
```

Paper, not white: a warm, slightly dim off-white that reads like uncoated stock rather than a
screen. Ink, not black: a near-black with a little brown in it, so long body copy stays warm at
reading size.

The accent keeps the skill's own rust (`#c2410c`). It was tempting to pick a second color to make
Folio feel more like its own brand, but rust already does the job: it reads as an oxide, a fired
glaze, a patina, which fits a journal about materials better than an arbitrary brand color would.
One of the two journal stories (`what-rust-is-for`) is about weathering steel for exactly this
reason, the site's accent and one of its subjects are the same phenomenon.

There is no `prefers-color-scheme` dark mode. `--folio-dark-*` is a section-level choice for the
one dark band on `/`, not a user preference the whole site swaps for.

## Type

- **Display: Fraunces** (variable, regular + italic). Headlines, deks, pull quotes, chapter
  numerals on `/lab`. Fraunces reads warm and a little irregular at large sizes, which suits a
  journal about handmade things better than a neutral display face would.
- **Text: Archivo** (variable). Navigation, body copy, captions, meta, buttons, the block catalogue
  on `/blocks`. Archivo stays plain and gets out of the way at both UI and reading sizes.

Both load through `next/font/google` in the root layout as `--font-fraunces` and `--font-archivo`,
mapped to Tailwind's `font-display` and `font-sans` in `globals.css`.

## Grid and spacing

No fixed 12-column grid. Content stacks in one column on mobile and opens into 2 columns (the
journal index) or 3 (the principles stack, the block catalogue) from the `sm`/`lg` breakpoints,
sharing one gutter and one measure:

- Gutter: `24px` (`px-6`) below `sm`, `40px` (`px-10`) from `sm` up.
- Reading measure: body copy caps at `42rem` (`max-w-2xl`), about 65-75 characters at its `18px`
  set size.
- Section rhythm: `py-20`/`py-24` on mobile, opening to `py-28`/`py-32`/`py-40` at `lg`, rounded to
  Tailwind's existing spacing scale rather than a new one. Folio does not use fluid-design's
  viewport-clamped scale; if a future example wants that compatibility layer, it reads
  fluid-design's own generated tokens rather than Folio inventing a parallel system.

## Pages

### `/`: Expressive (Lenis)

One idea per viewport, four scenes plus the hero:

1. **Hero.** Kicker ("Folio · Issue 04"), a three-word headline ("Things, made well."), one
   sentence of dek. Server-rendered, LCP-safe: the headline is plain text now, and SplitWords
   (Phase 3) wraps it word by word without changing what a no-JS reader sees.
2. **Pinned scrub scene.** A slow orbit around one object, the antique camera from the shot list
   below (the model `/lab` walks through). The video is the content: a small "01 · Object" label
   pins with it, and four one-line acts ride over it, one per viewport, each over the part of the
   turn it describes (0°, 90°, 270°, 360°). The turn wraps, so the scene holds both ends on the
   same three-quarter front view instead of looping. Phones get a shorter frame, which keeps the
   whole tripod in the crop, with the copy in a band below it. Reduced motion shows the poster,
   and the acts read as plain paragraphs under it.
3. **Horizontal rail.** Six objects (name + one-line material note), a change of pace from the
   journal's prose. Falls back to native horizontal scroll, which is also the reduced-motion
   behavior.
4. **Sticky stack, dark.** Three short principles ("One subject", "Made, not styled", "Slow
   reading"). This is the one dark section: background flips to `--folio-dark-bg`, and the header's
   ink flips with it for as long as the section is in view.

### `/journal` index and `/journal/[slug]` article: Reading (native)

Index: a two-up grid of article cards, cover image, category, title, dek, date and read time. Each
cover is the shared-element source for the article's hero (view transitions, Phase 4).

Article: cover hero, byline, a reading-progress bar (decorative until Phase 3 wires a scroll
listener), body copy with one CSS-parallax figure roughly a third of the way through, and one loop
video with a pause button around two-thirds through. Two articles ship now, both fictional:

- **"The Kiln That Never Went Cold"** (Objects): a wood kiln that has fired every five to six
  weeks for eleven years, and one stoneware jar that came out of it.
- **"What Rust Is For"** (Places): a weathering-steel library wall, ten years into rusting on
  purpose.

### `/lab`: Immersive

One object, five chapters, no second object and no second world: an antique bellows camera (see
the glTF entry below), scrolled through in five stops (body, bellows, lens, tripod, the whole
object). A rendered poster stands in for the canvas until ScrollCanvas and camera-path exist
(Phase 5), and is what reduced motion and no-WebGL fall back to permanently.

### `/blocks`

A catalogue, not a design reference, and labelled as one: every block from the plan's registry,
grouped by clock (foundation, trigger, scroll, media, route, render), one line each. Fixtures
attach below it as blocks ship, on their defaults rather than art-directed: so far the Motion
PinnedScene with a FrameSequence of the camera's turn, the Motion ScrubVideo on the same clip `/`
scrubs with GSAP, and a LoopVideo.

## Media shot list

Everything below is gitignored under `public/media/` and arrives via `pnpm media` (see
`scripts/fetch-media.mjs`); nothing here is committed. Paths are relative to `public/media/`.

**1. Scrub clip (`hero/scrub-camera-*`).** One slow turntable orbit around the antique camera
(item 5), seen from a fixed viewpoint, 8s at 30fps (240 frames). It starts on a three-quarter
front view and turns a full 360°, so its last frame runs back into its first. Two width variants
for `ScrubVideo`'s tier sources:

| Variant | Spec | Budget |
|---|---|---|
| `hero/scrub-camera-1920.mp4` | 1920w, all-intra H.264 | 8-14 MB |
| `hero/scrub-camera-1080.mp4` | 1080w, all-intra H.264 | 3-6 MB |
| `hero/scrub-camera-poster.avif` | first frame | 150-250 KB |

All-intra costs roughly 10x a long-GOP encode of the same clip; that cost is the reason there is
exactly one scrub scene on the site, not several. Encoded later with the CLI's `media scrub`, which
also writes the poster. Sourcing: rendered in three.js from the CC0 model in item 5, credited in
`CREDITS.md`.

**2. Image sequence (`blocks/camera-sequence/0001.webp`…`0120.webp`).** 120 frames, WebP, at
1600×900, with a 900×506 set in `mobile/` for narrow screens and a `manifest.json` beside each.
Budget: 2.5-4 MB total. Sourcing: extracted from the scrub clip with the CLI's `media sequence`,
so it costs no separate shoot; this is also why it lives on `/blocks` rather than a page of its
own, nothing in the page plans above calls for a second treatment of the same orbit.

**3. Two loops.** Short, seamless, muted, long-GOP (loops are never scrubbed, so all-intra buys
nothing here):

| File | Subject | Spec | Budget |
|---|---|---|---|
| `journal/kiln-loop.mp4` | the open kiln at the end of a firing, heat shimmering over the bricks | 4-6s, 1280×720 | 1.5-3 MB |
| `journal/rust-loop.mp4` | rain running down the steel wall | 4-6s, 1280×720 | 1.5-3 MB |

Each gets a poster (`journal/kiln-loop-poster.avif`, `journal/rust-loop-poster.avif`) generated by
the same `media loop` encode step, 100-180 KB each. Sourcing: generated video, or a short
CC0/Pexels-licensed clip, credited in `CREDITS.md`.

**4. Stills (10).** AVIF, sized to how each is used:

| File | Used on | Size | Budget |
|---|---|---|---|
| `journal/kiln-cover.avif` | journal index + article hero | 1600×2000 | 180-260 KB |
| `journal/kiln-detail.avif` | article parallax figure | 1200×1500 | 140-200 KB |
| `journal/rust-cover.avif` | journal index + article hero | 1600×2000 | 180-260 KB |
| `journal/rust-detail.avif` | article parallax figure | 1200×1500 | 140-200 KB |
| `objects/stoneware-vessel.avif` | `/` rail | 640×800 | 90-150 KB |
| `objects/corten-panel.avif` | `/` rail | 640×800 | 90-150 KB |
| `objects/plywood-chair.avif` | `/` rail | 640×800 | 90-150 KB |
| `objects/forged-hinge.avif` | `/` rail | 640×800 | 90-150 KB |
| `objects/concrete-stair.avif` | `/` rail | 640×800 | 90-150 KB |
| `objects/glass-shade.avif` | `/` rail | 640×800 | 90-150 KB |

Total: roughly 1.3-1.8 MB for all ten. Sourcing: the local `generate-image` skill for the six
rail objects (each is a clean, single-subject product shot, which generated stills handle well),
and either generated or CC0/Pexels-licensed photography for the four journal images, credited in
`CREDITS.md`.

**5. One CC0 glTF (`lab/antique-camera.glb`).** [`AntiqueCamera`](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/AntiqueCamera)
from Khronos's glTF-Sample-Assets, CC0 1.0 Universal, credited to Maximillian Kamps (© 2018 UX3D).
It exists specifically to demonstrate PBR materials (brass, leather, glass), which is exactly what
`/lab`'s chapters walk through. Source textures are uncompressed PNG; budget ≤5 MB after running it
through `gltf-transform` with Draco geometry and KTX2 textures, per `webgl-performance.md`, rather
than shipping it as downloaded. `lab/camera-poster.avif` is a rendered frame of the compressed
model, not a separate shoot, 150-250 KB.

Backup candidate if the camera doesn't art-direct well once modeled: Poly Haven's
[Painted Wooden Stool](https://polyhaven.com/a/painted_wooden_stool), also CC0 (Poly Haven's entire
library is CC0). It ships heavier by default (Poly Haven bundles multiple texture resolutions per
download) and needs the same compression pass before it would fit the same budget.

## What a human art director should decide

- Whether the rust accent (`#c2410c`) stays shared with the skill's own brand color once Folio is
  public-facing, or earns something distinct.
- Real sourcing versus generated: whether the kiln and the steel wall are worth a short commissioned
  shoot, or stay fully generated. The shot list works either way; it does not decide this.
- How far to push Fraunces' optical-size and irregular ("soft"/"wonk") settings at hero scale.
  This draft assumes a fairly conventional setting; a more characterful one is available.
- Decided: the rust article says "weathering steel" only; no real trade names in the fictional copy.
- Whether the five `/lab` chapter breaks (body, bellows, lens, tripod, whole object) actually read
  as good camera-path stops once blocked out in 3D, versus being a reasonable narrative guess.
- Whether "Folio" is the permanent name or a placeholder that gets swapped before any public
  release, given how generic the word is.
- Article count and length for a real (non-skeleton) `/journal`: two pieces is a build-time
  minimum for `generateStaticParams`, not an editorial judgment about how much a launch needs.
