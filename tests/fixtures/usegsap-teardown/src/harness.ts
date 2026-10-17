// Imported first by the page: it records every event listener, observer and interval the page's own bundle
// registers once armed, so tests/usegsap-teardown.mjs can tell what a block left behind after useGSAP tore it down.
// The ideas are tests/fixtures/recipes/src/harness.ts's; here the DOM is React's, so a snapshot is taken per mount
// (the block's subtree, which survives detached after an unmount, and everything outside the React root).
import { Observer } from 'gsap/Observer'

import { ScrollTrigger, gsap } from '../../../../skills/scroll-animation/assets/gsap/setup'

interface Registration {
  target: EventTarget
  type: string
  listener: EventListenerOrEventListenerObject
  capture: boolean
  /** Added while armed, by the page's own bundle. */
  counted: boolean
}

let armed = false
/**
 * The call comes from the page's bundle (Vite puts it in /assets/), not from a script Playwright evaluates, nor from
 * React: it puts its own media-event listeners on every <video> and <source> it creates and never takes them off.
 */
const fromPage = () => {
  if (!armed) return false
  const stack = new Error().stack ?? ''
  if (stack.includes('listenToNonDelegatedEvent')) return false
  return stack
    .split('\n')
    .filter((line) => /:\d+:\d+/.test(line))
    .slice(2)
    .some((line) => line.includes(`${location.origin}/assets/`))
}

const registrations: Registration[] = []
const captureOf = (options?: boolean | AddEventListenerOptions | EventListenerOptions) =>
  typeof options === 'boolean' ? options : !!options?.capture
const find = (target: EventTarget, type: string, listener: EventListenerOrEventListenerObject, capture: boolean) =>
  registrations.findIndex((r) => r.target === target && r.type === type && r.listener === listener && r.capture === capture)

const addListener = EventTarget.prototype.addEventListener
const removeListener = EventTarget.prototype.removeEventListener
EventTarget.prototype.addEventListener = function (type, listener, options) {
  if (listener && find(this, type, listener, captureOf(options)) < 0) {
    const once = typeof options === 'object' && !!options?.once
    // A `once` listener goes by itself when it fires; the spy can't see that, so it isn't counted.
    registrations.push({ target: this, type, listener, capture: captureOf(options), counted: !once && fromPage() })
  }
  return addListener.call(this, type, listener, options)
}
EventTarget.prototype.removeEventListener = function (type, listener, options) {
  if (listener) {
    const i = find(this, type, listener, captureOf(options))
    if (i >= 0) registrations.splice(i, 1)
  }
  return removeListener.call(this, type, listener, options)
}

/** Observers used while armed, with what each still observes. */
const observing = new Map<object, Set<Node>>()
for (const Ctor of [IntersectionObserver, ResizeObserver, MutationObserver] as const) {
  const proto = Ctor.prototype as unknown as {
    observe(target: Node, ...rest: unknown[]): void
    unobserve?(target: Node): void
    disconnect(): void
  }
  const { observe, unobserve, disconnect } = proto
  proto.observe = function (target: Node, ...rest: unknown[]) {
    if (fromPage()) {
      const set = observing.get(this) ?? new Set<Node>()
      set.add(target)
      observing.set(this, set)
    }
    return observe.call(this, target, ...rest)
  }
  if (unobserve) {
    proto.unobserve = function (target: Node) {
      observing.get(this)?.delete(target)
      return unobserve.call(this, target)
    }
  }
  proto.disconnect = function () {
    observing.get(this)?.clear()
    return disconnect.call(this)
  }
}

/** Intervals set while armed and not cleared: a watchdog that outlives its block keeps running for the page's life. */
const intervals = new Set<number>()
const setInterval0 = window.setInterval.bind(window)
const clearInterval0 = window.clearInterval.bind(window)
window.setInterval = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
  const id = setInterval0(handler, ms, ...args)
  if (fromPage()) intervals.add(id)
  return id
}) as typeof window.setInterval
window.clearInterval = ((id?: number) => {
  if (id !== undefined) intervals.delete(id)
  clearInterval0(id)
}) as typeof window.clearInterval

function describe(target: EventTarget) {
  if (target === window) return 'window'
  if (target === document) return 'document'
  if (target instanceof Element) return `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ''}`
  return target.constructor?.name ?? 'object'
}

