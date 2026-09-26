/**
 * A continuous attractor for scroll: while it runs, the page is nudged a
 * fraction of the way toward centring one box, every frame.
 *
 * ## Gravity, not a snap
 *
 * That is the whole mental model. There is no trigger moment, no settle gate,
 * no animation with a start and an end — a running pull simply attracts the
 * scroll for as long as its owner keeps it running.
 *
 * The nudge is ADDITIVE: each frame reads `window.scrollY` as it currently is
 * (visitor input already applied) and writes `y + step`. So the pull can
 * never overwrite, cancel or out-argue a scroll — it only ever adds a little
 * on top. A creeping arrival is helped along at a creep's pace and keeps
 * closing after the wheel goes quiet; there is no moment where the page
 * "settles, then snaps", because the pull was already running the whole way
 * in. `step` is an exponential ease (`tauS`) between a speed floor and a
 * ceiling, so it is quick when far out, gentle when close, and always lands
 * rather than crawling.
 *
 * ## The visitor always wins, by one rule instead of five
 *
 * Motion the pull did NOT write is the visitor's, and `releaseAwayPx` of it
 * directed away from centre releases the pull for the rest of the visit — the
 * loop goes quiet and only watches. Motion toward centre pays that meter back
 * down. This covers every input in one line of arithmetic: a wheel notch out,
 * a scrollbar drag, a keypress, a finger swipe, and the fly-by (a fling
 * through the target flips to "away" the instant it passes centre and is
 * released within a frame or two, so it is never trapped).
 *
 * The one exception is the inertia tail. A flicked arrival coasts past centre
 * with nobody's hand on it, and that coast is away-motion by the arithmetic
 * above — so every trackpad arrival would park slightly off. The well
 * therefore forgives ONE overshoot per visit: a release that goes quiet
 * (`reclaimQuietMs`) within `reclaimPx` of rest resumes the pull. Once only,
 * and only near rest, so a visitor who scrolled off and stopped to read is
 * never argued with.
 *
 * And ARRIVING SPENDS IT. The forgiveness is for an arrival that never
 * landed; once the target has reached rest there is nothing to forgive, and a
 * departure from a composition the visitor is already looking at is a
 * decision, not a tail. See the guard on `reclaims` in the loop.
 *
 * A finger on the glass suspends the WRITE but not the loop: pulling against
 * a live drag would slide the page out from under the finger, while the
 * away-meter still has to see that drag or a deliberate swipe out would be
 * yanked back on lift-off. Under `prefers-reduced-motion` the loop never
 * starts.
 *
 * ## Every length is on the fluid scale unit
 *
 * The tuning numbers are REFERENCE px — what they measure at the design
 * reference viewport (1440x900 in the reference build) — and are spent
 * multiplied by the site's own fluid scale unit (`--fluid`; see
 * `fluid.config.json`), so a threshold means the same fraction of the
 * composition at every window. A flat px value does not: it silently
 * tightens as the window shrinks, which is what made short viewports fail to
 * hold. The full argument, and what deliberately stays absolute, is on
 * `DEFAULTS` below.
 *
 * ## `behavior: 'instant'` is load-bearing
 *
 * A page that sets `scroll-behavior: smooth` on `html` will, left to the
 * default, queue a smooth animation on every write this loop makes, stacking
 * against the one before it. The explicit `instant` on each write is what
 * keeps the pull a direct position write regardless of that CSS.
 *
 * That protects the WELL's own writes from `smooth`, but it does nothing
 * for the reverse: an unrelated smooth scroll (a header anchor link, a
 * router hash jump) that happens to pass through the well's target. Each of
 * this loop's `instant` writes CANCELS whatever smooth animation the
 * browser had queued, one rAF at a time — so a "Menu" anchor click that
 * needs to travel through or past a pulled section never arrives; it gets
 * cancelled every frame and settles wherever the well was fighting it.
 * Measured: a `#menu` anchor click from the top landed 900px short, every
 * time, on a page whose well sat between the click and the target.
 *
 * `suspend()` is the fix: it pauses this loop's writes (not the loop
 * itself — `awayPx`/`released` tracking still needs live frames) for a
 * bounded window, so a programmatic or smooth scroll can run uncontested.
 * Two triggers call it automatically — a capture-phase `click` on any
 * `a[href^="#"]` or same-path hash link, and `hashchange` — and it is also
 * exposed on the returned controller for a caller that knows it is about to
 * drive `scrollIntoView`/`scrollTo` itself. Both automatic triggers read the
 * anchor TARGET's rect at click/hashchange time and scale the suspension to
 * that jump's distance (`SUSPEND_FALLBACK_MIN_MS`..`SUSPEND_FALLBACK_MAX_MS`),
 * since a flat 1200ms measured tight against a real ~5.2k-reference-px smooth
 * jump (1196ms in Chromium). It clears on the earliest of a `scrollend` event
 * (most browsers), `scrollY` going still for `SUSPEND_STABLE_MS` (works even
 * where `scrollend` is unsupported), or that distance-scaled fallback timeout
 * (Safari, which does not fire `scrollend` as of this writing).
 *

 * ## One rest state, or an interval of them
 *
 * A target that FITS the viewport has exactly one position worth resting at,
 * and it is the centre. A target that does NOT fit has a whole band of them:
 * every scroll position from "its top at the viewport top" to "its bottom at
 * the viewport bottom" shows the target and nothing else. There is no reason
 * to prefer one over another, and every reason not to — so inside that band
 * the pull produces zero error and does nothing at all, and outside it, it
 * reaches for the nearer edge.
 *
 * Both symptoms this was built to fix come out of that one line, measured on
 * the reference build. CENTRING an overflowing target rested a tall section's
 * top 54px above a 402x874 phone screen, slicing the first line of its
 * heading off. Replacing it with a flat TOP-ALIGN fixed arriving downward and
 * broke arriving upward: coming back up to the section's content, the well
 * hauled you to the top every time and you had to fight it back down to what
 * you came for.
 *
 * The band answers both without knowing which way anyone is moving. Arrive
 * scrolling down and the nearer edge is the top, so the heading lands whole.
 * Arrive scrolling up and the nearer edge is the bottom, so the last item
 * lands whole. Read through the middle and nothing touches you, which is the
 * part a direction latch could not buy: a latch still aims at a POINT, so it
 * pulls the entire way across the section and has to be fought off.
 *
 * This is ONE rule at every breakpoint, not a mobile special case, and it
 * must stay that way. Wherever a section is exactly viewport-height — every
 * desktop size in the reference build, since its fluid height utility
 * resolves to `100svh` while height binds — slack is zero, the band collapses
 * to a point and it IS the old centre, so there is nothing to branch on. A
 * blanket "top-align below the engage breakpoint" would also be wrong: a
 * section that is itself short (an `aspect-square` video, say) can be SHORTER
 * than the screen at narrow widths and belongs centred. One expression covers
 * all cases without asking what breakpoint it is.
 *
 * ## The clamp
 *
 * `clamp` bounds the attractor to an ancestor's own scroll range, which is
 * what makes this safe to point at a box inside a pinned scene. Without it, a
 * target SHORTER than the viewport wants a resting scroll position outside
 * the pin entirely — measured on the reference build, a copy layer sized
 * shorter than the screen once the fluid unit went width-bound asked, on a
 * 1440x1200 window, for a rest position 150px ABOVE the pin's start: a strip
 * of the previous section showing over the render, which is not a rest state
 * anybody designed. Clamped to the pin's own range marker (`[data-scrub-stage]`
 * in this system), the two ends land exactly on the pin's p=0 and p=1, which
 * ARE the designed rest compositions, at every viewport.
 *
 * ## The viewport height is a SNAPSHOT
 *
 * iOS collapses its toolbar WHILE you scroll, which changes `innerHeight`
 * without changing anything about the layout the target's rect is measured
 * in. Read live, the attractor moves under the pull — and worse, a pull
 * scrolling UP re-reveals the toolbar, which shrinks the viewport, which
 * moves the target up again. That is a feedback loop, and the only one this
 * design has. So the height is captured per visit and refreshed only on a
 * resize that is not the toolbar: any width change, or a height change too
 * large to be chrome.
 *
 * (`ScrubStage`'s pin is `lvh` and its sections `svh` precisely so the
 * GEOMETRY ignores the toolbar. This is the same fix applied to the
 * arithmetic.)
 *
 * ## One well at a time
 *
 * A page may hold several of these. Two attractors writing the same scroll in
 * the same frame is nonsense, so ownership is a module-level token: the first
 * to claim it holds it until it stops, and a refused claim is queued rather
 * than dropped. A well-designed page's geometry should already guarantee no
 * two wells are engaged at once — but a primitive that only works if you
 * audit its neighbours is not a primitive.
 *
 * ## Two earlier mechanisms, NOT worth re-litigating
 *
 * Native CSS scroll snap: its `proximity` radius is UA-defined (~a third of a
 * viewport on Chromium, nowhere near a 45% trigger at ~495px off-centre) and
 * its settle is a UA-paced dart. A Motion spring fired at the crossing
 * (momentum handoff, with a quiescence fallback): it needed velocity
 * tracking, absorb/veto budgets, deviation detection and a rest-detection
 * override to not feel like a scroll lock — and it still read as "the page
 * waits for you to stop, THEN grabs you", because a discrete animation fired
 * at a discrete moment is exactly that. Continuous attraction has no such
 * moment to notice.
 */

