'use client'
/**
 * motion/Reveal.tsx: triggered entrances for Motion (React) routes: `Reveal` (a group), `RevealItem`, `RevealVeil`.
 *
 *   <Reveal as="section">                              the element the layout already needs; trigger="view" (default)
 *     <RevealItem as="h2">Title</RevealItem>             effect: rise (default) | fade | clip | scale-in
 *     <div className="columns">                         server markup in between keeps the section a server component
 *       <RevealItem effect="fade">…</RevealItem>
 *     </div>
 *   </Reveal>
 *   <RevealVeil className="bg-paper" />                optional, high in <body>, over a `mount` group
 *
 * Needs MotionProvider, css/reveal.css (after css/animation.css) and GATE_SCRIPT in <head>. It renders the markup of
 * the engine-free path (reveal.ts), so the resting state, the failsafe and verify-motion work the same on every
 * engine.
 *
 * - Triggered, not scrubbed: a reveal plays once, on its own clock. `replay` plays it again on every return, after
 *   a reset that waits until the group is entirely out of view, so the reset is never seen.
 * - `Reveal` is the only trigger. Its state reaches every `RevealItem` below it through Motion's variant context,
 *   across any plain markup in between, and items stagger by `stagger` (MOTION.lineStagger) in document order.
 *   Never give an item its own trigger, and never leave one outside a Reveal: nothing would ever reveal it. A group
 *   fires on its own top edge, so use one Reveal per arrival: a column that stacks tall on a phone is several.
 * - `trigger`: 'view' when the group's top crosses the line (`margin`, TRIGGERS.reveal: 80% of the viewport;
 *   TRIGGERS.pageEnd for the page's last group or one that comes to rest below the line), 'mount' right after
 *   hydration, for a group on screen at load. `margin` is a static string: a new value rebuilds the observer.
 * - The resting state is css/reveal.css under the pre-JS gate, not an inline SSR style: the server renders items
 *   with no style at all, so a reader with JavaScript off sees everything with no <noscript> rule, and Motion starts
 *   each move from the item's computed resting value (--reveal-distance, --reveal-scale).
 * - Hydration gates the start: until then a `mount` group's items rest hidden. A RevealVeil over them hides that wait,
 *   but it holds the whole first paint, the LCP element included: leave it out when the first screen has a SplitWords
 *   headline or a hero image, which paint at once (references/entrances.md §7).
 * - The failsafe (css/animation.css): if it revealed the page before hydration, items settle where they are
 *   (data-reveal-state="shown", no movement): nothing hides and replays.
 * - Reduced motion, live (useReducedMotionLive): items settle, visible and still, and stay settled when it is
 *   turned off again.
 * - Never on the LCP element, which must not wait for hydration: an above-the-fold hero animates from CSS at first
 *   paint (SplitWords).
 * - Next's Activity: Motion replays a group's current state when its boundary shows again. A landed group rests in
 *   `settled`, a no-op from where its items are, and a reveal cut off mid-way resumes from where it stopped, so a
 *   finished reveal never plays twice.
 * - An item is marked data-reveal-state="shown" when its reveal lands. It writes `transform`: centre or offset the
 *   item with `translate` (Motion leaves it alone), or on a wrapper.
 */
import { m, stagger as staggerChildren, type Transition, type Variants } from 'motion/react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react'

import { CURVES, MOTION, TRIGGERS, failsafeFired } from '../config'
import { useReducedMotionLive } from './useReducedMotionLive'

export type RevealEffect = 'rise' | 'fade' | 'clip' | 'scale-in'

/**
 * The group's state, which Motion hands down to the items by label. `hidden` is empty: the resting state is CSS.
 * `visible` plays the entrance and lands in `settled`, which is also where reduced motion and the failsafe put it.
 * Once an item has taken values, the label never returns to `hidden` (Motion would animate the values it drops back
 * to what it first read), so a replay resets through `reset`.
 */
type Phase = 'hidden' | 'visible' | 'settled' | 'reset'

const MOVE: Transition = { duration: MOTION.entrance.duration, ease: CURVES[MOTION.entrance.curve] }
const FADE_SPAN = MOTION.entranceFade.delay + MOTION.entranceFade.duration
/**
 * The fade as one linear track that holds for entranceFade.delay, not a `delay`: a value's own delay replaces the
 * stagger delay it inherits from the group, and every line would fade at once. `null` keyframes start from the
 * current value, so the track is a no-op on an item already at rest.
 */
