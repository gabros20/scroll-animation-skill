'use client'
/**
 * motion/ScrollySteps.tsx: scrolly-steps.ts for React routes. Components that render the block's markup, and the hook
 * underneath them for markup of your own (the same data-scrolly-* contract, css/scrolly.css).
 *
 *   <ScrollySteps line={0.4} onStep={({ index, previous }) => …}>
 *     <ScrollyGraphic>
 *       <ScrollyState value="0"><Chart year={1990} /></ScrollyState>
 *       <ScrollyState value="1"><Chart year={2020} /></ScrollyState>
 *     </ScrollyGraphic>
 *     <ScrollyStepList>
 *       <ScrollyStep>…text…<ScrollyInline><Chart year={1990} /></ScrollyInline></ScrollyStep>
 *       <ScrollyStep show="1">…</ScrollyStep>
 *     </ScrollyStepList>
 *   </ScrollySteps>
 *
 *   const { active, direction } = useScrollyActive()           inside <ScrollySteps>: re-renders once per step
 *   const { active, direction } = useScrollySteps(ref, opts)   your own markup
 *
 * - The server renders the plain markup, which reads stacked without JavaScript; css/scrolly.css lays it out side by
 *   side before hydration where the core will choose sticky, so hydrating shifts nothing. The core owns every
 *   attribute it writes (data-scrolly-active, data-step-state, data-state-active, inert, aria-hidden), so nothing here
 *   renders them and a re-render never fights it.
 * - `line`, `query`, `live` and `side` render as the root's data-scrolly-* attributes: the CSS reads them before the
 *   core mounts (a root with its own `query` stays stacked until then, the one documented layout shift).
 * - `active` and `direction` are a useSyncExternalStore subscription: they change once per step, never per frame. On
 *   the server and through hydration they are { active: 0, direction: null }. For per-frame work inside a step pass
 *   `progress` and read --step-p in CSS, or onProgress; never React state.
 * - Drive the graphic's richer changes from `active` (a Motion `animate` keyed on it) or onStep. onStep's first call
 *   on every mount has previous null: jump there, don't animate.
 * - The core mounts in the subscription and is destroyed in its cleanup: on unmount and when Next's <Activity> hides
 *   the route. destroy() leaves the last state in place, so showing it again doesn't flash the first state. The root
 *   element must be the same one for the hook's lifetime; callbacks may change identity on every render.
 * - No Motion API is involved: it runs under any React tree.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type RefObject,
} from 'react'

import {
  mountScrollySteps,
  type ScrollyDirection,
  type ScrollyStepsOptions,
} from '../scrolly-steps'

export interface ScrollyActive {
  active: number
  direction: ScrollyDirection
}

export type UseScrollyStepsOptions = Pick<
  ScrollyStepsOptions,
  'line' | 'query' | 'progress' | 'live' | 'onStep' | 'onMode' | 'onProgress'
>

type Handlers = Pick<ScrollyStepsOptions, 'onStep' | 'onMode' | 'onProgress'>

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

const SERVER: ScrollyActive = { active: 0, direction: null }
const readOnServer = () => SERVER

export function useScrollySteps(
  rootRef: RefObject<HTMLElement | null>,
  { line, query, progress, live, onStep, onMode, onProgress }: UseScrollyStepsOptions = {},
): ScrollyActive {
  const [store] = useState(createStepStore)
  const handlers = useRef<Handlers>({})
  // The latest callbacks, without remounting the core when their identity changes.
  useIsomorphicLayoutEffect(() => {
    handlers.current = { onStep, onMode, onProgress }
  })
  const subscribe = useCallback(
    (notify: () => void) => {
      const root = rootRef.current
      return root ? store.mount(root, { line, query, progress, live }, handlers, notify) : () => {}
    },
    [store, rootRef, line, query, progress, live],
  )
  return useSyncExternalStore(subscribe, store.read, readOnServer)
}

/** The active step as a store: read by React while it renders, written by the core only when the step changes. */
function createStepStore() {
  let snapshot: ScrollyActive = SERVER
  return {
    read: () => snapshot,
    mount(
      root: HTMLElement,
      options: Pick<ScrollyStepsOptions, 'line' | 'query' | 'progress' | 'live'>,
      handlers: RefObject<Handlers>,
      notify: () => void,
    ) {
      const scrolly = mountScrollySteps(root, {
        ...options,
        onStep(detail, handle) {
          if (detail.index !== snapshot.active || detail.direction !== snapshot.direction) {
            snapshot = { active: detail.index, direction: detail.direction }
            notify()
          }
          handlers.current.onStep?.(detail, handle)
        },
        onMode: (mode, handle) => handlers.current.onMode?.(mode, handle),
        onProgress: (p, handle) => handlers.current.onProgress?.(p, handle),
      })
      return () => scrolly.destroy()
    },
  }
}

// ── components ──────────────────────────────────────────────────────────────────────────────────────────────────────

const ScrollyContext = createContext<ScrollyActive>(SERVER)

/** The enclosing <ScrollySteps>' active step and direction: re-renders once per step. */
export function useScrollyActive(): ScrollyActive {
  return useContext(ScrollyContext)
}

/** The section's own props, less its media `onProgress` event: here that name is the step's progress. */
export interface ScrollyStepsProps extends Omit<ComponentPropsWithoutRef<'section'>, 'onProgress'>, UseScrollyStepsOptions {
  /** Put the graphic in the inline-start column. Default: the inline-end one. */
  side?: 'start' | 'end'
}

export function ScrollySteps({
  line,
  query,
  progress,
  live,
  side,
  onStep,
  onMode,
  onProgress,
  children,
  ...rest
}: ScrollyStepsProps) {
  const ref = useRef<HTMLElement>(null)
  // The core reads line, query and live from the attributes, so the CSS sees what it sees before it mounts.
  const state = useScrollySteps(ref, { progress, onStep, onMode, onProgress })
  return (
    <section
      {...rest}
      ref={ref}
      data-scrolly=""
      data-scrolly-line={line === undefined ? undefined : String(Math.round(line * 1000) / 10)}
      data-scrolly-query={query}
      data-scrolly-live={live ? '' : undefined}
      data-scrolly-side={side === 'start' ? 'start' : undefined}
    >
      <ScrollyContext.Provider value={state}>{children}</ScrollyContext.Provider>
    </section>
  )
}

/** The sticky column; its children are ScrollyStates. */
export function ScrollyGraphic(props: ComponentPropsWithoutRef<'div'>) {
  return <div {...props} data-scrolly-graphic="" />
}

/** One state of the graphic: the steps that name `value` show it. */
export function ScrollyState({ value, ...rest }: ComponentPropsWithoutRef<'figure'> & { value: string | number }) {
  return <figure {...rest} data-scrolly-state={String(value)} />
}

export function ScrollyStepList(props: ComponentPropsWithoutRef<'ol'>) {
  return <ol {...props} data-scrolly-steps="" />
}

/** One step. `show` names its state; by default the state with the step's own index. */
export function ScrollyStep({ show, ...rest }: ComponentPropsWithoutRef<'li'> & { show?: string | number }) {
  return <li {...rest} data-scrolly-step="" data-scrolly-show={show === undefined ? undefined : String(show)} />
}

/** The figure the step shows in stacked mode (phones, no JavaScript, print); hidden beside the sticky graphic. */
export function ScrollyInline(props: ComponentPropsWithoutRef<'figure'>) {
  return <figure {...props} data-scrolly-inline="" />
}