/**
 * Every LENGTH below is a REFERENCE px — the value at the design reference
 * viewport (1440x900 in the reference build) — and is spent multiplied by the
 * fluid scale unit. Written as the drawn number times a unit, which is the
 * fluid scale's own convention.
 *
 * ## Why a length here cannot be absolute
 *
 * The distances this loop reasons about are all fractions of a composition
 * that scales, and a fixed px threshold silently changes what it MEANS as the
 * window shrinks. Measured: a 45% trigger opens a band of ±0.55 viewport, so
 * `reclaimPx` at a flat 260 is 53% of that band at the 1440x900 reference and
 * 73% of it on a 1280x650 window — a well that forgives almost anything at
 * one size and holds tight at another. `releaseAwayPx` runs the other way and
 * is worse, because a trackpad's inertia tail delivers roughly the same PX
 * COUNT whatever the window: on a short view that fixed 60px trips the
 * release far earlier in the arrival, and the overshoot then lands outside
 * the reclaim radius, so the pull lets go and the section parks off-centre.
 * Reported from a short window, and this is the fix.
 *
 * On the fluid unit the ratios are the drawn ones everywhere: 53% of the band
 * at every viewport. Two useful properties come free — the unit is exactly 1
 * at the reference, so the values below ARE the reviewed ones; and it is a
 * flat 1px below the engage breakpoint, so the narrow-viewport behaviour that
 * shipped is untouched.
 *
 * ## What deliberately does NOT scale
 *
 * `epsilonPx` is a rest threshold, not a length in the composition — 1.5px is
 * "closer than anyone can see", which is an absolute fact about screens. Same
 * doctrine as the fluid scale's own rule for hairlines: a bracket's leg
 * LENGTH scales, its 1px THICKNESS does not. `reclaimQuietMs` and `tauS` are
 * durations; a gesture does not get quicker because the window is shorter.
 */
