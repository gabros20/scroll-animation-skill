// The header-theme fixture page, described once. The static pages get it as markup (tests/header-theme.mjs injects
// `markup()` at build time) and motion-app.tsx renders it as JSX, so every page has the same geometry: a nested
// section, a section pulled up over the one before it, and unthemed gaps where the default ink applies. Plain
// TypeScript with no imports: Node loads it too.

/** The header's height, and so the probe line (its bottom edge) in viewport px. */
export const HEADER_H = 64
export const DEFAULT_INK = 'paper'

export interface SectionSpec {
  id: string
  /** data-header-theme; none for a gap. */
  theme?: string
  height: number
  /** Pulled up over the section before it by this many px (a negative top margin), painted over it. */
  pullUp?: number
  /** A themed section nested inside this one, `top` px below its top edge. */
  inner?: { id: string; theme: string; top: number; height: number }
}

export const SECTIONS: SectionSpec[] = [
  { id: 'hero', theme: 'night', height: 900 },
  { id: 'gap1', height: 400 },
  { id: 'day', theme: 'day', height: 800 },
  { id: 'brand', theme: 'brand', height: 700 },
  { id: 'outer', theme: 'day', height: 1000, inner: { id: 'inner', theme: 'night', top: 350, height: 300 } },
  { id: 'gap2', height: 300 },
  { id: 'over-a', theme: 'day', height: 600 },
  { id: 'over-b', theme: 'brand', height: 600, pullUp: 200 },
  { id: 'footer', theme: 'night', height: 900 },
  { id: 'tail', height: 1200 },
]

/** Each section's top edge in document px (inner sections included). */
export function tops(): Record<string, number> {
  const out: Record<string, number> = {}
  let y = 0
  for (const s of SECTIONS) {
    y -= s.pullUp ?? 0
    out[s.id] = y
    if (s.inner) out[s.inner.id] = y + s.inner.top
    y += s.height
  }
  return out
}

/** The header an author writes: fixed, the default ink on it, parts painted in currentColor. */
export function headerMarkup(): string {
  return (
    `<header id="header" data-header data-header-ink-default="${DEFAULT_INK}">` +
    '<span class="logo" data-logo>Folio</span><nav><a href="#hero" data-link>Index</a></nav></header>'
  )
}

/** The sections, as attribute markup. */
export function markup(): string {
  return SECTIONS.map((s) => {
    const style = `height:${s.height}px${s.pullUp ? `;margin-top:-${s.pullUp}px` : ''}`
    const theme = s.theme ? ` data-header-theme="${s.theme}"` : ''
    const inner = s.inner
      ? `<div style="height:${s.inner.top}px"></div>` +
        `<div id="${s.inner.id}" class="band t-${s.inner.theme}" data-header-theme="${s.inner.theme}" style="height:${s.inner.height}px"></div>`
      : ''
    return `<section id="${s.id}" class="band${s.theme ? ` t-${s.theme}` : ''}"${theme} style="${style}">${inner}</section>`
  }).join('')
}
