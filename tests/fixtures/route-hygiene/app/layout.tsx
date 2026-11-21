import type { ReactNode } from 'react'

import { GATE_SCRIPT } from '@/animation/config'
import { LayoutProgress, RouteScroll } from '@/components/routes'

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
          <header className="bar">route-hygiene fixture</header>
          <LayoutProgress />
          <main>{children}</main>
        </RouteScroll>
      </body>
    </html>
  )
}
