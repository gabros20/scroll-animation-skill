import type { ReactNode } from 'react'

import { NativeRoute } from '@/components/routes'

export default function EnterLayout({ children }: { children: ReactNode }) {
  return <NativeRoute>{children}</NativeRoute>
}
