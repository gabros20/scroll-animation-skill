# Fluid interop: with a fluid-scaled layout, and without one

**Read when:** the project also uses the `fluid-design` skill (a `fluid.config.json`, `--fluid`
custom properties, `fluid-*` utilities), or you're installing these primitives on a site that
doesn't, and need to know which parts depend on the scale.
**Skip when:** neither applies: you're only tuning an entrance or a video.
**Depends on:** `scroll-scenes.md` §1, §2, §8.

The two skills meet at three things only: the fluid units, the engage breakpoint, and `--header-h`.
Everything else is independent, and every primitive here runs on a plain px layout.

## 1. The engage breakpoint: one number, one source

Both engines keep one constant for "where the desktop composition starts":
`ENGAGE_BREAKPOINT_PX`/`ENGAGE_QUERY` in `assets/react-motion/lib/constants.ts`, and
`ENGAGE_PX`/`ENGAGE_QUERY` in `assets/gsap/src/config.ts`. Stages read it for `marginLg`/
`data-stage-margin-lg`, the scroll well for `thresholdLg`, the scrub scene for its desktop crop.

- **With `fluid-design` v2:** its `fluid.config.json` `bands.desktop.minWidth` is the source.
  `fluid generate` writes it into the generated `fluid.ts` (in the fluid output folder, e.g.
  `src/styles/fluid/fluid.ts`) as `DESKTOP_PX`/`DESKTOP_QUERY` (plus `ENGAGE_PX`/`ENGAGE_QUERY`
  aliases of the same values) — import those and re-export them from the constants file instead of
  the literal. Nothing in these files reads the config at runtime, so a hand-kept `1024` silently
  stops matching the moment `bands.desktop.minWidth` changes.
- **Without it:** set the literal to the site's own desktop breakpoint (Tailwind's `lg`, your SCSS
  `$desktop`, whatever marks the same width). Three copies of one number drift; keep it in this one
  file and import it everywhere else.

## 2. Fluid lengths inside motion code

The scroll well (`scrollPull`) is the only primitive that spends `--fluid`: its tuning numbers
(`maxSpeed` 800, `minSpeed` 120 reference-px/s; `releaseAwayPx`, `reclaimPx` 320 reference px) are
multiplied by the resolved unit, so a threshold means the same fraction of the composition at every
window size. It reads the unit with a probe element sized `calc(1000 * var(--fluid))`, because
`--fluid` is an unregistered custom property and `getPropertyValue` returns the token string, not a
number (`parseFloat` on it is `NaN`).

- **With `fluid-design`:** it just works. `--fluid` is defined in `svh`, so it is already blind to
  the iOS toolbar.
- **Without it:** the probe measures 0, and the well falls back to a unit of 1: every threshold is
  plain px, as tuned at a 1440×900 reference. That is correct at that size and proportionally
  stricter or looser elsewhere. If the site has its own scale variable, point the probe at it.

What never scales, with or without the scale: the 1.5px rest epsilon and every millisecond duration.

## 3. Distances: small entrances stay fixed, travel scales

A drawn distance means a fraction of the composition. On a fluid page the composition is 1.6×
larger at 2560×1440 than at 1440×900, so a `600` that crosses half the hero at 1440 crosses a
third of it at 2560 and ends in the wrong place. Fixed px is fine only for small entrance offsets.

**Small entrance offsets stay fixed px.** `--hero-drop`, `--hero-settle`, `--hero-lift` and every
24–40px reveal offset are **never fluid**, even on a scaled page. Engines resolve `var()` once, at
animation start, so a scaled offset goes stale on resize; for a 24–40px nudge that is not worth
solving. Vary them per breakpoint with a plain utility (`[--hero-lift:20px] lg:[--hero-lift:24px]`).

**Travel scales.** Anything that moves by a distance read off the drawing does: a product
crossing the hero, a parallax range, a horizontal track, an object landing on a drawn spot, a
ScrollTrigger `start`/`end` offset, a marquee's speed. Three patterns, in order of preference:

1. **CSS multiplies, the engine writes progress** (any engine, no unit maths in JS). The engine
   writes a unitless 0..1 to `--scene-p` on the element (registered in `motion.css`) and CSS
   turns it into a length. It stays right through a resize with no refresh, because the unit is
   resolved by CSS on every frame.

   ```css
   .peel { translate: calc(var(--scene-p) * 240 * var(--fluid, 1px)) 0; }
   ```
   ```ts
   // GSAP
   gsap.to('.peel', { '--scene-p': 1, ease: 'none',
     scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } })
   // Motion
   const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
   <m.div className="peel" style={{ '--scene-p': scrollYProgress } as MotionStyle} />
   ```
   Cost: one style recalc of that element per frame (`inherits: false` keeps it off the subtree),
   plus layout if the property is not `translate`/`transform`/`opacity`. Keep it to those.

2. **GSAP function values** when the distance must be a tween property (a timeline with several
   steps, `motionPath`, a `Flip` offset). Import `fluidValue`/`fluidEnd`/`fluidPx` from
   `assets/gsap/src/fluid.ts` and set `invalidateOnRefresh: true`, so ScrollTrigger re-reads them
   on the refresh it already runs after every resize:

   ```ts
   gsap.to('.peel', { x: fluidValue(240), ease: 'none',
     scrollTrigger: { trigger: '.hero', start: 'top top', end: fluidEnd(900), scrub: true,
                      invalidateOnRefresh: true } })
   ```
   A plain `x: 240` or `end: '+=900'` freezes at the size the page loaded at.

