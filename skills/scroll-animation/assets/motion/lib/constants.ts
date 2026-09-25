/**
 * The one breakpoint every primitive in this folder agrees on.
 *
 * Should match the host project's Tailwind `lg` (or whatever token marks
 * the same width) — drift between them is exactly what produced duplicate
 * `LG_QUERY` constants in the reference build (`Stage.tsx`,
 * `PullToCentre.tsx`), each hand-typed from the same fact. Change it once,
 * here.
 *
 * `1024` below is a DEFAULT desktop breakpoint, not a measured fact. If the
 * project has `fluid-design` v2 installed, import `DESKTOP_QUERY` (or its
 * `ENGAGE_QUERY` alias) from the generated `fluid.ts` in its fluid output
 * folder instead (e.g. `'@/styles/fluid/fluid'`) — it comes from
 * `fluid.config.json`'s `bands.desktop.minWidth`, so it cannot drift from
 * the CSS. Replace both constants below with that import at this one file;
 * otherwise set them to your desktop breakpoint.
 */
export const ENGAGE_BREAKPOINT_PX = 1024

/** `matchMedia`-ready form of `ENGAGE_BREAKPOINT_PX`, for JS callers. */
export const ENGAGE_QUERY = `(min-width: ${ENGAGE_BREAKPOINT_PX}px)`