const DEFAULTS = {
  /**
   * Time constant of the pull: the page closes ~63% of its remaining distance
   * to centre per this much time. Shapes the FEEL — bigger is lazier.
   * Seconds.
   */
  tauS: 0.35,
  /**
   * Ceiling on the pull, reference px/s. Without it the exponential opens at
   * ~1400px/s from a 45% trigger, which is the "sped-up snap" this design
   * exists to avoid — far out, the pull should be a firm drift, not a yank.
   */
  maxSpeed: 800,
  /**
   * Floor on the pull, reference px/s. An exponential alone has an infinite
   * tail; this makes the last few px land in a third of a second instead of
   * asymptoting.
   */
  minSpeed: 120,
  /**
   * Close enough to centre to stop writing (the loop keeps watching).
   * ABSOLUTE px — see the note above on what does not scale.
   */
  epsilonPx: 1.5,
  /**
   * Visitor-driven scroll AWAY from centre that releases the pull for the
   * rest of the visit, in reference px. Roughly half a wheel notch: enough
   * that the pull's own overshoot dither can never trip it, little enough
   * that one deliberate flick out is answered immediately. Motion toward
   * centre pays it back down.
   */
  releaseAwayPx: 60,
  /**
   * The well forgives ONE overshoot per visit: if a release is followed by
   * this long without any visitor motion, and the target is still within
   * `reclaimPx` of centre, the pull resumes. That is the trackpad case — an
   * inertia tail is not intent, it is the arrival gesture running out.
   * Milliseconds, absolute.
   */
  reclaimQuietMs: 450,
  /**
   * How close to centre a release has to land to be read as an overshoot, in
   * reference px — about two thirds of the 45% band (~495px out at the
   * reference). Beyond it the departure is taken as deliberate and the
   * section is never dragged back.
   *
   * Was 260 (just over half the band). Measured, a HARD flick coasts further
   * than that: the pull is still helping you inward as the gesture peaks, so
   * the arrival and the tail compound and the rest lands ~62% of the band
   * out — 344px on a 1998x1013 window against a 293px radius, and 278 against
   * 260 on a phone. Both fell outside by a hair and the section parked
   * off-centre, which is the reported symptom. 320 covers the measured
   * coasts with a third of the band still left as "you meant that".
   *
   * The floor on this is the pull's own overshoot dither, which is bounded by
   * `epsilonPx`, so there is a lot of room above; the ceiling is taste. Note
   * it only ever fires ONCE per visit, and only after `reclaimQuietMs` of
   * total quiet, so widening it cannot produce a tug-of-war.
   */
  reclaimPx: 320
} as const

