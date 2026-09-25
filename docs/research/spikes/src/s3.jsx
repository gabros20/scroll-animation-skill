// S3 — Motion 13.4 accelerated scroll: does a bound `style={{ opacity }}` agree
// with its MotionValue over a sticky pin?
//
// ?v=brief | brief-padded | cover | v1 | v1-tall | no-target     ?comp=motion | m
//
// brief         400vh range, sticky 100lvh child; opacity = useTransform(p, [0.2, 0.6], [0, 1]),
//               p = useScroll({ target: range, offset: ['start start', 'end end'] })
// brief-padded  same, input range padded to [0, 0.2, 0.6, 1] -> [0, 0, 1, 1]
// cover         same geometry, offset ['start end', 'end start'] (matches none of Motion's presets)
// v1            v1's FadeOnExit geometry: copy under marginTop -100lvh over a sticky pin,
//               p = useScroll({ target: copy, offset: ['start start', 'end start'] }), [0.1, 0.35] -> [1, 0]
// v1-tall       same, copy block taller than the viewport (130vh)
// no-target     no pin, no target: useScroll() page progress, [0.2, 0.6] -> [0, 1]
//
// Every variant renders a bound element (#bound, the declarative version) and a
// control (#manual, written by hand from the same MotionValue).
import { LazyMotion, domAnimation, m, motion, useMotionValueEvent, useScroll, useTransform } from 'motion/react'
import { useLayoutEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { createRecorder, scrollTop } from './lib/rec.js'

const q = new URLSearchParams(location.search)
const variant = q.get('v') ?? 'brief'
const comp = q.get('comp') ?? 'motion'
const Div = comp === 'm' ? m.div : motion.div

const SPEC = {
  brief: { input: [0.2, 0.6], output: [0, 1], offset: ['start start', 'end end'] },
  'brief-padded': { input: [0, 0.2, 0.6, 1], output: [0, 0, 1, 1], offset: ['start start', 'end end'] },
  cover: { input: [0.2, 0.6], output: [0, 1], offset: ['start end', 'end start'] },
  v1: { input: [0.1, 0.35], output: [1, 0], offset: ['start start', 'end start'] },
  'v1-tall': { input: [0.1, 0.35], output: [1, 0], offset: ['start start', 'end start'] },
  'no-target': { input: [0.2, 0.6], output: [0, 1], offset: undefined }
}[variant]

const box = (color) => ({ width: 120, height: 120, background: color })
window.__s3 = { variant, comp, spec: SPEC }

/** Bound + manual pair driven by one scroll progress value. */
function Pair({ progress }) {
  const opacity = useTransform(progress, SPEC.input, SPEC.output)
  const manual = useRef(null)
  // Subscribes to the transform's OUTPUT: useTransform recomputes in Motion's
  // preRender step, so reading opacity.get() inside a `progress` change
  // handler (preUpdate) would see last frame's value.
  const write = (v) => {
    if (manual.current) manual.current.style.opacity = String(v)
  }
  useMotionValueEvent(opacity, 'change', write)
  useLayoutEffect(() => write(opacity.get()), [])
  window.__s3.progress = progress
  window.__s3.mv = opacity
  return (
    <div style={{ display: 'flex', gap: 40, padding: 40 }}>
      <Div id="bound" style={{ ...box('#000'), opacity }} />
      <div id="manual" ref={manual} style={box('#000')} />
    </div>
  )
}

function Brief() {
  const range = useRef(null)
  const { scrollYProgress } = useScroll({ target: range, offset: SPEC.offset })
  window.__s3.targetEl = () => range.current
  return (
    <>
      <div style={{ height: '100vh' }} />
      <div id="range" ref={range} style={{ height: '400vh', position: 'relative' }}>
        <div id="pin" style={{ position: 'sticky', top: 0, height: '100lvh', background: '#eee' }}>
          <Pair progress={scrollYProgress} />
        </div>
      </div>
      <div style={{ height: '150vh' }} />
    </>
  )
}

// v1's ScrubStage + FadeOnExit structure: the content layer is pulled back over
// the pin with marginTop: -100lvh, and the fading copy tracks ITSELF.
function FadeCopy({ tall }) {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: SPEC.offset })
  window.__s3.targetEl = () => ref.current
  return (
    // tall: the boxes sit at the bottom of the layer, which stays on screen
    // while the layer's top has already left (where a fade-back would show)
    <div id="copy" ref={ref} style={{ height: tall ? '130vh' : 'auto', display: 'flex', alignItems: 'flex-end' }}>
      <Pair progress={scrollYProgress} />
    </div>
  )
}

