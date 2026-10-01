// The read-out every scroll-effects page loads: tests/scroll-effects.mjs reads and drives `window.__fx`.
//
//   [data-probe="id"]   an element to read: its layout box (docTop + height, the box the spec's view-progress maths
//                       uses, taken while nothing is stuck or transformed), its computed opacity, translate, scale,
//                       transform-origin, position and top, and the animations attached to it
//
// Plus the page's pause buttons: <button aria-controls="id" aria-pressed="false"> toggles data-marquee-paused on the
// marquee it controls, the pattern css/scroll-effects.css §5 documents.

declare global {
  interface Window {
    __fx: typeof api
  }
}

/** Offset top in document coordinates, ignoring transforms (the offsetParent chain). */
function docTop(el: HTMLElement): number {
  let y = 0
  for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) y += n.offsetTop
  return y
}

const probes = () => Array.from(document.querySelectorAll<HTMLElement>('[data-probe]'))
const label = (el: unknown) => (el instanceof HTMLElement ? (el.dataset.probe ?? el.tagName.toLowerCase()) : null)

function describe(a: Animation) {
  const timeline = a.timeline as (AnimationTimeline & { subject?: Element | null }) | null
  const timing = a.effect?.getTiming()
  return {
    on: label((a.effect as KeyframeEffect | null)?.target ?? null),
    name: 'animationName' in a ? (a as CSSAnimation).animationName : null,
    timeline: timeline ? timeline.constructor.name : null,
    subject: timeline && 'subject' in timeline ? label(timeline.subject) : null,
    playState: a.playState,
    duration: typeof timing?.duration === 'number' ? timing.duration : String(timing?.duration ?? ''),
    iterations: timing?.iterations === Infinity ? 'infinite' : (timing?.iterations ?? null),
    direction: timing?.direction ?? null,
  }
}

function readOne(el: HTMLElement) {
  const cs = getComputedStyle(el)
  const r = el.getBoundingClientRect()
  return {
    opacity: Number(cs.opacity),
    translate: cs.translate,
    scale: cs.scale,
    origin: cs.transformOrigin,
    position: cs.position,
    top: cs.top,
    rect: { left: r.left, right: r.right, top: r.top, width: r.width },
    anims: el.getAnimations().map(describe),
  }
}

const frames = (n = 3) =>
  new Promise<void>((resolve) => {
    let i = 0
    const step = () => (++i >= n ? resolve() : requestAnimationFrame(step))
    requestAnimationFrame(step)
  })

const api = {
  frames,
  support: () => ({
    view: CSS.supports('animation-timeline: view()'),
    scroll: CSS.supports('animation-timeline: scroll()'),
    scope: CSS.supports('timeline-scope: --a'),
  }),
  geometry() {
    const H = document.documentElement.clientHeight
    return {
      H,
      scrollMax: document.scrollingElement!.scrollHeight - H,
      boxes: Object.fromEntries(
        probes().map((el) => [el.dataset.probe!, { T: docTop(el), h: el.offsetHeight, w: el.offsetWidth }]),
      ),
    }
  },
  read() {
    return {
      scrollTop: document.scrollingElement!.scrollTop,
      probes: Object.fromEntries(probes().map((el) => [el.dataset.probe!, readOne(el)])),
    }
  },
  /** Scroll to `y` at once, let three frames paint, and return where the page landed. */
  async scrollTo(y: number) {
    window.scrollTo({ top: y, behavior: 'instant' })
    await frames(3)
    return document.scrollingElement!.scrollTop
  },
  /** Every animation in the document. */
  all: () => document.getAnimations().map(describe),
}

for (const button of document.querySelectorAll<HTMLButtonElement>('button[aria-controls]')) {
  button.addEventListener('click', () => {
    const paused = button.getAttribute('aria-pressed') !== 'true'
    button.setAttribute('aria-pressed', String(paused))
    document.getElementById(button.getAttribute('aria-controls')!)?.toggleAttribute('data-marquee-paused', paused)
  })
}

window.__fx = api

export {}
