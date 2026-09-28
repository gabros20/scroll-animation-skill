/**
 * gsap/marquee-velocity.ts — a recipe: a looping row whose speed and direction follow the scroll's velocity, on GSAP
 * pages. `marqueeVelocity(el, options)` → a handle. One file to adapt in place.
 *
 *   <div data-marquee id="ticker">                              overflow: clip
 *     <div data-marquee-track>                                  display: flex; width: max-content
 *       <ul>…the items…</ul>
 *       <ul aria-hidden="true" inert>…the same items…</ul>      a copy: assistive tech and Tab reach each item once
 *     </div>
 *   </div>
 *   <button type="button" aria-controls="ticker" aria-pressed="false">Pause the ticker</button>
 *
 *   const marquee = marqueeVelocity(el, { toggle: button })    marquee.paused   .pause()   .play()   .destroy()
 *
 * - When: the row should answer the reader's scroll. A row at a steady speed needs no JavaScript:
 *   `data-scroll-fx="marquee"` (css/scroll-effects.css) takes the same markup and the same button. Never both on a row.
 * - The loop: the track slides one copy's width (half its own) and starts over, seamless when the copies match and each
 *   is at least as wide as the marquee. Put no gap on the track: space the items inside each copy and end each copy
 *   with the same space. `duration` (30 s, the CSS marquee's) is one loop at rest. A right-to-left track runs
 *   rightward.
 * - Velocity: each scroll update asks for 1 + |velocity| / `velocity` (px/s, default 600) times the resting speed, at
 *   most `maxSpeed` (default 5), in the scroll's direction: scrolling up runs the row backwards. It keeps the last
 *   direction and returns to the resting speed once the scroll stops. The speed goes through gsap.quickTo on the loop's
 *   timeScale (never a new tween per event), so it eases over 0.6 s instead of jumping.
 * - WCAG 2.2.2: it moves on its own for more than 5 s, so the page must give it a pause control: a button outside the
 *   marquee, with `aria-controls` pointing at it and `aria-pressed` for its state. Pass it as `toggle` and the recipe
 *   wires it: a click pauses or plays, and the reader's pause holds through hover, focus and scrolling. It also pauses
 *   while hovered, while focus is inside it, and while it is off screen. Keyboard focus on an item the marquee clips
 *   moves the row until the item shows.
 * - Reduced motion (live, gsap.matchMedia(MOTION_CONDITIONS)): stopped, with nothing inline, and the scroll's velocity
 *   is ignored. The toggle reads pressed, and a press still starts it at the resting speed: items that are clipped
 *   only come into view by moving. Without JavaScript the row stands still, and it prints from its start.
 * - One writer: the track's `transform` is the recipe's. The velocity trigger lives outside the matchMedia build (GSAP
 *   3.15 throws the reader to the top when a ScrollTrigger is created or killed during a rebuild), so call it outside
 *   your own gsap.matchMedia callbacks. destroy() removes the loop, the listeners and the trigger, and puts back the
 *   track's inline styles and the toggle's aria-pressed.
 */
import { MOTION_CONDITIONS, ScrollTrigger, gsap, setupGsap, type MotionConditions } from './setup'

export interface MarqueeVelocityOptions {
  /** The pause control (WCAG 2.2.2): a button outside the marquee, with aria-controls and aria-pressed. */
  toggle?: HTMLElement | null
  /** Seconds per loop at rest. Default 30. */
  duration?: number
  /** The scroll speed, px/s, that adds one more resting speed. Default 600. */
  velocity?: number
  /** The fastest it runs, in resting speeds. Default 5. */
  maxSpeed?: number
}

export interface MarqueeVelocityHandle {
  /** Paused by the reader (the toggle's state), or by reduced motion until they press play. */
  readonly paused: boolean
  pause(): void
  play(): void
  destroy(): void
}

/** How the speed follows the scroll: gsap.quickTo on the loop's timeScale. */
const FOLLOW = { duration: 0.6, ease: 'power3' }

