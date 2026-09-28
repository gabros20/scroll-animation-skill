// The fixture page, described once: gsap.html and agnostic.html get it as static attribute markup (tests/reveal.mjs
// injects `markup()` at build time), motion-app.tsx renders it with Reveal/RevealItem, so the three engines are
// checked on identical geometry. Each group is one row, so every item in it crosses the line at the same moment,
// whether the engine triggers per group (Motion) or per item (GSAP's batch, the engine-free observer). Plain
// TypeScript with no imports: Node loads it too.

export type Effect = 'rise' | 'fade' | 'clip' | 'scale-in'

export interface ItemSpec {
  id: string
  effect: Effect
  tag: 'h1' | 'p' | 'div'
}

export interface GroupSpec {
  id: string
  tag: 'header' | 'section'
  trigger: 'mount' | 'view'
  replay?: boolean
  /** A rootMargin other than TRIGGERS.reveal. */
  margin?: string
  items: ItemSpec[]
}

export const GROUPS: GroupSpec[] = [
  {
    id: 'g-mount',
    tag: 'header',
    trigger: 'mount',
    items: [
      { id: 'mount-rise', effect: 'rise', tag: 'h1' },
      { id: 'mount-fade', effect: 'fade', tag: 'p' },
    ],
  },
  {
    id: 'g-view',
    tag: 'section',
    trigger: 'view',
    items: [
      { id: 'view-rise', effect: 'rise', tag: 'div' },
      { id: 'view-fade', effect: 'fade', tag: 'div' },
      { id: 'view-clip', effect: 'clip', tag: 'div' },
      { id: 'view-scale', effect: 'scale-in', tag: 'div' },
    ],
  },
  {
    id: 'g-replay',
    tag: 'section',
    trigger: 'view',
    replay: true,
    items: [
      { id: 'replay-rise', effect: 'rise', tag: 'div' },
      { id: 'replay-clip', effect: 'clip', tag: 'div' },
    ],
  },
  {
    // TRIGGERS.pageEnd: the last group fires as soon as it enters the viewport.
    id: 'g-edge',
    tag: 'section',
    trigger: 'view',
    margin: '0px',
    items: [{ id: 'edge-rise', effect: 'rise', tag: 'div' }],
  },
]

/** The attribute markup an author writes for gsap/reveal.ts or reveal.ts. `rise` is left implicit: the default. */
export function markup(): string {
  const groups = GROUPS.map((group, i) => {
    const attrs = [
      `id="${group.id}"`,
      `class="row${i === 0 ? ' first' : ''}"`,
      `data-reveal="${group.trigger}"`,
      group.replay ? 'data-reveal-replay' : '',
      group.margin ? `data-reveal-margin="${group.margin}"` : '',
    ].filter(Boolean)
    const items = group.items.map((item) => {
      const effect = item.effect === 'rise' ? '' : ` data-reveal-effect="${item.effect}"`
      return `<${item.tag} id="${item.id}" data-reveal-item${effect}>${item.id}</${item.tag}>`
    })
    return `<${group.tag} ${attrs.join(' ')}>${items.join('')}</${group.tag}>`
  })
  return `<main id="page">${groups.join('<div class="spacer"></div>')}<div class="tail"></div></main>`
}
