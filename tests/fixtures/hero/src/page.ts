// The busy hero's content, one source for every page: tests/hero.mjs injects markup(engine) into the static pages,
// and motion-entry.tsx renders the same items as Reveal/RevealItem. The headline is display type (96 px, set in
// fixture.css), the case a JavaScript-driven move without a layer steps through.

export type Effect = 'rise' | 'fade'

export const HEADLINE = 'Every line arrives'

/** The hero's `mount` group on the reveal pages: the headline and lede rise, the call to action fades in place. */
export const ITEMS: { id: string; tag: 'h1' | 'p'; effect: Effect; text: string }[] = [
  { id: 'h-title', tag: 'h1', effect: 'rise', text: HEADLINE },
  { id: 'h-lede', tag: 'p', effect: 'rise', text: 'A hero with a live scene, a blurred nav and a loop strip.' },
  { id: 'h-cta', tag: 'p', effect: 'fade', text: 'Read on' },
]

/**
 * The hero for a static page. css: the server-split headline (split.css animates it, and css-entry.ts tracks it).
 * gsap and agnostic: the mount group. motion renders its own.
 */
export function markup(engine: string, splitHeadline: string): string {
  if (engine === 'css') return `<section class="hero" id="hero">${splitHeadline}<p class="lede">${ITEMS[1].text}</p></section>`
  if (engine === 'motion') return ''
  const items = ITEMS.map(
    (item) => `<${item.tag} data-reveal-item id="${item.id}" data-reveal-effect="${item.effect}">${item.text}</${item.tag}>`,
  ).join('')
  return `<section class="hero" id="hero" data-reveal="mount">${items}</section>`
}
