import { Suspense } from 'react'
import { Lifecycle } from './lifecycle'

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <body>
      <Suspense fallback={null}>
        <Lifecycle />
      </Suspense>
      <main>{children}</main>
    </body>
  )
}
