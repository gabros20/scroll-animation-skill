/**
 * page.ts: the page lifecycle. One owner of "is this page ready to animate" for the first load and for every route
 * change (a visit). Engine-free and framework-free; blocks never import it, they read what it writes on <html>
 * (entrance-signal.ts). Dormant until its first call: a page that never calls it behaves as before.
 *
 *   <html data-entrance="pending | running | tail | settled" data-visit="3" data-visit-kind="push">
 *
 *   page.begin()                         a router adapter, once per committed navigation (react: <PageLifecycle />)
 *   page.placed()                        the router has placed the scroll (optional: two frames is the fallback)
 *   await page.when('settled')           'phase' | 'timeout' | 'stale' (a new visit began)
 *   const release = page.hold('loader', loaded, { capMs: 4000 })       keeps the visit at `pending`
 *   const stop = page.entrance(heroEl)   this element's animations are the entrance (else: the page's own)
 *   page.afterSettled(() => video.play(), { order: 1 })                costly starts, one per task
 *   page.onRemeasure(ScrollTrigger.refresh); page.remeasure()          one refresh per visit, after placement
 *
 * - A visit is one arrival: `load`, `push` (a link), `traverse` (back or forward) or `restore` (bfcache). The phase
 *   is monotonic within a visit and restarts with the next one. `detail` of `entrance:phase` carries visit and kind.
 * - A push starts at `pending` and is held (`data-entrance-held`): CSS entrances are paused from their first frame
 *   (css/split.css; give your own the same rule with [data-enter]) and the reveals start through whenEntranceOpen().
 *   When every hold is released the phase turns `running`, `startedAt` is stamped, and consumers' timeouts count
 *   from it.
 * - Built-in holds: `placement` (until placed(), at most two frames), `transition` (while a view transition is
 *   active, at most 1 s), `fonts` (only with <html data-entrance-fonts>, at most 400 ms), and the tab being visible.
 *   Your own hold defaults to a 4 s cap. A hold never outlives its cap: `running` always comes.
 * - begin() with no argument reads the kind: a traverse when a popstate changed the path since the last visit was
 *   placed, else a push.
 * - A traverse and a restore arrive `settled`: the reader is back where they were, and nothing replays.
 * - A load: the server HTML says which. `running`: a CSS entrance that played from first paint; nothing can hold it,
 *   and its clock is first contentful paint. `pending`: an entrance a script starts; the lifecycle opens it one
 *   frame after its first call unless something holds it (a loader), and a hold on a load restarts CSS entrances
 *   when it lifts (they ran unseen under the loader). No attribute: no entrance.
 * - One publisher per visit. Unless a block is it (one flag, `data-entrance-claimed`: a reveal's `entrance` option,
 *   trackEntrance(), page.entrance()), `tail` and `settled` come from the animations under [data-entrance-root],
 *   else <body>.
 * - The lifecycle never scrolls and never reads the scroll position. The router owns a push's position, the browser a
 *   traverse's; the scroll authority follows both by its own rule (smooth/authority.ts).
 *
 * Keep if you rewrite: begin() runs before the commit's layout effects (React: an insertion effect), or an entrance
 * created in one plays under the previous visit's `settled`; every hold has a cap; a new visit invalidates every
 * timer of the last.
 */
import { REDUCED_MOTION_QUERY, failsafeFired } from './config'
import {
  ENTRANCE_TIMEOUT_MS,
  entranceClaimed,
  readEntrance,
  trackAnimations,
  trackEntrance,
  writeEntrance,
  type EntrancePhase,
} from './entrance-signal'

export type Phase = EntrancePhase
export type VisitKind = 'load' | 'push' | 'traverse' | 'restore'

export interface Visit {
  id: number
  kind: VisitKind
  /** performance.now() at `running` (or at `settled`, on a visit that arrives settled); NaN before it. */
  startedAt: number
}