/** One line per element: its tag and sorted attributes. `normalise` may rewrite an element's line (React's own). */
function lines(elements: Iterable<Element>, ignore: string[] = []): string[] {
  return Array.from(elements, (el) => {
    const attrs = Array.from(el.attributes)
      .filter((a) => !ignore.includes(a.name))
      .map((a) => {
        // Activity hides by writing display: none !important on its top host node and empties it on show: React's.
        if (el.id === 'case' && a.name === 'style') {
          const rest = a.value.replace(/display:\s*none\s*!important;?/, '').trim()
          return rest ? `style="${rest}"` : ''
        }
        return `${a.name}="${a.value}"`
      })
      .filter(Boolean)
      .sort()
    return `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} ${attrs.join(' ')}>`
  })
}

/** Everything outside the React root: <html>, <head>, <body> and the root's own attributes. */
const outside = (ignore: string[]) =>
  lines(
    Array.from(document.querySelectorAll('*')).filter((el) => !el.closest('#app') || el.id === 'app'),
    ignore,
  )
/** The block's subtree, attached or not. */
const inside = (root: Element, ignore: string[]) => lines([root, ...Array.from(root.querySelectorAll('*'))], ignore)

function diff(before: string[], after: string[]) {
  const out: string[] = []
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    if (before[i] !== after[i]) out.push(`${before[i] ?? '(none)'} → ${after[i] ?? '(none)'}`)
  }
  return out
}

/** GSAP's ticker keeps its listeners on itself; the types don't say so. */
const tickerListeners = () => ((gsap.ticker as unknown as { _listeners?: unknown[] })._listeners ?? []).slice()

/** What GSAP has running: triggers, Observers, tweens (delayedCalls included) and ticker listeners. */
export function census(): Record<string, unknown[]> {
  return {
    triggers: ScrollTrigger.getAll(),
    observers: Observer.getAll(),
    tweens: gsap.globalTimeline.getChildren(true, true, true),
    ticker: tickerListeners(),
  }
}

/** The pre-mount snapshots, per case element: taken the first time a block mounts on it. */
const before = new WeakMap<Element, { outside: string[]; inside: string[] }>()
let baseline: Record<string, unknown[]> = {}
let ignored: string[] = []

export const harness = {
  /** Attributes React owns on this case (state the block's own change renders), left out of every snapshot. */
  ignore(names: string[]) {
    ignored = names
  },
  /** Called by the case's useGSAP callback before it creates the block. */
  beforeMount(caseEl: Element) {
    if (!before.has(caseEl)) before.set(caseEl, { outside: outside(ignored), inside: inside(caseEl, ignored) })
  },
  /** The census as it stands now is what every teardown must return to; listeners count from here. */
  arm() {
    baseline = census()
    armed = true
  },
  /** What is live now beyond the baseline, by kind: the "nothing doubled" comparison. */
  counts() {
    const now = census()
    const out: Record<string, number> = {}
    for (const [key, live] of Object.entries(now)) out[key] = live.filter((item) => !(baseline[key] ?? []).includes(item)).length
    out.listeners = registrations.filter((r) => r.counted).length
    out.observed = Array.from(observing.values()).reduce((n, set) => n + set.size, 0)
    out.intervals = intervals.size
    return out
  },
  /** After a teardown: anything still live, and every attribute that differs from the case's pre-mount snapshot. */
  leftovers(caseEl: Element | null) {
    const snap = caseEl ? before.get(caseEl) : undefined
    const counts = harness.counts()
    return {
      listeners: registrations.filter((r) => r.counted).map((r) => `${describe(r.target)} ${r.type}`),
      observers: Array.from(observing.values())
        .filter((set) => set.size)
        .map((set) => Array.from(set, describe).join(',')),
      intervals: intervals.size,
      census: Object.fromEntries(['triggers', 'observers', 'tweens', 'ticker'].map((k) => [k, counts[k]]).filter(([, n]) => n)),
      attrs: snap && caseEl ? [...diff(snap.outside, outside(ignored)), ...diff(snap.inside, inside(caseEl, ignored))] : ['(no snapshot)'],
    }
  },
}
