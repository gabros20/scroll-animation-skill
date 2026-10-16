import type { ReactNode } from 'react'

import { LenisRoute } from '@/components/routes'

export default function LenisLayout({ children }: { children: ReactNode }) {
  return <LenisRoute>{children}</LenisRoute>
}