/**
 * Read the fluid scale unit — 1 at the design reference viewport, a flat 1
 * below the engage breakpoint.
 *
 * ## Why this measures instead of reading the property
 *
 * The obvious version is `getComputedStyle(root).getPropertyValue('--fluid')`,
 * and it does not work. `--fluid` is (by design) an UNREGISTERED custom
 * property, so its computed value is the token string — a live staleness
 * check would expect to read back the literal
 * `max(0.58px, min(calc(100svh / 900), …))`, which is exactly that.
 * `parseFloat` on it is NaN, and a NaN that falls back to 1 is worse than an
 * error: every threshold silently reverts to the reference and the bug this
 * exists to fix comes back invisibly. (It did, on the first pass.)
 *
 * A probe asks CSS to resolve the calc and reports the answer, which also
 * means the formula lives in exactly one place. `1000 *` because the result
 * is a sub-pixel ratio and a rect is worth reading at that precision.
 *
 * This kit does not depend on the `fluid-design` skill. `--fluid` is given
 * an explicit `1px` fallback so a project without that skill (no `--fluid`
 * declared anywhere) resolves the probe to exactly `1`, not `0` — relying on
 * the unregistered property's own guaranteed-invalid behaviour here would
 * work too (it also nets `v <= 0`, which the check below also turns into
 * `1`), but it is the kind of correctness that is easy to break by accident
 * later, so it's spelled out instead.
 */
let probe: HTMLElement | null = null
const readFluid = () => {
  if (!probe || !probe.isConnected) {
    probe = document.createElement('div')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText =
      'position:fixed;top:-9999px;left:0;width:0;height:calc(1000 * var(--fluid, 1px));pointer-events:none;'
    document.body.appendChild(probe)
  }
  const v = probe.getBoundingClientRect().height / 1000
  return Number.isFinite(v) && v > 0 ? v : 1
}

/**
 * A resize whose width is unchanged and whose height moved less than this
 * fraction is browser chrome, not a new viewport. iOS's toolbar is ~8-12% of
 * a phone screen; a rotation or a window drag is far more.
 */
const CHROME_HEIGHT_RATIO = 0.25

/** A backgrounded tab resumes with a huge dt; clamp so it cannot land a full
 * jump on the first frame back. */
const MAX_FRAME_MS = 64

/**
 * How still the page must be, while already at rest, before the visit counts
 * as ARRIVED and spends its one forgiveness. Absolute ms, not a fluid length.
 *
 * Comfortably longer than the gap between input events inside any real
 * gesture (a wheel burst is ~16ms, a slow creep ~90ms), so it cannot be
 * reached while a hand is still moving — and well under `reclaimQuietMs`, so
 * an arrival that genuinely settles is marked before the reclaim window would
 * ever open.
 */
