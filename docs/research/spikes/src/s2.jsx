// S2 — what breaks inside ScrollSmoother's #smooth-content (Chromium).
//
// ?mode=smoother|native (native = same DOM, no ScrollSmoother: the baseline)
//
// (a) position: sticky          #sticky inside #stickyRange
// (b) animation-timeline: view() #viewEl
// (c) Motion useScroll vs ScrollTrigger on the same element  #motionTarget
// (d) IntersectionObserver / Motion whileInView               #ioEl
import gsap from 'gsap'
import { ScrollSmoother } from 'gsap/ScrollSmoother'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { motion, useScroll } from 'motion/react'
import { useLayoutEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { createRecorder, frameKey, scrollTop } from './lib/rec.js'

gsap.registerPlugin(ScrollTrigger, ScrollSmoother)

const mode = new URLSearchParams(location.search).get('mode') ?? 'smoother'
const H = { intro: 900, range: 1800, sticky: 200, gap: 400, view: 100, target: 300, gap2: 600, io: 200, outro: 1200 }

const css = document.createElement('style')
css.textContent = `
  html, body { margin: 0; background: #fff; }
  html { scroll-behavior: auto; }
  @keyframes tx { from { transform: translateX(0) } to { transform: translateX(400px) } }
  #viewEl { width: 60px; height: ${H.view}px; background: red; animation: tx auto linear both; animation-timeline: view(); }
  #sticky { position: sticky; top: 0; height: ${H.sticky}px; background: #99f; }
`
document.head.appendChild(css)

const events = []
window.__s2 = { mode, events }

function Probes() {
  const target = useRef(null)
  // ['start end', 'end start'] matches none of Motion's four accelerated
  // presets, so this is the JS scroll path (asserted in the runner).
  const { scrollYProgress } = useScroll({ target, offset: ['start end', 'end start'] })
  window.__s2.motionProgress = scrollYProgress
  return (
    <>
      <div style={{ height: H.intro }} />
      <section id="stickyRange" style={{ height: H.range, position: 'relative', background: '#eef' }}>
        <div id="sticky" />
      </section>
      <div style={{ height: H.gap }} />
      <div id="viewEl" />
      <div style={{ height: H.gap }} />
      <div id="motionTarget" ref={target} style={{ height: H.target, background: '#fdd' }} />
      <div style={{ height: H.gap2 }} />
      <motion.div
        id="ioEl"
        style={{ height: H.io, background: '#dfd' }}
        whileInView={{ opacity: 1 }}
        initial={{ opacity: 0.99 }}
        viewport={{ amount: 0 }}
        onViewportEnter={(e) =>
          events.push({ kind: 'motion-enter', t: frameKey(), rectTop: e?.boundingClientRect?.top ?? null, y: scrollTop() })
        }
        onViewportLeave={(e) =>
          events.push({ kind: 'motion-leave', t: frameKey(), rectTop: e?.boundingClientRect?.top ?? null, y: scrollTop() })
        }
      />
      <div style={{ height: H.outro }} />
    </>
  )
}

function App() {
  useLayoutEffect(() => {
    const smoother =
      mode === 'smoother'
        ? ScrollSmoother.create({ wrapper: '#smooth-wrapper', content: '#smooth-content', smooth: 1 })
        : null
    const st = ScrollTrigger.create({ trigger: '#motionTarget', start: 'top bottom', end: 'bottom top' })
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          events.push({ kind: e.isIntersecting ? 'io-enter' : 'io-leave', t: frameKey(), rectTop: e.boundingClientRect.top, y: scrollTop() })
      },
      { threshold: 0 }
    )
    io.observe(document.getElementById('ioEl'))
    Object.assign(window.__s2, { smoother, st })
    return () => {
      io.disconnect()
      st.kill()
      smoother?.kill()
    }
  }, [])
  return (
    <div id="smooth-wrapper">
      <div id="smooth-content">
        <Probes />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)

const $ = (id) => document.getElementById(id)
const rec = createRecorder((t) => {
  const s = window.__s2
  return {
    t,
    y: scrollTop(),
    sm: s.smoother ? s.smoother.scrollTop() : null,
    rangeTop: $('stickyRange').getBoundingClientRect().top,
    stickyTop: $('sticky').getBoundingClientRect().top,
    viewTop: $('viewEl').getBoundingClientRect().top,
    viewP: $('viewEl').getAnimations()[0]?.effect.getComputedTiming().progress ?? null,
    tTop: $('motionTarget').getBoundingClientRect().top,
    mP: s.motionProgress?.get() ?? null,
    stP: s.st?.progress ?? null,
    ioTop: $('ioEl').getBoundingClientRect().top
  }
})
window.__s2.rec = rec
window.__s2.info = () => {
  const target = $('motionTarget')
  let docTop = 0
  for (let el = target; el; el = el.offsetParent) docTop += el.offsetTop
  return {
    vh: innerHeight,
    H,
    targetDocTop: docTop,
    // Motion attaches a native ViewTimeline only for the four preset offsets;
    // this checks nothing was promoted.
    viewTimelineOnTarget: target.getAnimations().length,
    wrapperStyle: (() => {
      const w = $('smooth-wrapper')
      const cs = getComputedStyle(w)
      return { position: cs.position, overflow: cs.overflow }
    })(),
    contentTransform: getComputedStyle($('smooth-content')).transform
  }
}
