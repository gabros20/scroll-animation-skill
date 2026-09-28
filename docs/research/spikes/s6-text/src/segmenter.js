// S6e — Intl.Segmenter (granularity 'word') on Japanese, Chinese and Thai, and
// SplitText's words/lines on the same text with and without it.
import gsap from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { norm } from './lib/measure.js'
import { SAMPLES } from './samples.js'

gsap.registerPlugin(SplitText)

const segmentsOf = (lang, text) => {
  const seg = new Intl.Segmenter(lang, { granularity: 'word' })
  return { resolvedLocale: seg.resolvedOptions().locale, segments: [...seg.segment(text)].map((s) => (s.isWordLike ? s.segment : `[${s.segment}]`)) }
}

/** Rendered lines of an element's text, one grapheme at a time. */
function charLines(el) {
  const range = document.createRange()
  const lines = []
  let lastTop = null
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const { segment, index } of graphemes.segment(node.data)) {
      range.setStart(node, index)
      range.setEnd(node, index + segment.length)
      const r = range.getClientRects()[0]
      if (!r) continue
      const top = Math.round(r.top)
      if (lastTop === null || Math.abs(top - lastTop) > 4) {
        lines.push('')
        lastTop = top
      }
      lines[lines.length - 1] += segment
    }
  }
  return lines.map(norm)
}

const col = document.getElementById('col')
const result = { supported: typeof Intl.Segmenter === 'function', samples: {} }
for (const [lang, text] of Object.entries(SAMPLES)) {
  const r = (result.samples[lang] = { text })
  if (result.supported) {
    r.segmenter = segmentsOf(lang, text)
    r.roundTrips = r.segmenter.segments.map((s) => s.replace(/^\[|\]$/g, '')).join('') === text
  }
  const make = (mode) => {
    const p = document.createElement('p')
    p.lang = lang
    p.dataset.split = mode
    p.textContent = text
    col.appendChild(p)
    return p
  }
  const plain = make('none')
  const byDefault = make('default')
  const bySegmenter = make('segmenter')
  const byGlued = make('segmenter-glued')
  r.unsplitLines = charLines(plain)
  const d = SplitText.create(byDefault, { type: 'words,lines' })
  r.default = { words: d.words.length, lines: d.lines.map((l) => norm(l.textContent)), renderedLines: charLines(byDefault) }
  if (result.supported) {
    const seg = new Intl.Segmenter(lang, { granularity: 'word' })
    // every segment its own word
    const each = (t) => [...seg.segment(t)].map((x) => x.segment).join('\u200B')
    // punctuation stays on the word before it (tested with \p{P}, not isWordLike,
    // which Firefox sets to false on some real words)
    const glued = (t) =>
      [...seg.segment(t)]
        .reduce((acc, x) => {
          if (/^\p{P}+$/u.test(x.segment) && acc.length) acc[acc.length - 1] += x.segment
          else acc.push(x.segment)
          return acc
        }, [])
        .join('\u200B')
    const run = (el, prepareText) => {
      const s = SplitText.create(el, { type: 'words,lines', prepareText, wordDelimiter: { delimiter: /\u200B/, replaceWith: '' } })
      const out = {
        words: s.words.length,
        lines: s.lines.map((l) => norm(l.textContent)),
        textPreserved: norm(el.textContent) === norm(text),
        ariaLabelIsText: el.getAttribute('aria-label') === text
      }
      out.matchesUnsplit = JSON.stringify(out.lines) === JSON.stringify(r.unsplitLines)
      out.lineStartsWithPunctuation = out.lines.some((l) => /^[\p{P}]/u.test(l))
      return out
    }
    r.segmenterSplit = run(bySegmenter, each)
    r.segmenterGlued = run(byGlued, glued)
  }
}
window.__s6e = result
