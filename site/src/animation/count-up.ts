/**
 * count-up.ts: numbers that count up once, when they come into view, with no animation library. motion/CountUp.tsx
 * renders the same markup and drives the same count from a MotionValue; GSAP pages mount this as it is.
 *
 *   <p>$<span data-count-up>1,280</span>M</p>               the server's text is the final value; a prefix or a
 *                                                             suffix stays outside the number
 *   <span data-count-up data-count-locale="de-DE">12.500,75</span>
 *   <span data-count-up data-count-from="1990">2026</span>
 *
 *   const stop = mountCountUps(routeRoot)                    on a route's show; stop() on its hide or teardown
 *
 * - The text is the source. Readers without JavaScript and crawlers read the real number, and the count only rewinds it
 *   to data-count-from (default 0) as it starts. Frames are formatted like the text: Intl.NumberFormat in
 *   data-count-locale (default: the element's lang, else en-US), with the text's fraction digits (data-count-decimals
 *   overrides them) and its grouping (1,280 groups, 2026 doesn't). The last frame restores the text exactly.
 * - It starts once about 60% of the number is visible (a line of text always gets there) and plays once, for
 *   MOTION.entrance.duration on CURVES.entrance. Each frame writes the number's one text node in place: no re-render,
 *   nothing moves but the number's own width, which `font-variant-numeric: tabular-nums` keeps steady.
 * - data-count-state: waiting (mounted) → counting → done. done never plays again, which is also how a route that is
 *   hidden and shown (stop(), then mount again) leaves it. stop() lands a running count on its final value.
 * - Screen readers hear the final value: while it counts, the number is aria-hidden and a visually hidden copy of the
 *   final text (data-count-up-label) sits right after it. Both go when it lands. (aria-label on the span would not do:
 *   ARIA forbids naming a plain span, and screen readers skip it.)
 * - Reduced motion (read live), the failsafe (html[data-animation-failsafe]) and a hidden tab show the final value at
 *   once: a count that would start then doesn't, and one that is running lands when motion is reduced, the tab is
 *   hidden or the page prints.
 * - It never marks the engine ready: the number is never hidden, so the failsafe goes on guarding what else is.
 */
import { CURVES, MOTION, REDUCED_MOTION_QUERY, failsafeFired, prefersReducedMotion } from './config'

/** The share of the number that must be visible before it counts. */
const THRESHOLD = 0.6
const STATE = 'data-count-state'
const LABEL = 'data-count-up-label'
/** The usual "sr-only" recipe: in the accessibility tree, off the screen and out of the layout. */
const VISUALLY_HIDDEN: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: '0',
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: '0',
}

export interface CountFormat {
  /** A BCP 47 locale for Intl.NumberFormat. Default en-US. */
  locale?: string
  /** Fraction digits, the same on every frame. Default: the final value's own. */
  decimals?: number
  /** Group the digits (1,280). Default true; false for a year. */
  grouping?: boolean
}

/** What a count needs when it starts: where it runs from and to, and how a frame reads. */
export interface CountSpec {
  from: number
  to: number
  format: Intl.NumberFormat
}

/** Runs a count's frames: `write` takes each value, `done` ends it. Returns a cancel. */
export type CountDriver = (from: number, to: number, write: (value: number) => void, done: () => void) => () => void

/** The formatter a count's frames go through. Fixed fraction digits, so the width only changes as the number grows. */
export function countFormat({ locale = 'en-US', decimals, grouping = true }: CountFormat, to: number): Intl.NumberFormat {
  // 0..20: every engine's Intl takes that range.
  const digits = Math.min(20, Math.max(0, Math.round(decimals ?? fractionDigits(to))))
  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    // Omitted rather than true: true forces grouping where the locale's own rule leaves it out (Spanish writes 1280).
    ...(grouping ? {} : { useGrouping: false }),
  }
  try {
    return new Intl.NumberFormat(locale, options)
  } catch {
    return new Intl.NumberFormat('en-US', options)
  }
}

/**
 * Reads a number as `locale` prints it ('1,280', '12.500,75', '1 280', '٢٠٢٦'): the value, its fraction digits and
 * whether it groups its digits. Null for anything that isn't a plain number.
 */
