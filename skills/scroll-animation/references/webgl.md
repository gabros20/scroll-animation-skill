# Real-time WebGL in a scroll scene

**Purpose:** Put a real-time canvas (three.js, R3F) in a pinned scene so it draws the scroll position in the frame
the reader sees: the pin's progress feeds the 3d skill's conductor, and the canvas renders on the scroll authority's
tick, only when something changed. The 3D itself is the 3d skill's.

**Read when:** a model turns, a camera flies or a world changes as the reader scrolls a pinned section; a canvas in a
scene lags the copy, sweeps from 0 on reload, renders off screen, or leaks contexts across routes.
**Skip when:** the move is fixed and nothing reacts to the reader: a scrub video ([video.md](video.md)) or an image
sequence ([sequences.md](sequences.md)); the pin, acts and holds ([scenes.md](scenes.md)); modelling, a GLB, a
shader, materials or the camera path (the 3d skill).

**Inputs:** the scene's ledger row in `ANIMATION.md`, the route's engine and scroll authority, the 3d skill's
conductor and canvas (or a hand-written one, §2).
**Produces:** a `render-bridge` block wired between `pinned-scene` and the canvas, the poster and canvas slots, and
the checks in §7 run.

## Contents

1. [Real-time or rendered](#1-real-time-or-rendered)
2. [Who owns what](#2-who-owns-what)
3. [The bridge: one measurement](#3-the-bridge-one-measurement)
4. [The tick per authority](#4-the-tick-per-authority)
5. [The canvas slot](#5-the-canvas-slot)
6. [Lifecycle](#6-lifecycle)
7. [Verification](#7-verification)
8. [Traps](#traps)

## 1. Real-time or rendered

A fixed camera move that nothing on the page reacts to is a rendered clip: exact at any scroll speed, no GPU risk,
no context to lose. Short rendered moves with alpha (a product turn, an exploded view) are a `frame-sequence`; long
or filmed ones a `scrub-video`. Go real-time only when the geometry has to stay live:

- the reader interacts inside the pin (pointer parallax, a hotspot, a picked colour that persists into the scroll);
- the scene is data-driven or changes per visit;
- each breakpoint needs its own composition and re-rendering the clip per breakpoint costs more than the bundle;
- the clip would be too heavy: many chapters, high resolution, long runways.

Real-time still ships a poster (the LCP element, and the whole scene under reduced motion, without WebGL and after a
lost context), loads three only when it will draw, and takes one WebGL context per kept route. Never disguise a video
as three.js, or a three.js scene as a video.

## 2. Who owns what

This is the 3d skill's table (its `scroll-conductor.md`) seen from this side:

| `scroll-animation` owns | The 3d skill owns |
|---|---|
| The scroll authority per route and the one tick, including the canvas's render call (`render-bridge`) | The conductor contract (`createConductor`), chapters, damping, `ConductorDriver` |
| The feed: the scene's exact progress into `setExact`. Inside our pin no 3d scroll adapter is attached (§3) | The adapters, for a page without our scene |
| Range wrapper, `100lvh` pin, acts, holds, `inert`, the poster and canvas slots and their CSS | What is inside the canvas: renderer, camera path, world-state channels, assets, `SceneCanvas` |
| The pin's reduced-motion collapse, the live query, the hold, pause controls | The poster and no-WebGL path inside `SceneCanvas`, skipping the 3D bundle, context-loss recovery |
| The `ANIMATION.md` row for the scene | The world bible and chapter ledger that row links to |
| Motion verification: lag, renders at rest, reload, routes (§7) | Frame QA and render cost: calls, triangles, ms per frame, asset checks |
| Pre-rendered scrub video and image sequences | Real-time 3D, and the rendered frames for a scrub |

**Hand-off.** The 3d skill owns the model, its GLB pipeline, shaders, materials, lighting, the camera path and the
render budget. Recommend `/3d` when it is installed; never invoke it. Copy its `conductor.ts` and
`r3f/SceneCanvas.tsx`; never rewrite them from memory.

**Without the 3d skill**, the minimum is still a bridge, never a scroll listener: a poster in `[data-scene-poster]`;
the WebGL and reduced-motion check before three loads; a hand-written object that satisfies `RenderConductor`
(`render-bridge.ts`), exact only (`settled` stays true, `setExact` calls its `onInput` listeners); and a `render`
that sets the pose from exact, calls its `subscribe` listeners, then `renderer.render(scene, camera)`. Dispose the
renderer when the scene unmounts. Anything beyond one object and a fixed camera is the 3d skill's work.

## 3. The bridge: one measurement

The scene already measures the range wrapper; the canvas takes that number. The 3d adapters measure the same wrapper
a second time and drift from it (S11, Chromium and WebKit):

| Event | Scene progress | 3d adapters |
|---|---|---|
| Wheel runs, jumps, reloads (native and both Lenis drivers) | 0.44 px off the rect (rounding) | the same, except the native adapter under Lenis on `gsapDriver`: 1 frame late in every frame |
| Resize | 0.44 px | 150 px off for 2 to 20 frames |
| 300 px inserted above the range | 0.44 px after `routeChanged()` | 300 px off for good (Motion and native adapters) |

`createRenderBridge(scene, conductor, { render, hold })` (`render-bridge.ts`) does the wiring, and each engine's
adapter owns the tick:

- `onProgress` → `conductor.setExact(p)`; `onRehydrate` → `setExact(state.p)`, then `settle()`, then a render.
- Exact progress, not `band`: the conductor's chapters do the pacing. Holds belong to media that scrubs.
- While it lives it registers `onRouteRefresh(() => scene.rehydrate('route'))`: without it a Motion route on native
  scroll misses a layout shift above the range until the next scroll. `destroy()` unregisters it.
- Damping is the conductor's: 4.5 to 7 on native scroll, `damping: null` under Lenis or ScrollSmoother. Never a
  second smoother on top.

## 4. The tick per authority

The canvas runs `frameloop="never"` and renders from the authority's own tick, after the driver has moved the scroll
and the engine has read it. Frames late, over moving frames (S11):

| Page | Render from | Late |
|---|---|---|
| GSAP, native or Lenis on `gsapDriver` | `pinnedSceneRender`: `gsap.ticker`, added after the driver | 0 |
| Motion, native or Lenis on `motionDriver` | `usePinnedSceneRender`: Motion's `frame.render` | 0 |
| GSAP + Lenis | R3F `demand` + `ConductorDriver` (`SceneCanvas`'s default) | 1 on every other frame |
| Motion native | `demand`, `always`, a page rAF or a `scroll` listener | 1 on every frame: a DOM label driven by `exact` sits 100 px off |
| Motion + Lenis | `demand` + `ConductorDriver` | 1 on every frame (10 px median, 23 px p95) |
| GSAP native | a `scroll` listener | 0, but smooth stalls 99 to 136 px behind |

Rendering on every tick costs 60 renders/s at rest; the bridge renders only when dirty (input since the last render,
the conductor still settling, or priming) and costs 0 at rest, off screen and in a hidden tab. ScrollSmoother runs on
`gsap.ticker` too but wasn't measured.

```ts
// GSAP: the authority first, then the bridge, then the scene
createSmoothScroll({ driver: gsapDriver(gsap, ScrollTrigger) })      // native: nothing to add
const render = pinnedSceneRender(conductor, { render: (ms) => advance(ms / 1000) })
const scene = pinnedScene(root, { onProgress: render.onProgress, onRehydrate: render.onRehydrate })
// cleanup: render.destroy(); scene.destroy()
```

```tsx
// Motion
const bridge = usePinnedSceneRender(conductor, { render: (ms) => advance(ms / 1000) })
<PinnedScene onProgress={bridge.onProgress} onRehydrate={bridge.onRehydrate} pinned={<Stage />}>{acts}</PinnedScene>
```

- `advance` takes seconds. With more than one canvas on the page, advance this one's root:
  `advance(ms / 1000, true, store.getState())`.
- Pass the two callbacks as they are; don't spread the hook's result (`requestRender` isn't a div prop).
- Never `prioritize` the ticker callback: added after the driver is what puts it in the same tick.
- There is no ambient mode: at rest nothing draws, so an idle turn or a shader's clock stops with the scroll. To keep
  one moving, call `requestRender()` once per frame while it plays (not measured), and give it a pause control
  ([accessibility.md](accessibility.md) §3).

## 5. The canvas slot

```tsx
const Stage = () => (                                  // PinnedScene's `pinned`, inside [data-scene-pin]
  <>
    <img data-scene-poster src="/media/hero-poster.avif" alt="…" width={1600} height={900} />
    <div data-scene-canvas>
      <SceneCanvas frameloop="never">…<ConductorDriver conductor={conductor} onFrame={pose} /></SceneCanvas>
    </div>
  </>
)
```

- `css/scene.css`: both slots fill the pin (`position: absolute; inset: 0`), the poster first, the canvas over it by
  source order. No `z-index`: it would lift the canvas over acts stacked in the pin.
- Without JavaScript (`@media (scripting: none)`) and in print the canvas slot is `display: none` and the poster is
  the scene. Under reduced motion it is `visibility: hidden`, so it keeps its size and shows its frame again without a
  resize when the setting is turned off.
- The poster is server-rendered, sized and designed: it is the LCP element. Leave `SceneCanvas`'s own `poster` unset;
  the slot's poster sits under it.
- `SceneCanvas` types `frameloop` as `'always' | 'demand'` today; `'never'` passes through to R3F. Cast it until the
  3d skill accepts it. Its own off-screen pause does nothing under `never`: the bridge gates.
- The pin has `pointer-events: none`; give the canvas slot `pointer-events: auto` only when the reader interacts with
  the canvas.

## 6. Lifecycle

| Event | What happens |
|---|---|
| Off screen | the bridge stops when `scene.awake()` is false (200 px wake margin): 0 renders, against 60/s ungated |
| Hidden tab | `visibilityState` gates the same way. A real hidden tab also stops rAF (headless can't hide one) |
| Reduced motion, live | the bridge follows the scene: `setReduced(true)`, `setExact(hold ?? 0)`, `settle()`, one render, scroll ignored; the slot hides and the poster shows. Turning it off rehydrates from scroll. `SceneCanvas` checks the query only at mount, and `bindReducedMotion`'s snap is overwritten by the next `setExact`, so neither covers the switch |
| Reload, `pageshow`, wake | progress that arrives before the first rehydrate or while gated lands settled (smooth = exact): the first frame is the scroll position, never a glide from 0. Real bfcache returns are unmeasured |
| First frames | `ConductorDriver` subscribes lazily, so the bridge keeps rendering after a mount, resume or rehydrate until the conductor has ticked (`PRIME_FRAMES`, 120, at most). Set the mesh's pose from `conductor.state` when it mounts, not only in `onFrame`. A canvas that mounts later (a lazy three chunk) calls `requestRender()` from an effect inside it |
| Route change | a canvas route unmounts its canvas: 1 live context after 10 round trips. Under `<Activity>` (Next's Cache Components) a hidden route keeps its context, so budget one per kept route; the bridge's effect cleanup stops its tick, but a `frameloop="always"` canvas keeps rendering at 61/s while hidden |
| View transition | the old snapshot shows the canvas's last frame pixel for pixel, even after its context is released: nothing to do |
| Context lost | `SceneCanvas` unmounts its canvas and the poster shows, for good; nothing is thrown and scrolling on is harmless. Restoring it is the 3d skill's |

A canvas that persists across routes (one context for the whole site) has no block: S11 measured a canvas per route.

## 7. Verification

`verify-motion.mjs` checks the scene's states; check the canvas from read state (a counter in `render`, the
rendered `exact`, `getContext` wrapped before load), never from screenshots alone:

- **Lag.** Over a wheel run, every frame drawn while the range moves uses that frame's progress: 0 frames late.
- **Rest.** 0 renders/s once settled, off screen and in a hidden tab; rendering resumes on return.
- **Reload.** A mid-page reload draws the scroll position first: no sweep from 0, no default pose.
- **Reduced.** A live switch holds, shows the poster and ignores scroll; switching back rehydrates.
- **Lost.** `WEBGL_lose_context` leaves the poster, no error and harmless scrolling.
- **Routes.** After ten round trips: one live context, none detached, and only the shown route answers
  `routeChanged()`.
- **No WebGL.** With `getContext('webgl')` returning null the poster shows and nothing throws.

Headless WebGL needs Chromium's SwiftShader (`--enable-unsafe-swiftshader`). A real device still owes three checks:
a real hidden tab, a real bfcache return, and iOS with the toolbars shown, where the scene's range uses
`innerHeight` while the pin is `100lvh` (S5's caveat).

## Traps

- [ ] A fixed move nothing reacts to is a sequence or a scrub video, not a canvas (§1).
- [ ] The canvas is fed by the scene; no 3d scroll adapter on the same wrapper (§3).
- [ ] `frameloop="never"`, rendered by `pinnedSceneRender` or `usePinnedSceneRender`; never `demand` + `invalidate()`,
  a page rAF or a `scroll` listener (§4).
- [ ] The GSAP authority is created before `pinnedSceneRender`; the ticker callback isn't prioritised (§4).
- [ ] One smoother: the conductor's damping is `null` under Lenis or ScrollSmoother (§3).
- [ ] A designed poster sits first in the pin; the canvas slot carries no `z-index` (§5).
- [ ] The mesh takes its pose from `conductor.state` on mount; a late canvas calls `requestRender()` (§6).
- [ ] No `frameloop="always"` on a route Cache Components may keep; one context per kept route (§6).
- [ ] Ambient WebGL that moves by itself for more than 5 s has a pause control ([accessibility.md](accessibility.md) §3).
