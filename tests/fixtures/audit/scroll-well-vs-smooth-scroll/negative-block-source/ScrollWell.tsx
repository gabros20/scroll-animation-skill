// The Motion adapter as `scroll-animation add scroll-well` copies it, rendered by no route: its own definition and
// its call into the core are not a scroll well in use.
import { useEffect, useRef } from 'react'
import { createScrollWell } from '../scroll-well'

export function ScrollWell({ clamp }: { clamp?: string | null }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const target = ref.current?.parentElement
    if (!target) return
    const well = createScrollWell(target, { clamp })
    return () => well.destroy()
  }, [clamp])
  return <span ref={ref} hidden aria-hidden="true" />
}
