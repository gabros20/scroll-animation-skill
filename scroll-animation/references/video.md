# Video

**Read when:** you're shipping a `<video>` that scrubs with scroll, loops, autoplays conditionally,
or needs to survive a tab going to sleep mid-scene. Also when a loop pops or stutters at its seam, or
a scrub "feels like mud".
**Skip when:** the asset is a static image or a triggered (non-scroll-bound) animation (see
`motion-architecture.md`). For how a video element *renders* (sizing in fluid units, reserving
dimensions against CLS, art-directed `<picture>` fallbacks), the `fluid-design` skill's
`references/media.md` covers the layout side; this file covers playback.
**Depends on:** `scroll-scenes.md` for the pin geometry and the three-clocks model a scrubbed video
sits inside; `performance.md` §6 for the IntersectionObserver-gating budget every video here assumes.

Every number in this document was measured against a real asset, not assumed. The measurement
techniques (PSNR seam-matching, motion-floor loop detection, colour-curve grading) are reusable:
re-run them on a new asset rather than eyeballing a new one's loop point or gutter colour.

## Contents

1. [All-intra is for scrub, not for native playback](#1-all-intra-is-for-scrub-not-for-native-playback)
2. [Loop-point derivation by PSNR / motion floor](#2-loop-point-derivation-by-psnr--motion-floor)
3. [The rVFC wrap](#3-the-rvfc-wrap)
4. [Seek coalescing](#4-seek-coalescing)
5. [Preload tiers](#5-preload-tiers)
6. [The `translateZ(0)` anchor](#6-the-translatez0-anchor)
7. [The Preflight `max-width` trap](#7-the-preflight-max-width-trap)
8. [`<source media>` tiers and resync](#8-source-media-tiers-and-resync)
9. [Posters](#9-posters)
10. [Forced keyframes at loop seams](#10-forced-keyframes-at-loop-seams)
11. [Autoplay policy](#11-autoplay-policy)
12. [Tab-sleep rehydrate](#12-tab-sleep-rehydrate)
13. [Encoding recipes](#13-encoding-recipes)
14. [The imperative controller](#14-the-imperative-controller)
15. [Bringing your own asset to `ScrubStage`](#15-bringing-your-own-asset-to-scrubstage)
16. [Traps](#traps)

## 1. All-intra is for scrub, not for native playback

Scrubbing seeks on nearly every scroll frame, and a seek costs a decode from the nearest keyframe.
At a conventional GOP length that can mean decoding up to the whole GOP per seek, which is exactly
what "the scrub feels like mud" looks like. All-intra (every frame a keyframe: `keyint=1,
min-keyint=1, scenecut=0`) makes every seek a single-frame decode. A scrub stuck on its first frame
and then jumping is the same bug at its worst.

**This trade is specific to scrub.** A video that only plays forward, or loops without arbitrary
seeking, gets nothing from all-intra and pays for it in bitrate: inter-frame compression is most of
what keeps a normally-encoded clip small. In the reference build, the one pinned scrub scene is
all-intra, and the others should be conventional encodes. One was not: a 4-second 1080p rack-server
clip that only ever plays forward shipped all-intra at 26.5 MB (measured with ffprobe: every frame a
keyframe). A normal GOP would have been a small fraction of that for identical playback. Check new
clips with `ffprobe -select_streams v -show_frames -show_entries frame=pict_type -of csv` before
shipping. Reach for all-intra only when the component genuinely maps scroll position to
`currentTime`.

A genuinely counter-intuitive result, worth keeping in mind before assuming "all-intra = bigger": a
badly-encoded master (inefficient GOP structure, inflated bitrate) can come out **smaller** after an
all-intra re-encode at a sane CRF, simply because the master was wasting bits on something other
than quality. One measured case went from 60MB at GOP 28 / 51 Mbps down to 7.2MB all-intra at CRF
22: eight times smaller, with *better* seek behaviour. The lesson isn't "all-intra shrinks files".
It's **probe the codec, GOP structure and bitrate of any "master" before trusting its size as a
quality signal.** A large file is not necessarily a good one.

```bash
ffmpeg -i IN.mp4 -c:v libx264 -preset slow -crf 22 \
  -x264-params "keyint=1:min-keyint=1:scenecut=0:qcomp=1" \
  -pix_fmt yuv420p -movflags +faststart -an OUT.mp4

# verify — every single frame must report key_frame=1
ffprobe -v error -select_streams v:0 -show_entries frame=key_frame -of csv=p=0 OUT.mp4 | sort | uniq -c
```

**`qcomp=1` matters for a looping or scrubbed clip specifically, and is easy to miss because
nothing about the command looks wrong without it.** CRF is not a fixed quantizer: `qcomp`
("quantizer compression", x264's default 0.6) lets the rate controller spend a *different* QP on
different frames of the same encode, biasing bits toward frames it judges more important (a scene's
first frame typically gets the most). Two byte-identical MASTER frames (the two ends of a loop,
deliberately built to match) can therefore decode to measurably *different* output. One measured
case put the two encoded ends of a loop at ~32dB PSNR against each other, entirely from CRF's own
per-frame QP variance, with nothing else different about the source. That reads as a visible
sharpness pop at every wrap, on a clip whose master was verified pixel-identical at the seam (§2):
the master check passed and the shipped asset still popped. `qcomp=1` disables the per-frame bias
(identical input quantizes identically, so identical input decodes identically); constant-QP (`-qp
N` instead of `-crf N`) is the more extreme version of the same fix, at the cost of losing CRF's
content-adaptive bit allocation entirely. Either raises the effective CRF/QP needed to hit a given
file size versus content-adaptive `qcomp`, so budget for that, not for identical size at identical
CRF.

**Seams are verified on the ENCODED file, not the master: decode both frames and compare.** §2's
PSNR/motion-floor method is for *deriving* the loop points from source material; it works on
whatever frames you feed it, master or otherwise. But confirming the SHIPPED asset is actually
seamless is a different check, and it must decode the delivered file to do it. A `qcomp`-induced pop
like the one above exists only in the encoded bitstream's output, invisible to any comparison run
against the pre-encode master:

```bash
ffmpeg -i OUT.mp4 -vf "select=eq(n\,LAST_FRAME)" -vsync 0 -frames:v 1 last.png
ffmpeg -i OUT.mp4 -vf "select=eq(n\,0)"           -vsync 0 -frames:v 1 first.png
ffmpeg -i last.png -i first.png -lavfi psnr -f null -
```

## 2. Loop-point derivation by PSNR / motion floor

A clip that must loop seamlessly needs its re-entry frame *measured*, not eyeballed. The mistake
almost everyone makes first: comparing frame `L` (the re-entry point) to frame `E` (the last frame)
and asking them to be identical. That freezes the subject for one visible frame at every loop.

**The correct condition** is that frame `L−1` looks like `E`'s natural successor:

```
frame[L−1]  ≈  frame[E]
```

Compare `L−1` to `E`, then *enter* at `L`, the natural continuation.

**The threshold is a measured floor, not zero.** Compute the mean absolute pixel difference between
consecutive frames across the clip's steady (non-intro) section. That average is the "motion already
present" baseline. Any candidate seam costing at or below that floor is invisible, because it
differs by less than two adjacent real frames already differ by:

```python
floor = np.mean([np.abs(A[i+1] - A[i]).mean() for i in range(100, E)])
for L in range(30, 140):
    cost = float(np.abs(A[L-1] - A[E]).mean())
    # cost <= floor  →  seamless
```

Reading the resulting cost curve tells you what kind of clip you have:

- **One sharp minimum well below the floor** → a single cycle period; the loop point is determined
  by the render, not a matter of taste. An eyeballed guess in one measured case cost 4.12 against a
  0.90 floor, over four times the visible threshold.
- **Several minima** → rotational symmetry; take whichever gives the longest usable segment.
- **Nothing reaches the floor** → the clip doesn't contain a whole cycle; re-export, or fall back to
  a crossfade.

**Second check, easy to skip:** the seam can be numerically perfect while the loop still looks wrong
if the segment's early frames still carry decaying motion from an intro. Plot motion magnitude
across the candidate segment: flat is good; decaying means the intro's settle is inside the loop and
will replay every cycle.

**The easy route, when the source is synthetic rather than filmed: build the loop periodic by
construction instead of measuring one out of a longer render.** A generated clip (a shader loop, a
procedural camera path, an eased parameter sweep) can be authored so its last frame's *state* is
defined to equal its first frame's. The render's own parameters then guarantee `frame[0] ≈
frame[last+1]` rather than that identity having to be *discovered* by scanning for a PSNR minimum
across candidate seams. This turns the whole of this section's measurement work into a single sanity
check (confirm the two ends actually match, since a construction bug can still break the guarantee)
instead of a search. Reach for it whenever you control the generator; the PSNR/motion-floor method
above is for when you don't: a filmed or hand-animated clip that already exists and must have its
seam found after the fact.

**"The parameters match at both ends" is not the same guarantee as "the pixels match."** A
procedurally rendered loop can be POSE-periodic (every parameter driving the render, such as camera
angle, light position or a sway term, genuinely returns to its starting value) and still not be
PIXEL-periodic, because the renderer used to turn that pose into pixels is not guaranteed to be
resample-identical at every value along the sweep. Measured: a PIL `Image.rotate()` call in a frame
generator returns an UNRESAMPLED copy at exact multiples of 90°, so the frames where a sway term
happened to land on 0 (pose-identical to the frames around them) came out visibly SHARPER than their
resampled neighbours, a periodic flicker with nothing wrong in the render's own parameters. The
general lesson: verify the pixels a construction-guaranteed loop actually produced (the sanity check
above), not just the parameter sweep that was supposed to guarantee them. A renderer, filter or
resampling step in the pipeline can reintroduce exactly the non-periodicity "build it periodic by
construction" was meant to avoid.

On the web, a `loop` attribute forces re-entry at frame 0 and suppresses the `ended` event. For a
mid-clip loop point, don't use it:

```jsx
<video ref={ref} src={src} muted playsInline preload="none" />
```

```js
video.addEventListener('ended', () => {
  video.currentTime = LOOP_IN_FRAME / FPS
  void video.play().catch(() => {})
})
```

(`InViewLoopVideo`'s `loopFromFrame`/`fps` props and the GSAP `data-loop-from-frame` + `data-fps`
attributes implement this intro-then-seam policy.)

## 3. The rVFC wrap

Frame-accurate looping cannot be done by polling `currentTime` inside `requestAnimationFrame`, even
with a threshold guard, and this costs real debugging time if you don't already know why.

rAF runs at roughly 60Hz, so a threshold check lands anywhere within the following ~16.7ms window,
which can land exactly where the loop's "match" frame begins, and a seek's own latency stacks on
top. The visible symptom is a one-frame flash of the very first frame of the loop's motion,
perceived as "the loop jitters" even though the seam itself measured seamless offline (§2).

`requestVideoFrameCallback` (rVFC) fires once per **presented** frame and hands over that frame's
exact `mediaTime`, so the wrap decision is made on a frame *index*, never on a clock reading that's
already stale by the time it's read:

```js
const onFrame = (_now, meta) => {                    // requestVideoFrameCallback
  const frame = Math.round(meta.mediaTime * FPS)      // the frame ON SCREEN, exact
  if (frame >= matchFrame - 1 || meta.mediaTime < wrapFrom - 0.001) {
    seeking = false; pending = null                    // DIRECT — never queue a wrap behind
    video.currentTime = wrapFrom                        // another pending seek (§4)
  }
  video.requestVideoFrameCallback(onFrame)
}
```

Keep an rAF-based fallback for browsers without rVFC, but wrap a **full** frame early there instead
of half: losing the last frame of a cycle is cheap; presenting the first frame of the next motion
early is the visible fault. Verify by logging presented frame indices across a session; the sequence
must read as a clean sawtooth (`… 78 79 32 33 …`) with nothing outside the intended range, ever.

## 4. Seek coalescing

A seek issued while another is still outstanding is **silently dropped by the browser**: not
queued, dropped. Without a guard, the newest target is lost and the render visibly lags the
scrollbar.

```js
let seeking = false, pending = null
video.addEventListener('seeked', () => {
  if (pending !== null) { const n = pending; pending = null; video.currentTime = n }
  else seeking = false
})
const seek = t => { if (seeking) { pending = t; return } seeking = true; video.currentTime = t }
```

The one exception: a loop wrap (§3) must bypass this queue entirely and write `currentTime`
directly, clearing any pending seek first. A wrap queued behind a stale pending seek arrives a frame
late, which reintroduces exactly the flash this coalescing exists to prevent elsewhere.

Also: Safari specifically queues seeks and falls behind if more than one is genuinely in flight. An
imperative controller layer should enforce "one seek in flight at a time" as a hard rule, with a
sub-frame epsilon below which a seek is skipped entirely rather than issued (roughly half a frame at
the asset's fps is a reasonable floor; the shipped controller uses 1/60s, half a frame at 30fps).

## 5. Preload tiers

Three tiers, each buying something different, and conflating them is the common mistake:

| Tier | Trigger | Buys |
| --- | --- | --- |
| **none** | default, off-screen | zero network cost for a visitor who never scrolls there |
| **warm IO** | a wide `IntersectionObserver` margin (several hundred px out) | the network fetch and decoder handshake finish *before* the reader arrives |
| **play IO** | a tight margin (near the actual edge, or a visibility threshold) | playback starts only once genuinely on screen |

Warm **early**, wake **late**. The two buy different things, and collapsing them into one observer
either wastes bandwidth (warming too early) or stalls on arrival (warming too late). A multi-megabyte
video decoding three screens away from the viewport is pure cost; gating it correctly is what makes
even one scrubbed scene affordable at all (`performance.md` §6).

**Never call `.load()` on the warm tier.** It's tempting (`preload = 'auto'; video.load()` reads
like "start fetching"), but on phones this **aborts an in-progress `play()`**. `load()` re-runs the
full media-element resource-selection algorithm, which is also the correct tool for a different job
entirely: re-evaluating `<source media>` after a tier flip (§8) or recovering a video whose decoder
was evicted after a long background tab (§12). Reach for it only in those two cases, never as a
generic "start loading" call on the warm path. Setting `preload = 'auto'` alone is enough to hint the
browser to fetch.

**But "enough to hint the browser to fetch" assumes the element already has something to fetch.**
Two element shapes need different warm-tier code, and conflating them is how this rule gets
half-applied:

- **`InViewLoopVideo` (and its GSAP twin, `data-loop-video`): the `<source>` children exist at
  mount.** The browser already knows what it would fetch; `preload = 'auto'` alone is the whole
  fix, and an explicit `.load()` on top of it only risks re-running resource selection while a
  `play()` from a second, tighter observer is already in flight. Measured: both observers can fire
  in the same batch on a phone, and `.load()` there left a fully-buffered video paused forever.
- **`ScrubStage` (React and GSAP): the `<video>` starts genuinely SRC-LESS.** Only `data-src`/
  `data-mobile-src` (or, in React, a `null` `resolved` state) hold the real URL until JS assigns it,
  so there is nothing for `preload = 'auto'` to hint toward until that assignment happens. The fix
  here is not "add `.load()` back": setting the `src` IDL attribute is itself what starts the fetch
  (assigning `src` runs the same resource-selection algorithm `.load()` would trigger), so the warm
  tier only needs to assign `src` if it isn't set yet (GSAP: `if (!video.getAttribute('src'))
  video.src = …`; React: the `resolved` prop typically already reached the element by the time the
  warm margin fires) and set `preload = 'auto'`. No explicit `.load()` call is needed on top of an
  assignment, and nothing has played yet at the warm stage for one to abort even if it were called.

The rule is really one rule, not two: *the warm tier's job is to make sure the element has a source
and a preload hint, using whichever of those two steps this element's markup doesn't already
provide, never an unconditional `.load()`.*

## 6. The `translateZ(0)` anchor

A `translateZ(0)` (or `translate3d(...)`) inside a video's transform string is a load-bearing Safari
compositing anchor, not decoration. It's one of the few standing exceptions to "no `will-change`, no
forced compositing" (`performance.md` §10), and it should stay inside whatever composed transform
string a camera or scrub scene writes per frame (`scroll-scenes.md` §6), not as a separate
declaration that a later refactor might drop.

## 7. The Preflight `max-width` trap

Most CSS resets (Tailwind's Preflight among them) set `video { max-width: 100% }`. That silently
clamps a video that's *deliberately* oversized relative to its container: the common case for a
scrub scene's camera, which needs the asset larger than the viewport so it can pan and zoom without
exposing an edge.

The symptom reads as a mis-cropped video, not a broken one, which is what makes it slow to diagnose.
Because the video's **height** is usually derived from the same custom property as its width, the
height stays correct while the width silently clamps to the container: `offsetWidth` equals the
container's width exactly where it should be much larger, while the aspect ratio looks merely wrong
rather than obviously broken. Fix: `max-w-none` on the video element, scoped to whichever breakpoint
the oversized camera treatment applies at. Never globally: a blanket override reintroduces exactly
the overflow the reset existed to prevent, everywhere else on the site.

## 8. `<source media>` tiers and resync

Multiple `<source media="...">` tiers pointing at different crops (desktop vs. mobile framing) work,
with one hard rule most people don't expect: **`<video>` evaluates its `<source media>` queries
exactly ONCE**, during initial resource selection, unlike `<picture>`, which re-evaluates on every
resize.

Stack a `<picture>` poster behind a `<video>` in the same box and the two are only interchangeable
while they hold the same framing tier. Cross the breakpoint without reloading the video and the
poster swaps tier while the video keeps its original file: the two backgrounds now draw at different
scales with a hard edge between them ("double background").

**`.load()` is the resync mechanism**, and it should fire on a genuine flip of *either* the width
query or a `prefers-reduced-motion` change. Reduced motion is part of source selection too: turning
it on mid-session should make resource re-selection find no matching source, drop the video's
resource, and let a poster show through cleanly.

```js
mediaQuery.addEventListener('change', () => {
  const wasPlaying = !video.paused
  const t = video.currentTime
  video.load()                              // re-runs source selection against the new tier
  video.addEventListener('loadedmetadata', () => {
    try { video.currentTime = t } catch { /* best-effort */ }
    if (wasPlaying) void video.play().catch(() => {})
  }, { once: true })
})
```

The playhead carries across; if the resumed `play()` is refused for lack of a user gesture, catch it
and let whatever UI mirrors playback state (§11) fall back to its paused/idle rendering. This matters
less than it sounds for pure-phone traffic (nothing loads a desktop tier and then narrows below it),
but it's real on a desktop window dragged across the breakpoint and on tablet rotation. Check which
physical devices straddle your tier boundary before shipping one.

## 9. Posters

A JPEG poster export and the *decoded first frame* of the video it covers are almost never
pixel-identical (different colour pipeline, different compression artefacts), and the mismatch
shows as a visible flash the instant the video starts decoding over a static poster, especially
under any blend mode (`mix-blend-mode: lighten` and similar amplify small colour deltas). Two
consequences:

- **Export the poster from the encoded output, not from the source master.** A poster pulled from
  the pre-encode master will not match what the codec actually produces on decode; pull it from the
  delivered file (`ffmpeg -ss T -i encoded.mp4 -frames:v 1 poster.jpg`) so the two are the same
  pixels through the same pipeline.
- **The poster cannot be art-directed independently of the video**: it has to be a specific frame
  of the same asset. If the design wants a genuinely different, art-directed still (a different crop
  or composition than any frame the video passes through), that's a job for a separate `<picture>`
  element with its own `media` tiers underneath the video, not for the `poster` attribute.

Where the flash matters most (mobile, where decode is slower and the effect more visible), consider
dropping the poster attribute entirely and fading the video element in once its first frame is
confirmed decoded, rather than fighting a poster/frame mismatch.

## 10. Forced keyframes at loop seams

Even a normally-GOP-encoded (non-scrub) looping clip needs an explicit keyframe forced at its loop
re-entry point:

```
-force_key_frames 13.75
```

Without it, the backward seek on loop re-entry lands mid-GOP, and the decoder rewinds to the
*previous* keyframe and re-decodes everything between there and the target. On a fast loop cycle
(well under a second) that's a visible hitch on every single repeat, not just the first.
Re-encoding such an asset without preserving this forced keyframe is a regression that won't show
up until someone notices the loop stutter in production.

## 11. Autoplay policy

No browser starts **unmuted, audible** playback without either a user gesture or a site-specific
engagement allowlist the page cannot query or influence (Safari's per-site permission, Chrome's
Media Engagement Index). This is enforced inside the media stack, unreachable from any attribute or
script. Do not attempt the "start muted, then unmute programmatically" workaround for a video that's
supposed to carry sound: it depends on engine-specific grants that can revoke mid-playback, and a
hero that flip-flops between muted and audible depending on which browser opened it is worse than
one honest, consistent control.

**The reliable pattern for sound-carrying video:** the element preloads (or at least holds its
poster/first frame) but never calls `play()` itself. A visible play control sits over it, and the
`play()` call happens *inside the click handler*: gesture-backed, and therefore never refused, on
any engine, first visit or hundredth. This is strictly better than autoplay-plus-permission-probing:
one press, picture and sound together, every time.

**Muted, decorative loops** (no audio track, purely ambient motion) are the one case where autoplay
is uncontroversial. Give them `muted playsInline` (iOS will not play inline without both) and gate
them on an `IntersectionObserver` (§5) rather than firing at mount, so nothing plays off-screen.
`scripts/audit-motion.mjs`'s `video-attrs` rule flags a video missing these.

If a control mirrors play/pause state in the UI, make the **element** the single source of truth
and have the UI only mirror it. Every path that can change playback (a click, a refused programmatic
`play()`, a tier resync, an autoplay policy rejection) should update the element and let a `play`/
`pause` event listener sync the UI, rather than the UI driving the element and hoping it agrees.

## 12. Tab-sleep rehydrate

> **Scroll position is the only durable truth. Video `currentTime` is always derived from scroll. On
> any resume, re-measure and snap; never trust a playhead that slept.**

After a long background tab, a browser may freeze `requestAnimationFrame`, evict the decoder, or
leave a video's `currentTime`/readiness state stale while the page's scroll position is still
completely correct. A scrubbed scene that only tracks `awake`/mode via scroll *events* misses this
class of bug entirely, because nothing scrolled: the tab was simply asleep and woke up desynced.
Scroll says "head", the decoder is still parked near the tail.

**The fix is a single coalesced `rehydrate(reason)` routine**, not three separate patches for three
separate wake events:

1. Re-measure pin range and video/pin geometry.
2. Wake the scene if its range is near the viewport, or if progress is strictly between 0 and 1
   (proof the range straddles the viewport regardless of what the last-known `awake` flag says).
3. Read current scroll progress.
4. Derive mode and target playhead time **absolutely** from that progress (not via the live
   edge-plus-hysteresis stepper in `scroll-scenes.md` §3, which is for in-session transitions: a
   cold resume wants an unambiguous answer, not a state machine that assumes it already knows where
   it was).
5. Update any dependent visual state (backdrop colour, camera framing) from the same progress.
6. If the video's `duration` is invalid (decoder evicted), issue a **single** soft `video.load()`
   and re-run rehydrate on `loadedmetadata`. Never loop this recovery attempt unconditionally.
7. If now awake, **snap** the playhead to the derived time, with no glide. A live in-session
   handoff between modes glides; a cold resume snaps, because there are no "in between" frames
   worth playing on the way from a stale time to the correct one.
8. If off-screen, pause only. Do not spin the decoder for a scene nobody's looking at.

**Triggers, coalesced to one call per animation frame** so a burst of `visibilitychange` + `focus` +
`pageshow` doesn't seek three times in a row:

| Reason | Fires on |
| --- | --- |
| `visibility` | `document.visibilitychange` → `'visible'` |
| `focus` | `window` `focus` |
| `bfcache` | `pageshow` with `event.persisted` |
| `wake` | the scene's own `awake` flag flipping false → true |
| `mount` | first paint: progress may already be mid-range with no scroll event yet to explain it |
| `resize` | an existing geometry recheck path |
| `metadata` | after step 6's media-recovery `load()` resolves |

All of these APIs are long-stable across engines. `requestVideoFrameCallback` is **not** required for
this path: the loop wrap (§3) already falls back to rAF, and a cold resume doesn't need frame
accuracy, only correctness.

**Explicitly rejected approaches**, because they were tried: do not force-scroll the visitor back to
the section on resume, do not force a full-page reload on focus, and do not persist mode/time in
`sessionStorage`. It fights the scroll position (which is already durable truth) and goes stale
faster than it helps.

A dev-only probe function exposed on `window` that snapshots the scene's internal counters (scroll
events seen, awake state, rAF ticks, rejected `play()` calls, recovery attempts) is worth building
early. It turns "the video is frozen" bug reports into "which counter didn't move," which is the
difference between a five-minute diagnosis and an unreproducible ticket. `ScrubStage` ships one as
`window.__scrub()` (`verification.md` §1).

## 13. Encoding recipes

```bash
# Probe before trusting a "master" — codec, GOP, bitrate, frame count
ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height,r_frame_rate,nb_frames,duration,codec_name,pix_fmt \
  -of default=noprint_wrappers=1 IN.mp4

# All-intra, for a scrub asset only (§1). qcomp=1 is required for a LOOPING or
# SCRUBBED clip (§1) -- without it, CRF's per-frame rate control can quantize
# two byte-identical master frames differently and pop at every wrap.
ffmpeg -i IN.mp4 -c:v libx264 -preset slow -crf 22 \
  -x264-params "keyint=1:min-keyint=1:scenecut=0:qcomp=1" \
  -pix_fmt yuv420p -movflags +faststart -an OUT.mp4

# Extract a candidate loop segment with a forced keyframe at the seam (§10),
# qcomp=1 again for the same reason
ffmpeg -i IN.mp4 -vf "select='between(n\,73\,162)',setpts=PTS-STARTPTS,format=yuv420p" \
  -an -c:v libx264 -profile:v high -crf 20 -preset veryslow -g 90 \
  -x264-params "qcomp=1" -movflags +faststart OUT.mp4

# Colour-match a render's background to a CSS surface: pin black/white, grade the midpoint
ffmpeg -i IN.mp4 -vf "curves=\
r='0/0 0.929412/0.988235 1/1':\
g='0/0 0.733333/0.800000 1/1':\
b='0/0 0.188235/0.211765 1/1',format=yuv420p" -an -c:v libx264 -crf 20 -preset veryslow OUT.mp4

# Poster from the ENCODED output, not the master (§9)
ffmpeg -ss $(python3 -c "print(FRAME/FPS)") -i encoded.mp4 -frames:v 1 poster.jpg

# SSIM check before spending bytes on a higher-resolution re-export
ffmpeg -v error -i CANDIDATE.mp4 -i SOURCE.mp4 \
  -lavfi "[0:v]scale=W:H:flags=lanczos[a];[a][1:v]ssim=stats_file=-" -f null -
```

Practical notes that came out of using these on real assets:

- Large flat colour fields band before detail does, so that's where to spend CRF budget. A
  mostly-flat small loop can drop from CRF 20 to CRF 31 for a fraction of the size with no visible
  banding, while the same jump on a detailed frame would show.
- `-movflags +faststart` always; `-an` for anything with no audio track; `-g` set to the loop length
  so the loop point itself is a keyframe (redundant with `-force_key_frames` for a single seam, but
  required if the clip loops more than once per encode).
- Even dimensions are required for `yuv420p`.
- An 8-bit `yuv420p` round-trip costs roughly 1–3 units per channel versus a target hex value.
  Landing a few units off an exact brand colour after encode/decode is expected, not a bug; verify
  against what's already shipping before chasing exactness.
- Resolution is not always the bottleneck. A 1.33× linear-resolution bump bought +0.0008 SSIM in one
  measured case: the limit was compressing smooth gradients, not pixel count. Run the SSIM check
  before assuming "softer" means "needs more resolution."
- All-intra re-pays background texture every frame (`performance.md` §13): a textured ground cost
  37MB at CRF 22 / 1600×900; softening the texture and dropping to 1440×676 brought the same shot to
  9MB. Prefer a flatter background for anything that will be scrub-encoded.
- Sanity-check delivered size against whatever it replaces before it lands in version control. A
  large jump (an order of magnitude) is worth raising before committing: a version-control system
  keeps every blob forever, so an oversized asset's clone-time cost doesn't come back once optimised
  later; it just becomes permanent history.
- `qcomp=1` (or `-qp` constant-QP) costs bitrate versus content-adaptive `qcomp` at the same visual
  quality, so expect to raise CRF a few points to hold a target size once it's on. One measured loop
  held ~9MB by moving from CRF 22 to CRF 33 with `qcomp=1`; the flat-field CRF-budget note above
  still applies on top of that.
- Verify a loop or scrub asset's seam on the ENCODED output specifically (§1's `ffmpeg … -lavfi
  psnr` pair), never on the master alone: a `qcomp`-induced pop exists only in the delivered
  bitstream.

## 14. The imperative controller

`assets/react-motion/lib/videoController.ts` and its GSAP twin `assets/gsap/src/videoController.ts`
isolate the WebKit hardening from the scroll and easing logic, so the state machine never touches
the element directly. It tracks a single `desiredPlaying` intent (`play()` sets it,
`pause()`/`reset()` clear it) and owns four fixes:

- **Decoder priming.** iOS won't paint `currentTime` seeks on a video that has never started. A
  muted `play()` then `pause()` warms the pipeline so the first scrub seek actually paints (undone
  only if nothing intends to play by the time it resolves).
- **Guarded seeking.** One seek in flight at a time, plus a sub-frame epsilon (§4).
- **Playback that survives a mid-seek `play()`.** During a fast scrub the handoff lands while a
  seek is still resolving, and Safari silently drops a `play()` issued mid-seek (the slow path works
  because the seek has long settled). So when `video.seeking`, wait for `seeked`, with a 150ms
  timeout fallback in case the event never fires, then play.
- **A watchdog, `ensurePlaying()`.** WebKit can demote the video's GPU layer and silently pause it,
  and browsers pause when a tab hides. While the intent is set, re-issue `play()` from a tick inside
  the already-gated loop and from `pause`/`visibilitychange` listeners, skipping a legitimately
  ended video and a hidden tab (`ios-safari-motion.md` §2).

Use it standalone for a simpler scrub without loops.

## 15. Bringing your own asset to `ScrubStage`

Every measured constant from the reference build is a prop (React) or option (GSAP) with that
measured value as its default: `fps`, `headLoop`, `tailLoop`, `headHoldPx`, `tailLeadPx`,
`hysteresisRatio`, `warmMarginPx`, `wakeMarginPx`, `glide`, `backdropStops`. Re-measure them for
YOUR clip; they will not generally be correct for someone else's.

1. **Re-encode all-intra, with `qcomp=1`** (§1, §13).
2. **Find your loop seams** if you want head and tail loops rather than a plain hold on the first
   and last frames (§2). Set `headLoop={{ fromFrame, matchFrame }}` and `tailLoop={{ fromFrame }}`.
   The tail's match frame is always the clip's own last frame, read from `video.duration` at
   runtime.
3. **Optionally build a `camera`** (`scroll-scenes.md` §7). Omit it for a plain `object-cover` scrub
   (no pan or zoom; often enough). To pan and zoom, cut your asset from one square canvas at two
   crops (`desktop`/`mobile`), supply where your subject sits in each crop (`subject`) and where it
   should land on screen at each end of the pan (`shots`), plus the base on-screen size
   (`frameSize`, a multiple of viewport height: height-driven, because viewports vary far more in
   aspect than in height). The reference build's own camera numbers are that render's measured
   composition and are not shipped; the GSAP port defaults every camera field to identity.
4. **Sample your own backdrop ramp** (`backdropStops`) from your asset's top and bottom edges. It is
   only a backstop for the paint before the first camera frame, but should roughly match so that
   backstop isn't jarring.

## Traps

- [ ] ★ A scrub asset is all-intra: a non-all-intra one makes scrubbing a slideshow, since every
  seek decodes from the nearest keyframe (§1).
- [ ] ★ No all-intra on a video that only plays forward: it pays a real bitrate cost for nothing
  (§1).
- [ ] ★ Loops wrap on `requestVideoFrameCallback`, never by polling `currentTime` in rAF (§3).
- [ ] ★ Seeks are coalesced: one issued while another is outstanding is silently dropped (§4).
- [ ] ★ No `.load()` on the warm preload tier: it aborts an in-progress `play()` on phones (§5).
- [ ] ★ A deliberately oversized scrub video carries a scoped `max-w-none` against the reset's
  `max-width: 100%` (§7).
- [ ] ★ Loop and scrub encodes use `qcomp=1` (or constant QP); seams are verified on the encoded
  output, never the master (§1, §2).
- [ ] The poster is pulled from the delivered file, not the pre-encode master (§9).
- [ ] A video paired with a resize-reactive poster resyncs with `.load()` on tier flips: `<video>`
  evaluates `<source media>` once (§8).
- [ ] A re-encoded loop keeps its forced keyframe at the seam (§10).
- [ ] Sound-carrying video plays from a click handler; no permission probing or mid-session unmute
  (§11).
- [ ] Every autoplaying loop is `muted playsInline` and IO-gated (§11).
- [ ] After a tab wakes, the scene rehydrates from scroll progress; it never resumes in place (§12).
- [ ] A big "master" file is not evidence of quality: probe codec, GOP and bitrate first (§1, §13).
