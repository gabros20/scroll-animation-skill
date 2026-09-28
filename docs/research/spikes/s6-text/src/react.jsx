// S6c — SplitText on text React renders. Every variant renders the same
// heading, `{text}{suffix && <em> (beta)</em>}`, into its own React root, and
// the runner re-renders every parent through the same steps:
//   mount (A + suffix) -> same props again -> new text B -> suffix removed -> text A again
//
//   once          SplitText.create in useEffect on mount, no cleanup (the naive version)
//   gsap-deps     useGSAP(split, { dependencies: [text, suffix] })         (revertOnUpdate: false, the default)
//   gsap-revert   useGSAP(split, { dependencies: [text, suffix], revertOnUpdate: true })
//   keyed         <Heading key={text + suffix}>, useGSAP(split) with no dependencies: a change remounts
//   unowned       React renders an empty <h1>; the effect writes the text itself, then splits (revertOnUpdate)
//   inner-html    dangerouslySetInnerHTML + useGSAP(split, { dependencies, revertOnUpdate: true })
//   react-words   no SplitText: React renders one <span class="word"> per word; GSAP animates the spans
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { Fragment, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'

gsap.registerPlugin(SplitText, useGSAP)

const A = 'The quick brown fox jumps over the lazy dog'
const B = 'Pack my box with five dozen liquor jugs'
const CFG = { type: 'lines,words', mask: 'lines', linesClass: 'line', wordsClass: 'word' }
const full = (text, suffix) => text + (suffix ? ' (beta)' : '')
const reveal = (targets) => gsap.from(targets, { yPercent: 100, duration: 0.4, stagger: 0.03 })

function Once({ text, suffix }) {
  const ref = useRef(null)
  useEffect(() => {
    const split = SplitText.create(ref.current, CFG)
    reveal(split.lines)
  }, [])
  return (
    <h1 ref={ref}>
      {text}
      {suffix && <em> (beta)</em>}
    </h1>
  )
}

function GsapDeps({ text, suffix }) {
  const ref = useRef(null)
  useGSAP(
    () => {
      const split = SplitText.create(ref.current, CFG)
      reveal(split.lines)
    },
    { dependencies: [text, suffix], scope: ref }
  )
  return (
    <h1 ref={ref}>
      {text}
      {suffix && <em> (beta)</em>}
    </h1>
  )
}

function GsapRevert({ text, suffix }) {
  const ref = useRef(null)
  useGSAP(
    () => {
      const split = SplitText.create(ref.current, CFG)
      reveal(split.lines)
    },
    { dependencies: [text, suffix], scope: ref, revertOnUpdate: true }
  )
  return (
    <h1 ref={ref}>
      {text}
      {suffix && <em> (beta)</em>}
    </h1>
  )
}

function KeyedHeading({ text, suffix }) {
  const ref = useRef(null)
  useGSAP(
    () => {
      const split = SplitText.create(ref.current, CFG)
      reveal(split.lines)
    },
    { scope: ref }
  )
  return (
    <h1 ref={ref}>
      {text}
      {suffix && <em> (beta)</em>}
    </h1>
  )
}
const Keyed = ({ text, suffix }) => <KeyedHeading key={`${text}|${suffix}`} text={text} suffix={suffix} />

function Unowned({ text, suffix }) {
  const ref = useRef(null)
  useGSAP(
    () => {
      ref.current.textContent = full(text, suffix)
      const split = SplitText.create(ref.current, CFG)
      reveal(split.lines)
    },
    { dependencies: [text, suffix], scope: ref, revertOnUpdate: true }
  )
  return <h1 ref={ref} />
}

function InnerHtml({ text, suffix }) {
  const ref = useRef(null)
  useGSAP(
    () => {
      const split = SplitText.create(ref.current, CFG)
      reveal(split.lines)
    },
    { dependencies: [text, suffix], scope: ref, revertOnUpdate: true }
  )
  return <h1 ref={ref} dangerouslySetInnerHTML={{ __html: text + (suffix ? '<em> (beta)</em>' : '') }} />
}

function ReactWords({ text, suffix }) {
  const ref = useRef(null)
  const words = full(text, suffix).split(' ')
  useGSAP(() => reveal(ref.current.querySelectorAll('.word')), { dependencies: [text, suffix], scope: ref, revertOnUpdate: true })
  return (
    <h1 ref={ref}>
      {words.map((w, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          <span className="word">{w}</span>
        </Fragment>
      ))}
    </h1>
  )
}

const VARIANTS = { once: Once, 'gsap-deps': GsapDeps, 'gsap-revert': GsapRevert, keyed: Keyed, unowned: Unowned, 'inner-html': InnerHtml, 'react-words': ReactWords }

const api = {}
const errors = {}
const containers = {}

function Harness({ name, V }) {
  const [s, set] = useState({ text: A, suffix: true, n: 0 })
  api[name] = (fn) => flushSync(() => set(fn))
  return (
    <div data-n={s.n} data-expected={full(s.text, s.suffix)}>
      <V text={s.text} suffix={s.suffix} />
    </div>
  )
}

for (const [name, V] of Object.entries(VARIANTS)) {
  const section = document.createElement('section')
  section.dataset.variant = name
  document.getElementById('roots').appendChild(section)
  containers[name] = section
  errors[name] = []
  const record = (kind) => (error) => errors[name].push(`${kind}: ${error?.name}: ${error?.message}`)
  const root = createRoot(section, { onUncaughtError: record('uncaught'), onCaughtError: record('caught'), onRecoverableError: record('recoverable') })
  flushSync(() => root.render(<Harness name={name} V={V} />))
}

const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
const STEPS = {
  'same props': (s) => ({ ...s, n: s.n + 1 }),
  'new text': (s) => ({ ...s, text: B, n: s.n + 1 }),
  'suffix removed': (s) => ({ ...s, suffix: false, n: s.n + 1 }),
  'text A again': (s) => ({ ...s, text: A, n: s.n + 1 })
}

window.__s6c = {
  variants: Object.keys(VARIANTS),
  step(step) {
    for (const name of Object.keys(VARIANTS)) {
      try {
        api[name]?.(STEPS[step])
      } catch (e) {
        errors[name].push(`thrown from setState: ${e?.name}: ${e?.message}`)
      }
    }
  },
  read() {
    const out = {}
    for (const name of Object.keys(VARIANTS)) {
      const box = containers[name]
      const h1 = box.querySelector('h1')
      const expected = box.firstElementChild?.dataset.expected ?? null
      const shown = h1 ? norm(h1.textContent) : null
      out[name] = {
        shown,
        expected,
        ok: shown === expected,
        mounted: !!h1,
        lines: h1 ? h1.querySelectorAll('.line').length : 0,
        nestedSplits: h1 ? h1.querySelectorAll('.line .line, .word .word').length : 0,
        ariaLabel: h1?.getAttribute('aria-label') ?? null,
        errors: errors[name].slice()
      }
    }
    return out
  }
}
