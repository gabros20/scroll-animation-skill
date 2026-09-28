// reveal.html: split-reveal on a heading and a paragraph set in a web font that arrives late. Records what each split
// saw the moment it happened, and puts `window.__t` (what tests/text.mjs reads and drives) on the page.
import { SplitText } from 'gsap/SplitText'

import { EASES, ScrollTrigger, gsap, setupGsap } from '../../../../skills/scroll-animation/assets/gsap/setup'
import { splitReveal, type SplitRevealHandle } from '../../../../skills/scroll-animation/assets/gsap/split-reveal'
import { docTop, frames, norm, textLines } from './measure'

setupGsap({ plugins: [SplitText] })

type Id = 'h' | 'p'
const IDS: Id[] = ['h', 'p']
const byId = (id: string) => document.getElementById(id) as HTMLElement
const els: Record<Id, HTMLElement> = { h: byId('h'), p: byId('p') }
const twins: Record<Id, HTMLElement> = { h: byId('h-twin'), p: byId('p-twin') }
const probe = byId('probe')
const link = byId('p-link')

/** The element as authored: markup, attributes, and the node objects themselves. */
const snapshot = (el: HTMLElement) => ({
  html: el.innerHTML,
  attrs: Array.from(el.attributes, (a) => `${a.name}=${a.value}`).join(' '),
  nodes: Array.from(el.childNodes),
  all: Array.from(el.querySelectorAll('*')),
})
const authored = { h: snapshot(els.h), p: snapshot(els.p) }

// The listener a revert must keep: the same node, not a copy made from innerHTML.
let clicks = 0
link.addEventListener('click', (event) => {
  event.preventDefault()
  clicks++
})

const probeWidth = () => Math.round(probe.getBoundingClientRect().width * 100) / 100
const height = (el: HTMLElement) => Math.round(el.getBoundingClientRect().height * 100) / 100
const handles: Partial<Record<Id, SplitRevealHandle>> = {}
const lines = (id: Id) => handles[id]?.split?.lines.map((line) => norm(line.textContent)) ?? null
const pieces = (id: Id) => {
  const split = handles[id]?.split
  return split ? ((split.lines.length ? split.lines : split.words) as HTMLElement[]) : []
}

/** Before any font: the twins' lines in the fallback. */
const atStart = { probe: probeWidth(), twin: { h: textLines(twins.h), p: textLines(twins.p) } }

/** What each split saw the moment it happened: the font in use (the probe), its lines and the unsplit twin's. */
interface AtSplit {
  t: number
  probe: number
  fontCheck: boolean
  lines: string[] | null
  twin: string[]
  height: number
  twinHeight: number
}
const atSplit: Partial<Record<Id, AtSplit>> = {}
for (const id of IDS) {
  const observer = new MutationObserver(() => {
    if (atSplit[id] || !handles[id]?.split) return
    observer.disconnect()
    atSplit[id] = {
      t: Math.round(performance.now()),
      probe: probeWidth(),
      fontCheck: document.fonts.check("400 44px 'Late'"),
      lines: lines(id),
      twin: textLines(twins[id]),
      height: height(els[id]),
      twinHeight: height(twins[id]),
    }
  })
  observer.observe(els[id], { childList: true, subtree: true })
}

const create = (id: Id) => {
  handles[id] = splitReveal(els[id])
}
IDS.forEach(create)

function sameDom(id: Id) {
  const was = authored[id]
  const now = snapshot(els[id])
  return {
    html: now.html === was.html,
    attrs: now.attrs === was.attrs,
    nodes: now.nodes.length === was.nodes.length && now.nodes.every((node, i) => node === was.nodes[i]),
    all: now.all.length === was.all.length && now.all.every((node, i) => node === was.all[i]),
    styled: [els[id], ...Array.from(els[id].querySelectorAll('*'))].filter((node) => node.hasAttribute('style')).length,
    attrsNow: now.attrs,
  }
}

const t = {
  eases: EASES,
  ready: () => IDS.every((id) => !!atSplit[id]),
  atStart: () => atStart,
  atSplit: () => atSplit,
  now: (id: Id) => ({
    split: !!handles[id]?.split,
    done: handles[id]?.done ?? null,
    lines: lines(id),
    twin: textLines(twins[id]),
    probe: probeWidth(),
    height: height(els[id]),
    twinHeight: height(twins[id]),
    label: els[id].getAttribute('aria-label'),
  }),
  dom: sameDom,
  /** The first line (or word): where the reveal has it, and its mask. */
  first: (id: Id) => {
    const piece = pieces(id)[0]
    if (!piece) return null
    const style = getComputedStyle(piece)
    return {
      yPercent: Math.round(Number(gsap.getProperty(piece, 'yPercent')) * 100) / 100,
      opacity: style.opacity,
      transform: style.transform,
      mask: piece.parentElement ? getComputedStyle(piece.parentElement).overflow : null,
    }
  },
  /** The entrance: its timeline and tweens, read off the pieces. */
  entrance: (id: Id) => {
    const targets = pieces(id)
    if (!targets.length) return null
    const tweens = gsap.getTweensOf(targets)
    const timeline = tweens[0]?.parent ?? null
    return {
      pieces: targets.length,
      paused: timeline?.paused() ?? null,
      progress: timeline ? Math.round(timeline.progress() * 1000) / 1000 : null,
      duration: timeline ? Math.round(timeline.duration() * 1000) / 1000 : null,
      tweens: tweens.map((tween) => ({
        props: Object.keys(tween.vars).filter((key) => key === 'yPercent' || key === 'opacity'),
        ease: tween.vars.ease,
        // Per piece: a staggered tween's duration() spans every piece.
        duration: tween.vars.duration,
        start: Math.round(tween.startTime() * 1000) / 1000,
        stagger: tween.vars.stagger,
      })),
    }
  },
  /** The trigger's start against the line TRIGGERS.reveal draws: the element's top at 80% of the viewport. */
  trigger: (id: Id) => {
    const trigger = ScrollTrigger.getAll().find((st) => st.trigger === els[id])
    return trigger ? { start: Math.round(trigger.start), line: Math.round(docTop(els[id]) - 0.8 * innerHeight) } : null
  },
  triggers: () => ScrollTrigger.getAll().length,
  scrollTo: (id: Id | 'top', fraction = 0) =>
    window.scrollTo({ top: id === 'top' ? 0 : docTop(els[id]) - fraction * innerHeight, behavior: 'instant' }),
  scrollY: () => Math.round(window.scrollY),
  clicks: () => clicks,
  click: () => link.click(),
  focusedOriginalLink: () => document.activeElement === link,
  active: () => (document.activeElement as HTMLElement | null)?.id || document.activeElement?.tagName || null,
  destroy: (id: Id) => handles[id]?.destroy(),
  create,
  frames,
}

declare global {
  interface Window {
    __t: typeof t
  }
}
window.__t = t
