/**
 * gsap/cursor-media.ts — a recipe: a list of links that shows each link's media in a preview that follows the
 * pointer, on GSAP pages. `cursorMedia(root, options)` → a handle, or null without a preview. One file to adapt in
 * place.
 *
 *   <div data-cursor-media>
 *     <ul>
 *       <li><a href="/work/harbour" data-cursor-media-item="harbour">Harbour</a></li>
 *       <li><a href="/work/field" data-cursor-media-item="field">Field notes</a></li>
 *     </ul>
 *     <div data-cursor-media-preview aria-hidden="true">         one preview; every item's media stacked in it
 *       <img data-cursor-media-for="harbour" src="…" alt="" loading="lazy">
 *       <img data-cursor-media-for="field" src="…" alt="" loading="lazy">
 *     </div>
 *   </div>
 *
 *   [data-cursor-media] { position: relative }
 *   [data-cursor-media-preview] { position: absolute; top: 0; left: 0; width: 18rem; aspect-ratio: 4 / 3;
 *     translate: 1.5rem -50%; pointer-events: none; opacity: 0; transition: opacity 0.2s }
 *   [data-cursor-media-preview][data-cursor-media-state='shown'] { opacity: 1 }
 *   [data-cursor-media-for] { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0 }
 *   [data-cursor-media-for][data-cursor-media-active] { opacity: 1 }
 *
 *   const previews = cursorMedia(listRoot)     previews?.destroy()
 *
 * - When: decoration for a mouse. Touch and keyboard readers get the list as it is, so it must work on its own: the
 *   links carry the names, and the preview is aria-hidden with empty alts. A thumbnail in each row, shown on :hover in
 *   CSS, needs no JavaScript and is the cheaper choice when the media can sit in the row.
 * - The recipe writes the preview's `transform` (a translate to the point, in the root's coordinates: its top-left on
 *   the point) and two attributes, data-cursor-media-state="shown" on the preview and data-cursor-media-active on the
 *   media shown. Everything else is your CSS: its `translate` picks the part of the preview that sits on the point
 *   (above: 1.5rem to the right, vertically centred), and the opacity carries the fade. The media keeps showing while
 *   the preview fades.
 * - Pointer: over an item, its media shows at the pointer and follows it through gsap.quickTo on x and y (0.5 s,
 *   power3): one tween per axis, retargeted, never a new tween per event. A scroll under a still pointer follows too.
 *   Off the items it hides; it appears where the pointer is, never gliding in from where it last was.
 * - Only under (hover: hover) and (pointer: fine): a finger has no hover, so on touch screens nothing shows at all.
 * - Keyboard: focus on an item (:focus-visible) shows its media at the item, never at the pointer: by default just past
 *   the item's inline end, vertically centred (`at` moves it). Keep items as wide as their text (width: fit-content) so
 *   the preview sits beside the words and never covers the focus ring.
 * - Reduced motion (live, gsap.matchMedia): no following. Hover and focus show the media at the item, placed at once.
 * - destroy() removes the listeners, the tweens and the attributes, and puts back the preview's own inline transform.
 */
import { MOTION_CONDITIONS, gsap, setupGsap, type MotionConditions } from './setup'

export interface CursorMediaOptions {
  /** Seconds the preview takes to catch up with the pointer. Default 0.5. */
  duration?: number
  /**
   * Where the preview sits for an item focused from the keyboard, and for any item under reduced motion, in the root's
   * coordinates. Default: the item's inline end, vertically centred.
   */
  at?: (item: HTMLElement, root: HTMLElement) => { x: number; y: number }
}

export interface CursorMediaHandle {
  destroy(): void
}

/** A pointer that hovers precisely: a mouse, a trackpad or a pen, never a finger. */
export const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)'

const ITEM = '[data-cursor-media-item]'
const ACTIVE = 'data-cursor-media-active'
const STATE = 'data-cursor-media-state'

