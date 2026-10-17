// One component per GSAP block, each mounting it the way the block's header tells React to: inside
// useGSAP(() => { const b = block(ref.current!, …); return () => b?.destroy() }, { scope }). The page renders one of
// them (?block=…); tests/usegsap-teardown.mjs scrolls and interacts through the ids below.
import { useGSAP } from '@gsap/react'
import { useRef, useState, type ReactNode, type RefObject } from 'react'
import { flushSync } from 'react-dom'

import { colourTrack } from '../../../../skills/scroll-animation/assets/gsap/colour-track'
import { cursorMedia } from '../../../../skills/scroll-animation/assets/gsap/cursor-media'
import { drawOnScroll } from '../../../../skills/scroll-animation/assets/gsap/draw-on-scroll'
import { flipTransition, type FlipTransition } from '../../../../skills/scroll-animation/assets/gsap/flip-transition'
import { frameSequence } from '../../../../skills/scroll-animation/assets/gsap/frame-sequence'
import { ScrollTrigger, gsap } from '../../../../skills/scroll-animation/assets/gsap/setup'
import { horizontalRail } from '../../../../skills/scroll-animation/assets/gsap/horizontal-rail'
import { initLoopVideos } from '../../../../skills/scroll-animation/assets/gsap/loop-video'
import { marqueeVelocity } from '../../../../skills/scroll-animation/assets/gsap/marquee-velocity'
import { parallax } from '../../../../skills/scroll-animation/assets/gsap/parallax'
import { pinnedScene } from '../../../../skills/scroll-animation/assets/gsap/pinned-scene'
import { reveal } from '../../../../skills/scroll-animation/assets/gsap/reveal'
import { scrollWell } from '../../../../skills/scroll-animation/assets/gsap/scroll-well'
import { scrubVideo } from '../../../../skills/scroll-animation/assets/gsap/scrub-video'
import { splitReveal } from '../../../../skills/scroll-animation/assets/gsap/split-reveal'
import { steppedSections } from '../../../../skills/scroll-animation/assets/gsap/stepped-sections'
import { harness } from './harness'

/** The live block handles, by name: the runner's probes read them. */
export const handles: Record<string, unknown> = {}

/** The case's mount, wrapped so every case takes the pre-mount snapshot before its block writes anything. */
function useBlock<E extends HTMLElement>(ref: RefObject<E | null>, make: (el: E) => (() => void) | void) {
  useGSAP(
    () => {
      harness.beforeMount(document.getElementById('case')!)
      return make(ref.current!)
    },
    { scope: ref },
  )
}

const Spacer = ({ short = false }: { short?: boolean }) => <div className={short ? 'spacer short' : 'spacer'} />
const words = 'Every line arrives when its reader does, and the masks let descenders and accents out again'

function Reveal() {
  const ref = useRef<HTMLDivElement>(null)
  useBlock(ref, (el) => {
    const r = reveal(el)
    return () => r.destroy()
  })
  return (
    <div ref={ref}>
      <header data-reveal="mount">
        <h1 data-reveal-item>Reveal under useGSAP</h1>
      </header>
      <Spacer />
      <section data-reveal="view" id="ga">
        <h2 data-reveal-item>A rise</h2>
        <p data-reveal-item data-reveal-effect="fade">A fade</p>
        <p data-reveal-item data-reveal-effect="clip">A clip</p>
      </section>
      <Spacer />
      <Spacer />
      <section data-reveal="view" id="gb">
        <h2 data-reveal-item>B rise</h2>
        <p data-reveal-item data-reveal-effect="scale-in">B scale</p>
      </section>
      <Spacer />
    </div>
  )
}

