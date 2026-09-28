/**
 * gsap/stepped-sections.ts — a recipe: a presentation mode that steps one full-viewport section per wheel notch,
 * touch swipe or key press, with GSAP's Observer (ScrollTrigger.observe(), which ScrollTrigger includes).
 * `steppedSections(root, options)` → a handle. One file to adapt in place.
 *
 *   <main data-stepped>
 *     <section data-step aria-labelledby="intro-title">…</section>      min-height: 100svh each
 *     <section data-step aria-labelledby="plan-title">…</section>
 *   </main>
 *
 *   const deck = steppedSections(main)     deck.index   deck.goTo(2)   deck.next()   deck.previous()   deck.destroy()
 *
 * - Read this first: ordinary scrolling is almost always better. Stepping takes the reader's pace away (a notch always
 *   moves a whole viewport and a trackpad's momentum is swallowed), and it fights anything else that owns the wheel.
 *   Use it only when the brief is explicitly a presentation: a deck, a product tour, one screen per idea. The cheaper
 *   alternative is CSS scroll snap, `html { scroll-snap-type: y proximity }` with `[data-step] { scroll-snap-align:
 *   start }`: no JavaScript, the reader keeps their pace, and `proximity` never strands content (`mandatory` can, in a
 *   section taller than the viewport). Never both: a snap re-targets every scroll this recipe writes.
 * - It replaces gestures, never the page's scrolling. Sections stay in normal flow and the document scrolls natively:
 *   the scrollbar, find in page, anchors and a screen reader's reading cursor all work, and nothing is ever hidden,
 *   inert or locked, so assistive technology is never trapped.
 * - Over the root, a wheel notch or a touch swipe steps to the next or previous stop, once per gesture (momentum is
 *   swallowed while a step plays and after it). So do ArrowDown/ArrowUp, PageDown/PageUp and Space/Shift+Space, and
 *   Home/End go to the first and last. A stop is a section's top; a section taller than the viewport adds one per
 *   viewport, the last showing its end, so every part of it can be reached.
 * - Left alone: keys in a text field, a select or a widget that uses them, Space on a button, keys and wheel over a
 *   nested scroller that can still scroll that way, Ctrl+wheel (zoom), a horizontal swipe, a pinch, and every gesture
 *   on a page zoomed in. Past the first or last stop a gesture scrolls natively, so a presentation inside a longer
 *   page can always be left; scrolled into natively, the next gesture steps to the nearest stop in its direction.
 * - Keyboard focus (:focus-visible) in a section scrolls it into place at once: the stop that shows the focused
 *   element.
 * - A step is a GSAP tween of the page's scroll (`duration`, default 0.8 s, on the measured disclosure curve). It
 *   yields at once to any scroll it didn't write: a scrollbar drag, a screen reader.
 * - Native scrolling only: stepping owns the wheel, and so do Lenis and ScrollSmoother (one scroll authority per page).
 *   Under either it steps nothing and warns.
 * - Reduced motion (live, gsap.matchMedia(MOTION_CONDITIONS)) and no JavaScript: normal scrolling, nothing stepped.
 *   The handle's goTo(), next() and previous() then jump.
 * - destroy() removes the Observer, the listeners and a step in flight; the page stays where the reader left it.
 */
import { currentSmoothScroll, getScrollAuthority } from '../smooth/authority'
import { EASES, MOTION_CONDITIONS, ScrollTrigger, gsap, setupGsap, type MotionConditions } from './setup'

export interface SteppedSectionsOptions {
  /** Seconds a step takes. Default 0.8. */
  duration?: number
}

export interface SteppedSectionsHandle {
  /** The section the page's scroll position is in. */
  readonly index: number
  /** Scrolls to a section's top: a step in full motion, a jump under reduced motion. */
  goTo(index: number): void
  next(): void
  previous(): void
  destroy(): void
}

/** A wheel gesture ends after this long without a wheel event: one step per notch, or per trackpad swipe. */
const GESTURE_GAP_MS = 200
const KEYS: Record<string, 1 | -1 | 'first' | 'last'> = {
  ArrowDown: 1,
  PageDown: 1,
  ' ': 1,
  ArrowUp: -1,
  PageUp: -1,
  Home: 'first',
  End: 'last',
}
/** Elements whose keys stay theirs: typing, choosing, and widgets that move with the arrows. */
const OWN_KEYS =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), video, audio, [role="textbox"], ' +
  '[role="slider"], [role="spinbutton"], [role="listbox"], [role="menu"], [role="menubar"], [role="grid"], ' +
  '[role="tablist"], [role="tree"], [role="radiogroup"]'
