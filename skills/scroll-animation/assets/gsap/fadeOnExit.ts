/**
 * `[data-fade-on-exit]` — fades a group out as it scrolls up out of the
 * viewport. Port of `FadeOnExit`.
 *
 * Built for copy sitting over a pinned scrubbed render (`scrubStage.ts`):
 * without it, foreground copy stays legible while the render underneath is
 * playing its middle act, so the two compete for the same frame.
 *
 * It fades the GROUP, not each element against its own position — the copy
 * and (say) a wordmark below it are one composition and should leave as
 * one; per-element ranges would have a small element fading across its own
 * small height, which snaps rather than fades.
 *
 * ## Why this writes `style.opacity` by hand instead of a library tween
 *
 * `references/scroll-scenes.md` §6, "The direct style write": a scroll-linked property
 * bound through Motion (the reference build's animation library) was
 * measured to get promoted to a native, hardware-accelerated WAAPI timeline
 * whose view range disagreed with the JS-computed one — on an element that
 * sits under a negative-margin pull-up overlapping a sticky sibling (exactly
 * `scrubStage.ts`'s geometry), so past the fade's endpoint the native
 * timeline ran BACKWARDS and the copy faded back in over the render it
 * exists to clear.
 *
 * GSAP does not do this particular promotion — it writes styles itself
 * rather than handing scroll-linked values to the browser's native
 * scroll-timeline API — but the fix this module carries over is the safer
 * one regardless of engine: a manual scroll listener computing progress
 * from `getBoundingClientRect()` and writing `style.opacity` directly has no
 * second code path to disagree with the one doing the math. One style write
 * per scroll frame on one node either way.
 */

const FROM_VAR = '--exit-from'
const TO_VAR = '--exit-to'

/** Defaults if neither custom property is set. See the reference build's
 * `FadeOnExit` docblock for why these are early rather than "halfway". */
const DEFAULT_FROM = 0.1
const DEFAULT_TO = 0.35

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function readRange(el: HTMLElement): [number, number] {
  const style = getComputedStyle(el)
  const from = Number.parseFloat(style.getPropertyValue(FROM_VAR))
  const to = Number.parseFloat(style.getPropertyValue(TO_VAR))
  return [Number.isFinite(from) ? from : DEFAULT_FROM, Number.isFinite(to) ? to : DEFAULT_TO]
}

/**
 * Progress across `['start start', 'end start']`: 0 when the element's top
 * reaches the viewport top, 1 when its bottom does — "how far out of frame
 * is it". Matches the reference build's `EXIT_OFFSET`.
 */
function exitProgress(el: HTMLElement): number {
  const rect = el.getBoundingClientRect()
  const h = rect.height || 1
  return clamp01(-rect.top / h)
}

interface Entry {
  el: HTMLElement
  range: [number, number]
}

function write(entry: Entry, reduced: boolean): void {
  const { el, range } = entry
  if (reduced) {
    el.style.opacity = '1'
    return
  }
  const [start, end] = range
  const progress = exitProgress(el)
  const span = end - start
  const k = span <= 0 ? (progress >= end ? 1 : 0) : (progress - start) / span
  el.style.opacity = String(1 - clamp01(k))
}

export interface FadeOnExitController {
  destroy(): void
}

export function initFadeOnExit(root: ParentNode = document): FadeOnExitController {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const entries: Entry[] = Array.from(root.querySelectorAll<HTMLElement>('[data-fade-on-exit]')).map((el) => ({
    el,
    range: readRange(el)
  }))

  if (entries.length === 0) {
    return { destroy() {} }
  }

  entries.forEach((entry) => write(entry, reduced)) // first paint has no scroll event to react to

  let raf = 0
  const onScroll = () => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      entries.forEach((entry) => write(entry, reduced))
    })
  }

  // Re-read on resize — the breakpoint is when `--exit-from`/`--exit-to`
  // (set by a plain responsive CSS utility) can change.
  const onResize = () => {
    for (const entry of entries) entry.range = readRange(entry.el)
    entries.forEach((entry) => write(entry, reduced))
  }

  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onResize)

  return {
    destroy() {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
    }
  }
}
