// S7 read-out helper, shared by every page.
//
// [data-probe="id"]      an animated element to read
// [data-subject="id"]    the view-timeline subject whose geometry the spec maths
//                        uses for that probe (defaults to the probe itself)
//
// geometry() is taken at scrollTop 0, before anything is stuck or translated
// by its own animation: the layout box the spec's view-progress maths uses.

const describe = (el) => {
  if (!el || !el.tagName) return el == null ? null : String(el)
  return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '')
}
const num = (v) => {
  if (v == null) return null
  if (typeof v === 'number') return v
  if (typeof v.value === 'number') return v.value // CSSNumericValue (percent or ms)
  return Number(v) || null
}
// Firefox (behind its pref) throws NotSupportedError from some timeline getters.
const get = (fn) => {
  try {
    return fn()
  } catch (e) {
    return `throws ${e.name}`
  }
}
const rangeStr = (r) => (r && typeof r === 'object' ? `${r.rangeName} ${num(r.offset)}` : r)

/** Offset top in document coordinates, ignoring transforms (offsetParent chain). */
function docTop(el) {
  let y = 0
  for (let n = el; n; n = n.offsetParent) y += n.offsetTop
  return y
}

export function geometry() {
  const H = document.documentElement.clientHeight
  const out = { H, scrollMax: document.scrollingElement.scrollHeight - H, subjects: {} }
  for (const el of document.querySelectorAll('[data-probe],[data-subject]')) {
    const g = { T: docTop(el), h: el.offsetHeight, rectTop: el.getBoundingClientRect().top + scrollY }
    if (el.dataset.subject) out.subjects[el.dataset.subject] = g
    if (el.dataset.probe) out.subjects[el.dataset.probe] = g
  }
  return out
}

export function readProbe(el) {
  const cs = getComputedStyle(el)
  return {
    id: el.dataset.probe,
    subject: el.dataset.subjectOf ?? el.dataset.probe,
    top: el.getBoundingClientRect().top,
    anims: el.getAnimations().map((a) => {
      const t = a.timeline
      const timing = a.effect?.getComputedTiming?.() ?? {}
      return {
        name: a.animationName ?? null,
        timeline: t ? t.constructor.name : null,
        source: t && 'source' in t ? get(() => describe(t.source)) : undefined,
        subject: t && 'subject' in t ? get(() => describe(t.subject)) : undefined,
        startOffset: t && 'startOffset' in t ? get(() => num(t.startOffset)) : undefined,
        endOffset: t && 'endOffset' in t ? get(() => num(t.endOffset)) : undefined,
        rangeStart: 'rangeStart' in a ? get(() => rangeStr(a.rangeStart)) : undefined,
        rangeEnd: 'rangeEnd' in a ? get(() => rangeStr(a.rangeEnd)) : undefined,
        playState: a.playState,
        currentTime: get(() => num(a.currentTime)),
        progress: timing.progress ?? null,
        phaseActive: timing.progress != null
      }
    }),
    cs: {
      opacity: Number(cs.opacity),
      marginLeft: parseFloat(cs.marginLeft),
      scale: cs.scale,
      translate: cs.translate,
      transform: cs.transform,
      animationName: cs.animationName,
      animationTimeline: cs.animationTimeline ?? '(unsupported)',
      animationRange: cs.animationRange ?? `${cs.animationRangeStart ?? '(unsupported)'} ${cs.animationRangeEnd ?? ''}`.trim(),
      animationDuration: cs.animationDuration
    }
  }
}

export function read() {
  return {
    scrollTop: document.scrollingElement.scrollTop,
    t: document.timeline.currentTime,
    probes: [...document.querySelectorAll('[data-probe]')].map(readProbe)
  }
}

export function support() {
  return {
    ua: navigator.userAgent,
    viewTimeline: CSS.supports('animation-timeline: view()'),
    scrollTimeline: CSS.supports('animation-timeline: scroll()'),
    timelineScope: CSS.supports('timeline-scope: --a'),
    animationRange: CSS.supports('animation-range: entry 0% exit 100%'),
    ViewTimeline: typeof ViewTimeline,
    ScrollTimeline: typeof ScrollTimeline
  }
}

window.__s7 = { geometry, read, support, readProbe }
