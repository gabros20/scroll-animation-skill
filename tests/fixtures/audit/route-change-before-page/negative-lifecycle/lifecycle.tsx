'use client'
import { usePathname } from 'next/navigation'
import { PageLifecycle } from '@/animation/react/PageLifecycle'

export function Lifecycle() {
  return <PageLifecycle route={usePathname()} />
}
