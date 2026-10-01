// Shared by every recipe page: import it first. It records every event listener and observer registration, so
// tests/recipes.mjs can tell what a mount left behind after destroy(), and puts `window.__t` on the page.
//
// expose() snapshots every element's attributes, mounts the recipe once and destroys it (a warm-up: GSAP registers, for
// the page's life, the listeners it keeps whatever runs), arms the spy and mounts it for real. leftovers() then
// lists, after destroy(): listeners and observations the page's own scripts added since the spy was armed and that are
// still live (Playwright's injected scripts add their own, which don't count), attributes that differ from the snapshot
// (inline styles included), and anything in the page's census (triggers, tweens…) that wasn't there at the baseline.

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
 * The call comes from the page's bundle (Vite puts it in /assets/), not from a script Playwright evaluates. The first
 * two frames are this function and the wrapper that called it, both in the bundle, so they don't count.
 */
const fromPage = () =>
  armed &&
  (new Error().stack ?? '')
    .split('\n')
    .filter((line) => /:\d+:\d+/.test(line))
    .slice(2)
    .some((line) => line.includes(`${location.origin}/assets/`))
const registrations: Registration[] = []
const captureOf = (options?: boolean | AddEventListenerOptions | EventListenerOptions) =>
  typeof options === 'boolean' ? options : !!options?.capture
const find = (target: EventTarget, type: string, listener: EventListenerOrEventListenerObject, capture: boolean) =>
  registrations.findIndex(
    (r) => r.target === target && r.type === type && r.listener === listener && r.capture === capture,
  )

const addListener = EventTarget.prototype.addEventListener
const removeListener = EventTarget.prototype.removeEventListener
EventTarget.prototype.addEventListener = function (type, listener, options) {
  // A duplicate registration is a no-op in the browser, and here.
  if (listener && find(this, type, listener, captureOf(options)) < 0) {
    registrations.push({ target: this, type, listener, capture: captureOf(options), counted: fromPage() })
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

function describe(target: EventTarget) {
  if (target === window) return 'window'
  if (target === document) return 'document'
  if (target instanceof Element) {
    const id = target.id ? `#${target.id}` : ''
    return `${target.tagName.toLowerCase()}${id}`
  }
  return target.constructor?.name ?? 'object'
}

/** Every element with its attributes, one line each: equal snapshots mean nothing was written or left behind. */
function snapshot(): string[] {
  return Array.from(document.querySelectorAll('*'), (el) => {
    const attrs = Array.from(el.attributes, (a) => `${a.name}="${a.value}"`).sort()
    return `<${el.tagName.toLowerCase()} ${attrs.join(' ')}>`
  })
}

export const frames = (n: number) =>
  new Promise<void>((resolve) => {
    let i = 0
    const step = () => (++i >= n ? resolve() : requestAnimationFrame(step))
    requestAnimationFrame(step)
  })

export interface Recipe<H> {
  create(): H
  destroy(handle: H): void
  /** The live things of each kind the recipe may create (triggers, tweens…): none may be new after destroy. */
  census?(): Record<string, unknown[]>
  /** Anything the page's checks read or drive. */
  extras?: Record<string, unknown>
}

declare global {
  interface Window {
    __t: Record<string, unknown> & { frames: typeof frames }
  }
}

export function expose<H>(recipe: Recipe<H>) {
  // Before the warm-up: anything it left behind would hide the same leftover later.
  const before = snapshot()
  recipe.destroy(recipe.create())
  const baseline = recipe.census?.() ?? {}
  armed = true
  let handle: H | null = recipe.create()
  window.__t = {
    frames,
    handle: () => handle,
    destroy() {
      if (handle) recipe.destroy(handle)
      handle = null
    },
    remount() {
      handle = recipe.create()
    },
    leftovers() {
      const after = snapshot()
      const attrs: string[] = []
      for (let i = 0; i < Math.max(before.length, after.length); i++) {
        if (before[i] !== after[i]) attrs.push(`${before[i] ?? '(none)'} → ${after[i] ?? '(none)'}`)
      }
      const census = recipe.census?.() ?? {}
      return {
        listeners: registrations.filter((r) => r.counted).map((r) => `${describe(r.target)} ${r.type}`),
        observers: Array.from(observing.values())
          .filter((set) => set.size)
          .map((set) => Array.from(set, (node) => describe(node)).join(',')),
        attrs,
        census: Object.fromEntries(
          Object.entries(census)
            .map(([key, live]) => [key, live.filter((item) => !(baseline[key] ?? []).includes(item)).length])
            .filter(([, added]) => added),
        ),
      }
    },
    ...recipe.extras,
  }
}