export function cursorMedia(root: HTMLElement, options: CursorMediaOptions = {}): CursorMediaHandle | null {
  const preview = root.querySelector<HTMLElement>('[data-cursor-media-preview]')
  if (!preview) return null
  setupGsap()
  const duration = options.duration ?? 0.5
  const at = options.at ?? itemEnd
  // The inline transform the page wrote itself, put back when the recipe lets go.
  const authored = preview.style.transform
  const media = () => Array.from(preview.querySelectorAll<HTMLElement>('[data-cursor-media-for]'))

  const itemAt = (node: EventTarget | null) => {
    const item = node instanceof Element ? node.closest<HTMLElement>(ITEM) : null
    return item && root.contains(item) ? item : null
  }
  /** A client point in the root's coordinates, where the preview's containing block starts (its padding box). */
  const local = (x: number, y: number) => {
    const box = root.getBoundingClientRect()
    return { x: x - box.left - root.clientLeft, y: y - box.top - root.clientTop }
  }

  // No ScrollTrigger here, so the pointer query can sit in the conditions (gsap/setup.ts).
  const mm = gsap.matchMedia()
  mm.add({ ...MOTION_CONDITIONS, fine: FINE_POINTER_QUERY }, (context) => {
    const { reduce, fine } = context.conditions as MotionConditions & { fine: boolean }
    if (!fine) return
    // The point eases on a plain object and is written by hand: the tweens never touch the preview, and its own CSS
    // translate composes with the transform untouched.
    const point = { x: 0, y: 0 }
    const write = () => {
      preview.style.transform = `translate(${point.x.toFixed(2)}px, ${point.y.toFixed(2)}px)`
    }
    const xTo = unrecorded(context, () => gsap.quickTo(point, 'x', { duration, ease: 'power3', onUpdate: write }))
    const yTo = unrecorded(context, () => gsap.quickTo(point, 'y', { duration, ease: 'power3', onUpdate: write }))
    /** The item whose media shows; null while hidden. */
    let shown: HTMLElement | null = null
    /** The item focused from the keyboard, if any. */
    let focused: HTMLElement | null = null
    /** The pointer in client coordinates, while it is over the root. */
    let pointer: { x: number; y: number } | null = null

    const show = (item: HTMLElement, to: { x: number; y: number }) => {
      // Glide only while shown and in full motion: a preview that appears, appears in place.
      const glide = shown !== null && !reduce
      if (item !== shown) {
        const key = item.getAttribute('data-cursor-media-item')
        for (const el of media()) el.toggleAttribute(ACTIVE, el.getAttribute('data-cursor-media-for') === key)
      }
      shown = item
      preview.setAttribute(STATE, 'shown')
      if (glide) {
        xTo(to.x)
        yTo(to.y)
      } else {
        xTo(to.x, to.x)
        yTo(to.y, to.y)
      }
    }
    const hide = () => {
      shown = null
      preview.removeAttribute(STATE)
    }
    /** The pointer's item, followed (or, under reduced motion, placed at once at the item). */
    const track = (item: HTMLElement | null) => {
      if (!item || !pointer) return focused ? show(focused, at(focused, root)) : hide()
      if (reduce) {
        if (item !== shown) show(item, at(item, root))
      } else {
        show(item, local(pointer.x, pointer.y))
      }
    }

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      pointer = { x: event.clientX, y: event.clientY }
      track(itemAt(event.target))
    }
    const onLeave = () => {
      pointer = null
      track(null)
    }
    // The page scrolled under a still pointer: the item under it may have changed, and the preview moved with the root.
    const onScroll = () => {
      if (pointer) track(itemAt(document.elementFromPoint(pointer.x, pointer.y)))
    }
    const onFocusIn = (event: FocusEvent) => {
      const item = itemAt(event.target)
      if (!item || !(event.target as Element).matches(':focus-visible')) return
      focused = item
      show(item, at(item, root))
    }
    const onFocusOut = (event: FocusEvent) => {
      if (itemAt(event.relatedTarget)) return
      focused = null
      if (!pointer) hide()
    }
    root.addEventListener('pointermove', onMove, { passive: true })
    root.addEventListener('pointerleave', onLeave)
    root.addEventListener('focusin', onFocusIn)
    root.addEventListener('focusout', onFocusOut)
    window.addEventListener('scroll', onScroll, { passive: true })

    // The preview gets its own transform back.
    return () => {
      xTo.tween.kill()
      yTo.tween.kill()
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerleave', onLeave)
      root.removeEventListener('focusin', onFocusIn)
      root.removeEventListener('focusout', onFocusOut)
      window.removeEventListener('scroll', onScroll)
      preview.removeAttribute(STATE)
      for (const el of media()) el.removeAttribute(ACTIVE)
      if (authored) preview.style.transform = authored
      else preview.style.removeProperty('transform')
      if (preview.getAttribute('style') === '') preview.removeAttribute('style')
    }
  })

  return {
    destroy() {
      mm.revert()
    },
  }
}

/** The default placement: the item's inline end (its right edge, or its left in right-to-left text), centred on it. */
function itemEnd(item: HTMLElement, root: HTMLElement) {
  const box = item.getBoundingClientRect()
  const frame = root.getBoundingClientRect()
  const rtl = getComputedStyle(item).direction === 'rtl'
  return {
    x: (rtl ? box.left : box.right) - frame.left - root.clientLeft,
    y: box.top + box.height / 2 - frame.top - root.clientTop,
  }
}

/**
 * Makes a tween outside the build's record. A matchMedia revert replays recorded tweens with their events on, so a
 * catch-up tween's onUpdate would write its stale start value one last time; this one is killed in the cleanup instead.
 */
function unrecorded<T>(context: gsap.Context, make: () => T): T {
  let made: T | undefined
  context.ignore(() => {
    made = make()
  })
  return made as T
}
