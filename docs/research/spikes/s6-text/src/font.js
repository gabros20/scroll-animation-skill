// S6a — SplitText 3.15 (autoSplit, onSplit, mask: 'lines') on a heading whose
// web font arrives late. See pages/font.html for the modes.
import gsap from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { clsOf, firstContentfulPaint, frameSampler, norm, now, observeShifts, textLines } from './lib/measure.js'

gsap.registerPlugin(SplitText)
const mode = new URLSearchParams(location.search).get('mode') ?? 'auto'
const h1 = document.getElementById('title')
const twin = document.getElementById('twin')
const below = document.getElementById('below')

const shifts = observeShifts()
const lateFace = () => [...document.fonts].find((f) => f.family.replace(/["']/g, '') === 'Late')
const fontStatus = () => lateFace()?.status ?? 'none'
const log = { mode, scriptAt: now(), splits: [], fontEvents: [], readyAt: null }

for (const type of ['loading', 'loadingdone', 'loadingerror']) {
  document.fonts.addEventListener(type, (e) => log.fontEvents.push({ type, t: now(), faces: e.fontfaces?.map((f) => f.family) ?? [] }))
}
lateFace()?.loaded.then(() => log.fontEvents.push({ type: 'Late loaded', t: now() }), () => log.fontEvents.push({ type: 'Late failed', t: now() }))

let split = null
const lineTexts = () => (split?.isSplit ? split.lines.map((l) => norm(l.textContent)) : textLines(h1))

const sampler = frameSampler(() => ({
  belowTop: Math.round(below.getBoundingClientRect().top * 100) / 100,
  h1Height: h1.offsetHeight,
  lines: split?.isSplit ? split.lines.length : null,
  font: fontStatus(),
  set: document.fonts.status,
  // the reveal's progress on the first line: 100 at the start, 0 when done
  line0: split?.isSplit && split.lines[0] ? Math.round(gsap.getProperty(split.lines[0], 'yPercent')) : null
}))

function doSplit(autoSplit) {
  return SplitText.create(h1, {
    type: 'lines,words',
    mask: 'lines',
    linesClass: 'line',
    wordsClass: 'word',
    autoSplit,
    onSplit(self) {
      log.splits.push({ t: now(), font: fontStatus(), lines: self.lines.map((l) => norm(l.textContent)), h1Height: h1.offsetHeight })
      // long and linear so the font lands mid-reveal and the first line's
      // yPercent shows whether a re-split restarts it
      return gsap.from(self.lines, { yPercent: 100, duration: 2, stagger: 0.1, ease: 'none' })
    }
  })
}

if (mode === 'auto') split = doSplit(true)
else if (mode === 'noauto') split = doSplit(false)
else if (mode === 'ready' || mode === 'ready-auto') {
  document.fonts.ready.then(() => {
    log.readyAt = now()
    log.fontAtReady = fontStatus()
    split = doSplit(mode === 'ready-auto')
  })
} else if (mode === 'load-auto') {
  const go = () => {
    log.readyAt = now()
    log.fontAtReady = fontStatus()
    split = doSplit(true)
  }
  document.fonts.load("400 56px 'Late'").then(go, go)
}

window.__s6a = {
  log,
  /** Everything the runner needs, read once the page has settled. */
  final() {
    const twinLines = textLines(twin)
    const shown = lineTexts()
    const lineBoxes = split?.isSplit ? split.lines.map((l) => l.getBoundingClientRect().height) : []
    return {
      fcp: firstContentfulPaint(),
      font: fontStatus(),
      splitCount: log.splits.length,
      twinLines,
      shownLines: shown,
      linesMatchUnsplit: JSON.stringify(twinLines) === JSON.stringify(shown),
      // a split line taller than one line box means its words re-wrapped inside it
      tallestLineBox: lineBoxes.length ? Math.max(...lineBoxes) : null,
      lineHeightPx: parseFloat(getComputedStyle(h1).lineHeight),
      maskOverflow: split?.masks?.[0] ? getComputedStyle(split.masks[0]).overflow : null,
      h1Height: h1.offsetHeight,
      twinHeight: twin.offsetHeight,
      ariaLabel: h1.getAttribute('aria-label')
    }
  },
  /** First-line yPercent in the frames around each split after the first: does the reveal restart? */
  revealAcrossResplits() {
    return log.splits.slice(1).map((s) => ({
      splitAt: s.t,
      frames: sampler.rows.filter((r) => r.t >= s.t - 40 && r.t <= s.t + 60).map((r) => [r.t, r.line0])
    }))
  },
  /** FontFaceSet events recorded from the first line of <head>, and the face's status over time. */
  fontTrace() {
    const statuses = []
    for (const r of sampler.rows) if (!statuses.length || statuses.at(-1).font !== r.font || statuses.at(-1).set !== r.set) statuses.push({ t: r.t, font: r.font, set: r.set })
    return { setEvents: window.__fontEvents ?? null, statuses }
  },
  shifts() {
    const rows = sampler.rows
    const moves = []
    for (let i = 1; i < rows.length; i++) {
      const d = rows[i].belowTop - rows[i - 1].belowTop
      if (Math.abs(d) > 0.5) moves.push({ t: rows[i].t, px: Math.round(d * 10) / 10, h1Height: rows[i].h1Height, lines: rows[i].lines, font: rows[i].font })
    }
    return { layoutShift: shifts.supported ? { cls: clsOf(shifts), entries: shifts.entries } : 'unsupported', belowMoves: moves, frames: rows.length }
  }
}
