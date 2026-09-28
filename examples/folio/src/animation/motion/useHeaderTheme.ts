'use client'
/**
 * motion/useHeaderTheme.ts: header-theme.ts for React routes. It mounts the engine-free core on the header and returns
 * the ink under the header's probe line.
 *
 *   const header = useRef<HTMLElement>(null)
 *   const ink = useHeaderTheme(header)              // the section's token, the default, or null
 *   <header ref={header} data-header data-header-ink-default="light">…</header>
 *
 * - The core writes data-header-ink on the header itself, so CSS needs no React state: `[data-header][data-header-ink=
 *   'dark'] { color: #fff }`. Reach for `ink` only for what CSS can't do (swapping a logo component, say). It changes
 *   once per ink change, never per frame.
 * - `ink` is null on the server and through hydration (useSyncExternalStore's server snapshot), then the ink the core
 *   resolves. Render `data-header-ink` for the top of the page on the server if the first paint must be right.
 * - A useSyncExternalStore subscription: the core mounts in its effect and stops in the cleanup, which runs on unmount
 *   and when Next's <Activity> hides the route; showing it mounts the core again, which re-reads the page.
 * - Options are the core's: `sections` (a selector) and `line` (a fraction of the header's height, 1 = its bottom edge).
 *   The header element must be the same one for the hook's lifetime.
 * - css/header-theme.css carries the ink transition. No Motion API is involved: it runs under any React tree.
 */
import { useCallback, useState, useSyncExternalStore, type RefObject } from 'react'

import { mountHeaderTheme, type HeaderThemeOptions } from '../header-theme'

export type UseHeaderThemeOptions = Pick<HeaderThemeOptions, 'sections' | 'line'>

export function useHeaderTheme(
  headerRef: RefObject<HTMLElement | null>,
  { sections, line }: UseHeaderThemeOptions = {},
): string | null {
  const [store] = useState(createInkStore)
  const subscribe = useCallback(
    (notify: () => void) => {
      const header = headerRef.current
      return header ? store.mount(header, { sections, line }, notify) : () => {}
    },
    [store, headerRef, sections, line],
  )
  return useSyncExternalStore(subscribe, store.read, readOnServer)
}

/** The ink as a store: read by React while it renders, written by the core only when the ink changes. */
function createInkStore() {
  let ink: string | null = null
  return {
    read: () => ink,
    mount(header: HTMLElement, options: UseHeaderThemeOptions, notify: () => void) {
      ink = header.getAttribute('data-header-ink')
      return mountHeaderTheme(header, {
        ...options,
        onChange(next) {
          ink = next
          notify()
        },
      })
    },
  }
}

const readOnServer = () => null
