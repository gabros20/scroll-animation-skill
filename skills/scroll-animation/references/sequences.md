# Image sequences

**Purpose:** Scrub an image sequence on a canvas (the Apple-style product turn), or a Lottie, dotLottie or Rive file,
from scroll progress, within a decode and byte budget.

**Read when:** frames should follow scroll exactly: a product turning, an exploded view, a rendered camera move; or a
vector animation should scrub with scroll.
**Skip when:** the clip is long, filmed or loops ([video.md](video.md)), or only the pin around it is in question
([scenes.md](scenes.md)).

**Inputs:** a rendered clip or its frames, the scroll range, the route's engine.
**Produces:** WebP frames and `manifest.json` from `media sequence`, a `frame-sequence` block fed exact progress, and
its budgets checked with `stats()`.

## Contents

1. [Sequence or scrub video](#1-sequence-or-scrub-video)
2. [Frames and the manifest](#2-frames-and-the-manifest)
3. [FrameSequence in both engines](#3-framesequence-in-both-engines)
4. [The decode window](#4-the-decode-window)
5. [Drawing and byte budgets](#5-drawing-and-byte-budgets)
6. [WebP, AVIF and WebCodecs](#6-webp-avif-and-webcodecs)
7. [Lottie, dotLottie and Rive](#7-lottie-dotlottie-and-rive)
8. [Traps](#traps)

## 1. Sequence or scrub video

A sequence draws a decoded bitmap synchronously, so the frame on screen is exact at any scroll speed, with alpha if
the art needs it and no `play()` for iOS or Low Power Mode to refuse. It pays with a request and a CPU decode per frame
and holds decoded RGBA: 5.5 MiB per 1600×900 frame in the window, where a video decoder holds a few frames in hardware.
Use it for short rendered moves: a turn, an exploded view. Use ScrubVideo for long or filmed clips, and anything with
head or tail loops.

## 2. Frames and the manifest

```sh
scroll-animation media sequence turn.mov --out public/media/turn --frames 120 --width 1600 --mobile-width 900
```

- **N evenly spaced source frames, first and last included**, so progress 0 and 1 land on the clip's true ends.
  Defaults: `--frames 24`, `--quality 80`, the source's width.
- **`manifest.json`** holds `count`, `width`, `height`, `format`, `frames`, `sourceFrames` (the source indices) and
  `bytes`. The block reads `frames`, `width` and `height`. `--mobile-width` writes a second, independent set under
  `mobile/`.
- **WebP** through ffmpeg's libwebp, else Google's `cwebp` (ffmpeg writes a lossless PNG and `cwebp` encodes it;
  `brew install webp`), else PNG with a warning, several times larger for photographic frames. A set never mixes
  formats.
- Frames get the CLI's accurate colour conversion (limited to full range, accurate rounding), so a poster cut from the
  same clip matches them.
- Choose `--frames` from the scroll range: the block's `prefix` of 12 assumes about 20–25 px of scroll per frame.
- Frames on another origin need CORS headers: the block fetches them.

## 3. FrameSequence in both engines

```tsx
<FrameSequence manifest="/media/turn/manifest.json" mobile progress={progress} label="The camera, turning" />
```

`progress` is a MotionValue or a number, read by hand, never bound to a style (S3). The canvas is `role="img"` named by
`label`, and fills its box (`display: block`, 100% × 100%): size the box. `ref` reaches the canvas, `sequenceRef` the
handle. It builds in a layout effect and is destroyed on unmount and on an Activity hide; `manifest`, `mobile` and
`position` compare by content, so an inline object doesn't rebuild it. The page provides any poster behind the canvas
for no-JS and the time before `ready`: the block renders only the canvas.

```ts
frameSequence(canvas, { manifest, mobile: true, trigger: '#turn' })   // its own ScrollTrigger: 'top top' to 'bottom bottom'
frameSequence(canvas, { manifest, progress: () => scene.band() })    // any getter, polled on gsap.ticker
```

The trigger-mode ScrollTrigger isn't refreshed when layout shifts above it (only `pinnedScene` watches `<body>`; S5
measured 300 px stale): on a pinned scene prefer the getter, and otherwise call `ScrollTrigger.refresh()` after late
layout.

In GSAP, call `setupGsap()` first. Made inside `useGSAP`, a `gsap.context` or a `matchMedia` callback (never one with a
breakpoint condition: scenes.md §9), it is destroyed when that context reverts; otherwise call `destroy()`. Vanilla
pages use `createFrameSequence(canvas, options)` from `media/frame-sequence.ts`, which returns `setProgress`, `ready`,
`stats` and `destroy`.

**On a pinned scene**, put the canvas in the pin and feed it the band, so the holds own the ends (scenes.md §3).
`pinned`'s render function hands it over as an exact MotionValue, rehydrates included:

```tsx
<PinnedScene pinned={({ band }) => <FrameSequence manifest={m} progress={band} label="…" />}>{acts}</PinnedScene>
```

In GSAP, `progress: () => scene.band()` is read after Lenis and ScrollTrigger in the same tick when the scroll
authority is created first (S4). Pass exact progress: the canvas already shows the nearest decoded frame while the
exact one decodes, so a spring only makes it late.

Options and defaults: `fit` `'cover'`, `position` `[0.5, 0.5]`, `dprCap` 2, `prefix` 12, `budgetBytes` (§4),
`reducedMotion` `'user'` (live), `reducedMotionFrame` 0 (negative counts from the end),
`warmMargin` 1.5 and `wakeMargin` 0.5 viewports,
`fetchConcurrency` 4, `decodeConcurrency` 2, `resizeQuality` `'high'`, `worker` true.

## 4. The decode window

Decoding a sequence up front is the trap: 120 frames at 1600×900 are 691 MB of RGBA. The block keeps frames
**compressed** (a Blob each) and decodes only a window around the current frame, at the size it is drawn, into an LRU
of `ImageBitmap`s bounded by a byte budget.

- **The budget follows `navigator.deviceMemory`** (Chromium only): 24 MiB per GB, clamped to 24–192 MiB, 64 MiB when
  unknown (Safari, Firefox), and never under two frames.

  | deviceMemory | ≤ 1 GB | 2 GB | 4 GB | 8 GB | unknown |
  |---|---|---|---|---|---|
  | budget | 24 MiB | 48 MiB | 96 MiB | 192 MiB | 64 MiB |
  | 1600×900 frames | 4 | 8 | 17 | 34 | 11 |
  | 900×506 frames | 13 | 27 | 55 | 110 | 36 |

- **The window** is as many contiguous frames as the budget holds, three quarters ahead in the direction of travel.
- **Eviction ranks, then LRU**: frames outside the window go first, then stale ones inside it; the frame on screen and
  fresh window frames never go. A plain LRU would evict the frames fetched ahead when the scroll reverses. Decodes in
  flight reserve their bytes, so held plus reserved never passes the budget.
- **Every bitmap that leaves is `close()`d**: its pixels live outside the JS heap, where the GC is in no hurry.
- **Decoding runs in a worker.** WebKit runs `createImageBitmap` on the main thread, 12–16 ms per 1600×900 WebP, a
  dropped frame per decode; the shared worker blocks it ≤ 1 ms. It starts from a `blob:` URL, so a CSP needs
  `worker-src blob:` (or pass `worker: false`), and falls back to the main thread if it errors or stays silent for 2 s.
- **Fetch order**: the frame on screen, the prefix, the last frame (where a finished scroll rests), then coarse to fine
  (every 64th, 32nd, …), so a fast early scrub steps through the whole sequence. Up to three missing frames at the
  front of the window jump the queue.
- **Gating**: fetch within `warmMargin`, decode and draw within `wakeMargin`. Leaving the warm margin (or
  `display: none`) releases every bitmap; the blobs stay.
- **A fast flick shows the nearest decoded frame** and upgrades when the exact one lands, never a blank. A failed frame
  is skipped with one warning.
- **Reduced motion** shows one still and fetches nothing else: frame 0 by default, the head a pinned scene holds (a
  negative `reducedMotionFrame` counts from the end).

## 5. Drawing and byte budgets

The backing store is the canvas's CSS size × min(dpr, `dprCap`), **never finer than the frames**: a 1600×900 sequence
covering 1440×900 on a 2× screen gets 1440×900, and the compositor upscales. There, an uncapped 2880×1800 store
dropped about 47% of scroll frames in headless Chromium, and the capped one none, in a quarter of the memory. It caps
density, not size, so a letterboxed `contain` frame keeps its pixels; stores over 16.7 MP (Safari's limit) scale
down. `dprCap: 1` lightens a heavy page further. Size the canvas with CSS: an unsized canvas takes its size from its
backing store and keeps growing.

Put both budgets in the ledger:
- **Network**: the manifest's `bytes`. Aim for about 25 KiB per 1600×900 frame from a clean render; noisy test frames
  ran 97–108 KiB, and frames that size decode 3–4× slower. `mobile` serves the smallest set at least the canvas's CSS
  width × min(dpr, `dprCap`) wide, chosen once, by width alone.
- **Memory**: the decoded budget (§4). `stats()` shows `peakDecodedBytes` against `budgetBytes`, `fetchedBytes`, and
  `decodeMs` per frame.

## 6. WebP, AVIF and WebCodecs

- **WebP is the default.** AVIF is reported 15–30% smaller at matched quality but 2–5× slower to decode per frame, and
  a sequence decodes on every scrub step. That wasn't measured here: compare `stats().decodeMs.avg` on a mid-tier phone
  before switching.
- **WebCodecs** (`VideoDecoder`) decodes a video's frames in hardware: worth it for hundreds of frames already in an
  MP4. It needs a demuxer (mp4box.js) to feed it chunks, and random access needs keyframes (all-intra again). **Close
  every `VideoFrame`** as soon as it is drawn or evicted: each holds decoder memory outside the JS heap, and unclosed
  frames stall the decoder and leak until the tab dies. The block doesn't use WebCodecs; reuse its window and budget.

## 7. Lottie, dotLottie and Rive

Drive the frame from exact progress (a scene's band) and stop the player's own clock:

```ts
const anim = lottie.loadAnimation({ container, renderer: 'svg', autoplay: false, loop: false, path })
anim.goToAndStop(band * (anim.totalFrames - 1), true)   // lottie-web
player.setFrame(band * (player.totalFrames - 1))         // @lottiefiles/dotlottie-web
```

For Rive, give the state machine a number input that drives a blend state, and set its `value` from the band.

- No smoothing on the frame: under Lenis the scroll is already smooth, and a spring on top only lags the scrub.
- Set the frame in the producer's tick (`onProgress`, a ScrollTrigger `onUpdate`), never in a second rAF loop.
- Reduced motion shows one frame (the finished state or a key pose); destroy the player on unmount and on hide.

## Traps

- [ ] Frames come from `media sequence`, first and last included (§2).
- [ ] Nothing decodes every frame up front; every bitmap and `VideoFrame` is closed (§4, §6).
- [ ] `progress` is exact (or the band), never a spring, never bound to a style (§3).
- [ ] A strict CSP allows `worker-src blob:` or passes `worker: false` (§4).
- [ ] Cross-origin frames send CORS headers (§2).
- [ ] The canvas is sized by CSS, and a poster behind it covers the time before `ready` (§3, §5).
- [ ] Byte and memory budgets are in the ledger and checked with `stats()` (§5).
- [ ] A Lottie or Rive player's own clock is off while scroll drives it (§7).
