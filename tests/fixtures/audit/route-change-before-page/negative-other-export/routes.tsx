'use client'
import { usePathname } from 'next/navigation'
import { RouteChange } from '@/animation/smooth/SmoothScroll'

// Another export of the same file is not a wrapper: only RouteScroll renders <RouteChange>.
export function Divider() {
  return <hr />
}

export function RouteScroll({ children }: { children?: React.ReactNode }) {
  return <RouteChange route={usePathname()}>{children}</RouteChange>
}

export function Page({ children }: { children: React.ReactNode }) {
  return (
    <RouteScroll>
      <Divider />
      {children}
    </RouteScroll>
  )
}