export function marqueeVelocity(el: HTMLElement, options: MarqueeVelocityOptions = {}): MarqueeVelocityHandle | null {
  const track = el.querySelector<HTMLElement>('[data-marquee-track]')
  if (!track) return null
  setupGsap()
  const toggle = options.toggle ?? null
  const pressed = toggle?.getAttribute('aria-pressed') ?? null
  // GSAP reverts inline styles by emptying them, which leaves an empty style attribute: dropped if the track had none.
  const unstyled = !track.hasAttribute('style')
  const velocity = options.velocity ?? 600
  const maxSpeed = options.maxSpeed ?? 5

  /** The reader's choice from the toggle, which outranks everything else; null until they make one. */
  let choice: 'pause' | 'play' | null = null
  let reduce = false
  let hovered = false
  let focused = false
  let inView = false
  /** The last scroll direction: the row keeps running that way once the scroll stops. */
  let direction = 1
  let loop: gsap.core.Tween | null = null
  let speedTo: gsap.QuickToFunc | null = null

  const paused = () => choice === 'pause' || (choice === null && reduce)
  const update = () => {
    const hold = paused() || hovered || focused || !inView
    if (loop && loop.paused() !== hold) loop.paused(hold)
    toggle?.setAttribute('aria-pressed', String(paused()))
  }

  /** The copy's width, in the loop's own terms: the track slides this far per loop, and positions repeat after it. */
  const period = () => track.offsetWidth / 2
  let rtl = false

  /** Keyboard focus on an item clipped by the marquee moves the loop until the item shows (focus also pauses it). */
  const reveal = (target: Element) => {
    if (!loop || !target.matches(':focus-visible')) return
    const view = el.getBoundingClientRect()
    const box = target.getBoundingClientRect()
    if (box.left >= view.left - 1 && box.right <= view.right + 1) return
    // The translate that puts the item's start edge on the marquee's, as progress through one loop.
    const shift = rtl ? box.right - view.right : box.left - view.left
    const at = ((gsap.getProperty(track, 'xPercent') as number) / 100) * track.offsetWidth - shift
    loop.progress((((rtl ? at : -at) / period()) % 1 + 1) % 1)
  }

  const mm = gsap.matchMedia()
  mm.add(MOTION_CONDITIONS, (context) => {
    const next = (context.conditions as MotionConditions).reduce
    // A new preference starts from its own default: a reader who turns reduced motion on sees the row stop.
    if (next !== reduce) choice = null
    reduce = next
    rtl = getComputedStyle(track).direction === 'rtl'
    loop = gsap.to(track, {
      xPercent: rtl ? 50 : -50,
      duration: options.duration ?? 30,
      ease: 'none',
      repeat: -1,
      paused: true,
    })
    if (!reduce) {
      // Far enough into its repeats that running backwards never reaches the start.
      loop.totalTime(loop.duration() * 1000)
      speedTo = gsap.quickTo(loop, 'timeScale', FOLLOW)
    }
    update()
    // Printed from its start, then back where it was.
    let at = 0
    const print = () => {
      at = loop?.totalTime() ?? 0
      loop?.progress(0)
    }
    const unprint = () => loop?.totalTime(at)
    window.addEventListener('beforeprint', print)
    window.addEventListener('afterprint', unprint)
    // The build's tweens revert with it, which puts the track's inline styles back.
    return () => {
      window.removeEventListener('beforeprint', print)
      window.removeEventListener('afterprint', unprint)
      loop = null
      speedTo = null
      if (unstyled && track.getAttribute('style') === '') track.removeAttribute('style')
    }
  })

  // Outside the build, for the handle's life (see the header): the page's whole scroll, and when it stops.
  const trigger = ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate(self) {
      const v = self.getVelocity()
      if (!speedTo || !v) return
      direction = v < 0 ? -1 : 1
      speedTo(direction * Math.min(maxSpeed, 1 + Math.abs(v) / velocity))
    },
  })
  const settle = () => speedTo?.(direction)
  ScrollTrigger.addEventListener('scrollEnd', settle)

  const onEnter = () => {
    hovered = true
    update()
  }
  const onLeave = () => {
    hovered = false
    update()
  }
  const onFocusIn = (event: FocusEvent) => {
    focused = true
    update()
    if (event.target instanceof Element) reveal(event.target)
  }
  const onFocusOut = (event: FocusEvent) => {
    focused = el.contains(event.relatedTarget as Node | null)
    update()
  }
  const onToggle = () => {
    choice = paused() ? 'play' : 'pause'
    update()
  }
  el.addEventListener('pointerenter', onEnter)
  el.addEventListener('pointerleave', onLeave)
  el.addEventListener('focusin', onFocusIn)
  el.addEventListener('focusout', onFocusOut)
  toggle?.addEventListener('click', onToggle)
  const observer = new IntersectionObserver(([entry]) => {
    inView = !!entry?.isIntersecting
    update()
  })
  observer.observe(el)

  return {
    get paused() {
      return paused()
    },
    pause() {
      choice = 'pause'
      update()
    },
    play() {
      choice = 'play'
      update()
    },
    destroy() {
      mm.revert()
      trigger.kill()
      ScrollTrigger.removeEventListener('scrollEnd', settle)
      el.removeEventListener('pointerenter', onEnter)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('focusin', onFocusIn)
      el.removeEventListener('focusout', onFocusOut)
      toggle?.removeEventListener('click', onToggle)
      observer.disconnect()
      if (pressed === null) toggle?.removeAttribute('aria-pressed')
      else toggle?.setAttribute('aria-pressed', pressed)
    },
  }
}
