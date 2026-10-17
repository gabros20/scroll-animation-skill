/**
 * scrolly-steps.ts: scrollytelling's side-by-side pattern with no animation library and no scroll listener. Text steps
 * scroll natively beside a sticky graphic that changes once per step (the trigger clock): the step at a trigger line
 * picks the graphic's state. On phones, without JavaScript and in print the section is stacked: the graphic column is
 * hidden and each step's own inline figure shows in flow. css/scrolly.css holds the layout and the crossfade;
 * motion/ScrollySteps.tsx wraps this for React; GSAP pages mount it as it is and drive their own timeline from onStep.
 *
 *   Minimal: one state per step, in order (a step shows the state with its own index).
 *   <section data-scrolly>
 *     <div data-scrolly-graphic>
 *       <figure data-scrolly-state="0">…</figure>
 *       <figure data-scrolly-state="1">…</figure>
 *     </div>
 *     <ol data-scrolly-steps>
 *       <li data-scrolly-step>…</li>
 *       <li data-scrolly-step>…</li>
 *     </ol>
 *   </section>
 *
 *   Full: steps name their state (fewer states than steps), stacked-mode figures, a line, a query, live captions.
 *   <section data-scrolly data-scrolly-line="40" data-scrolly-query="(min-width: 800px)" data-scrolly-live
 *            data-scrolly-side="start">
 *     <div data-scrolly-graphic>
 *       <figure data-scrolly-state="map"><svg>…</svg><figcaption>…</figcaption></figure>
 *       <figure data-scrolly-state="zoom">…</figure>
 *     </div>
 *     <ol data-scrolly-steps>
 *       <li data-scrolly-step data-scrolly-show="map">…text…<figure data-scrolly-inline>…</figure></li>
 *       <li data-scrolly-step data-scrolly-show="map">…</li>
 *       <li data-scrolly-step data-scrolly-show="zoom">…</li>
 *     </ol>
 *   </section>
 *
 *   const scrolly = mountScrollySteps(section, { onStep: ({ index, previous, direction }) => … })
 *   scrolly.destroy()                                      on teardown (a route's mount(), useGSAP's cleanup)
 *
 * - Modes. Sticky (side by side) only when the pre-JS gate is on (html[data-animation="on"], GATE_SCRIPT) and
 *   DESKTOP_QUERY, or the root's data-scrolly-query, matches; otherwise stacked, with no observers. The root carries
 *   data-scrolly-mode. A breakpoint change switches live and keeps the reader's place: the active step keeps its
 *   distance from the viewport top through the switch (one immediate scroll through the page's scroll authority), so
 *   it is still the active step afterwards. Before the core mounts, css/scrolly.css lays the section out sticky at
 *   1024 px and up under the gate, so mounting shifts nothing; a root with its own data-scrolly-query renders stacked
 *   until the core mounts (that switch is the one layout shift, documented). A page whose failsafe already fired
 *   (failsafeFired(): its scripts were late) stays stacked rather than re-laying out under the reader.
 * - Reduced motion keeps the sticky mode: the graphic stands still beside text that scrolls natively, and css/
 *   scrolly.css makes the state change an instant swap. There is no runway to scroll past a frozen frame (the reason a
 *   pinned scene collapses), and the steps are the content either way.
 * - The active step is the last step, in document order, whose top has reached the line; before the first step that
 *   is step 0, so the graphic is never empty, and after the last the last stays. Between steps the one above the gap
 *   stays active. The line is data-scrolly-line, a percentage of the viewport below the header (default 50: the middle
 *   of the sticky graphic), from the --header-h the graphic sticks under (css/scrolly.css mirrors it into the graphic's
 *   scroll-margin-top, which the core reads in px whatever unit the page uses).
 * - How it notices. Two IntersectionObservers split the viewport at the line, one region above it and one below, and
 *   watch every step and the root. A step's top crossing the line moves it between the regions, and any jump (an
 *   anchor, Page Down, a reload mid-page, an immediate scrollTo) changes what one of them holds, so each callback
 *   re-reads the steps' rects and resolves. A 1 px strip at the line (header-theme.ts's probe) misses a jump that
 *   carries a step across the line without it ever overlapping the strip. IntersectionObserver fires on what the
 *   reader sees, so the same code is exact under native scrolling, Lenis and ScrollSmoother. Nothing runs per frame,
 *   and attributes are written only when they change. One blind spot: a jump inside a gap between steps taller than
 *   the viewport, with no step on screen before or after, resolves when the next step comes on screen.
 * - A jump reports one change: from the step before it to the step it lands on, never the steps it skipped.
 * - Writes: data-scrolly-active="<i>" on the root; data-step-state="before|active|after" on steps (sticky mode only:
 *   stacked steps lose it, so a page's dimming of inactive steps never dims stacked content); on the states, the shown
 *   one gets data-state-active and the others inert and aria-hidden="true". A `scrolly:step` CustomEvent (bubbling) on
 *   the root and the onStep option carry { index, previous, direction }. Every mount reports its starting step once,
 *   with previous null and direction null, and so does a change the observers find on their first callbacks: the page
 *   settling where it loaded (a #fragment, or a restored position, the browser applies after the scripts ran). On
 *   previous null seek a timeline to the step; animate only on a real change.
 * - No aria-current: ARIA's "step" is the current step of a process the reader is moving through (a checkout's
 *   progress), and a screen reader's cursor never moves the line, so it would announce a "current" step the reader
 *   isn't on.
 * - Focus. Keyboard focus (:focus-visible) inside a step makes it active while it stays on screen, even when the line
 *   didn't move (a step that can't reach the line at the page end, a step visible below the line). A click doesn't:
 *   the reader aimed at what they saw.
 * - progress: true writes --step-p (0..1, exact, never smoothed) on the root: the active step's way from its top at the
 *   line to the next step's top there (the last step: its own bottom). One requestAnimationFrame loop, only while the
 *   root is on screen in sticky mode, reading rects (what the reader sees, so ScrollSmoother's moving wrapper reads
 *   right; window.scrollY runs ahead of it). Written only when it changes. Gate your own motion from it under reduced
 *   motion.
 * - live: true (or data-scrolly-live) mirrors the shown state's figcaption into a visually hidden aria-live="polite"
 *   region in sticky mode. Off by default: the steps already say what the graphic shows, and an announcement on every
 *   step a reader scrolls past talks over the text they are reading. Turn it on when a state carries information the
 *   steps don't (a chart's value).
 * - destroy() disconnects everything and removes the live region, and leaves the last state in place, so a route
 *   shown again (Next's Activity) doesn't flash the first state before the next mount re-reads the page.
 * - Under ScrollSmoother sticky never sticks inside #smooth-content: pin the graphic with ScrollTrigger (scroll-
 *   authority.md §5). The steps' activations are the same.
 */
