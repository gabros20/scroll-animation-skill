import type { ReactNode } from 'react'

import { NativeRoute } from '@/components/routes'

export default function JournalLayout({ children }: { children: ReactNode }) {
  return <NativeRoute>{children}</NativeRoute>
}