const RESTED_QUIET_MS = 200

/**
 * How long `suspend()` pauses writes for when the browser never reports
 * `scrollend` (Safari, as of this writing), if nothing clears it sooner.
 *
 * A flat 1200ms was measured tight: a smooth `#menu` jump of ~5.2k reference
 * px on a real page took 1196ms in Chromium, and Safari's own smooth-scroll
 * pacing is not guaranteed to be faster. A jump this long resuming the well
 * mid-flight is the exact bug `suspend()` exists to prevent — so the two
 * automatic triggers (the capture-phase anchor click and `hashchange`) scale
 * the fallback with how far the target actually is: `max(SUSPEND_FALLBACK_MIN_MS,
 * distancePx * SUSPEND_FALLBACK_DISTANCE_FACTOR)`, capped at
 * `SUSPEND_FALLBACK_MAX_MS` so a broken/very distant target can't suspend the
 * well indefinitely. See `references/scenes.md` §8.
 *
 * `SUSPEND_STABLE_MS` is the second, browser-agnostic half of the fix: while
 * suspended, a small watcher ends the suspension as soon as `scrollY` has
 * gone unchanged for that long, so a fast jump doesn't sit out the rest of a
 * conservative fallback window even on Safari.
 */
const SUSPEND_FALLBACK_MIN_MS = 1200
const SUSPEND_FALLBACK_MAX_MS = 4000
/** Reference px→ms slope for the distance-scaled fallback above. */
const SUSPEND_FALLBACK_DISTANCE_FACTOR = 0.35
/** How long scrollY must sit still, while suspended, to end the suspension
 * early — see `SUSPEND_FALLBACK_MIN_MS`'s docblock. */
const SUSPEND_STABLE_MS = 150

/** `max(SUSPEND_FALLBACK_MIN_MS, distancePx * SUSPEND_FALLBACK_DISTANCE_FACTOR)`,
 * capped at `SUSPEND_FALLBACK_MAX_MS`. */
const suspendMsForDistance = (distancePx: number) =>
  Math.min(
    SUSPEND_FALLBACK_MAX_MS,
    Math.max(SUSPEND_FALLBACK_MIN_MS, Math.abs(distancePx) * SUSPEND_FALLBACK_DISTANCE_FACTOR)
  )

export interface ScrollPullOptions {
  /** The box to centre in the viewport. */
  target: HTMLElement
  /**
   * Bound the attractor to this ancestor's own scroll range — see §The
   * clamp. Pass the element, or `null` for an unbounded pull.
   */
  clamp?: HTMLElement | null
  /** Seconds. */
  tauS?: number
  /** Reference px/s at the design reference viewport; spent times the fluid
   * unit. See §DEFAULTS. */
  maxSpeed?: number
  /** Reference px/s at the design reference viewport; spent times the fluid
   * unit. */
  minSpeed?: number
  /** ABSOLUTE px — a rest threshold, not a length in the composition. */
  epsilonPx?: number
  /** Reference px at the design reference viewport; spent times the fluid
   * unit. */
  releaseAwayPx?: number
  /** Milliseconds. */
  reclaimQuietMs?: number
  /** Reference px at the design reference viewport; spent times the fluid
   * unit. */
  reclaimPx?: number
}

export interface ScrollPull {
  /** Begin (or resume) attracting. Idempotent. */
  start(): void
  /** Stop attracting and reset the visit — the next `start` is a fresh visit. */
  stop(): void
  /**
   * Pause writes (not the loop) for `ms` (default `SUSPEND_FALLBACK_MIN_MS`),
   * or until `scrollend` fires or `scrollY` has been stable for
   * `SUSPEND_STABLE_MS`, whichever is sooner. Call this before driving a
   * programmatic or smooth scroll of your own through this pull's target —
   * see §`behavior: 'instant'` is load-bearing. The two automatic triggers
   * (anchor click, `hashchange`) instead pass a distance-scaled `ms` — see
   * `suspendMsForDistance`. Safe to call repeatedly; each call only extends
   * the suspension, never shortens it.
   */
  suspend(ms?: number): void
  /** Stop, drop listeners, release ownership. */
  destroy(): void
}

