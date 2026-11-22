import { Suspense } from 'react'
import { RouteScroll } from './route-scroll'

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <body>
      <Suspense fallback={null}>
        <RouteScroll />
      </Suspense>
      <main>{children}</main>
    </body>
  )
}
