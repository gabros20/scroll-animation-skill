/**
 * The one breakpoint every primitive in this GSAP port agrees on. This file
 * is the SINGLE place the literal is declared for this stack — `stage.ts`,
 * `scrollPull.ts`, `scrubStage.ts` and `eases.ts` all import
 * `ENGAGE_PX`/`ENGAGE_QUERY` from here rather than each keeping its own
 * copy. Before this file existed `eases.ts` declared its own literal and
 * the other three imported it from there, which is a harder place to find
 * than a file named for exactly this job — and the shape invited a second,
 * silently-drifting copy the moment anyone reached for `1024` directly
 * instead of importing it.
 *
 * `1024` below is a DEFAULT desktop breakpoint, not a measured fact — if the
 * project has `fluid-design` v2 installed, import `DESKTOP_PX`/`DESKTOP_QUERY`
 * (or their `ENGAGE_PX`/`ENGAGE_QUERY` aliases) from the generated `fluid.ts`
 * in its fluid output folder instead (e.g. `'@/styles/fluid/fluid'`) — it
 * comes from `fluid.config.json`'s `bands.desktop.minWidth`, so it cannot
 * drift from the CSS. Swapping this file's body for that import, or having
 * this one re-export from it, is the whole fix; otherwise set it to your
 * desktop breakpoint.
 */
export const ENGAGE_PX = 1024

/** `matchMedia`-ready form of ENGAGE_PX. */
export const ENGAGE_QUERY = `(min-width: ${ENGAGE_PX}px)`
