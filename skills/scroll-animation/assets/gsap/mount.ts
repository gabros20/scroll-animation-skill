/**
 * gsap/mount.ts — a vanilla GSAP page's blocks, created on a route's root from the attributes in its markup:
 * `mount(routeRoot, blocks)` → the route's cleanup.
 *
 *   import { mount } from './gsap/mount'
 *
 *   const unmount = mount(document.querySelector('main')!, {
 *     '[data-scene-root]:not([data-rail])': (el) => pinnedScene(el, { onProgress: (p) => tl.progress(p) }),
 *     '[data-rail]': (el) => horizontalRail(el),
 *     '[data-split-reveal]': (el) => splitReveal(el),
 *     '[data-reveal]': (el) => reveal(el),
 *     '[data-count-ups]': (el) => mountCountUps(el),
 *   })
 *   unmount()      when the route goes away or is hidden: an MPA swap, a view the page hides
 *
 * - `blocks` maps a selector to a block: a function of each element it matches inside `root` (never `root` itself)
 *   that returns the block's handle (anything with destroy()), a cleanup function, or nothing.
 * - Every match of every selector is created in document order, across block types: invariant 6, ScrollTriggers are
 *   created in page order, so ScrollTrigger refreshes them top to bottom. An element two selectors match gets both
 *   blocks, in the order `blocks` lists them. Keep a block that already covers another off its elements: a rail is a
 *   pinned scene, so the scene's selector leaves rails out.
 * - All of them are created inside one gsap.context(…, root), which records what they make (and anything else the
 *   functions make), and selector text given to GSAP inside it resolves in `root`. Then ScrollTrigger refreshes once.
 * - The cleanup destroys every block in reverse order and reverts the context. A block that throws while mounting
 *   leaves nothing behind: what was created is destroyed, and the error is thrown on.
 * - Mounting a root that is mounted already creates nothing and returns the live mount's cleanup. After the cleanup
 *   the root can be mounted again: a route shown again.
 * - `root` is a route's root element, never `document` (nor <html>): Next's Activity keeps a hidden route's DOM in
 *   the document, and an MPA swap replaces the route, not the page. Page chrome outside the root, such as the fixed
 *   header's ink (mountHeaderTheme), is the page's own. Start the scroll authority (createSmoother,
 *   createSmoothScroll) before mounting, so every trigger binds to it, and call mount() outside your own
 *   gsap.matchMedia callbacks, like any scene.
 * - React never needs this file: call the block functions inside useGSAP(() => …, { scope }), whose context does the
 *   same job, and return their destroy() from it.
 */
import { ScrollTrigger, gsap, setupGsap } from './setup'

/** What a block's function returns: a handle with destroy(), a cleanup function, or nothing to undo. */
export type MountedBlock = { destroy(): void } | (() => void) | null | undefined | void

/** A selector, and the block to create on each element it matches inside the root. */
export type MountBlocks = Record<string, (el: HTMLElement) => MountedBlock>

/** The live mounts, by root: a second mount() of one returns its cleanup. */
const mounts = new WeakMap<Element, () => void>()

export function mount(root: Element, blocks: MountBlocks): () => void {
  if (!isRouteRoot(root)) {
    throw new TypeError('mount(): the root is a route root element, never the document or <html>')
  }
  const live = mounts.get(root)
  if (live) return live
  setupGsap()

  // Every element any selector matches, with the selectors it matches, in document order.
  const entries = Object.entries(blocks)
  const matched = new Map<HTMLElement, number[]>()
  entries.forEach(([selector], i) => {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
      const indices = matched.get(el)
      if (indices) indices.push(i)
      else matched.set(el, [i])
    }
  })
  const elements = Array.from(matched.keys()).sort(documentOrder)

  const cleanups: Array<() => void> = []
  const failed: unknown[] = []
  const context = gsap.context(() => {
    try {
      for (const el of elements) {
        for (const i of matched.get(el) ?? []) {
          const cleanup = cleanupOf(entries[i][1](el))
          if (cleanup) cleanups.push(cleanup)
        }
      }
    } catch (error) {
      failed.push(error)
    }
  }, root)

  let done = false
  const unmount = () => {
    if (done) return
    done = true
    if (mounts.get(root) === unmount) mounts.delete(root)
    // Every block gets its destroy() even if one throws: a half-torn-down route keeps triggers on a page it left.
    const thrown: unknown[] = []
    for (let i = cleanups.length - 1; i >= 0; i--) {
      try {
        cleanups[i]()
      } catch (error) {
        thrown.push(error)
      }
    }
    context.revert()
    if (thrown.length) throw thrown[0]
  }

  if (failed.length) {
    try {
      unmount()
    } catch {
      // The mount's own error is the one to report.
    }
    throw failed[0]
  }
  mounts.set(root, unmount)
  ScrollTrigger.refresh()
  return unmount
}

function cleanupOf(block: MountedBlock): (() => void) | null {
  if (typeof block === 'function') return block
  if (block && typeof block.destroy === 'function') return () => block.destroy()
  return null
}

function isRouteRoot(root: unknown): root is Element {
  const el = root as Element | null
  return !!el && el.nodeType === Node.ELEMENT_NODE && el !== el.ownerDocument.documentElement
}

function documentOrder(a: Node, b: Node) {
  if (a === b) return 0
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
}