/** Caps, in ms. Each built-in hold releases itself; a cap is what a stuck one costs. */
export const HOLD_CAPS = { placement: 100, transition: 1000, fonts: 400, custom: 4000 } as const
/** How long after a visit its late content (streamed sections, images) still re-measures the page. */
export const SETTLE_MS = 5000
/** One refresh per burst of height changes, and per burst of remeasure() calls. */
export const SETTLE_DEBOUNCE_MS = 150

const ORDER: readonly Phase[] = ['pending', 'running', 'tail', 'settled']
const past = (phase: Phase, target: Phase) => ORDER.indexOf(phase) >= ORDER.indexOf(target)
const html = () => document.documentElement
const hasDom = () => typeof document !== 'undefined'

// ── the refresh registry and the settle watch (no visit needed: smooth/route.ts uses them alone) ─────────────

// Each registered function with its count: two registrations of one function run it once, and unregister apart.
const registered = new Map<() => void, number>()

function onRemeasure(refresh: () => void): () => void {
  registered.set(refresh, (registered.get(refresh) ?? 0) + 1)
  let live = true
  return () => {
    if (!live) return
    live = false
    const count = (registered.get(refresh) ?? 1) - 1
    if (count > 0) registered.set(refresh, count)
    else registered.delete(refresh)
  }
}

/** @internal Runs every registered refresh once, with `extra` if given. */
export function refreshAll(extra?: () => void): void {
  const run = new Set(registered.keys())
  if (extra) run.add(extra)
  for (const fn of run) fn()
}

// The watch running now, and the height its last refresh measured. A new watch ends it and, unless it just
// refreshed, takes that height over: a change the old watch hadn't refreshed yet still runs once, and two watches
// never refresh one change twice.
let watching: { stop: () => void; measured: number } | undefined

/**
 * @internal For `settle` ms, run the refreshes again each time the page's height changes, debounced (a
 * ResizeObserver, never per frame). `refreshed`: the caller just refreshed, so the current height is measured.
 */
export function watchSettle(options: { refresh?: () => void; settle?: number } = {}, refreshed = false): () => void {
  const { refresh, settle = SETTLE_MS } = options
  const before = watching
  before?.stop()
  if (!(settle > 0) || !hasDom() || typeof ResizeObserver === 'undefined') return () => {}
  const root = html()
  let pending: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    observer.disconnect()
    clearTimeout(pending)
    clearTimeout(end)
    if (watching === self) watching = undefined
  }
  // The observer's first report, and a refresh's own pin spacing, match `measured`: nothing runs for them.
  const self = { stop, measured: refreshed || !before ? root.scrollHeight : before.measured }
  const check = () => {
    pending = undefined
    if (root.scrollHeight === self.measured) return
    refreshAll(refresh)
    self.measured = root.scrollHeight
  }
  const observer = new ResizeObserver(() => {
    clearTimeout(pending)
    pending = setTimeout(check, SETTLE_DEBOUNCE_MS)
  })
  observer.observe(root)
  if (document.body) observer.observe(document.body)
  const end = setTimeout(stop, settle)
  watching = self
  return stop
}

let remeasureTimer: ReturnType<typeof setTimeout> | undefined
function remeasure(): void {
  clearTimeout(remeasureTimer)
  remeasureTimer = setTimeout(() => {
    refreshAll()
    // And keep watching from here: what the caller announced (a search-param change, a client fetch) may still stream.
    endVisit.push(watchSettle({}, true))
  }, SETTLE_DEBOUNCE_MS)
}

// ── the visit ───────────────────────────────────────────────────────────────────────────────────────────────

let visit: Visit | null = null
/** Ends everything the current visit scheduled: holds, timers, the tracker. */
let endVisit: Array<() => void> = []
const holds = new Map<symbol, string>()
/** A popstate moved to another path and no visit has begun for it yet: the next one is a traverse. */
let popped = false
let path = typeof location === 'undefined' ? '' : location.pathname
// Registered as the module loads, the one thing here that isn't dormant: it has to run before the router's own
// popstate handler, and Next's commits the traverse synchronously inside it (measured, next@16.3.6), so a listener
// added later hears the event after begin() has run. A router that listens before this module loads passes the
// kind itself: page.begin('traverse').
if (typeof window !== 'undefined' && typeof location !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (location.pathname !== path) popped = true
  })
}
let placedFor = 0
let transitionHeld = 0

