import type { ReactNode } from 'react'

import { SmootherRevealRoute } from '@/components/reveals'

export default function SmootherLayout({ children }: { children: ReactNode }) {
  return <SmootherRevealRoute>{children}</SmootherRevealRoute>
}
