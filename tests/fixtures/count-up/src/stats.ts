// The count-up fixture page, described once. agnostic.html gets it as attribute markup (tests/count-up.mjs injects
// `markup()` at build time) and motion-app.tsx renders it with <CountUp>, so both engines are checked on the same page:
// a stat in view at load, then one per screen, each a different formatting case. Plain TypeScript with no imports:
// Node loads it too.

export interface StatSpec {
  id: string
  /** The final value as the agnostic page's author writes it: the server's text. */
  text: string
  /** The same number for <CountUp to>. */
  to: number
  from?: number
  /** <CountUp format>. */
  format?: { locale?: string; decimals?: number; grouping?: boolean }
  /** data-count-* on the agnostic page's number. */
  attrs?: Record<string, string>
  /** lang on the stat, which the agnostic path takes its locale from. */
  lang?: string
  prefix?: string
  suffix?: string
}

export const STATS: StatSpec[] = [
  // In view at load: it counts as soon as the engine boots.
  { id: 'usd', text: '1,280', to: 1280, prefix: '$', suffix: 'M', attrs: { 'data-count-locale': 'en-US' }, format: { locale: 'en-US' } },
  { id: 'pct', text: '98.6', to: 98.6, suffix: '%' },
  { id: 'eur', text: '12.500,75', to: 12500.75, suffix: ' €', lang: 'de-DE', format: { locale: 'de-DE' } },
  // fr-FR groups with a narrow no-break space (U+202F).
  { id: 'fr', text: '1\u202f280', to: 1280, suffix: ' visiteurs', attrs: { 'data-count-locale': 'fr-FR' }, format: { locale: 'fr-FR' } },
  { id: 'year', text: '2026', to: 2026, from: 1990, attrs: { 'data-count-from': '1990' }, format: { grouping: false } },
  // Frames with one fraction digit, though the text has none: the last frame restores the text.
  { id: 'dec', text: '7', to: 7, suffix: '×', attrs: { 'data-count-decimals': '1' }, format: { decimals: 1 } },
]

/** The attribute markup an author writes for count-up.ts. A reveal item hosts animation.css's failsafe. */
export function markup(): string {
  const stats = STATS.map((s) => {
    const attrs = Object.entries(s.attrs ?? {})
      .map(([k, v]) => ` ${k}="${v}"`)
      .join('')
    const lang = s.lang ? ` lang="${s.lang}"` : ''
    return `<p class="stat" id="${s.id}"${lang}>${s.prefix ?? ''}<span id="n-${s.id}" data-count-up${attrs}>${s.text}</span>${s.suffix ?? ''}</p>`
  })
  return `<main id="page"><h1 data-reveal-item>Numbers</h1>${stats.join('<div class="spacer"></div>')}<div class="tail"></div></main>`
}