/** Elements that Space presses. */
const OWN_SPACE = 'button, summary, [role="button"], [role="checkbox"], [role="switch"], [role="option"], [role="tab"]'

export function steppedSections(root: HTMLElement, options: SteppedSectionsOptions = {}): SteppedSectionsHandle {
  setupGsap()
  const duration = options.duration ?? 0.8
  const sections = () => Array.from(root.querySelectorAll<HTMLElement>('[data-step]'))

  /** Every stop, as document scroll positions, sorted: each section's top, then a viewport at a time through it. */
  const stops = () => {
    const scrolled = window.scrollY
    const view = window.innerHeight
    const max = document.documentElement.scrollHeight - view
    const out = new Set<number>()
    for (const section of sections()) {
      const box = section.getBoundingClientRect()
      const top = Math.round(box.top + scrolled)
      const end = Math.round(box.bottom + scrolled - view)
      out.add(top)
      for (let y = top + view; y < end; y += view) out.add(y)
      if (end > top) out.add(end)
    }
    return Array.from(out, (y) => Math.min(max, Math.max(0, y))).sort((a, b) => a - b)
  }
  /** The next stop in a direction from the scroll position, or undefined past the last (or before the first). */
  const nextStop = (direction: 1 | -1) => {
    const y = window.scrollY
    const all = stops()
    if (direction > 0) return all.find((stop) => stop > y + 1)
    for (let i = all.length - 1; i >= 0; i--) if (all[i]! < y - 1) return all[i]
    return undefined
  }
  /** The root is on screen: gestures step only then. */
  const engaged = () => {
    const box = root.getBoundingClientRect()
    return box.top < window.innerHeight && box.bottom > 0
  }

  /** Set by each build: scrolls to a document position (a step, or a jump). Null between builds. */
  let move: ((y: number) => void) | null = null
  /** A step is playing. */
  let busy = () => false
  /** Straight there, through the page's scroll authority. */
  const jump = (y: number) => {
    const scroll = currentSmoothScroll()
    if (scroll) scroll.scrollTo(y, { immediate: true })
    else window.scrollTo({ top: y, behavior: 'instant' })
  }

  const mm = gsap.matchMedia()
  mm.add(MOTION_CONDITIONS, (context) => {
    move = jump
    busy = () => false
    if ((context.conditions as MotionConditions).reduce) return
    if (getScrollAuthority() !== 'native') {
      console.warn('[scroll-animation] steppedSections steps nothing under Lenis or ScrollSmoother: they own the wheel')
      return
    }

    // A step: the page's scroll, tweened. `written` is where it last put the page, so a scroll it didn't write shows.
    const position = { y: window.scrollY }
    let written = window.scrollY
    const glide = unrecorded(context, () =>
      gsap.quickTo(position, 'y', {
        duration,
        ease: EASES.disclosure,
        onUpdate() {
          if (Math.abs(window.scrollY - written) > 2) {
            // Someone else scrolled (a scrollbar drag, a screen reader): theirs wins.
            glide.tween.pause()
            return
          }
          written = Math.round(position.y)
          window.scrollTo({ top: position.y, behavior: 'instant' })
        },
      }),
    )
    busy = () => glide.tween.isActive()
    move = (y) => {
      written = window.scrollY
      glide(y, window.scrollY)
    }

    // One step per gesture. A wheel gesture is a run of wheel events with no gap over GESTURE_GAP_MS; a touch gesture
    // starts at the press.
    let gesture = 0
    let stepped = -1
    let lastWheel = -Infinity
    let pressY = 0
    const step = (direction: 1 | -1) => {
      if (busy() || stepped === gesture) return
      const y = nextStop(direction)
      if (y === undefined) return
      stepped = gesture
      move?.(y)
    }

    /** A nested element inside the root that can still scroll this way keeps the gesture. */
    const scrollsInside = (target: EventTarget | null, direction: 1 | -1) => {
      const start = target instanceof Element && root.contains(target) ? target : null
      for (let el = start; el && el !== root; el = el.parentElement) {
        const overflow = getComputedStyle(el).overflowY
        if ((overflow !== 'auto' && overflow !== 'scroll') || el.scrollHeight <= el.clientHeight) continue
        if (direction > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true
      }
      return false
    }

    /**
     * True hands the event to the browser (Observer neither prevents it nor counts it); false keeps it for a step,
     * or swallows it while one plays.
     */
    const native = (event: Event) => {
      if (window.visualViewport && window.visualViewport.scale > 1.01) return true
      if (event.type === 'wheel') {
        const wheel = event as WheelEvent
        if (wheel.timeStamp - lastWheel > GESTURE_GAP_MS) gesture++
        lastWheel = wheel.timeStamp
        if (wheel.ctrlKey || Math.abs(wheel.deltaX) > Math.abs(wheel.deltaY)) return true
        if (busy()) return false
        const direction = wheel.deltaY > 0 ? 1 : -1
        return !engaged() || scrollsInside(wheel.target, direction) || nextStop(direction) === undefined
      }
      const touches = (event as TouchEvent).touches
      if (touches && touches.length > 1) return true
      const y = touches?.[0]?.clientY ?? (event as PointerEvent).clientY
      if (event.type === 'touchstart' || event.type === 'pointerdown') {
        gesture++
        pressY = y
        return false
      }
      if (event.type !== 'touchmove' && event.type !== 'pointermove') return false
      if (busy()) return false
      // A finger moving up scrolls down.
      const direction = y < pressY ? 1 : -1
      return !engaged() || scrollsInside(event.target, direction) || nextStop(direction) === undefined
    }

    // Observer, which ScrollTrigger includes: identical to Observer.create() with no second registration.
    const observer = ScrollTrigger.observe({
      target: root,
      type: 'wheel,touch',
      // Wheel down and a finger moving up both land on onUp.
      wheelSpeed: -1,
      tolerance: 10,
      preventDefault: true,
      ignoreCheck: native,
      onUp: () => step(1),
      onDown: () => step(-1),
    })

    const onKey = (event: KeyboardEvent) => {
      const key = KEYS[event.key]
      if (key === undefined || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest(OWN_KEYS) || (event.key === ' ' && target?.closest(OWN_SPACE)) || !engaged()) return
      const direction = key === 1 && event.shiftKey && event.key === ' ' ? -1 : key
      let y: number | undefined
      if (direction === 'first') y = stops()[0]
      else if (direction === 'last') y = stops().at(-1)
      else if (!scrollsInside(target, direction)) y = nextStop(direction)
      else return
      // Past the ends the key is the browser's: it scrolls on out of the presentation.
      if (y === undefined) return
      event.preventDefault()
      if (!busy()) move?.(y)
    }

    let focusFrame = 0
    const onFocusIn = (event: FocusEvent) => {
      const el = event.target
      if (!(el instanceof Element) || !el.matches(':focus-visible') || !el.closest('[data-step]')) return
      // A frame later, once the browser's own scroll-into-view has landed. At once: a Tab never waits on a step.
      cancelAnimationFrame(focusFrame)
      focusFrame = requestAnimationFrame(() => {
        const top = el.getBoundingClientRect().top + window.scrollY
        const section = el.closest('[data-step]')!.getBoundingClientRect().top + window.scrollY
        // The last stop at or above the element, within its section.
        let y: number | undefined
        for (const stop of stops()) if (stop <= top + 1 && stop >= section - 1) y = stop
        if (y === undefined || Math.abs(window.scrollY - y) <= 1) return
        glide.tween.pause()
        jump(y)
      })
    }

    window.addEventListener('keydown', onKey)
    root.addEventListener('focusin', onFocusIn)
    // A step in flight stops where it is, and so does the page.
    return () => {
      glide.tween.kill()
      observer.kill()
      window.removeEventListener('keydown', onKey)
      root.removeEventListener('focusin', onFocusIn)
      cancelAnimationFrame(focusFrame)
      busy = () => false
      move = null
    }
  })

  /** The last section whose top is at or above the viewport's. */
  const index = () => {
    let i = 0
    sections().forEach((section, n) => {
      if (section.getBoundingClientRect().top <= 1) i = n
    })
    return i
  }

  return {
    get index() {
      return index()
    },
    goTo(i) {
      const section = sections()[i]
      if (section) (move ?? jump)(Math.round(section.getBoundingClientRect().top + window.scrollY))
    },
    next() {
      const y = nextStop(1)
      if (y !== undefined && !busy()) (move ?? jump)(y)
    },
    previous() {
      const y = nextStop(-1)
      if (y !== undefined && !busy()) (move ?? jump)(y)
    },
    destroy() {
      mm.revert()
      move = null
    },
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
