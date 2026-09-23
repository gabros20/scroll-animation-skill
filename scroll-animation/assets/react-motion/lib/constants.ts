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
 * project uses the `fluid-design` skill, replace it with the output of its
 * `node scripts/generate-fluid.mjs --stack ts` and import `ENGAGE_PX`/
 * `ENGAGE_QUERY` from the generated `fluid.config.ts` instead, replacing
 * both constants below at this one file; otherwise set it to your desktop
 * breakpoint.
 */
export const ENGAGE_BREAKPOINT_PX = 1024

/** `matchMedia`-ready form of `ENGAGE_BREAKPOINT_PX`, for JS callers. */
export const ENGAGE_QUERY = `(min-width: ${ENGAGE_BREAKPOINT_PX}px)`