function SplitText({ id, as: Tag = 'h2', children }: { id: string; as?: 'h2' | 'p'; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement & HTMLParagraphElement>(null)
  useBlock(ref, (el) => {
    const s = splitReveal(el)
    handles[id] = s
    return () => s.destroy()
  })
  return (
    <Tag ref={ref} id={id} className="text">
      {children}
    </Tag>
  )
}

function SplitReveal() {
  return (
    <div>
      <Spacer />
      <SplitText id="s1">{words}</SplitText>
      <SplitText id="s2" as="p">
        {words}, with <a href="#here">a link</a> inside the paragraph that wraps onto a second line
      </SplitText>
      <Spacer />
      <Spacer />
      <SplitText id="s3">{words}</SplitText>
      <SplitText id="s4" as="p">
        {words}, and once more for the paragraph that reverts after its entrance
      </SplitText>
      <Spacer />
    </div>
  )
}

const acts = (n: number) =>
  Array.from({ length: n }, (_, i) => (
    <section key={i} data-scene-act className="act">
      Act {i + 1}
    </section>
  ))

function PinnedScene() {
  const ref = useRef<HTMLDivElement>(null)
  useBlock(ref, (el) => {
    const s = pinnedScene(el)
    handles.scene = s
    return () => s.destroy()
  })
  return (
    <div>
      <Spacer short />
      <div ref={ref} data-scene-root id="scene">
        <div data-scene-pin className="pin">
          Pinned
        </div>
        <div data-scene-content>{acts(3)}</div>
      </div>
      <Spacer />
    </div>
  )
}

function HorizontalRail() {
  const ref = useRef<HTMLElement>(null)
  useBlock(ref, (el) => {
    const r = horizontalRail(el)
    handles.rail = r
    return () => r?.destroy()
  })
  return (
    <div>
      <Spacer short />
      <section ref={ref} data-scene-root data-rail id="scene">
        <div data-scene-pin>
          <div data-rail-track role="region" aria-label="Selected work">
            {[60, 45, 70, 55, 60].map((w, i) => (
              <article key={i} data-rail-panel className="panel" style={{ width: `${w}vw` }}>
                <a href={`#p${i}`}>Panel {i + 1}</a>
              </article>
            ))}
          </div>
        </div>
        <div data-scene-spacer aria-hidden="true" />
      </section>
      <Spacer />
    </div>
  )
}

const POSTER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function ScrubVideo() {
  const ref = useRef<HTMLDivElement>(null)
  useBlock(ref, (el) => {
    const v = scrubVideo(el, {
      fps: 30,
      headLoop: { fromFrame: 0, matchFrame: 5 },
      tailLoop: { fromFrame: 55 },
      src: '/clip.mp4?tier=desktop',
      mobileSrc: '/clip.mp4?tier=mobile',
      poster: POSTER,
      camera: { desktop: { frameSize: { w: 160, h: 100 } }, mobile: { frameSize: { w: 60, h: 100 } } },
      backdrop: [
        { at: 0, top: '#111111', bottom: '#222222' },
        { at: 1, top: '#333333', bottom: '#444444' },
      ],
    })
    handles.video = v
    return () => v?.destroy()
  })
  return (
    <div>
      <div ref={ref} data-scene-root id="scene">
        <div data-scene-pin>
          <div data-scene-gutter aria-hidden="true" />
          <video data-scene-media muted playsInline preload="none" aria-hidden="true" />
        </div>
        <div data-scene-content>{acts(3)}</div>
      </div>
      <Spacer />
    </div>
  )
}

function FrameSequence() {
  const ref = useRef<HTMLCanvasElement>(null)
  useBlock(ref, (canvas) => {
    const seq = frameSequence(canvas, { manifest: '/seq/manifest.json', trigger: document.getElementById('range')! })
    handles.seq = seq
    return () => seq.destroy()
  })
  return (
    <div>
      <div id="range">
        <div id="pin">
          <canvas ref={ref} id="seq" role="img" aria-label="Test pattern" />
        </div>
      </div>
      <Spacer />
    </div>
  )
}

function LoopVideo() {
  const ref = useRef<HTMLDivElement>(null)
  useBlock(ref, (el) => {
    const videos = initLoopVideos(el)
    return () => videos.destroy()
  })
  return (
    <div ref={ref}>
      <Spacer />
      <div className="video-wrap">
        <video id="loop" data-loop-video data-controls="true" muted playsInline preload="none" poster={POSTER} aria-hidden="true">
          <source src="/clip.mp4" type="video/mp4" />
        </video>
      </div>
      <div className="video-wrap">
        <video id="seam" data-loop-video data-loop-from-frame="30" data-fps="30" data-alt="A test pattern" muted playsInline preload="none" poster={POSTER}>
          <source src="/clip.mp4?seam" type="video/mp4" />
        </video>
        <button type="button" data-loop-toggle aria-label="Video control">
          ⏯
        </button>
      </div>
      <Spacer />
    </div>
  )
}

function Parallax() {
  const ref = useRef<HTMLElement>(null)
  useBlock(ref, (el) => {
    const p = parallax(el)
    return () => p.destroy()
  })
  return (
    <main ref={ref}>
      <Spacer />
      <div className="layer" id="l1" data-parallax data-parallax-speed="0.2" />
      <Spacer />
      <div className="layer small" id="l2" data-parallax data-parallax-speed="-0.15" style={{ translate: '10px 0' }} />
      <Spacer />
    </main>
  )
}

function ColourTrack() {
  const ref = useRef<HTMLElement>(null)
  useBlock(ref, (el) => {
    const t = colourTrack(el)
    return () => t.destroy()
  })
  return (
    <main ref={ref}>
      <section data-colour-track="#0000ff" className="band">
        Blue
      </section>
      <section data-colour-track="#ffff00" className="band" id="yellow">
        Yellow
      </section>
      <section data-colour-track="oklch(0.5 0.1 30)" className="band">
        Brick
      </section>
      <Spacer />
    </main>
  )
}

function DrawOnScroll() {
  const ref = useRef<HTMLElement>(null)
  useBlock(ref, (el) => {
    const d = drawOnScroll(el)
    return () => d.destroy()
  })
  return (
    <main ref={ref}>
      <Spacer />
      <svg className="drawing" id="wave" viewBox="0 0 600 200" aria-hidden="true">
        <path data-draw id="wave-path" d="M0 100 C 150 0, 150 200, 300 100 S 450 0, 600 100" fill="none" stroke="#1a1a1a" strokeWidth={4} />
      </svg>
      <Spacer />
      <svg className="drawing" id="pair" viewBox="0 0 600 200" aria-hidden="true">
        <line data-draw x1="0" y1="50" x2="600" y2="50" stroke="#1a1a1a" strokeWidth={4} style={{ strokeLinecap: 'round' }} />
        <line data-draw x1="0" y1="150" x2="600" y2="150" stroke="#1a1a1a" strokeWidth={4} />
      </svg>
      <Spacer />
    </main>
  )
}

const items = ['One', 'Two', 'Three', 'Four', 'Five', 'Six']

function MarqueeVelocity() {
  const ref = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  useBlock(ref, (el) => {
    const m = marqueeVelocity(el, { toggle: toggle.current, duration: 10 })
    handles.marquee = m
    return () => m?.destroy()
  })
  const copy = (hidden: boolean) => (
    <ul className="copy" aria-hidden={hidden || undefined} inert={hidden || undefined}>
      {items.map((item) => (
        <li key={item}>
          <a href={`#${item}`}>{item}</a>
        </li>
      ))}
    </ul>
  )
  return (
    <div>
      <div ref={ref} className="marquee" data-marquee id="ticker">
        <div data-marquee-track id="track">
          {copy(false)}
          {copy(true)}
        </div>
      </div>
      <button ref={toggle} type="button" id="toggle" aria-controls="ticker" aria-pressed="false">
        Pause the ticker
      </button>
      <Spacer />
      <Spacer />
    </div>
  )
}

function CursorMedia() {
  const ref = useRef<HTMLDivElement>(null)
  useBlock(ref, (el) => {
    const c = cursorMedia(el)
    return () => c?.destroy()
  })
  return (
    <div>
      <div ref={ref} data-cursor-media id="list">
        <ul>
          {['harbour', 'field', 'tide'].map((key) => (
            <li key={key}>
              <a href={`#${key}`} data-cursor-media-item={key} id={`item-${key}`}>
                {key}
              </a>
            </li>
          ))}
        </ul>
        <div data-cursor-media-preview aria-hidden="true" id="preview" style={{ transform: 'rotate(1deg)' }}>
          {['harbour', 'field', 'tide'].map((key) => (
            <div key={key} data-cursor-media-for={key} className="media" />
          ))}
        </div>
      </div>
      <Spacer />
    </div>
  )
}

function SteppedSections() {
  const ref = useRef<HTMLElement>(null)
  useBlock(ref, (el) => {
    const s = steppedSections(el, { duration: 0.6 })
    handles.deck = s
    return () => s.destroy()
  })
  return (
    <div>
      <main ref={ref} id="deck">
        {['One', 'Two', 'Three', 'Four'].map((name, i) => (
          <section key={name} data-step id={`s${i + 1}`} className="step">
            <h2>{name}</h2>
          </section>
        ))}
      </main>
      <div className="after">After the deck</div>
    </div>
  )
}

function ScrollWell() {
  const ref = useRef<HTMLElement>(null)
  useBlock(ref, (el) => {
    const well = scrollWell(el)
    handles.well = well
    return () => well.destroy()
  })
  return (
    <main>
      <Spacer />
      <section ref={ref} className="well" id="well" data-scroll-well>
        <h2>A well</h2>
      </section>
      <Spacer />
    </main>
  )
}

/**
 * No mount-time block: the flip runs from a click, and the component kills the one it keeps in its cleanup (the
 * header's React line: contextSafe can't record it, Flip.from runs after change() resolves).
 */
function Flip() {
  const ref = useRef<HTMLUListElement>(null)
  const flipRef = useRef<FlipTransition | null>(null)
  const [detail, setDetail] = useState(false)
  useGSAP(
    () => {
      harness.beforeMount(document.getElementById('case')!)
      return () => flipRef.current?.kill()
    },
    { scope: ref },
  )
  const open = () => {
    const flip = flipTransition(ref.current!, {
      change: () => flushSync(() => setDetail((d) => !d)),
    })
    flipRef.current = flip
    handles.flipDone = false
    flip.then(() => (handles.flipDone = true))
  }
  return (
    <div>
      <button type="button" id="open" onClick={open}>
        Open
      </button>
      <ul ref={ref} id="gallery" data-view={detail ? 'detail' : 'grid'}>
        {['a', 'b', 'c', 'd'].map((id) => (
          <li key={id} id={id} data-flip-id={id}>
            {id.toUpperCase()}
          </li>
        ))}
      </ul>
      <Spacer />
    </div>
  )
}

/**
 * The order itself: what the callback's own cleanup (a block's destroy()) finds when useGSAP's context reverts. A
 * tween, a ScrollTrigger and a matchMedia build made in the callback; the cleanup records whether each is still there.
 */
function Order() {
  const ref = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      harness.beforeMount(document.getElementById('case')!)
      const box = ref.current!
      const seen: string[] = []
      handles.order = seen
      const tween = gsap.to(box, { x: 100, duration: 10 })
      tween.progress(0.5)
      const trigger = ScrollTrigger.create({ trigger: box, start: 'top bottom' })
      const mm = gsap.matchMedia()
      mm.add('all', () => () => seen.push('matchMedia cleanup'))
      return () => {
        const x = gsap.getProperty(box, 'x')
        seen.push(`tween ${x === 0 ? 'reverted' : `live at x ${x}`}`)
        seen.push(`trigger ${ScrollTrigger.getAll().includes(trigger) ? 'live' : 'killed'}`)
        seen.push('cleanup')
        mm.revert()
      }
    },
    { scope: ref },
  )
  return <div ref={ref} id="order" className="layer small" />
}

export const CASES: Record<string, { Case: () => ReactNode; ignore?: string[] }> = {
  reveal: { Case: Reveal },
  'split-reveal': { Case: SplitReveal },
  'pinned-scene': { Case: PinnedScene },
  'horizontal-rail': { Case: HorizontalRail },
  'scrub-video': { Case: ScrubVideo },
  'frame-sequence': { Case: FrameSequence },
  'loop-video': { Case: LoopVideo },
  parallax: { Case: Parallax },
  'colour-track': { Case: ColourTrack },
  'draw-on-scroll': { Case: DrawOnScroll },
  'marquee-velocity': { Case: MarqueeVelocity },
  'cursor-media': { Case: CursorMedia },
  'stepped-sections': { Case: SteppedSections },
  'scroll-well': { Case: ScrollWell },
  // React renders the change itself: data-view is the view the flip lands on, not something the recipe wrote.
  'flip-transition': { Case: Flip, ignore: ['data-view'] },
  order: { Case: Order },
}
