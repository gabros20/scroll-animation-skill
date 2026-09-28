// react.html: split-reveal on React-rendered text, in the keyed pattern gsap/split-reveal.ts documents (spike S6c).
// Each variant renders into its own root, and tests/text.mjs steps every root through: mount (text A plus an <em>
// suffix), the same props, new text B, the suffix removed (a structural change), text A again. The component that
// owns the split element is keyed by its content, so new text mounts a fresh element, and splitReveal() runs in
// useGSAP and is destroyed on unmount.
import { useGSAP } from '@gsap/react'
import { SplitText } from 'gsap/SplitText'
import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'

import { setupGsap } from '../../../../skills/scroll-animation/assets/gsap/setup'
import { splitReveal } from '../../../../skills/scroll-animation/assets/gsap/split-reveal'
import { norm } from './measure'

setupGsap({ plugins: [SplitText, useGSAP] })

const A = 'The quick brown fox jumps over the lazy dog'
const B = 'Pack my box with five dozen liquor jugs'

interface Props {
  text: string
  suffix: boolean
}

/** A heading with nothing focusable: split with aria: 'auto', kept split. */
function Title({ text, suffix }: Props) {
  const ref = useRef<HTMLHeadingElement>(null)
  useGSAP(() => {
    const reveal = splitReveal(ref.current!)
    return () => reveal.destroy()
  })
  return (
    <h2 ref={ref}>
      {text}
      {suffix && <em> (beta)</em>}
    </h2>
  )
}

/** Running text with a link: the original nodes stay the content, the pieces are hidden copies. */
function Lede({ text, suffix }: Props) {
  const ref = useRef<HTMLParagraphElement>(null)
  useGSAP(() => {
    const reveal = splitReveal(ref.current!)
    return () => reveal.destroy()
  })
  return (
    <p ref={ref}>
      {text} <a href="#more">Read more</a>
      {suffix && <em> (beta)</em>}
    </p>
  )
}

const VARIANTS = {
  heading: {
    render: ({ text, suffix }: Props) => <Title key={`${text}|${suffix}`} text={text} suffix={suffix} />,
    expected: ({ text, suffix }: Props) => text + (suffix ? ' (beta)' : ''),
  },
  paragraph: {
    render: ({ text, suffix }: Props) => <Lede key={`${text}|${suffix}`} text={text} suffix={suffix} />,
    expected: ({ text, suffix }: Props) => `${text} Read more` + (suffix ? ' (beta)' : ''),
  },
}
type Variant = keyof typeof VARIANTS
interface State extends Props {
  n: number
}

const api: Partial<Record<Variant, (step: (s: State) => State) => void>> = {}
const errors: Record<string, string[]> = {}
const containers: Record<string, HTMLElement> = {}

function Harness({ name }: { name: Variant }) {
  const [state, set] = useState<State>({ text: A, suffix: true, n: 0 })
  api[name] = (step) => flushSync(() => set(step))
  const variant = VARIANTS[name]
  return <div data-expected={variant.expected(state)}>{variant.render(state)}</div>
}

for (const name of Object.keys(VARIANTS) as Variant[]) {
  const section = document.createElement('section')
  section.dataset.variant = name
  document.getElementById('roots')!.appendChild(section)
  containers[name] = section
  errors[name] = []
  const record = (kind: string) => (error: unknown) => {
    const e = error as Error | undefined
    errors[name].push(`${kind}: ${e?.name}: ${e?.message}`)
  }
  const root = createRoot(section, {
    onUncaughtError: record('uncaught'),
    onCaughtError: record('caught'),
    onRecoverableError: record('recoverable'),
  })
  flushSync(() => root.render(<Harness name={name} />))
}

const STEPS: Record<string, (s: State) => State> = {
  'same props': (s) => ({ ...s, n: s.n + 1 }),
  'new text': (s) => ({ ...s, text: B, n: s.n + 1 }),
  'suffix removed': (s) => ({ ...s, suffix: false, n: s.n + 1 }),
  'text A again': (s) => ({ ...s, text: A, n: s.n + 1 }),
}

/** The running-text split: a visually hidden copy (the element's own nodes) and the aria-hidden pieces after it. */
const copyOf = (el: HTMLElement) => {
  const first = el.firstElementChild
  return first instanceof HTMLElement && first.style.clipPath === 'inset(50%)' ? first : null
}

/** Text a screen reader gets: aria-label, or every text node outside aria-hidden. */
function accessibleText(el: HTMLElement): string {
  const label = el.getAttribute('aria-label')
  if (label !== null) return norm(label)
  let out = ''
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest('[aria-hidden="true"]')) out += node.textContent
  }
  return norm(out)
}

const t = {
  variants: Object.keys(VARIANTS),
  step(name: string) {
    for (const variant of Object.keys(VARIANTS) as Variant[]) {
      try {
        api[variant]?.(STEPS[name])
      } catch (error) {
        const e = error as Error
        errors[variant].push(`thrown from setState: ${e?.name}: ${e?.message}`)
      }
    }
  },
  read() {
    return Object.fromEntries(
      (Object.keys(VARIANTS) as Variant[]).map((name) => {
        const box = containers[name]
        const el = box.querySelector<HTMLElement>('h2, p')
        const copy = el ? copyOf(el) : null
        // What the reader sees: the pieces when split, else the element's text.
        const visible = el ? norm(copy ? copy.nextElementSibling?.textContent : el.textContent) : null
        const split = !!el && (copy !== null || (el.hasAttribute('aria-label') && !!el.querySelector('[aria-hidden="true"]')))
        return [
          name,
          {
            mounted: !!el,
            expected: box.firstElementChild?.getAttribute('data-expected') ?? null,
            visible,
            accessible: el ? accessibleText(el) : null,
            split,
            errors: errors[name].slice(),
          },
        ]
      }),
    )
  },
}

declare global {
  interface Window {
    __rx: typeof t
  }
}
window.__rx = t
