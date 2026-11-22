import type { ReactNode } from 'react'

import { GATE_SCRIPT } from '@/animation/config'
import { LayoutProgress, RouteScroll, RouteSlot } from '@/components/routes'

import './fixture.css'

// <html> carries attributes React doesn't render (data-scroll-authority, Lenis's classes, the reveal gate's).
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: GATE_SCRIPT }} />
      </head>
      <body>
        <RouteScroll>
          <RouteSlot at="before" />
          <header className="bar">route-hygiene fixture</header>
          <LayoutProgress />
          <main>{children}</main>
          <RouteSlot at="after" />
        </RouteScroll>
      </body>
    </html>
  )
}