const frames = (count: number, fn: () => void): (() => void) => {
  let id = 0
  const step = () => (--count <= 0 ? fn() : (id = requestAnimationFrame(step)))
  id = requestAnimationFrame(step)
  return () => cancelAnimationFrame(id)
}

function stamp(v: Visit): void {
  html().setAttribute('data-visit', String(v.id))
  html().setAttribute('data-visit-kind', v.kind)
}

function ensure(): Visit {
  if (visit) return visit
  visit = { id: 1, kind: 'load', startedAt: NaN }
  if (!hasDom()) return visit
  stamp(visit)
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) begin('restore')
  })
  // A phase a block published (a 2.1 publisher, a visit that arrives settled) starts the clock too.
  html().addEventListener('entrance:phase', () => {
    const v = visit
    if (!v || !Number.isNaN(v.startedAt) || !past(readEntrance() ?? 'pending', 'running')) return
    v.startedAt = performance.now()
    html().setAttribute('data-entrance-started', String(Math.round(v.startedAt)))
  })
  const server = readEntrance()
  if (server === 'running') {
    // A CSS entrance, playing since first paint.
    const paint = performance.getEntriesByName?.('first-contentful-paint')[0]
    start(visit, paint ? paint.startTime : performance.now())
  } else if (server === 'pending') {
    // A script starts this one. One frame first: a loader mounted in this task can still take its hold.
    addHold('boot', undefined, 50, frames.bind(null, 1))
    builtinHolds()
  }
  return visit
}

/** `running`: the holds are gone. Stamps the clock, lifts the hold, and tracks the entrance unless a block claimed it. */
function start(v: Visit, at = performance.now()): void {
  v.startedAt = at
  html().setAttribute('data-entrance-started', String(Math.round(at)))
  html().removeAttribute('data-entrance-held')
  writeEntrance('running')
  if (visit !== v) return
  // The page's own animations are the entrance unless a block is its publisher (the one flag: entranceClaimed()).
  const root = document.querySelector('[data-entrance-root]') ?? document.body
  if (root) endVisit.push(trackAnimations(root, (phase) => !entranceClaimed() && visit === v && writeEntrance(phase)))
}

function addHold(
  reason: string,
  until: Promise<unknown> | undefined,
  capMs: number,
  auto?: (release: () => void) => () => void,
): () => void {
  const v = visit
  const key = Symbol(reason)
  holds.set(key, reason)
  let cancelAuto = () => {}
  const release = () => {
    if (!holds.delete(key)) return
    clearTimeout(cap)
    cancelAuto()
    if (visit === v) open()
  }
  const cap = setTimeout(release, capMs)
  if (auto) cancelAuto = auto(release)
  until?.then(release, release)
  endVisit.push(() => {
    clearTimeout(cap)
    cancelAuto()
    holds.delete(key)
  })
  return release
}

function builtinHolds(): void {
  if (html().getAttribute('data-entrance-fonts') !== null && document.fonts?.status === 'loading') {
    addHold('fonts', document.fonts.ready, HOLD_CAPS.fonts)
  }
}

const transitionActive = (): boolean => {
  try {
    return html().matches(':active-view-transition')
  } catch {
    return false // An engine without the selector: no hold; css/split.css's own rule covers nothing there either.
  }
}

/** Every hold released? Then the tab must be visible and no view transition active; then `running`. */
function open(): void {
  const v = visit
  if (!v || holds.size) return
  // Past pending already (a visit that arrives settled): nothing to open, and no hold may outlive that.
  if (readEntrance() !== 'pending') return void html().removeAttribute('data-entrance-held')
  if (document.visibilityState === 'hidden' && v.kind !== 'load') {
    const onVisible = () => {
      document.removeEventListener('visibilitychange', onVisible)
      if (visit === v) open()
    }
    document.addEventListener('visibilitychange', onVisible)
    endVisit.push(() => document.removeEventListener('visibilitychange', onVisible))
    return
  }
  if (transitionActive() && transitionHeld !== v.id) {
    transitionHeld = v.id
    // `finished` where the browser exposes the transition; a frame poll of the selector elsewhere.
    const active = (document as Document & { activeViewTransition?: { finished: Promise<unknown> } | null }).activeViewTransition
    addHold('transition', active?.finished, HOLD_CAPS.transition, (release) => {
      let stop = () => {}
      const poll = () => (transitionActive() ? (stop = frames(1, poll)) : release())
      stop = frames(1, poll)
      return () => stop()
    })
    return
  }
  start(v)
}

