// cursor-media.html: gsap/cursor-media.ts on a list of four links.
import { expose } from './harness'
import { setupGsap } from '../../../../skills/scroll-animation/assets/gsap/setup'
import { cursorMedia, type CursorMediaHandle } from '../../../../skills/scroll-animation/assets/gsap/cursor-media'
import { gsapCensus } from './census'

setupGsap()

const root = document.getElementById('list')!
const preview = root.querySelector<HTMLElement>('[data-cursor-media-preview]')!
const item = (key: string) => root.querySelector<HTMLElement>(`[data-cursor-media-item="${key}"]`)!
const round = (v: number) => Math.round(v * 100) / 100
/** The point the recipe wrote: its transform alone (the page's CSS translate is a separate property). */
const written = () => {
  const transform = getComputedStyle(preview).transform
  const m = transform === 'none' ? new DOMMatrix() : new DOMMatrix(transform)
  return { x: round(m.m41), y: round(m.m42) }
}
document.addEventListener('click', (event) => {
  if ((event.target as Element).closest('a')) event.preventDefault()
})

expose<CursorMediaHandle | null>({
  create: () => cursorMedia(root),
  destroy: (handle) => handle?.destroy(),
  census: gsapCensus,
  extras: {
    state() {
      return {
        shown: preview.getAttribute('data-cursor-media-state') === 'shown',
        active: preview.querySelector('[data-cursor-media-active]')?.getAttribute('data-cursor-media-for') ?? null,
        ...written(),
        inline: preview.getAttribute('style') ?? '',
        fine: matchMedia('(hover: hover) and (pointer: fine)').matches,
      }
    },
    /** An item's centre, in client coordinates: where the mouse goes. */
    centre(key: string) {
      const box = item(key).getBoundingClientRect()
      return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }
    },
    /** A client point in the root's coordinates (inside its 4 px border): where the preview's point must be. */
    local(x: number, y: number) {
      const box = root.getBoundingClientRect()
      return { x: round(x - box.left - root.clientLeft), y: round(y - box.top - root.clientTop) }
    },
    /** The static point for an item: its right edge, vertically centred, in the root's coordinates. */
    end(key: string) {
      const box = item(key).getBoundingClientRect()
      const frame = root.getBoundingClientRect()
      return { x: round(box.right - frame.left - root.clientLeft), y: round(box.top + box.height / 2 - frame.top - root.clientTop) }
    },
    focused: () => document.activeElement?.getAttribute('data-cursor-media-item') ?? document.activeElement?.tagName ?? null,
  },
})
