/**
 * plugins/animation-html.ts — what every page's HTML needs from the animation blocks before any script runs, written
 * in at build time (and by the dev server):
 *
 * - `<!--animation-gate-->` in <head> becomes GATE_SCRIPT (src/animation/config.ts), inline, ahead of the stylesheets.
 *   It sets html[data-animation="on"] before first paint and only when JavaScript runs, so the hidden entrance states
 *   never apply to a reader without it. A page without the placeholder fails the build.
 * - `<h1 data-split-words>Plain text</h1>` (h1–h6 or p) becomes splitWordsHTML's markup (src/animation/split-words.ts):
 *   the words are in the served HTML and css/split.css animates them from the first frame, with no JavaScript on the
 *   LCP path (spike S6d). `class`, `data-split-delay` and `data-split-stagger` (seconds) carry over; the page's
 *   <html lang> picks the segmentation for CJK and Thai. Any other attribute, or markup inside, fails the build rather
 *   than being dropped.
 */
import type { Plugin } from 'vite'

import { GATE_SCRIPT } from '../src/animation/config.ts'
import { splitWordsHTML } from '../src/animation/split-words.ts'

const GATE = '<!--animation-gate-->'
/** An h1–h6 or p marked data-split-words, to its closing tag (neither nests in itself). */
const SPLIT = /<(h[1-6]|p)(\s[^>]*\bdata-split-words\b[^>]*)>([\s\S]*?)<\/\1>/g
const ATTRIBUTE = /([^\s=]+)(?:\s*=\s*"([^"]*)")?/g
const CARRIED = new Set(['class', 'data-split-words', 'data-split-delay', 'data-split-stagger'])
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'" }

export function animationHtml(): Plugin {
  return {
    name: 'animation-html',
    transformIndexHtml: {
      order: 'pre',
      handler(html, { path }) {
        if (!html.includes(GATE)) throw new Error(`animation-html: ${path} has no ${GATE} in its <head>`)
        const locale = /<html\b[^>]*\blang="([^"]+)"/.exec(html)?.[1]
        return html
          .replace(GATE, `<script>${GATE_SCRIPT}</script>`)
          .replace(SPLIT, (_, tag: string, attributes: string, text: string) => split(path, tag, attributes, text, locale))
      },
    },
  }
}

function split(path: string, tag: string, attributes: string, text: string, locale?: string): string {
  if (text.includes('<')) throw new Error(`animation-html: <${tag} data-split-words> in ${path} holds markup; it splits plain text only`)
  const read = new Map<string, string>()
  for (const [, name, value = ''] of attributes.matchAll(ATTRIBUTE)) {
    if (!CARRIED.has(name)) {
      throw new Error(`animation-html: <${tag} data-split-words> in ${path} can't carry "${name}" (splitWordsHTML renders class and timing only)`)
    }
    read.set(name, value)
  }
  const seconds = (name: string) => {
    const value = read.get(name)
    return value === undefined ? undefined : Number.parseFloat(value)
  }
  return splitWordsHTML(decode(path, text), {
    as: tag,
    locale,
    className: read.get('class'),
    delay: seconds('data-split-delay'),
    stagger: seconds('data-split-stagger'),
  })
}

function decode(path: string, text: string): string {
  return text.replace(/&([#\w]+);/g, (entity, name: string) => {
    const character = ENTITIES[name.toLowerCase()]
    if (character === undefined) throw new Error(`animation-html: write "${entity}" in ${path} as the character itself`)
    return character
  })
}
