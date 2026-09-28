// Page-side helpers shared by the S6 fixtures.

export const now = () => Math.round(performance.now() * 10) / 10

const describe = (n) => {
  if (!n || !n.tagName) return n ? n.nodeName : null
  return n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/).join('.') : '')
}

/**
 * Layout Instability API entries (Chromium only; the other engines don't list
 * 'layout-shift' in PerformanceObserver.supportedEntryTypes). Buffered, so it
 * also sees shifts from before it was created.
 */
export function observeShifts() {
  const out = { supported: PerformanceObserver.supportedEntryTypes?.includes('layout-shift') ?? false, entries: [] }
  if (!out.supported) return out
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      out.entries.push({
        t: Math.round(e.startTime),
        value: Math.round(e.value * 100000) / 100000,
        hadRecentInput: e.hadRecentInput,
        sources: (e.sources ?? []).map((s) => ({ node: describe(s.node), from: Math.round(s.previousRect.y), to: Math.round(s.currentRect.y), h: [Math.round(s.previousRect.height), Math.round(s.currentRect.height)] }))
      })
    }
  }).observe({ type: 'layout-shift', buffered: true })
  return out
}
export const clsOf = (shifts) => Math.round(shifts.entries.filter((e) => !e.hadRecentInput).reduce((a, e) => a + e.value, 0) * 100000) / 100000

export function firstContentfulPaint() {
  const e = performance.getEntriesByName('first-contentful-paint')[0]
  return e ? Math.round(e.startTime) : null
}

/** Words of `el`'s text grouped into rendered lines (Range rects per word). */
export function textLines(el) {
  const range = document.createRange()
  const lines = []
  let lastTop = null
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const re = /\S+/g
    for (let m = re.exec(node.data); m; m = re.exec(node.data)) {
      range.setStart(node, m.index)
      range.setEnd(node, m.index + m[0].length)
      const r = range.getClientRects()[0]
      if (!r) continue
      const top = Math.round(r.top)
      if (lastTop === null || Math.abs(top - lastTop) > 2) {
        lines.push([])
        lastTop = top
      }
      lines[lines.length - 1].push(m[0])
    }
  }
  return lines.map((l) => l.join(' '))
}

export const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()

/** Records `sample()` once per rendered frame until stop(). */
export function frameSampler(sample) {
  const rows = []
  let on = true
  const tick = (t) => {
    if (!on) return
    rows.push({ t: Math.round(t), ...sample() })
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  return {
    rows,
    stop() {
      on = false
      return rows
    }
  }
}