import { DESKTOP_QUERY, failsafeFired } from './config'
import { currentSmoothScroll } from './smooth/authority'

export type ScrollyMode = 'sticky' | 'stacked'
export type ScrollyDirection = 'down' | 'up' | null

export interface ScrollyStepDetail {
  /** The active step's index among the root's [data-scrolly-step] elements. */
  index: number
  /** The step active before; null on the mount's first report. */
  previous: number | null
  /** 'down' to a later step, 'up' to an earlier one; null on the mount's first report. */
  direction: ScrollyDirection
}

export interface ScrollyStepsOptions {
  /** The trigger line as a fraction (0..1) of the viewport below the header. Default: data-scrolly-line (a percentage), else 0.5. */
  line?: number
  /** The sticky-mode media query. Default: data-scrolly-query, else DESKTOP_QUERY. */
  query?: string
  /** Write --step-p on the root while it is on screen. Default false. */
  progress?: boolean
  /** Mirror the shown state's figcaption into an aria-live region. Default: data-scrolly-live is present. */
  live?: boolean
  /** Every active-step change, and once on mount (previous null). */
  onStep?: (detail: ScrollyStepDetail, scrolly: ScrollyStepsHandle) => void
  /** Every mode switch, and once on mount. */
  onMode?: (mode: ScrollyMode, scrolly: ScrollyStepsHandle) => void
  /** Every --step-p change (progress: true only). */
  onProgress?: (p: number, scrolly: ScrollyStepsHandle) => void
}