/** The single writer. See §One well at a time. */
let owner: symbol | null = null
const waiting = new Set<() => void>()

export function createScrollPull(options: ScrollPullOptions): ScrollPull {
  const { target, clamp = null } = options
  const tauS = options.tauS ?? DEFAULTS.tauS
  const maxSpeed = options.maxSpeed ?? DEFAULTS.maxSpeed
  const minSpeed = options.minSpeed ?? DEFAULTS.minSpeed
  const epsilonPx = options.epsilonPx ?? DEFAULTS.epsilonPx
  const releaseAwayPx = options.releaseAwayPx ?? DEFAULTS.releaseAwayPx
  const reclaimQuietMs = options.reclaimQuietMs ?? DEFAULTS.reclaimQuietMs
  const reclaimPx = options.reclaimPx ?? DEFAULTS.reclaimPx

  const id = Symbol('scroll-pull')
  const abort = new AbortController()
  const { signal } = abort
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

  /** The IO (or whoever owns this) wants the pull running. */
  let wanted = false
  /** A finger owns the scroll outright; the loop watches but does not write. */
  let touching = false
  /** The visitor pulled away on purpose — no more pull until the next visit. */
  let released = false
  /** rAF handle; 0 when the loop is not running. */
  let frame = 0
  let lastFrame = 0
  /** Where the loop left the page last frame; -1 = it has not written yet. */
  let ownY = -1
  /** Visitor motion away from centre, px, paid back down by motion toward it. */
  let awayPx = 0
  /** When the visitor last moved the page — the reclaim's quiescence clock. */
  let lastMove = 0
  /** One forgiven overshoot per visit; spent here. */
  let reclaims = 0
  /** `performance.now()` timestamp writes stay paused until. 0 = not suspended. */
  let suspendedUntil = 0
  /** Listener for the `scrollend` that would end a suspension early. */
  let scrollendAbort: AbortController | null = null
  /** rAF handle for the scrollY-stability watcher; 0 when not running. */
  let stabilityFrame = 0

  // §The viewport height is a SNAPSHOT, and §the lengths are on the fluid unit.
  let vw = window.innerWidth
  let vh = window.innerHeight
  /** Every reference length above, resolved against the current fluid unit. */
  let scaled = { maxSpeed, minSpeed, releaseAway: releaseAwayPx, reclaim: reclaimPx }

  const remeasureViewport = () => {
    const w = window.innerWidth
    const h = window.innerHeight
    const chromeOnly = w === vw && Math.abs(h - vh) < vh * CHROME_HEIGHT_RATIO
    vw = w
    if (!chromeOnly) vh = h

    // `--fluid` is defined in `svh`, so it is already blind to the iOS toolbar
    // and needs none of the filtering above.
    const fluid = readFluid()
    scaled = {
      maxSpeed: maxSpeed * fluid,
      minSpeed: minSpeed * fluid,
      releaseAway: releaseAwayPx * fluid,
      reclaim: reclaimPx * fluid
    }
  }
  remeasureViewport()

  /** Signed px the page must scroll for the target to sit at rest. */
  const offset = () => {
    const r = target.getBoundingClientRect()
    const y = window.scrollY
    const top = y + r.top
    // §One rest state, or an interval of them. `slack` is how much taller than
    // the viewport the target is: negative means it fits, so there is one rest
    // state and `top + slack / 2` IS the centre. Positive means it does not, so
    // every position in `[top, top + slack]` covers the viewport with the target
    // and is equally a rest — clamping the CURRENT scroll into that band yields
    // zero error inside it and the nearer edge outside. Continuous at slack = 0.
    const slack = r.height - vh
    let want = slack > 0 ? Math.min(Math.max(y, top), top + slack) : top + slack / 2
    if (clamp) {
      const c = clamp.getBoundingClientRect()
      const top = y + c.top
      const travel = Math.max(0, clamp.offsetHeight - vh)
      want = Math.min(Math.max(want, top), top + travel)
    }
    return want - y
  }

  function step(now: number) {
    frame = 0
    const dt = Math.min(now - lastFrame, MAX_FRAME_MS) / 1000
    lastFrame = now

    // Suspended: a programmatic/smooth scroll may be in flight through this
    // target. Skip the write AND the away/reclaim bookkeeping below — the
    // suspension's own scroll is not visitor motion to react to — but keep
    // the loop alive so it resumes exactly where it left off once the
    // suspension clears. See `suspend()` and the docblock's §`behavior:
    // 'instant'` is load-bearing.
    if (now < suspendedUntil) {
      ownY = window.scrollY
      frame = requestAnimationFrame(step)
      return
    }

    const y = window.scrollY
    const err = offset()

    // Anything that moved the page since our own last write is the visitor's
    // doing — no matter which device produced it.
    if (ownY >= 0) {
      const moved = y - ownY
      if (moved !== 0) {
        lastMove = now
        if (Math.sign(moved) === Math.sign(err)) awayPx = Math.max(0, awayPx - Math.abs(moved))
        else awayPx += Math.abs(moved)
        if (awayPx > scaled.releaseAway) {
          released = true
          awayPx = 0
        }
      }
    }

    // Released, but the page went quiet close to centre and the visit still has
    // its forgiveness: that was an inertia tail, not a decision.
    // SETTLING SPENDS THE FORGIVENESS. The reclaim exists for an arrival that
    // never landed — a flick whose inertia tail carried it past before the pull
    // could close. Once the target HAS come to rest, there is nothing left to
    // forgive, and every later departure is a decision: the visitor is at the
    // composition and choosing to leave it. Without this the well tidies up
    // after them once, which on a tall target reads as being dragged back to
    // the edge they just read away from (measured: 131px, leaving the bottom of
    // a tall section on a phone). It fixes the same tug on a target that fits —
    // settle, push 200px off, stop, and the old rule hauled you back.
    //
    // `RESTED_QUIET_MS` is what makes "settled" mean settled. Zero error alone
    // is not arrival: a hard flick TRANSITS rest while the hand is still
    // moving, and spending the forgiveness there costs the tail the correction
    // it exists for — measured, a burst overran by 315px on a 2560x800 window
    // for exactly that reason. Requiring the page to be still for a moment
    // first cannot be hit mid-gesture, where input arrives every frame or two.
    if (!released && Math.abs(err) <= epsilonPx && now - lastMove > RESTED_QUIET_MS) reclaims = 1

    if (
      released &&
      reclaims === 0 &&
      now - lastMove > reclaimQuietMs &&
      Math.abs(err) > epsilonPx &&
      Math.abs(err) < scaled.reclaim
    ) {
      released = false
      reclaims = 1
    }

    // Under a live finger: keep watching (the away meter must see the drag, or a
    // deliberate swipe out gets yanked back on lift-off), write nothing.
    // Released: the loop watches only, so the reclaim above can still fire.
    if (!released && !touching && Math.abs(err) > epsilonPx) {
      const ease = err * (1 - Math.exp(-dt / tauS))
      const ceiling = scaled.maxSpeed * dt
      const floor = Math.min(Math.abs(err), scaled.minSpeed * dt)
      const magnitude = Math.min(Math.max(Math.abs(ease), floor), ceiling)
      // `instant` is load-bearing against `scroll-behavior: smooth` — see the
      // docblock.
      window.scrollTo({ top: y + Math.sign(err) * magnitude, behavior: 'instant' })
    }

    ownY = window.scrollY
    frame = requestAnimationFrame(step)
  }

  /** Take the token if it is free, otherwise queue for it. */
  const claim = () => {
    if (!wanted || frame || reduced.matches) return
    if (owner && owner !== id) {
      waiting.add(claim)
      return
    }
    owner = id
    // A fresh visit is the one moment the viewport is certainly worth re-reading
    // — the resize path is filtered (§the snapshot) and can therefore sit out a
    // genuine change it mistook for chrome.
    remeasureViewport()
    lastFrame = performance.now()
    lastMove = lastFrame
    ownY = -1
    awayPx = 0
    released = false
    reclaims = 0
    frame = requestAnimationFrame(step)
  }

  const start = () => {
    wanted = true
    claim()
  }

  const stop = () => {
    wanted = false
    waiting.delete(claim)
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    ownY = -1
    awayPx = 0
    if (owner !== id) return
    owner = null
    // Hand off in one pass: a claimant that is still blocked re-queues itself.
    const pending = [...waiting]
    waiting.clear()
    for (const resume of pending) resume()
  }

  /**
   * Pause writes for `ms` (or until `scrollend`/scrollY-stability, whichever
   * is sooner). See the `ScrollPull.suspend` docblock.
   */
  const suspend = (ms = SUSPEND_FALLBACK_MIN_MS) => {
    suspendedUntil = Math.max(suspendedUntil, performance.now() + ms)
    if ('onscrollend' in window) {
      // Only one pending scrollend listener at a time — a second suspend()
      // before the first clears just extends `suspendedUntil` above; the
      // listener only needs to fire once to clear it early.
      scrollendAbort?.abort()
      scrollendAbort = new AbortController()
      window.addEventListener(
        'scrollend',
        () => {
          suspendedUntil = 0
        },
        { once: true, signal: scrollendAbort.signal }
      )
    }
    watchStability()
  }

  /**
   * While suspended, ends the suspension as soon as `scrollY` has gone
   * unchanged for `SUSPEND_STABLE_MS` — the browser-agnostic half of the
   * fix, since it does not depend on `scrollend` support. Idempotent: a
   * second `suspend()` call while one watcher is already running does not
   * start a second one.
   */
  const watchStability = () => {
    if (stabilityFrame) return
    let lastY = window.scrollY
    let lastChangeAt = performance.now()
    const tick = () => {
      const now = performance.now()
      if (now >= suspendedUntil) {
        // Already cleared, by scrollend or by the timeout above.
        stabilityFrame = 0
        return
      }
      const y = window.scrollY
      if (y !== lastY) {
        lastY = y
        lastChangeAt = now
      } else if (now - lastChangeAt >= SUSPEND_STABLE_MS) {
        suspendedUntil = 0
        stabilityFrame = 0
        return
      }
      stabilityFrame = requestAnimationFrame(tick)
    }
    stabilityFrame = requestAnimationFrame(tick)
  }

  // Anchor navigation is the common source of a smooth scroll this loop did
  // not initiate — a header nav link, a footer "back to top", a router hash
  // jump. Capture phase so this fires before any click handler on the
  // anchor itself might call preventDefault(). `hashchange` also catches a
  // browser back/forward that lands on a hash with no click in between.
  //
  // Both listeners compute the jump distance from the anchor target's OWN
  // rect (at the moment of the click/hashchange, before any scroll has
  // started) and scale the fallback suspension to it — see
  // `suspendMsForDistance`'s docblock on `SUSPEND_FALLBACK_MIN_MS`.
  const suspendForHash = (hash: string) => {
    const id = hash.slice(1)
    const anchorTarget = id ? document.getElementById(id) : null
    const distancePx = anchorTarget ? anchorTarget.getBoundingClientRect().top : 0
    suspend(suspendMsForDistance(distancePx))
  }
  window.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || !a.hash) return
      const isHashOnly = (a.getAttribute('href') ?? '').startsWith('#')
      const isSamePathHash =
        a.pathname === window.location.pathname && a.search === window.location.search
      if (isHashOnly || isSamePathHash) suspendForHash(a.hash)
    },
    { capture: true, passive: true, signal }
  )
  window.addEventListener('hashchange', () => suspendForHash(window.location.hash), { passive: true, signal })

  // Touch is the only input the loop has to be told about: everything else it
  // reads straight off the scroll position.
  window.addEventListener(
    'touchstart',
    () => {
      touching = true
    },
    { passive: true, signal }
  )
  window.addEventListener(
    'touchend',
    () => {
      touching = false
    },
    { passive: true, signal }
  )
  window.addEventListener('resize', remeasureViewport, { passive: true, signal })

  return {
    start,
    stop,
    suspend,
    destroy: () => {
      stop()
      scrollendAbort?.abort()
      if (stabilityFrame) cancelAnimationFrame(stabilityFrame)
      stabilityFrame = 0
      abort.abort()
    }
  }
}
