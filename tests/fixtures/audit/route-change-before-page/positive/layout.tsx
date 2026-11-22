import { Suspense } from 'react'
import { usePathname } from 'next/navigation'
import { RouteChange } from '@/animation/smooth/SmoothScroll'

export function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <body>
      <RouteChange route={pathname} />
      <main>{children}</main>
    </body>
  )
}