export function parseCount(text: string, locale: string): { value: number; decimals: number; grouped: boolean } | null {
  const numbers = countFormat({ locale, decimals: 1 }, 0)
  const parts = numbers.formatToParts(-1234567.5)
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.'
  const group = parts.find((p) => p.type === 'group')?.value
  const digits = Array.from(countFormat({ locale: numbers.resolvedOptions().locale, grouping: false }, 0).format(1234567890))
  let plain = ''
  let decimals = -1
  let grouped = false
  for (const ch of text.trim()) {
    const local = digits.indexOf(ch)
    const digit = /[0-9]/.test(ch) ? ch : local >= 0 ? String((local + 1) % 10) : null
    if (digit !== null) {
      plain += digit
      if (decimals >= 0) decimals++
    } else if (ch === decimal && decimals < 0) {
      plain += '.'
      decimals = 0
    } else if (ch === group || /[\s'\u2019]/.test(ch)) {
      grouped = true
    } else if ((ch === '-' || ch === '\u2212') && plain === '') {
      plain = '-'
    } else {
      return null
    }
  }
  const value = Number(plain)
  return /[0-9]/.test(plain) && Number.isFinite(value) ? { value, decimals: Math.max(0, decimals), grouped } : null
}

/** Every [data-count-up] under `root`, counted from its own text. Returns stop. */
export function mountCountUps(root: ParentNode): () => void {
  const stops = Array.from(root.querySelectorAll<HTMLElement>('[data-count-up]'), (el) => watchCount(el, () => readSpec(el)))
  return () => stops.forEach((stop) => stop())
}

/**
 * Counts one element once it is in view. `spec` is read when the count starts (null: nothing to count); `drive` runs
 * the frames (a requestAnimationFrame tween by default; motion/CountUp.tsx passes a MotionValue). Returns stop.
 */
export function watchCount(el: HTMLElement, spec: () => CountSpec | null, drive: CountDriver = tween): () => void {
  if (el.getAttribute(STATE) === 'done') return () => {}
  el.setAttribute(STATE, 'waiting')
  let land: (() => void) | null = null
  const line = new IntersectionObserver(
    (entries) => {
      const entry = entries[entries.length - 1]
      if (!entry?.isIntersecting || entry.intersectionRatio < THRESHOLD - 0.01) return
      line.disconnect()
      land = count(el, spec(), drive)
    },
    { threshold: THRESHOLD },
  )
  line.observe(el)
  return () => {
    line.disconnect()
    if (land) land()
    else if (el.getAttribute(STATE) === 'waiting') el.removeAttribute(STATE)
    land = null
  }
}

/** Starts the count, or shows the final value at once. Returns the landing while a count runs. */
function count(el: HTMLElement, s: CountSpec | null, drive: CountDriver): (() => void) | null {
  const doc = el.ownerDocument
  if (!s || prefersReducedMotion() || failsafeFired() || doc.visibilityState === 'hidden') {
    el.setAttribute(STATE, 'done')
    return null
  }
  const text = el.textContent ?? ''
  // One text node, written in place: a count never re-renders the element or replaces its children.
  if (el.childNodes.length !== 1 || el.firstChild?.nodeType !== Node.TEXT_NODE) el.textContent = text
  const node = el.firstChild as Text
  const hidden = el.getAttribute('aria-hidden')
  const label = doc.createElement('span')
  label.setAttribute(LABEL, '')
  label.textContent = text
  Object.assign(label.style, VISUALLY_HIDDEN)
  el.setAttribute('aria-hidden', 'true')
  el.after(label)
  el.setAttribute(STATE, 'counting')

  const view = doc.defaultView ?? window
  const reduce = view.matchMedia(REDUCED_MOTION_QUERY)
  let cancel = () => {}
  let landed = false
  const land = () => {
    if (landed) return
    landed = true
    cancel()
    reduce.removeEventListener('change', onReduce)
    doc.removeEventListener('visibilitychange', onVisibility)
    view.removeEventListener('beforeprint', land)
    node.data = text
    label.remove()
    if (hidden === null) el.removeAttribute('aria-hidden')
    else el.setAttribute('aria-hidden', hidden)
    el.setAttribute(STATE, 'done')
  }
  const onReduce = () => {
    if (reduce.matches) land()
  }
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') land()
  }
  reduce.addEventListener('change', onReduce)
  doc.addEventListener('visibilitychange', onVisibility)
  view.addEventListener('beforeprint', land)

  let shown = text
  cancel = drive(
    s.from,
    s.to,
    (value) => {
      const next = s.format.format(value)
      if (next !== shown && !landed) node.data = shown = next
    },
    land,
  )
  if (landed) cancel()
  return land
}

function readSpec(el: HTMLElement): CountSpec | null {
  const locale = el.getAttribute('data-count-locale') || el.closest('[lang]')?.getAttribute('lang') || 'en-US'
  const parsed = parseCount(el.textContent ?? '', locale)
  if (!parsed) return null
  const decimals = Number.parseInt(el.getAttribute('data-count-decimals') ?? '', 10)
  const from = Number(el.getAttribute('data-count-from') || 0)
  return {
    from: Number.isFinite(from) ? from : 0,
    to: parsed.value,
    format: countFormat(
      { locale, decimals: decimals >= 0 ? decimals : parsed.decimals, grouping: parsed.grouped },
      parsed.value,
    ),
  }
}

const ease = cubicBezier(CURVES[MOTION.entrance.curve])

/** The engine-free driver: MOTION.entrance.duration on CURVES.entrance, one write per frame. */
function tween(from: number, to: number, write: (value: number) => void, done: () => void): () => void {
  const ms = MOTION.entrance.duration * 1000
  let start = -1
  let frame = 0
  write(from)
  const step = (now: number) => {
    if (start < 0) start = now
    const t = Math.min(1, (now - start) / ms)
    write(from + (to - from) * ease(t))
    if (t < 1) frame = requestAnimationFrame(step)
    else done()
  }
  frame = requestAnimationFrame(step)
  return () => cancelAnimationFrame(frame)
}

/** A CSS cubic-bezier as a function of progress: x(t) rises on 0..1, so t is found by bisection. */
function cubicBezier([x1, y1, x2, y2]: readonly [number, number, number, number]): (x: number) => number {
  const at = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3
  return (x) => {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 24; i++) {
      const t = (lo + hi) / 2
      if (at(t, x1, x2) < x) lo = t
      else hi = t
    }
    return at((lo + hi) / 2, y1, y2)
  }
}

function fractionDigits(n: number): number {
  const s = String(n)
  return /e/i.test(s) ? 0 : Math.min(20, (s.split('.')[1] ?? '').length)
}
