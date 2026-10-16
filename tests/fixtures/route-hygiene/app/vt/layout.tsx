import { ViewTransition, type ReactNode } from 'react'

// The same two routes under /vt, inside a React <ViewTransition>: a navigation between them runs as a view transition
// (the root's default cross-fade) wherever the browser has document.startViewTransition.
export default function TransitionLayout({ children }: { children: ReactNode }) {
  return <ViewTransition>{children}</ViewTransition>
}
