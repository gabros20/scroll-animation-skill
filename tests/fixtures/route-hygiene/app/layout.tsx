import type { ReactNode } from 'react'

import { LayoutProgress, RouteScroll } from '@/components/routes'

import './fixture.css'

// <html> carries attributes React doesn't render (data-scroll-authority, Lenis's classes).
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <RouteScroll>
          <header className="bar">route-hygiene fixture</header>
          <LayoutProgress />
          <main>{children}</main>
        </RouteScroll>
      </body>
    </html>
  )
}