const FADE: Transition = { duration: FADE_SPAN, ease: 'linear', times: [0, MOTION.entranceFade.delay / FADE_SPAN, 1] }
const FADE_IN = [null, null, 1]
const INSTANT: Transition = { duration: 0 }

/**
 * `settled` jumps a reveal in flight to its end, so its targets are one-keyframe arrays: Motion leaves a value
 * running when the new label resolves it to the same target as the old, and `y: 0` is `visible`'s target too.
 * `reset` restores css/reveal.css's resting values (the same custom properties and fallbacks), for a replay.
 */
const EFFECTS: Record<RevealEffect, Variants> = {
  rise: {
    visible: { y: 0, opacity: FADE_IN, transition: { y: MOVE, opacity: FADE } },
    settled: { y: [0], opacity: [1], transition: INSTANT },
    reset: { y: 'var(--reveal-distance, 32px)', opacity: 0, transition: INSTANT },
  },
  fade: {
    visible: { opacity: 1, transition: MOVE },
    settled: { opacity: [1], transition: INSTANT },
    reset: { opacity: 0, transition: INSTANT },
  },
  clip: {
    // inset(0) while it moves (none can't interpolate), then none, so the item no longer clips its overflow.
    visible: { clipPath: 'inset(0% 0% 0% 0%)', transition: MOVE, transitionEnd: { clipPath: 'none' } },
    settled: { clipPath: ['none'], transition: INSTANT },
    reset: { clipPath: 'inset(100% 0% 0% 0%)', transition: INSTANT },
  },
  'scale-in': {
    visible: { scale: 1, opacity: FADE_IN, transition: { scale: MOVE, opacity: FADE } },
    settled: { scale: [1], opacity: [1], transition: INSTANT },
    reset: { scale: 'var(--reveal-scale, 0.95)', opacity: 0, transition: INSTANT },
  },
}

// `aside`, `ul` and `figure` are here because a group whose contents stagger IS that element: wrapping it in a
// bare div to say so costs a landmark or a list's semantics.
const GROUP_TAGS = {
  div: m.div,
  section: m.section,
  article: m.article,
  header: m.header,
  footer: m.footer,
  main: m.main,
  aside: m.aside,
  nav: m.nav,
  ul: m.ul,
  ol: m.ol,
  figure: m.figure,
}
// Headings are here because a heading that rises IS the item: without them every animated heading needs a span
// inside it or a div around it.
const ITEM_TAGS = {
  div: m.div,
  span: m.span,
  p: m.p,
  li: m.li,
  h1: m.h1,
  h2: m.h2,
  h3: m.h3,
  h4: m.h4,
  figure: m.figure,
  figcaption: m.figcaption,
  blockquote: m.blockquote,
}

/** A ref for whichever element `as` picks: a callback, which every `m.*` element accepts. */
function useElementRef() {
  const ref = useRef<HTMLElement | null>(null)
  const attach = useCallback((el: HTMLElement | null) => {
    ref.current = el
  }, [])
  return [ref, attach] as const
}

const subscribeNothing = () => () => {}
/** False on the server and during hydration, true after: renders before it keep the server's markup and state. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  )
}

function subscribeFailsafe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-animation-failsafe'] })
  return () => observer.disconnect()
}
/** html[data-animation-failsafe]: the CSS failsafe revealed the page before the engine was ready. */
function useFailsafeFired(): boolean {
  return useSyncExternalStore(subscribeFailsafe, failsafeFired, () => false)
}

export interface RevealProps {
  children?: ReactNode
  /** The element the layout already needs: a group should not add a wrapper. */
  as?: keyof typeof GROUP_TAGS
  /** 'view' (default): when the group's top crosses the line. 'mount': right after hydration. */
  trigger?: 'mount' | 'view'
  /** 'view' only: the trigger line as an IntersectionObserver rootMargin. Default TRIGGERS.reveal. */
  margin?: string
  /** Seconds between items, in document order. Default MOTION.lineStagger. */
  stagger?: number
  /** 'view' only: reveal again on every return. Off by default: a reveal plays once. */
  replay?: boolean
  className?: string
  style?: CSSProperties
  /** Passed through: the element the layout needs may be an anchor target or a labelled group. */
  id?: string
  role?: string
  'aria-label'?: string
}

