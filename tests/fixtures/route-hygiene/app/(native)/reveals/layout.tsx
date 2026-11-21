import type { ReactNode } from 'react'

import { NativeRevealRoute } from '@/components/reveals'

export default function RevealsLayout({ children }: { children: ReactNode }) {
  return <NativeRevealRoute>{children}</NativeRevealRoute>
}
