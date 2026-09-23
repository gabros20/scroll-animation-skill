/**
 * A tiny, dependency-free class-joiner.
 *
 * The reference build's components import `cn` from `@/lib/utils`, which
 * wraps `clsx` + a `tailwind-merge` instance taught the project's `fluid-*`
 * utility groups (so `lg:fluid-p-40 lg:fluid-p-24` resolves to one winner
 * instead of shipping both). That merge behaviour is Tailwind-specific and
 * has no meaning outside it, so these primitives do not depend on it — this
 * just joins truthy strings, which is all any of them actually need.
 *
 * If the host project uses Tailwind, swap this import for the `cn` in
 * `assets/styles/tailwind-v4/cn.ts` instead, which does the fluid-aware
 * merge. Anywhere else, this is enough.
 */
export function cx(...inputs: Array<string | false | null | undefined>): string {
  return inputs.filter(Boolean).join(' ')
}