export function Reveal({
  children,
  as = 'div',
  trigger = 'view',
  margin = TRIGGERS.reveal,
  stagger = MOTION.lineStagger,
  replay = false,
  className,
  style,
  id,
  role,
  'aria-label': ariaLabel,
}: RevealProps) {
  const Group = GROUP_TAGS[as]
  const [ref, attach] = useElementRef()
  const hydrated = useHydrated()
  const reduced = useReducedMotionLive()
  const failsafe = useFailsafeFired()
  const [phase, setPhase] = useState<Phase>(trigger === 'mount' ? 'visible' : 'hidden')

  // Settling is sticky: turning reduced motion off later must not send a settled item back through `visible`.
  const settle = hydrated && (reduced || failsafe)
  if (settle && phase !== 'settled') setPhase('settled')

  const watching = hydrated && trigger === 'view' && !settle && (replay || phase === 'hidden')
  useEffect(() => {
    const el = ref.current
    if (!watching || !el) return
    const line = new IntersectionObserver(
      (entries) => {
        if (entries[entries.length - 1]?.isIntersecting) {
          setPhase((p) => (p === 'hidden' || p === 'reset' ? 'visible' : p))
        }
      },
      { rootMargin: margin },
    )
    line.observe(el)
    const gone = replay
      ? new IntersectionObserver((entries) => {
          if (entries[entries.length - 1]?.isIntersecting === false) {
            setPhase((p) => (p === 'visible' || p === 'settled' ? 'reset' : p))
          }
        })
      : null
    gone?.observe(el)
    return () => {
      line.disconnect()
      gone?.disconnect()
    }
  }, [ref, watching, margin, replay])

  const variants = useMemo<Variants>(() => ({ visible: { transition: { delayChildren: staggerChildren(stagger) } } }), [stagger])

  return (
    <Group
      ref={attach}
      data-reveal={trigger}
      data-reveal-replay={replay && trigger === 'view' ? '' : undefined}
      className={className}
      style={style}
      id={id}
      role={role}
      aria-label={ariaLabel}
      variants={variants}
      initial="hidden"
      animate={hydrated ? phase : 'hidden'}
      // A landed reveal rests in `settled`: the state Motion replays when an Activity boundary shows again, and a
      // no-op from where the items already are.
      onAnimationComplete={(label) => {
        if (label === 'visible') setPhase((p) => (p === 'visible' ? 'settled' : p))
      }}
    >
      {children}
    </Group>
  )
}

export interface RevealItemProps {
  children?: ReactNode
  /** rise (default): up by --reveal-distance and in. fade: in. clip: wiped up from the bottom edge. scale-in: up
   * from --reveal-scale and in. */
  effect?: RevealEffect
  as?: keyof typeof ITEM_TAGS
  className?: string
  /** For layout values that can't be a class. Not `transform` or `opacity`: the reveal writes them. */
  style?: CSSProperties
  /** Passed through: a heading that moves is still an aria-labelledby or anchor target. */
  id?: string
}

export function RevealItem({ children, effect = 'rise', as = 'div', className, style, id }: RevealItemProps) {
  const Item = ITEM_TAGS[as]
  const [ref, attach] = useElementRef()
  // The state other engines' CSS and verify-motion read: shown once a reveal lands, cleared by a replay's reset.
  const onAnimationComplete = (label: unknown) => {
    const el = ref.current
    if (!el) return
    if (label === 'reset') el.removeAttribute('data-reveal-state')
    else if (label === 'visible' || label === 'settled') el.setAttribute('data-reveal-state', 'shown')
  }
  return (
    <Item
      ref={attach}
      data-reveal-item=""
      data-reveal-effect={effect}
      className={className}
      style={style}
      id={id}
      variants={EFFECTS[effect]}
      onAnimationComplete={onAnimationComplete}
    >
      {children}
    </Item>
  )
}

export interface RevealVeilProps {
  /** Its paint: the surface the page starts on. css/reveal.css gives it no background of its own. */
  className?: string
}

/**
 * The load cover over a `mount` group's first beat. Pure CSS (css/reveal.css): opaque from first paint under the
 * gate, dissolving on MOTION.veil once MotionProvider marks the engine ready at hydration, so the entrance under it
 * is already moving when it clears. It never covers without JavaScript or after a client-side navigation, and the
 * failsafe removes it at 4 s if the engine never boots. Mount it high in <body>, outside any stacking context, so it
 * out-ranks a fixed header.
 */
export function RevealVeil({ className }: RevealVeilProps) {
  return <div data-reveal-veil="" aria-hidden="true" className={className} />
}
