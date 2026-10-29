import { connection } from 'next/server'
import { Suspense } from 'react'

import { Streamed, StreamedSection } from '@/components/routes'

// Rendered per request, and slow twice: the page itself (loading.tsx shows meanwhile), then a section inside it
// behind its own Suspense. `?long=1` lengthens the page: a search-param navigation keeps the pathname.
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function Section() {
  await wait(700)
  return <StreamedSection />
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await connection()
  await wait(700)
  const { long } = await searchParams
  return (
    <Streamed long={long === '1'}>
      <Suspense fallback={<section className="block">streaming…</section>}>
        <Section />
      </Suspense>
    </Streamed>
  )
}