3. **Motion with the unit as a MotionValue** when the distance feeds other maths:
   `const f = useFluidUnit(); const x = useTransform(() => p.get() * 240 * f.get())`
   (`assets/react-motion/hooks/useFluidUnit.ts`). It re-scales on resize without a remount.

**Measured distances need nothing.** A value read from layout (`track.scrollWidth - innerWidth`,
`el.offsetLeft`, a `getBoundingClientRect()` span) is already in scaled px. In GSAP make it a
function with `invalidateOnRefresh`; in Motion re-measure on resize. Only drawn numbers typed into
motion code need a unit.

**Text split into lines re-wraps on resize.** Fluid type changes size continuously, so line
splits go stale. Use GSAP SplitText's `autoSplit: true` with an `onSplit()` that returns the
animation (3.13+), or split at authored breaks (`fluid-design`'s `typography.md` hard breaks)
rather than rendered ones.

**Scaled `start`/`end` offsets** follow the same rule: `start: 'top top+=120'` is fixed px; write
`start: () => 'top top+=' + fluidPx(120)` when the 120 is a drawn header height or margin.

**Pass `el` when the pinned or animated element sits inside a limit.** `fluidPx`, `fluidValue` and
`fluidEnd` take an optional third argument. A header with `fluid-ui-grow-until-1680` reports its
own, capped `ui` value only to something that reads it *at* the header —
`fluidPx(48, 'ui', headerEl)` — not to a bare `fluidPx(48, 'ui')`, which reads the root's uncapped
one and drifts once the window passes 1680.

**Static offsets on an animated element go through `translate`.** A stage item's `transform` is
owned by its variant. `fluid-design`'s `fluid-translate-x/y-*` utilities write the independent
`translate` property for exactly this reason, so they compose with the engine's `transform`.
Without the scale, write `translate` yourself (`[translate:-50%_0]`), never
`transform: translateX(-50%)` (`motion-architecture.md` §7). Pattern 1 above uses `translate` for
the same reason, so it composes with an entrance the engine runs on `transform`.

**With GSAP, never on an element GSAP tweens.** GSAP folds an element's CSS `translate`/`rotate`/
`scale` into its own transform on its first transform tween, keeping a plain % (as `xPercent`) but
freezing any px or `calc()` value: a `fluid-translate-*` offset stops following resizes and a
`--scene-p` drift never moves (measured: the Vite example's peel drift sat at 0 until it moved from
the entrance-tweened wrapper to the `<img>` inside it). Put the drift, and any scaled static offset,
on a child or wrapper that GSAP does not tween. Motion is unaffected.

**No property collides.** Animation writes `transform`, `translate` and `opacity`; the scale writes
`font-size`, `padding`, `gap`, `width` and `height`, and recomputes on resize only, never per frame
or during a scroll.

## 4. Pins in `lvh`, sections in `svh`

The pin and its cancelling margin are `100lvh` (`scroll-scenes.md` §1). The sections riding over it
stay on `svh`, or on fluid heights, which are `svh`-based: a one-screen section must not resize
while the reader scrolls. This split holds with or without the scale. A fluid layout adds one rule:
never re-express the pin in fluid units. It is a viewport-covering box, not a drawn length.

## 5. Fluid-height acts inside a pin

A section sized `lg:fluid-h-900` is exactly one screen only when height binds. When **width** binds
(a wide-short or narrow-tall window), it is shorter than the viewport. That is fine visually over a
pinned render, but it changes two things:

- **Act maths.** N is no longer a whole number of viewports: a four-act scene measured 3.42 viewports
  at 1024×900 instead of 4.00. Since progress advances 1/(N−1) per viewport (`scroll-scenes.md` §2),
  landmarks derived from "act k starts at k/(N−1)" drift. Derive thresholds from the measured range
  in px (the latch already does), never from hard-coded fractions.
- **`PullToCentre` must clamp.** A section shorter than the viewport, centred, asks to rest at a
  scroll position where part of the previous section shows over the render, or outside the pin
  entirely. Pass `clamp` (the range wrapper, or `data-clamp="[data-scrub-stage]"` in GSAP) so the
  well's extremes land exactly on progress 0 and 1 (`scroll-scenes.md` §8). Without the scale the
  same applies to any act shorter than the viewport.

## 6. `--header-h`

`fluid-design` emits `--header-h` (the header's resting inset, safe area and row height).
`anchor-check.mjs` reads it as a fallback when an anchor target has no `scroll-margin-top`, and the
header-ink probe is independent of it. Without the scale, either define `--header-h` yourself or give
anchor targets an explicit `scroll-margin-top`.

## Traps

- [ ] The engage constant comes from the fluid config when there is one; otherwise it is kept in one
  file (§1).
- [ ] Without `--fluid`, the scroll well's thresholds are plain reference px, which is expected (§2).
- [ ] No fluid entrance offsets (24–40px), but every drawn travel distance scales (§3).
- [ ] GSAP distances and `end` offsets are functions with `invalidateOnRefresh: true` (§3).
- [ ] `fluidPx`/`fluidValue`/`fluidEnd` pass `el` for anything pinned or animated inside a limited
  subtree (§3).
- [ ] No `transform` for static offsets on animated elements; use `translate` (§3).
- [ ] With GSAP, a `calc()`/px `translate` or `--scene-p` drift sits on a child GSAP never tweens (§3).
- [ ] The pin is never expressed in fluid units (§4).
- [ ] No hard-coded progress fractions for acts that are fluid-height; thresholds come from the
  measured range (§5).
- [ ] A scroll well inside a pin has a `clamp` (§5).