// A visit begins inside the commit (React: an insertion effect): the attributes are written at once, the event is
// dispatched in a microtask, after the commit, where a listener may set state.
const WRITE_BEGIN = { restart: true, defer: true } as const

function begin(kind?: VisitKind): Visit {
  const last = ensure()
  if (!hasDom()) return last
  endVisit.forEach((end) => end())
  endVisit = []
  holds.clear()
  clearTimeout(remeasureTimer)
  const next: Visit = { id: last.id + 1, kind: kind ?? (popped ? 'traverse' : 'push'), startedAt: NaN }
  visit = next
  popped = false
  stamp(next)
  for (const name of ['data-entrance-claimed', 'data-entrance-started', 'data-visit-placed']) html().removeAttribute(name)
  const arrives = next.kind !== 'push' || window.matchMedia(REDUCED_MOTION_QUERY).matches || failsafeFired()
  if (arrives) {
    html().removeAttribute('data-entrance-held')
    writeEntrance('settled', WRITE_BEGIN)
  } else {
    html().setAttribute('data-entrance-held', 'pause')
    writeEntrance('pending', WRITE_BEGIN)
    builtinHolds()
  }
  // Placement: placed() from the adapter, else two frames (the router placed the scroll in this commit), else the
  // cap (a hidden tab has no frames).
  addHold('placement', undefined, HOLD_CAPS.placement * 2)
  const cap = setTimeout(placed, HOLD_CAPS.placement)
  endVisit.push(frames(2, placed), () => clearTimeout(cap))
  return next
}

/** The router has placed the scroll for this visit: one refresh, then the settle watch. Once per visit. */
function placed(): void {
  const v = ensure()
  if (!hasDom() || placedFor === v.id) return
  placedFor = v.id
  // Read here, not in begin(): a router may write the URL in the same commit, after begin() (Next's history update is
  // an insertion effect too).
  path = location.pathname
  // A load is ScrollTrigger's own refresh (at `load`): only its streamed content is watched.
  if (v.kind !== 'load') refreshAll()
  const stop = watchSettle({}, v.kind !== 'load')
  // After this task: every effect of the commit has mounted its blocks, and they read the visit as it arrived
  // (arrivesSettled()). What mounts later in the visit is not part of the arrival.
  const stamped = setTimeout(() => visit === v && html().setAttribute('data-visit-placed', ''), 0)
  endVisit.push(stop, () => clearTimeout(stamped))
  for (const [key, reason] of holds) {
    if (reason !== 'placement') continue
    holds.delete(key)
    open()
  }
}

function hold(reason: string, until?: Promise<unknown>, options: { capMs?: number } = {}): () => void {
  const v = ensure()
  if (!hasDom() || readEntrance() !== 'pending') return () => {}
  // On a load, CSS entrances have run since first paint (under the loader): restart them when the hold lifts.
  if (v.kind === 'load' && html().getAttribute('data-entrance-held') === null) {
    html().setAttribute('data-entrance-held', 'restart')
  }
  return addHold(reason, until, options.capMs ?? HOLD_CAPS.custom)
}

