'use client'
import { usePathname } from 'next/navigation'
import { RouteChange } from '@/animation/smooth/SmoothScroll'

export function RouteScroll({ children }: { children?: React.ReactNode }) {
  return <RouteChange route={usePathname()}>{children}</RouteChange>
}
