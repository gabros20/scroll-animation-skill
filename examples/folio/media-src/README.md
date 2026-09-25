# Folio media source

How `media-v1.tar.gz` (the GitHub Release that `pnpm media` unpacks into `public/media/`) is made.
Nothing here runs as part of the site. Every output goes to `$FOLIO_MEDIA_WORK` (default:
`<os tmpdir>/folio-media`), never into the repo. Credits and licences are in
[`../CREDITS.md`](../CREDITS.md).

The idea is render, don't film. The scrub clip, the image sequence and the `/lab` model all come
from one CC0 object (Khronos's AntiqueCamera), rendered in three.js on Folio paper. The two journal
loops are three.js cinemagraphs over generated plates, and the stills are generated.

## Prerequisites

Node ≥ 22 and `npm install` here (three, Playwright's Chromium, glTF Transform). On `PATH`:
`ffmpeg` (with libx264), `cwebp`, `avifenc`, ImageMagick 7 (`magick`), and `python3` with torch,
transformers and Pillow for `upscale.py`. Regenerating stills also needs the Grok CLI or the Codex
CLI. Rendering expects a GPU (it runs on SwiftShader too, just slowly).

## Steps

```bash
export FOLIO_MEDIA_WORK=/some/scratch/dir
npm install
node scripts/model.mjs                 # download (pinned commit), licence check, debrand, gltf-transform
node scripts/stills.mjs generate       # optional and paid: only names with no raw image yet (--backend grok|codex)
node scripts/stills.mjs plates         # loop plates → PNG; the rust plate's frozen raindrops are painted out
node scripts/stills.mjs encode         # crop → Swin2SR (upscale.py) or Lanczos → AVIF within budget
node scripts/render.mjs all            # orbit (240), lab-poster, kiln-loop (180), rust-loop (180) → PNG frames
node scripts/encode.mjs                # masters → scroll-animation media scrub | sequence | loop → AVIF posters, probes
node scripts/package.mjs               # media-v1/ + CREDITS.md + manifest.sha256 → media-v1.tar.gz (reproducible)
```

To publish, attach `$FOLIO_MEDIA_WORK/media-v1.tar.gz` to the release and put its hash in
`../media/manifest.sha256`. `package.mjs` prints the hash.

Every shot's framing, lighting and tone mapping is a URL parameter with an art-directed default
(`render/shots/orbit.js` `DEFAULTS`, `scripts/render.mjs` `SHOTS`), so a test still is one command:
`node scripts/render.mjs orbit --only 0,60 --samples 32 --set az0=-40 --out /tmp/test`.

## What's in the package

| Path under `public/media/` | Made by | Spec |
|---|---|---|
| `hero/scrub-camera-1920.mp4` | `media scrub --crf 18 --mobile 1080` | all-intra H.264, 1920×1080, 240 frames = one full turn |
| `hero/scrub-camera-1080.mp4` | same call (its `-mobile` output) | all-intra, 1080×608 |
| `hero/scrub-camera-poster.avif` | frame 0 of the 1920 file | 1920×1080 |
| `blocks/camera-sequence/` | `media sequence --frames 120 --width 1600 --mobile-width 900 --quality 86` | WebP + `manifest.json`, `mobile/` set |
| `journal/kiln-loop.mp4`, `journal/rust-loop.mp4` | `media loop --crf 14` | 1280×720, 6 s, seamless |
| `journal/*-loop-poster.avif` | frame 0 of each loop | 1280×720 |
| `journal/*-cover.avif`, `journal/*-detail.avif` | generated → Swin2SR → AVIF | 1600×2000, 1200×1500 |
| `objects/*.avif` | generated → AVIF | 640×800 |
| `lab/antique-camera.glb` | `model.mjs` | meshopt + WebP textures, ≤ 3 MB |
| `lab/camera-poster.avif` | `render.mjs lab-poster` | 1920×1080 |

The whole orbit is one turn at constant speed, so frame 240 would equal frame 0. The clip wraps
seamlessly from its last frame to its first, which means ScrubVideo's head and tail loops can use
all of it.
