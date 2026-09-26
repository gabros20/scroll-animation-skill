# Video

**Purpose:** Encode, serve and play video that scrubs with scroll or loops in the background, and keep it right
through seeks, tab sleep, hidden routes and refused autoplay.

**Read when:** a `<video>` scrubs with scroll (ScrubVideo), loops in the background (LoopVideo) or autoplays; a loop pops
at its seam; a scrub "feels like mud" or freezes after the tab slept.
**Skip when:** the media is an image sequence or a Lottie or Rive file ([sequences.md](sequences.md)), or the problem
is the pin around the video ([scenes.md](scenes.md)).

**Inputs:** the source clip, what it should do (scrub, loop, play once), the route's scroll authority.
**Produces:** encodes and posters from `scroll-animation media`, a `scrub-video` or `loop-video` block wired in, and
seam and serving checks.

## Contents

1. [All-intra is for scrub, not for playback](#1-all-intra-is-for-scrub-not-for-playback)
2. [Loop seams, measured on the encoded file](#2-loop-seams-measured-on-the-encoded-file)
3. [The rVFC wrap](#3-the-rvfc-wrap)
4. [Seeks: coalescing and the glide](#4-seeks-coalescing-and-the-glide)
5. [Preload tiers](#5-preload-tiers)
6. [The compositing anchor and the reset's `max-width`](#6-the-compositing-anchor-and-the-resets-max-width)
7. [Desktop and mobile sources](#7-desktop-and-mobile-sources)
8. [Serving: HTTP Range and caching](#8-serving-http-range-and-caching)
9. [Posters](#9-posters)
10. [Keyframes at loop seams](#10-keyframes-at-loop-seams)
11. [Autoplay, Low Power Mode and Save-Data](#11-autoplay-low-power-mode-and-save-data)
12. [Tab-sleep rehydrate](#12-tab-sleep-rehydrate)
13. [Encoding with `scroll-animation media`](#13-encoding-with-scroll-animation-media)
14. [The video controller](#14-the-video-controller)
15. [ScrubVideo and LoopVideo](#15-scrubvideo-and-loopvideo)
16. [Pausing: hidden routes and WCAG 2.2.2](#16-pausing-hidden-routes-and-wcag-222)
17. [WebGL video textures](#17-webgl-video-textures)
18. [Traps](#traps)

Section numbers are stable: block comments cite them.

## 1. All-intra is for scrub, not for playback

A scrub seeks on nearly every scroll frame, and a seek decodes from the previous keyframe: on a normal GOP that is up
to a whole GOP per seek, which is what "mud" and "holds frame one, then jumps" look like. All-intra (every frame a
keyframe) makes each seek one decode; `media scrub` encodes it and `media probe` calls it `scrub-ready` (§13).

A clip that only plays forward or loops gains nothing from all-intra and pays for it in bitrate.

## 2. Loop seams, measured on the encoded file

Measure the re-entry frame; never eyeball it. Re-entering at frame L after the last shown frame E is invisible when
**frame[L−1] ≈ frame[E]**: L is then E's natural successor. Asking for L ≈ E freezes the subject for a frame each cycle.
The threshold is a floor, not zero: the mean absolute difference between consecutive frames of the steady part. A seam
at or under it differs less than two real neighbours do.

```python
A = frames.astype(np.float32)   # uint8 differences wrap around
floor = np.mean([np.abs(A[i + 1] - A[i]).mean() for i in range(steady_from, E)])
cost = {L: np.abs(A[L - 1] - A[E]).mean() for L in candidates}   # cost <= floor: seamless
```

One sharp minimum under the floor is the cycle; none means the clip holds no whole cycle. The segment's motion must be
flat, not decaying, or the intro's settle replays every cycle; a synthetic loop is checked on its pixels, not its
parameters, since a resample step can break a loop whose pose is periodic.

**Verify on the encoded file.** CRF's per-frame rate control can quantise two identical master frames differently and
pop at every wrap, and that pop exists only in the delivered bitstream:

```sh
ffmpeg -i out.mp4 -vf "select=eq(n\,79)" -fps_mode passthrough -frames:v 1 end.png   # E
ffmpeg -i out.mp4 -vf "select=eq(n\,31)" -fps_mode passthrough -frames:v 1 pre.png   # L − 1
ffmpeg -i end.png -i pre.png -lavfi psnr -f null -
```

How the blocks spell it:
- **ScrubVideo** `headLoop: { fromFrame, matchFrame }` shows `fromFrame … matchFrame−1`, so it needs
  frame[matchFrame] ≈ frame[fromFrame]; the match frame is never shown in the loop, and the band starts there.
  `tailLoop: { fromFrame }` shows up to the clip's second-to-last frame: the last frame closes the cycle.
- **LoopVideo** `loopFromFrame` plays the whole clip once, then re-enters at L: frame[L−1] ≈ the last frame.

## 3. The rVFC wrap

Polling `currentTime` in rAF can't wrap on an exact frame: the check lands anywhere in a 16.7 ms window, and a late
wrap flashes the next cycle's frame. `requestVideoFrameCallback` hands over the presented frame's `mediaTime`, so the
decision is a frame index. The controller (`wrapDue`) wraps once the loop's last frame is on screen **or already due by
the playback position**, because WebKit runs the callback about 0.8 of a frame late (27 ms measured); a rAF backstop
and an `ended` re-wrap catch the rest without moving an on-time wrap. LoopVideo wraps on the presented frame's end
(`mediaTime` is its start) within 1.5 frames of the duration: a tighter margin lost to WebKit's end-of-media handling
one run in three. Firing up to a frame early skips the last frame, so seam clips end on a spare clone (§10).

- Without rVFC, poll and wrap a full frame early: losing a cycle's last frame is cheap, showing the next cycle's first
  frame early is the visible fault.
- Verify by logging presented frame indices: a clean sawtooth (`… 78 79 32 33 …`), nothing outside the loop.

## 4. Seeks: coalescing and the glide

A seek issued while another is in flight is dropped, not queued, so the controller keeps one in flight and only the
newest target waits. Wraps and snaps skip that queue: behind a stale seek they land a frame late.

In the band the playhead **glides** with the decoder paused: an exponential approach whose `glide` (0.18) is the rate
per 60 Hz frame, `dt`-based so 120 Hz isn't twice as fast; it settles in about 150 ms. Entering a loop plays at once
from where the band left the playhead; leaving one pauses, and the glide takes over. Safari drops a `play()` issued
mid-seek, so play waits for `seeked` (150 ms fallback).

## 5. Preload tiers

| Tier | Trigger | Buys |
|---|---|---|
| none | the default | nothing fetched for a reader who never arrives |
| warm | a wide margin: ScrubVideo 600 px, LoopVideo 800 px | the fetch and decoder setup finish before arrival |
| wake, play | a tight one: ScrubVideo 200 px, LoopVideo 20% visible | per-frame work and playback only near the screen |

Warm early, wake late: a single observer either wastes bandwidth or stalls on arrival.

**Never call `load()` on the warm tier**: on phones it aborts a `play()` in flight when both observers fire in one
batch. `preload = 'auto'` is the hint, and all LoopVideo sets, since its `<source>` children exist at mount.
ScrubVideo starts with no source: the controller sets the picked tier's `src` a frame after mount (under
`preload="none"`, which fetches nothing), and `warm()` raises `preload` at the warm margin. Its one soft `load()` is for
an evicted resource or an awake scene whose network sits idle (iOS ignoring `preload`); a first load is never aborted.

## 6. The compositing anchor and the reset's `max-width`

A `translateZ(0)` in a video's transform is a Safari compositing anchor that keeps its layer from being demoted.
`scene.css` gives every `[data-scene-media]` one by default, and a camera's inline `translate3d(…) scale(…)` replaces it
while staying 3D, so a ScrubVideo has it with or without a camera. LoopVideo sets it inline (in GSAP only when nothing
else set a transform). Don't clean it up, and never animate a transform on a video's ancestors.

A reset's `video { max-width: 100% }` silently clamps an oversized camera box to the pin's width. `scene.css` sets
`max-width: none` on `[data-scene-media]`; any other oversized video needs the same fix, scoped, never global.

## 7. Desktop and mobile sources

ScrubVideo takes `src` and `mobileSrc` (with `poster` and `mobilePoster`), cut from one master canvas. The controller
picks the tier by `DESKTOP_QUERY` (`config.ts`), or `mobileSrc` everywhere under Save-Data (§11), a frame after mount,
never in the hydrating commit, so only one tier is fetched and the server renders the poster alone. Crossing the
breakpoint swaps the source, and `onTier` tells the camera which crop is on screen.

Hand-written `<source media>` tiers are chosen once, at resource selection (unlike `<picture>`), so a `<picture>` poster
behind one drifts to another framing on resize: resync with `load()` on a real flip.

## 8. Serving: HTTP Range and caching

- **Range requests.** Seeking fetches byte ranges, so the server must answer `Range` with `206 Partial Content`: without
  it Safari won't play the file and other browsers can only seek within what has downloaded. Check with a GET,
  `curl -s -o /dev/null -D - -r 0-1 <url>`, and expect `206` with `Content-Range: bytes 0-1/<size>` (a HEAD request
  may ignore `Range`). Static servers and CDNs do this; a framework route or service worker that streams the file
  often answers `200` (Workbox needs its range-requests plugin).
- **Faststart.** `moov` before `mdat` lets playback start before the file finishes; every `media` encode sets it and
  `media probe` reports it.
- **Caching.** Content-hashed names with `Cache-Control: public, max-age=31536000, immutable`, so a revisit never
  refetches; leave video out of gzip and brotli (already compressed).

## 9. Posters

Take the poster from the **encoded** file, never the master: the master's colour pipeline and artefacts differ from
the decoded frames, and the mismatch flashes when decoding starts (worse under a blend mode). The `media` commands do
this (§13).

- **Accurate colour.** ffmpeg's fast YUV to RGB path lands 2–3 levels dark, a visible step when the video starts; the
  CLI converts limited to full range with accurate rounding, and tags every encode BT.709 so Safari and Chrome agree.
- **Match the frame that rests.** ScrubVideo holds the head loop's `fromFrame` (frame 0 without a loop) in the head
  and under reduced motion. `media scrub` writes frame 0, so for a head loop run
  `media poster out.mp4 --at <fromFrame / fps>`.
- **A poster is a frame of the same asset.** An art-directed still that no frame matches is a `<picture>` under the
  video, not the `poster` attribute.

## 10. Keyframes at loop seams

A normal-GOP loop that re-enters mid-GOP decodes from the previous keyframe each cycle: a hitch per repeat on a short
loop. `media loop` encodes one GOP per clip, so frame 0 is the keyframe a native `loop` needs. For an intro-then-seam
loop (LoopVideo `loopFromFrame`), `media loop <in> --loop-from L` also keys frame L (by frame number, after any
`--fps`), ends the file on one spare clone of the last frame (the early wrap in §3 only ever skips that), re-probes
the output to confirm both keyframes, and prints the `loopFromFrame` and `fps` to pass. Hand encodes need the same
spare (`tpad=stop_mode=clone:stop=1`) and keyframe; `media probe` lists keyframe positions when there are 12 or fewer.

## 11. Autoplay, Low Power Mode and Save-Data

- **Sound needs a gesture**: play sound-carrying video from a click handler. Never start muted and unmute later: the
  grants behind it differ per engine and can be revoked mid-play.
- **Decorative video is `muted playsinline`** (iOS plays inline only with both) and IO-gated; the audit's `video-attrs`
  rule flags a missing attribute.
- **A refused `play()` stays refused until the reader asks.** Low Power Mode and autoplay policy reject the promise.
  LoopVideo keeps the poster and the control, and a sticky flag stops every retry until a click, because a timer would
  hammer the refusal every 2 s. ScrubVideo counts refusals in `debug().rejections`.
- **Save-Data** (`navigator.connection.saveData`; Safari and Firefox don't expose it): LoopVideo shows the poster, skips
  the warm tier and fetches nothing until the control is pressed. ScrubVideo takes its smallest tier (`mobileSrc`) at
  every viewport and scrubs as usual. Both follow it live where `connection` fires `change`.
- **Reduced motion** stops LoopVideo's autoplay but keeps its warm tier, and the control still plays it: the setting
  asks for less motion, not less content. ScrubVideo fetches no video: the poster is the scene, and lifting the
  setting mid-visit loads the tier where the reader is.
- **The element is the source of truth.** Every path that changes playback acts on the element, and the UI mirrors
  its `play` and `pause` events, never the code's intent.

iOS may not paint seeks on a video that has never played, and a scene of holds only (no `headLoop`, no `tailLoop`)
never calls `play()`. Whether it needs a prime is checked on the Phase 2 real-device pass: that holds-only scene is the
iPhone case to test, with a reload mid-scrub and Low Power Mode.

## 12. Tab-sleep rehydrate

Scroll is the durable truth; the playhead is derived. After a long background tab the browser may freeze rAF, evict the
decoder or leave `currentTime` stale while the scroll position is still right. So every resume (scenes.md §1 lists
the triggers) re-derives everything, coalesced to one frame:

1. re-measure the range and read the wrapper's rect;
2. derive mode, band and act **absolutely** (`sceneAt`), not through the live stepper;
3. snap the playhead, no glide, if awake (no frame between a stale time and the right one is worth playing), or pause;
4. if `duration` is invalid (an evicted decoder), issue **one** soft `load()`; metadata rehydrates the scene again.

A hidden tab stops the controller and pauses the video. LoopVideo re-checks on `visibilitychange`, `pageshow` and
`focus`, with the same single `load()`. Never scroll the reader back, reload on focus or store the playhead in
`sessionStorage`: each fights a scroll position that is already right. For a scene frozen after a sleep, load the page
with `?motion-debug` and call `window.__scrub()`: the counter that stopped names the layer (scenes.md §13).

## 13. Encoding with `scroll-animation media`

Needs `ffmpeg` and `ffprobe` on PATH; exit 2 is a usage error, 1 an ffmpeg failure.

| Command | Does | Flags (default) |
|---|---|---|
| `media probe <in>` | codec, profile, pixel format, size, fps, duration, keyframes (where, when 12 or fewer) and max GOP, faststart, audio; verdicts `scrub-ready` (all-intra or max GOP ≤ 2) and `web-safe` (H.264 High or Main, yuv420p, faststart) | none |
| `media scrub <in>` | all-intra H.264 (`keyint=1:min-keyint=1:scenecut=0:qcomp=1`, `-preset slow`), plus a `--mobile` variant and a poster | `--out`, `--width`, `--crf` (23), `--fps`, `--mobile <width>` |
| `media loop <in>` | H.264 High, one GOP per clip, `qcomp=1`, plus a poster; `--loop-from` also keys the seam and adds a spare frame (§10) | `--out`, `--width`, `--fps`, `--crf` (23), `--loop-from <frame>` |
| `media poster <in>` | one frame, accurate colour: `.jpg` or `.png` by `--out`'s extension, else WebP | `--out`, `--at` (0 s) |

Every encode is yuv420p, faststart, silent and tagged BT.709, written beside the input as `<input>-scrub.mp4` or
`<input>-loop.mp4` (plus `-mobile` and `-poster.webp`).
`media sequence` is in [sequences.md](sequences.md).

- **`qcomp=1`** stops CRF biasing bits per frame, so identical seam frames quantise alike: without it the two ends of
  one loop measured about 32 dB apart. It costs bitrate, so raise the CRF a few points to hold a size.
- **Budget texture before rendering**: all-intra re-pays background detail every frame (a textured ground: 37 MB at
  CRF 22, 9 MB softened), and flat fields band first, so spend CRF there.

## 14. The video controller

`media/video-controller.ts` is the decoder behind ScrubVideo in both engines. It never reads scroll; a scene drives it:

```ts
const video = createVideoController(el, { fps: 30, headLoop, tailLoop, glide: 0.18, loopSeconds: 5, src, mobileSrc,
  poster, mobilePoster, desktopQuery, onRehydrate, onPlayhead, onTier })
video.setMode(mode)     // per mode transition
video.setBand(band)     // per progress event
video.setAwake(awake)   // per wake transition
video.setReduced(r) · video.rehydrate({ mode, band, awake, reason }) · video.warm() · video.destroy()
```

- **Holds by default**: no `headLoop` holds frame 0 and no `tailLoop` holds the last frame, so a plain scrub needs no
  seams. `fps` must be the clip's exact rate.
- **It runs only while awake, visible and not reduced**; `destroy()` stops and pauses, so a hidden route never decodes.
- **Two drivers, never at once**: the glide (rAF, decoder paused) in the band, playback with rVFC wraps in a loop.
- **A loop runs `loopSeconds` (5) per visit to its region**, because WCAG 2.2.2 allows 5 s of self-moving content
  without a pause control. Then it finishes the cycle and holds the frame beside the band, so the scrub takes over
  without a jump; a new visit, or a restart after sleep, starts a new budget. `Infinity` needs a pause control of yours.
- **A watchdog** re-issues `play()` when a loop should run but sits paused (Safari pauses a video it judges hidden,
  around a resize), at most once per ~30 frames.

To drive it from a scene of your own, copy `ScrubVideo`'s wiring: `rehydrate` before `setMode`, `setBand(scene.band())`
on every progress event.

## 15. ScrubVideo and LoopVideo

```tsx
<ScrubVideo src="/media/orbit-1920.mp4" mobileSrc="/media/orbit-960.mp4" poster="/media/orbit.webp"
  fps={30} headLoop={{ fromFrame: 32, matchFrame: 80 }} tailLoop={{ fromFrame: 192 }}>
  <section className="h-svh">…copy riding over the render…</section>
</ScrubVideo>
```

ScrubVideo takes every PinnedScene prop and event ([scenes.md](scenes.md)), plus `glide`, `loopSeconds`, `camera`,
`backdrop`, `videoClassName` and `pinned` (more of the pin above the video, such as stacked captions); its `ref` gets
`{ scene, video, debug() }`. GSAP reads the same markup, with the sources on the video as `data-src`, `data-mobile-src`,
`poster` and `data-mobile-poster`, and `preload="none"` kept on it, or the picked source fetches at page load.
`scrubVideo(root, { fps: 30, headLoop, tailLoop })` returns the scene handle plus `video` and `controller`, or `null`
without a video.

Bringing your own clip: encode it all-intra (§13), measure seams (§2) or omit the loops to hold, add a `camera` if the
shot moves (scenes.md §7), and sample `backdrop` stops (`{ at, top, bottom }` in `#rrggbb`) from the clip's top and
bottom edges: the backdrop is a backstop for the paint before the first camera frame.

```tsx
<div className="relative">
  <LoopVideo poster="/media/kiln.webp" loopFromFrame={73} fps={60}>
    <source src="/media/kiln.webm" type="video/webm" />
    <source src="/media/kiln.mp4" type="video/mp4" />
  </LoopVideo>
</div>
```

LoopVideo renders the `<video>` and a sibling `<button>` with no wrapper, so give the parent `position: relative`.
Without `loopFromFrame` it loops natively; with it and `fps`, it plays the intro once and loops from the seam. It plays
at 20% visible, pauses when it leaves and resumes in place, never from frame 0.
GSAP marks the video `data-loop-video` (`data-loop-from-frame`, `data-fps`, `data-controls`), with an optional sibling
`<button data-loop-toggle>`, or a `<button data-loop-toggle data-loop-toggle-for="<video id>">` anywhere in the root;
mount with `initLoopVideos(routeRoot)` or `loopVideo(el, options)`, and `destroy()` pauses.

## 16. Pausing: hidden routes and WCAG 2.2.2

**Hidden routes.** With Cache Components, Next keeps visited routes alive under `<Activity>`: effects clean up on hide
and re-run on show, but a hidden `<video>` keeps playing and decoding unless something pauses it. Every block pauses in
its cleanup: LoopVideo in a layout effect (a passive cleanup can lag a paint), ScrubVideo through `controller.destroy()`.
On show, a loop resumes only if it is in view and nothing else holds it. In GSAP, call `destroy()` from `useGSAP`'s or the route's cleanup.

**WCAG 2.2.2 (Pause, Stop, Hide).** Content that moves by itself for more than 5 s beside other content needs a way to
pause it. WCAG counts how long the movement lasts, and a loop moves for as long as it is in view, so LoopVideo shows its
control whatever the cycle length; `controls={false}` (GSAP `data-controls="false"`) opts out only a loop that is
decorative and brief. It is a real `<button>` whose name flips between `pauseLabel` and `playLabel` with the
element's events, without `aria-pressed` (a toggle's name must not change with its state); a supplied GSAP button keeps
its content and gets `aria-label`. A reader's pause survives scrolling away and back; only play clears it. Footage that
carries meaning gets `alt` (GSAP `data-alt`): visually hidden text beside the `aria-hidden` video.

ScrubVideo caps its head and tail loops instead (`loopSeconds`, §14), so it ships no control.

## 17. WebGL video textures

A three.js `VideoTexture` uploads the video's frame to the GPU each time a new one is presented, at the video's full
size: size the encode to the texture you need, and pause the video off-screen and on hide
like any loop. A cross-origin video needs CORS headers and `crossOrigin = 'anonymous'`, or WebGL refuses the upload.
Scrubbing a video texture is still a `<video>` seek, with the same all-intra encode and controller.

## Traps

- [ ] A scrub asset is all-intra (`scrub-ready`); a forward-only or looping clip is not (§1).
- [ ] Seams are measured against the floor and verified on the encoded file; loops and scrubs use `qcomp=1` (§2, §13).
- [ ] Loops wrap on rVFC, never by polling `currentTime` in rAF; wraps skip the seek queue (§3, §4).
- [ ] No `load()` on the warm tier (§5).
- [ ] The compositing anchor stays; an oversized video has a scoped `max-width: none` (§6).
- [ ] The server answers `Range` with `206`, and media is cached immutable under hashed names (§8).
- [ ] Posters come from the encoded file, at the frame the scene rests on (§9).
- [ ] An intro-then-seam loop is encoded with `media loop --loop-from` (§10).
- [ ] Sound plays from a click; a refused `play()` is never retried on a timer (§11).
- [ ] A resume derives the playhead from scroll and snaps; an evicted decoder gets one `load()` (§12).
- [ ] Every video pauses in its cleanup and on hide; LoopVideo keeps its control, ScrubVideo's loop cap (§14, §16).
