import gsap from 'gsap'

import { ENGAGE_QUERY } from './config'
import { MOTION, prefersReducedMotion, registerEases, TRIGGERS } from './eases'

/**
 * `[data-stage]` / `[data-stage-item]` / `[data-stage-veil]` — the PAGE-LOAD
 * entrance system. Port of `Stage`/`StageItem` (see `veil.ts` for the veil).
 *
 * TRIGGERED, not scrubbed: a stage fires once and then plays on its own
 * clock, so scrolling faster or slower changes nothing and scrolling back up
 * replays nothing (unless `data-stage-repeat` is set).
 *
 * ## The DOM contract (`references/attribute-contract.md` §3)
 *
 * ```html
 * <div data-stage="view" data-stage-margin="0px 0px -20% 0px">
 *   <p data-stage-item data-variant="liftFade" data-delay="0" class="[--hero-lift:20px]">…</p>
 *   <h2 data-stage-item data-variant="liftFade" data-delay="0.067">…</h2>
 * </div>
 * ```
 *
 * - `data-stage="view"` (default) fires when the group crosses its trigger
 *   line; `"mount"` fires immediately, for content already on screen at
 *   load (pair with `[data-stage-veil]`, see `veil.ts`).
 * - `data-stage-margin` / `data-stage-margin-lg` are IntersectionObserver
 *   `rootMargin` strings — `margin` is the mobile-first base, `margin-lg`
 *   overrides it from `ENGAGE_QUERY` up, resolved ONCE at mount (a reveal is
 *   a one-shot; the breakpoint at the moment it could fire is what matters).
 * - `data-stage-repeat` (presence, any value) replays the group each time it
 *   re-enters instead of firing once.
 * - `data-stage-item` marks an element that starts in its CSS-authored
 *   hidden state (`motion.css`, keyed off `data-variant`) and animates to
 *   rest when its stage fires.
 * - `data-variant` — see `MOVEMENT` / `HAS_FADE` below; mirrors
 *   `entranceVariants` in the reference build's `lib/motion/variants.ts`.
 * - `data-delay` — seconds after the stage starts; the reference staggers
 *   title lines by `MOTION.lineStagger` (0.067s).
 *
 * `amount` is deliberately NOT a fraction here — always `threshold: 0`, i.e.
 * ANY part of the group visible. A fractional threshold is unsatisfiable for
 * an element taller than the viewport (the same element that stacks into a
 * tall column on mobile), so the reveal would simply never fire there.
 */

type Variant = 'drop' | 'settle' | 'settleFade' | 'lift' | 'liftFade' | 'growY' | 'growX'

/** The property each variant moves. Distances live in the CSS the hidden
 * state was authored with (`--hero-drop` etc, `motion.css`) — GSAP reads the
 * element's current computed transform on first tween, so it animates FROM
 * whatever that CSS put there without needing the value repeated in JS. */
const MOVEMENT: Record<Variant, gsap.TweenVars> = {
  drop: { y: 0 },
  settle: { y: 0 },
  settleFade: { y: 0 },
  lift: { y: 0 },
  liftFade: { y: 0 },
  growY: { scaleY: 1 },
  growX: { scaleX: 1 }
}

const HAS_FADE: Record<Variant, boolean> = {
  drop: false,
  settle: false,
  settleFade: true,
  lift: false,
  liftFade: true,
  growY: false,
  growX: false
}

function isVariant(value: string | undefined): value is Variant {
  return !!value && value in MOVEMENT
}

/**
 * Every `[data-stage-item]` under `root`, stopping at a nested `[data-stage]`
 * boundary — a nested stage owns its own descendants' entrance, the same way
 * a nested `<Stage>` would take over variant propagation in the React port.
 */
function collectItems(root: Element): HTMLElement[] {
  const items: HTMLElement[] = []
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (child.hasAttribute('data-stage-item')) items.push(child as HTMLElement)
      if (child.hasAttribute('data-stage') && child !== root) continue
      walk(child)
    }
  }
  walk(root)
  return items
}

function playItem(el: HTMLElement, reduced: boolean): void {
  const variant = isVariant(el.dataset.variant) ? el.dataset.variant : 'lift'
  const delay = Number.parseFloat(el.dataset.delay ?? '') || 0
  const move = MOVEMENT[variant]

  if (reduced) {
    // Movement removed, opacity kept — the same rule `motion.css`'s
    // reduced-motion block applies to the pre-hydration hidden state.
    gsap.set(el, move)
  } else {
    gsap.to(el, { ...move, duration: MOTION.entrance.duration, ease: MOTION.entrance.ease, delay, overwrite: 'auto' })
  }

  if (HAS_FADE[variant]) {
    gsap.to(el, {
      opacity: 1,
      duration: MOTION.entranceFade.duration,
      ease: MOTION.entranceFade.ease,
      delay: reduced ? delay : MOTION.entranceFade.delay + delay,
      overwrite: 'auto'
    })
  }
}

/** Reset a group back to its hidden state so `data-stage-repeat` can replay
 * it — instant (`gsap.set`), never animated; leaving is not a moment. */
function resetItem(el: HTMLElement): void {
  const variant = isVariant(el.dataset.variant) ? el.dataset.variant : 'lift'
  gsap.set(el, { clearProps: 'transform,opacity' })
  // Clearing props drops back to the CSS-authored hidden state for this
  // variant (motion.css), which is exactly the state a replay should start
  // from — nothing further to set here.
  void variant
}

export interface StageController {
  destroy(): void
}

/**
 * Wires every `[data-stage]` under `root`. Call once per page (or per
 * fragment after an HTML swap); `initFluidMotion` does this for you.
 */
export function initStages(root: ParentNode = document): StageController {
  registerEases()
  const reduced = prefersReducedMotion()
  const stageEls = Array.from(root.querySelectorAll<HTMLElement>('[data-stage]'))
  const observers: IntersectionObserver[] = []

  for (const stageEl of stageEls) {
    const trigger = stageEl.dataset.stage === 'mount' ? 'mount' : 'view'
    const items = collectItems(stageEl)
    if (items.length === 0) continue

    const fire = () => items.forEach((el) => playItem(el, reduced))

    if (trigger === 'mount') {
      fire()
      continue
    }

    const repeat = stageEl.hasAttribute('data-stage-repeat')
    const marginLg = stageEl.dataset.stageMarginLg
    const marginBase = stageEl.dataset.stageMargin || TRIGGERS.reveal
    // Resolved once, on mount — mirrors the React port's `useState(() => …)`.
    // A reveal is a one-shot; the breakpoint at the moment it could fire is
    // the one that matters, so this deliberately does not track resize.
    const margin = marginLg && window.matchMedia(ENGAGE_QUERY).matches ? marginLg : marginBase

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        if (entry.isIntersecting) {
          fire()
          if (!repeat) io.disconnect()
        } else if (repeat) {
          items.forEach(resetItem)
        }
      },
      { threshold: 0, rootMargin: margin }
    )
    io.observe(stageEl)
    observers.push(io)
  }

  return {
    destroy() {
      observers.forEach((io) => io.disconnect())
    }
  }
}