export interface ScrollyStepsHandle {
  readonly root: HTMLElement
  readonly active: number
  readonly direction: ScrollyDirection
  readonly mode: ScrollyMode
  /** The last --step-p written (0 without progress: true). */
  readonly progress: number
  /** Re-read the steps and states (added or removed) and resolve again. */
  refresh(): void
  destroy(): void
}

declare global {
  interface HTMLElementEventMap {
    'scrolly:step': CustomEvent<ScrollyStepDetail>
  }
}

export const STEP_EVENT = 'scrolly:step'
export const DEFAULT_LINE = 0.5

// ── the maths (pure; tests/unit/scrolly-steps.test.mjs) ─────────────────────────────────────────────────────────────

/** data-scrolly-line: a percentage ("40", "40%"), 0..100, as a fraction; null when absent or invalid. */
export function parseLine(value: string | null | undefined): number | null {
  if (value == null || value.trim() === '') return null
  const n = Number(value.trim().replace(/%$/, ''))
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n / 100 : null
}

/** The line's y in the viewport: `fraction` of the height below the header. */
export function lineY(viewportHeight: number, header: number, fraction: number): number {
  return header + Math.max(0, viewportHeight - header) * fraction
}

/** The last step (document order) whose top has reached the line; 0 when none has. */
export function stepAtLine(tops: readonly number[], line: number): number {
  let index = 0
  tops.forEach((top, i) => {
    if (top <= line) index = i
  })
  return index
}

/**
 * The active step: a keyboard-focused step while it is on screen, else the step at the line. `focused` is the index
 * of the step holding keyboard focus (null: none), `focusedOnScreen` whether its box is in the viewport.
 */
export function resolveActive(tops: readonly number[], line: number, focused: number | null, focusedOnScreen: boolean): number {
  return focused !== null && focused >= 0 && focused < tops.length && focusedOnScreen ? focused : stepAtLine(tops, line)
}

export function directionOf(previous: number | null, index: number): ScrollyDirection {
  return previous === null || previous === index ? null : index > previous ? 'down' : 'up'
}

/** --step-p: the line's way from the step's top (0) to `end` (1), the next step's top or the last step's bottom. */
export function stepProgress(top: number, end: number, line: number): number {
  if (end <= top) return line >= top ? 1 : 0
  return Math.min(1, Math.max(0, (line - top) / (end - top)))
}

/**
 * The two observer regions as rootMargins, from the line's place as a fraction of the viewport's height: `above`
 * keeps the viewport from its top to the line, `below` from the line to its bottom. Percentages follow the root the
 * browser measures (iOS's toolbars), so the line stays at its fraction without correcting the margins.
 */
export function regionMargins(fraction: number): { above: string; below: string } {
  const f = Math.min(0.999, Math.max(0.001, fraction))
  const pct = (v: number) => `${Math.round(v * 1e5) / 1e3}%`
  return { above: `0px 0px -${pct(1 - f)} 0px`, below: `-${pct(f)} 0px 0px 0px` }
}

// ── the block ───────────────────────────────────────────────────────────────────────────────────────────────────────

const STEP = '[data-scrolly-step]'
const STATE = '[data-scrolly-graphic] [data-scrolly-state]'
const ACTIVE = 'data-scrolly-active'
const MODE = 'data-scrolly-mode'
/** Frames in a row off-screen before the progress loop stops without an observer callback saying so. */
const OFF_FRAMES = 30

