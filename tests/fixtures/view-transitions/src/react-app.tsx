// The React page: React 19.3's <ViewTransition> with the block's classes. The cover is a shared element (share="vt-morph");
// each view enters and exits with the slide that matches the transition's type (addTransitionType), and crossfades
// when there is none. React starts the transitions itself, so nothing here goes through transition().
import { addTransitionType, startTransition, useEffect, useState, ViewTransition } from 'react'

type View = 'index' | 'article'
const slide = { forward: 'vt-forward', back: 'vt-back', default: 'auto' }
const filler = Array.from({ length: 40 }, (_, i) => <p key={i}>Paragraph {i + 1}</p>)

function Cover() {
  return (
    <ViewTransition name="cover" share="vt-morph">
      <div className="cover" />
    </ViewTransition>
  )
}

function Index() {
  return (
    <section className="index" data-view="index">
      <h1>Index</h1>
      <a className="card" href="#kiln">
        <Cover />
      </a>
      <div className="filler">{filler}</div>
    </section>
  )
}

function Article() {
  return (
    <article className="article" data-view="article">
      <Cover />
      <h1>The Kiln That Never Went Cold</h1>
      <div className="filler">{filler}</div>
    </article>
  )
}

export function App() {
  const [view, setView] = useState<View>('index')
  useEffect(() => {
    const w = window as unknown as { __fx: Record<string, unknown> & { updates: number } }
    if (!w.__fx) {
      w.__fx = {
        updates: -1,
        go: (next: View, { types = [] }: { types?: string[] } = {}) =>
          startTransition(() => {
            for (const type of types) addTransitionType(type)
            setView(next)
          }),
      }
    }
    w.__fx.view = () => view
    w.__fx.updates++
  }, [view])
  return (
    <ViewTransition key={view} enter={slide} exit={slide}>
      {view === 'index' ? <Index /> : <Article />}
    </ViewTransition>
  )
}
