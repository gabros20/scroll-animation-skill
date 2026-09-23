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

- **With `fluid-design`:** its `fluid.config.json` `engageAt` is the source. Generate the TS
  constants with that skill's generator (`--stack ts`, which emits `fluid.config.ts` exporting
  `ENGAGE_PX` and `ENGAGE_QUERY`) and re-export them from the constants file instead of the literal.
  Nothing in these files reads the config at runtime, so a hand-kept `1024` silently stops matching
  the moment `engageAt` changes.
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

## 3. Entrance distances stay fixed px, and centring uses `translate`

- `--hero-drop`, `--hero-settle`, `--hero-lift` are **fixed px, never fluid**, even on a scaled
  page. Engines resolve `var()` once, at animation start, so a scaled offset goes stale on resize;
  for a 24–40px offset that is not worth solving. Vary them per breakpoint with a plain utility
  (`[--hero-lift:20px] lg:[--hero-lift:24px]`).
- **No property collides.** Animation writes `transform` and `opacity`; the scale writes
  `font-size`, `padding`, `gap`, `width` and `height`, and recomputes on resize only, never per
  frame or during a scroll.
- **Static offsets on an animated element go through `translate`.** A stage item's `transform` is
  owned by its variant. `fluid-design`'s `fluid-translate-x/y-*` utilities write the independent
  `translate` property for exactly this reason, so they compose with the engine's `transform`.
  Without the scale, write `translate` yourself (`[translate:-50%_0]`), never
  `transform: translateX(-50%)` (`motion-architecture.md` §7).

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
- [ ] No fluid entrance distances (§3).
- [ ] No `transform` for static offsets on animated elements; use `translate` (§3).
- [ ] The pin is never expressed in fluid units (§4).
- [ ] No hard-coded progress fractions for acts that are fluid-height; thresholds come from the
  measured range (§5).
- [ ] A scroll well inside a pin has a `clamp` (§5).
