/**
 * pages/debug.ts — each page's live pieces on `window.__site`, for devtools and the site's checks (checks/run.mjs):
 * the scroll authority, what every block returned (by the element it was created on), mount() itself, ScrollTrigger
 * and the route's cleanup.
 */
import { mount, type MountBlocks } from '../animation/gsap/mount'
import { ScrollTrigger } from '../animation/gsap/setup'
import type { SmoothScrollHandle } from '../animation/smooth/authority'

export interface SiteDebug {
  authority: SmoothScrollHandle
  /** What each block's function returned, by the element it was created on. */
  blocks: Map<Element, unknown>
  mount: typeof mount
  ScrollTrigger: typeof ScrollTrigger
  /**
   * The route's cleanup. A multi-page site never calls it (the next page load replaces this one, and a page restored
   * from the back-forward cache comes back with its blocks); a router swapping routes would, on the way out.
   */
  unmount: () => void
}

declare global {
  interface Window {
    __site?: SiteDebug
  }
}

const created = new Map<Element, unknown>()

/** The same blocks, each remembering what it returned. */
export function recorded(blocks: MountBlocks): MountBlocks {
  return Object.fromEntries(
    Object.entries(blocks).map(([selector, create]) => [
      selector,
      (el: HTMLElement) => {
        const block = create(el)
        created.set(el, block)
        return block
      },
    ]),
  )
}

export function expose(authority: SmoothScrollHandle, unmount: () => void): void {
  window.__site = { authority, blocks: created, mount, ScrollTrigger, unmount }
}