function V1({ tall }) {
  return (
    <>
      <div style={{ height: '100vh' }} />
      <div id="range" style={{ position: 'relative' }}>
        <div id="pin" style={{ position: 'sticky', top: 0, height: '100lvh', overflow: 'hidden', background: '#eee' }} />
        <div id="content" style={{ position: 'relative', marginTop: '-100lvh' }}>
          <section style={{ minHeight: '100svh', display: 'flex', alignItems: 'center' }}>
            <FadeCopy tall={tall} />
          </section>
          <section style={{ height: '200svh' }} />
          <section style={{ height: '100svh' }} />
        </div>
      </div>
      <div style={{ height: '150vh' }} />
    </>
  )
}

function NoTarget() {
  const { scrollYProgress } = useScroll()
  window.__s3.targetEl = () => null
  return (
    <>
      <div style={{ height: '100vh' }} />
      <div style={{ position: 'fixed', top: 0, left: 0 }}>
        <Pair progress={scrollYProgress} />
      </div>
      <div style={{ height: '400vh' }} />
    </>
  )
}

function App() {
  const body =
    variant === 'v1' ? <V1 /> : variant === 'v1-tall' ? <V1 tall /> : variant === 'no-target' ? <NoTarget /> : <Brief />
  return comp === 'm' ? (
    <LazyMotion features={domAnimation} strict>
      {body}
    </LazyMotion>
  ) : (
    body
  )
}

const css = document.createElement('style')
css.textContent = 'html, body { margin: 0; background: #fff; } html { scroll-behavior: auto; }'
document.head.appendChild(css)
createRoot(document.getElementById('root')).render(<App />)

const $ = (id) => document.getElementById(id)
const opacityOf = (el) => (el ? parseFloat(getComputedStyle(el).opacity) : null)

window.__s3.read = () => ({
  y: scrollTop(),
  p: window.__s3.progress?.get() ?? null,
  mv: window.__s3.mv?.get() ?? null,
  bound: opacityOf($('bound')),
  manual: opacityOf($('manual'))
})
window.__s3.rec = createRecorder((t) => ({ t, ...window.__s3.read() }))
window.__s3.info = () => {
  const el = $('bound')
  const anims = el.getAnimations().map((a) => ({
    type: a.constructor.name,
    timeline: a.timeline?.constructor?.name ?? null,
    subject: a.timeline?.subject ? a.timeline.subject.id || a.timeline.subject.tagName : null,
    rangeStart: a.rangeStart ? String(a.rangeStart.rangeName ?? '') + ' ' + String(a.rangeStart.offset ?? a.rangeStart) : null,
    rangeEnd: a.rangeEnd ? String(a.rangeEnd.rangeName ?? '') + ' ' + String(a.rangeEnd.offset ?? a.rangeEnd) : null,
    keyframes: a.effect.getKeyframes().map((k) => ({ offset: k.offset, opacity: k.opacity, easing: k.easing })),
    fill: a.effect.getTiming().fill,
    playState: a.playState
  }))
  const target = window.__s3.targetEl?.()
  const docTop = (e) => e.getBoundingClientRect().top + scrollTop()
  return {
    variant,
    comp,
    spec: SPEC,
    vh: innerHeight,
    inlineOpacity: el.style.opacity,
    anims,
    target: target ? { id: target.id, docTop: docTop(target), height: target.offsetHeight } : null,
    maxScroll: document.scrollingElement.scrollHeight - innerHeight
  }
}