function when(
  phase: Exclude<Phase, 'pending'>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<'phase' | 'timeout' | 'stale'> {
  const v = ensure()
  const { signal, timeoutMs } = options
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    if (!hasDom() || past(page.phase(), phase)) return resolve('phase')
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = (result: 'phase' | 'timeout' | 'stale') => {
      clearTimeout(timer)
      html().removeEventListener('entrance:phase', onPhase)
      signal?.removeEventListener('abort', onAbort)
      resolve(result)
    }
    // The timeout counts from `running`: armed once the visit has a start.
    const arm = () => {
      if (timeoutMs === undefined || timer !== undefined || Number.isNaN(v.startedAt)) return
      timer = setTimeout(() => done('timeout'), Math.max(0, v.startedAt + timeoutMs - performance.now()))
    }
    const onPhase = () => {
      if (visit !== v) return done('stale')
      if (past(page.phase(), phase)) return done('phase')
      arm()
    }
    const onAbort = () => {
      clearTimeout(timer)
      html().removeEventListener('entrance:phase', onPhase)
      reject(signal!.reason)
    }
    html().addEventListener('entrance:phase', onPhase)
    signal?.addEventListener('abort', onAbort)
    arm()
  })
}

function entrance(root: Element, options: { tailAt?: number } = {}): () => void {
  ensure()
  if (!hasDom()) return () => {}
  return trackEntrance(root, { tailAt: options.tailAt })
}

// ── the start queue ─────────────────────────────────────────────────────────────────────────────────────────

const queue: Array<{ start: () => void; order: number }> = []
let draining = false
/** One when() serves every queued start. */
let armed = false

/** One start per task, two frames apart (rAF also waits out a hidden tab), only while the visit is settled. */
function drain(): void {
  if (draining || !queue.length) return
  draining = true
  const v = visit
  const next = () => {
    if (visit !== v || page.phase() !== 'settled' || !queue.length) {
      draining = false
      arm()
      return
    }
    queue.shift()!.start()
    frames(2, () => setTimeout(next, 0))
  }
  setTimeout(next, 0)
}

/** Drain at this visit's `settled`, or when its entrance has run ENTRANCE_TIMEOUT_MS without settling. */
function arm(): void {
  if (armed || draining || !queue.length) return
  armed = true
  when('settled', { timeoutMs: ENTRANCE_TIMEOUT_MS }).then((result) => {
    armed = false
    if (result === 'stale') return arm()
    if (result === 'timeout') writeEntrance('settled')
    drain()
  })
}

function afterSettled(start: () => void, options: { order?: number; signal?: AbortSignal } = {}): void {
  ensure()
  const { signal } = options
  if (!hasDom() || signal?.aborted) return
  const drop = () => {
    const i = queue.indexOf(entry)
    if (i >= 0) queue.splice(i, 1)
  }
  const entry = {
    order: options.order ?? 0,
    start: () => {
      signal?.removeEventListener('abort', drop)
      start()
    },
  }
  const at = queue.findIndex((queued) => queued.order > entry.order)
  queue.splice(at < 0 ? queue.length : at, 0, entry)
  signal?.addEventListener('abort', drop, { once: true })
  arm()
}

export const page = {
  /** The current visit. The first call starts the lifecycle (a `load` visit). */
  visit: (): Visit => ensure(),
  /** The current visit's phase; `settled` on a page with no entrance. */
  phase: (): Phase => (ensure(), (hasDom() && readEntrance()) || 'settled'),
  /** Resolves at or past the phase of the current visit; 'stale' if a new visit began; rejects on abort. `timeoutMs` counts from `running`. */
  when,
  /** Keeps the visit at `pending` until released (or `until` settles, or the cap). A no-op once the visit runs. */
  hold,
  /** A router adapter calls this once per committed navigation, before the new route's entrances are created. */
  begin,
  /** The router placed the scroll: the visit's one refresh. Optional; two frames after begin() is the fallback. */
  placed,
  /** This element's CSS and WAAPI animations are the visit's entrance. Returns the stop. */
  entrance,
  /** A costly start (a video, a canvas loop, an embed): in `order`, one per task, after the entrance settled. */
  afterSettled,
  /** The page's content changed without a visit (search params, a client fetch): refresh, debounced, then watch it settle. */
  remeasure,
  /** Register a refresh (`ScrollTrigger.refresh`) for each visit's placement and for remeasure(). Returns the unregister. */
  onRemeasure,
}
