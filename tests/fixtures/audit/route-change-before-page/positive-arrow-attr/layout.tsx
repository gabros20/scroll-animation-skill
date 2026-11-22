import { usePathname } from 'next/navigation'
import { RouteChange } from '@/animation/smooth/SmoothScroll'

export function Layout({ children, refresh }: { children: React.ReactNode; refresh: () => void }) {
  const pathname = usePathname()
  return (
    <body>
      <RouteChange route={pathname} refresh={() => refresh()} />
      <main>{children}</main>
    </body>
  )
}