export function mountScrollySteps(root: HTMLElement, options: ScrollyStepsOptions = {}): ScrollyStepsHandle {
  const doc = root.ownerDocument
  const view = doc.defaultView ?? window
  const fraction = options.line ?? parseLine(root.getAttribute('data-scrolly-line')) ?? DEFAULT_LINE
  const query = view.matchMedia(options.query ?? root.getAttribute('data-scrolly-query') ?? DESKTOP_QUERY)
  const wantsLive = options.live ?? root.hasAttribute('data-scrolly-live')
  const gated = doc.documentElement.dataset.animation === 'on' && !failsafeFired()

  let steps: HTMLElement[] = []
  let states: HTMLElement[] = []
  let mode = 'stacked' as ScrollyMode
  let active = clampIndex(Number(root.getAttribute(ACTIVE)))
  let direction: ScrollyDirection = null
  let progress = 0
  let focused: number | null = null
  /** The line in viewport px: computed on mount and resize, then taken from the observers' own bounds. */
  let line = 0
  let viewportHeight = 0
  let header = 0
  let margins = ''
  let above: IntersectionObserver | null = null
  let below: IntersectionObserver | null = null
  let frame = 0
  let liveRegion: HTMLElement | null = null
  let destroyed = false
  /** The mount's observers that haven't called back yet: what they find is where the page landed, not a step. */
  const unsettled = new Set<'above' | 'below'>()

  const handle: ScrollyStepsHandle = {
    root,
    get active() {
      return active
    },
    get direction() {
      return direction
    },
    get mode() {
      return mode
    },
    get progress() {
      return progress
    },
    refresh() {
      collect()
      if (mode === 'sticky') {
        observe()
        resolve()
      }
    },
    destroy() {
      destroyed = true
      query.removeEventListener('change', onQuery)
      view.removeEventListener('resize', onResize)
      root.removeEventListener('focusin', onFocusIn)
      root.removeEventListener('focusout', onFocusOut)
      disconnect()
      liveRegion?.remove()
      liveRegion = null
    },
  }

  function clampIndex(n: number) {
    return Number.isInteger(n) && n >= 0 ? n : 0
  }

  function collect() {
    steps = [...root.querySelectorAll<HTMLElement>(STEP)]
    states = [...root.querySelectorAll<HTMLElement>(STATE)]
    active = Math.min(active, Math.max(0, steps.length - 1))
  }

  const showOf = (index: number) => steps[index]?.getAttribute('data-scrolly-show') ?? String(index)
  const graphic = () => root.querySelector<HTMLElement>('[data-scrolly-graphic]')

  function readHeader() {
    const g = graphic()
    return g ? parseFloat(view.getComputedStyle(g).scrollMarginTop) || 0 : 0
  }

  function measure() {
    viewportHeight = Math.min(view.innerHeight, doc.documentElement.clientHeight || view.innerHeight)
    header = readHeader()
    line = lineY(viewportHeight, header, fraction)
  }

  function attr(el: Element, name: string, value: string | null) {
    if (el.getAttribute(name) === value) return
    if (value === null) el.removeAttribute(name)
    else el.setAttribute(name, value)
  }

  /** Writes the active step's attributes; only what changed. */
  function write() {
    attr(root, ACTIVE, String(active))
    if (mode === 'sticky') steps.forEach((s, i) => attr(s, 'data-step-state', i < active ? 'before' : i > active ? 'after' : 'active'))
    const show = showOf(active)
    let shown: HTMLElement | null = null
    for (const state of states) {
      const on = state.getAttribute('data-scrolly-state') === show
      if (on) shown = state
      attr(state, 'data-state-active', on ? '' : null)
      attr(state, 'aria-hidden', on ? null : 'true')
      if (state.inert === on) state.inert = !on
    }
    return shown
  }

  function report(previous: number | null) {
    const detail: ScrollyStepDetail = { index: active, previous, direction }
    options.onStep?.(detail, handle)
    root.dispatchEvent(new CustomEvent(STEP_EVENT, { detail, bubbles: true }))
  }

  /** `landing`: the page settling where it loaded, reported like the mount (previous and direction null). */
  function setActive(next: number, landing = false) {
    if (next === active) return
    const previous = active
    active = next
    direction = landing ? null : directionOf(previous, next)
    const before = showOf(previous)
    const shown = write()
    if (liveRegion && shown && showOf(next) !== before) {
      liveRegion.textContent = shown.querySelector('figcaption')?.textContent?.trim() ?? ''
    }
    report(landing ? null : previous)
  }

  const tops = () => steps.map((s) => s.getBoundingClientRect().top)

  function focusedOnScreen() {
    if (focused === null || !steps[focused]) return false
    const r = steps[focused].getBoundingClientRect()
    return r.bottom > 0 && r.top < viewportHeight
  }

  function resolve(landing = false) {
    if (destroyed || mode !== 'sticky' || !steps.length) return
    setActive(resolveActive(tops(), line, focused, focusedOnScreen()), landing)
  }

  // ── observers ─────────────────────────────────────────────────────────────────────────────────────────────────

  function onEntries(region: 'above' | 'below', observer: IntersectionObserver, entries: IntersectionObserverEntry[]) {
    if (observer !== above && observer !== below) return
    // The header height can arrive after the mount (WebKit may run a module script before the page's stylesheet
    // applies; measured: the line sat 32 px high for the page's life). New regions call back and resolve.
    if (readHeader() !== header) {
      measure()
      observe()
      return
    }
    const bounds = entries[0]?.rootBounds
    // The observer's own bounds ARE the line it watches: reading it from them keeps the resolution and the regions
    // in agreement when the viewport the browser measures differs from innerHeight.
    if (bounds && bounds.height > 0) line = region === 'above' ? bounds.bottom : bounds.top
    resolve(unsettled.delete(region))
    loop()
  }

  function observe() {
    disconnect()
    const fractionOfViewport = viewportHeight > 0 ? line / viewportHeight : fraction
    const next = regionMargins(fractionOfViewport)
    margins = next.above + next.below
    const make = (region: 'above' | 'below') => {
      const io: IntersectionObserver = new IntersectionObserver((entries) => onEntries(region, io, entries), {
        root: doc,
        rootMargin: next[region],
      })
      io.observe(root)
      steps.forEach((s) => io.observe(s))
      return io
    }
    above = make('above')
    below = make('below')
  }

  function disconnect() {
    above?.disconnect()
    below?.disconnect()
    above = below = null
    if (frame) view.cancelAnimationFrame(frame)
    frame = 0
  }

  // ── progress ──────────────────────────────────────────────────────────────────────────────────────────────────

  function writeProgress() {
    const step = steps[active]
    if (!step) return
    const r = step.getBoundingClientRect()
    const end = steps[active + 1]?.getBoundingClientRect().top ?? r.bottom
    const p = Math.round(stepProgress(r.top, end, line) * 1e4) / 1e4
    if (p === progress && root.style.getPropertyValue('--step-p') !== '') return
    progress = p
    root.style.setProperty('--step-p', String(p))
    options.onProgress?.(p, handle)
  }

  /**
   * From the root's rect, never the entry's isIntersecting: WebKit can report a stale false for an element much taller
   * than the viewport (measured: the loop stopped mid-section).
   */
  function rootOnScreen() {
    const r = root.getBoundingClientRect()
    return r.height > 0 && r.bottom > 0 && r.top < viewportHeight
  }

  /** Frames in a row the loop has found the root off-screen. */
  let offFrames = 0

  /**
   * One rAF loop while the root is on screen in sticky mode, started and stopped from the observers' callbacks (every
   * edge crossing). A frame off-screen alone doesn't stop it: a smooth scroll can leave and come back between two
   * callbacks. OFF_FRAMES in a row do, with a last exact write.
   */
  function loop() {
    if (!options.progress) return
    const run = !destroyed && mode === 'sticky' && rootOnScreen()
    if (!run) {
      if (frame) stopLoop()
      return
    }
    if (frame) return
    offFrames = 0
    const tick = () => {
      writeProgress()
      offFrames = rootOnScreen() ? 0 : offFrames + 1
      frame = offFrames < OFF_FRAMES ? view.requestAnimationFrame(tick) : 0
    }
    frame = view.requestAnimationFrame(tick)
  }

  function stopLoop() {
    view.cancelAnimationFrame(frame)
    frame = 0
    if (!destroyed && mode === 'sticky') writeProgress()
  }

  // ── modes ─────────────────────────────────────────────────────────────────────────────────────────────────────

  function scrollBy(delta: number) {
    const y = view.scrollY + delta
    const scroll = currentSmoothScroll()
    if (scroll) scroll.scrollTo(y, { immediate: true })
    else view.scrollTo({ top: y, behavior: 'instant' })
  }

  /** The mode's own DOM and observers; no resolving, no reports. */
  function enter(next: ScrollyMode) {
    mode = next
    attr(root, MODE, next)
    if (next === 'sticky') {
      measure()
      root.style.setProperty('--scrolly-line', String(fraction))
      if (wantsLive && !liveRegion) {
        liveRegion = doc.createElement('div')
        liveRegion.setAttribute('data-scrolly-live-region', '')
        liveRegion.setAttribute('aria-live', 'polite')
        liveRegion.setAttribute('aria-atomic', 'true')
        root.append(liveRegion)
      }
    } else {
      disconnect()
      steps.forEach((s) => attr(s, 'data-step-state', null))
      liveRegion?.remove()
      liveRegion = null
    }
  }

  /** A live switch: the active step keeps its distance from the viewport top, so it is still active afterwards. */
  function switchMode(next: ScrollyMode) {
    if (next === mode) return
    // In stacked mode nothing tracked the reader: the step they are at comes from the stacked layout's own rects.
    if (mode === 'stacked' && steps.length) {
      measure()
      active = stepAtLine(tops(), line)
    }
    const anchor = steps[active]
    const was = anchor?.getBoundingClientRect()
    const onScreen = !!was && was.bottom > 0 && was.top < view.innerHeight
    enter(next)
    if (anchor && was && onScreen) {
      const delta = anchor.getBoundingClientRect().top - was.top
      if (Math.abs(delta) >= 1) scrollBy(delta)
    }
    write()
    if (next === 'sticky') {
      observe()
      resolve()
    }
    options.onMode?.(next, handle)
  }

  const desired = (): ScrollyMode => (gated && query.matches ? 'sticky' : 'stacked')

  const onQuery = () => switchMode(desired())

  const onResize = () => {
    if (mode !== 'sticky') return
    const before = margins
    measure()
    const next = regionMargins(viewportHeight > 0 ? line / viewportHeight : fraction)
    if (next.above + next.below !== before) observe()
    resolve()
  }

  const stepOf = (target: EventTarget | null) => {
    const step = target instanceof Element ? target.closest(STEP) : null
    return step ? steps.indexOf(step as HTMLElement) : -1
  }

  const onFocusIn = (event: FocusEvent) => {
    const i = stepOf(event.target)
    const keyboard = event.target instanceof Element && event.target.matches(':focus-visible')
    focused = i >= 0 && keyboard ? i : null
    resolve()
  }

  const onFocusOut = (event: FocusEvent) => {
    if (focused === null) return
    if (stepOf(event.relatedTarget) === focused) return
    focused = null
    resolve()
  }

  // ── mount ─────────────────────────────────────────────────────────────────────────────────────────────────────

  collect()
  enter(desired())
  // The pre-mount CSS already laid a sticky section out side by side: resolve from that layout before the observers'
  // first callbacks, so a reload or an anchor mid-section is right in the first frame.
  if (mode === 'sticky' && steps.length) active = stepAtLine(tops(), line)
  write()
  report(null)
  options.onMode?.(mode, handle)
  if (mode === 'sticky') {
    unsettled.add('above').add('below')
    observe()
  }
  query.addEventListener('change', onQuery)
  view.addEventListener('resize', onResize)
  root.addEventListener('focusin', onFocusIn)
  root.addEventListener('focusout', onFocusOut)
  return handle
}
