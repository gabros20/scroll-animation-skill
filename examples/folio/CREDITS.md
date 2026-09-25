# Folio media credits (media-v1)

Everything under `public/media/` comes from the `media-v1` GitHub Release (`pnpm media`), and a
copy of this file ships inside it. None of it is a photograph of a real place, person, product or
brand: the stills are generated and the moving pictures are rendered. The pipeline that made them,
prompts included, is in [`media-src/`](media-src/README.md).

## 3D model: Antique Camera

| | |
|---|---|
| Source | Khronos [glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/81e8b567643b5166e6ff40024e4ff71ad4b18676/Models/AntiqueCamera) `Models/AntiqueCamera`, commit `81e8b56` |
| Licence | [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/legalcode) (SPDX `CC0-1.0`), covering "Everything" in the model |
| Attribution | © 2018 UX3D, artist Maximillan Kamps (as credited in the model's `metadata.json`). CC0 asks for none; it's given anyway. |
| Used in | `lab/antique-camera.glb`, and rendered for `hero/scrub-camera-*`, `blocks/camera-sequence/`, `lab/camera-poster.avif` |

The original tripod carries a UX3D logo. That logo is a trademark, which the model's licence
excludes from the CC0 grant (`LicenseRef-LegalMark-UX3D`), and Folio shows no real brands. It was
painted out of the tripod's base-colour and metallic-roughness textures before compression, so no
UX3D mark appears in any Folio file.

The model was compressed with glTF Transform 4.5.0, from 16.7 MB of glTF + PNG to 2.05 MB:

```
gltf-transform optimize AntiqueCamera.gltf antique-camera.glb \
  --compress meshopt --texture-compress webp --texture-size 2048 --join-named false
```

It requires `EXT_meshopt_compression`, `EXT_texture_webp` and `KHR_mesh_quantization`, all of
which three.js's `GLTFLoader` handles once it is given `MeshoptDecoder`. KTX2 textures weren't used
because KTX-Software isn't part of this toolchain.

## Rendered video and frames

- **`hero/scrub-camera-1920.mp4`, `hero/scrub-camera-1080.mp4`, `hero/scrub-camera-poster.avif`,
  `blocks/camera-sequence/`, `lab/camera-poster.avif`:** rendered from the compressed model with
  three.js 0.186.1 in headless Chromium (Playwright 1.63.0, GPU through ANGLE Metal). Each frame
  averages 128 jittered passes (256 for the lab poster) for anti-aliasing and soft shadows, over
  flat Folio paper (`#f5f1e8`).
- **`journal/kiln-loop.mp4`, `journal/rust-loop.mp4` and their posters:** cinemagraphs, also rendered
  in three.js. Each one is a generated plate (see below), animated by a fragment shader: heat haze,
  a breathing glow and sparks over the kiln; water tracks, sliding beads and rain over the steel.
  Both loop seamlessly because every motion completes a whole number of cycles per loop.
- **Encoding:** the videos and the sequence were encoded with this repo's CLI
  (`scroll-animation media scrub | sequence | loop | probe`) on ffmpeg 8.0.1 (libx264), with WebP
  frames through cwebp 1.6.0. The AVIF posters and stills were made with avifenc 1.3.0 (aom 3.13.1).

## Generated stills and plates

| | |
|---|---|
| Generator | Grok Imagine (xAI), through the Grok CLI 1.0.40 `image_gen` tool. This is the second backend of the local `generate-image` skill; its Codex/gpt-image-2 backend was out of quota. |
| Generations | 13 in total: the 10 stills, one regeneration of `objects/plywood-chair` (the first chair stood on separate legs, but its note says "one sheet"), and the 2 loop plates. That cost about $0.28 in agent tokens plus the per-image fees. |
| Prompts | `media-src/prompts/<name>.txt`, one per image |
| Upscaling | The journal covers (1600×2000) and details (1200×1500) came out at 864×1152. They were enlarged with Swin2SR, [`caidas/swin2SR-realworld-sr-x4-64-bsrgan-psnr`](https://huggingface.co/caidas/swin2SR-realworld-sr-x4-64-bsrgan-psnr) (revision `bb13f02`, Apache-2.0; Conde et al., [arXiv:2209.11345](https://arxiv.org/abs/2209.11345)), via `media-src/upscale.py`, then Lanczos-resized to exact size. The rail objects are downscales. |

| File | Subject |
|---|---|
| `journal/kiln-cover.avif` | a lidded, ash-glazed stoneware jar on a wire cooling shelf |
| `journal/kiln-detail.avif` | ash glaze pooling above a jar's foot |
| `journal/rust-cover.avif` | a library reading room with a weathering-steel wall under clerestory windows |
| `journal/rust-detail.avif` | a weathering-steel joint, a rain stain and a bright corner post |
| `objects/stoneware-vessel.avif` | a wood-fired stoneware vessel |
| `objects/corten-panel.avif` | a weathering-steel panel |
| `objects/plywood-chair.avif` | a single-sheet bent-plywood chair |
| `objects/forged-hinge.avif` | a hand-forged strap hinge |
| `objects/concrete-stair.avif` | a board-formed concrete stair |
| `objects/glass-shade.avif` | a hand-blown glass lamp shade |
| (plate for `journal/kiln-loop.mp4`) | an open wood kiln at the end of a firing |
| (plate for `journal/rust-loop.mp4`) | a wet weathering-steel wall |

Every subject is invented for this repository: no real people, places, products, logos or brands.
Where a generated design echoes a common furniture type (the cantilevered plywood chair), it is
not a reproduction of any particular designer's piece.
