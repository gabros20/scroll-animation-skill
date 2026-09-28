/**
 * split-words.ts — words for text that animates word by word, with no animation library: the segmentation both text
 * blocks share, and the server-split markup that motion/SplitWords.tsx renders and css/split.css animates.
 *
 *   splitWords('Every line arrives')                  → ['Every', 'line', 'arrives']
 *   splitWords('名前はまだ無い。', 'ja')                  → ['名前', 'は', 'まだ', '無い。']
 *   splitWordsHTML(text, { as, locale, delay, stagger, className })   the markup below, for vanilla and templated pages
 *   markWordBoundaries(text, locale)                  U+200B at every boundary, for SplitText's prepareText
 *
 *   <h1 data-split-words style="--split-delay:0.2s;--split-stagger:0.05s">   both optional, in seconds
 *     <span data-split-copy>Every line arrives</span>                       the full sentence: the accessible name
 *     <span aria-hidden="true"><span data-split-word style="--i:0">Every</span> <span data-split-word style="--i:1">line</span> …</span>
 *   </h1>
 *
 * - Words split at breaking whitespace (a no-break space stays inside its word), and one space is kept between them.
 * - Scripts written without spaces (Chinese, Japanese, Thai, Lao, Khmer, Burmese) split at Intl.Segmenter's word
 *   boundaries, in `locale` when one is given (spike S6e). Split at spaces only, SplitText makes a whole Japanese or
 *   Chinese sentence one "word" that renders on 2–3 lines. A boundary counts only where one side is in such a
 *   script. Latin text keeps its whitespace words: an extra split at a hyphen, a slash or `$` would add line breaks
 *   ($|100) the unsplit text doesn't have.
 * - Punctuation (\p{P}) stays on the word before it, and an opening bracket or quote on the word after it. With the
 *   segmenter alone, a line started with 。 in every engine (S6e).
 * - Segment on the server. Node (ICU 78) segments exactly like Chromium and WebKit, and Firefox 155 segments all
 *   three S6e samples differently.
 * - splitWordsHTML returns byte for byte what motion/SplitWords.tsx server-renders (tests/text.mjs compares them).
 */

/** One word, and what follows it: ' ' where the text had whitespace, '' between segmented words and after the last. */
export interface WordPiece {
  word: string
  space: '' | ' '
}

export interface SplitWordsOptions {
  /** The element. Default 'h1'. */
  as?: string
  /** The text's language, for Intl.Segmenter. */
  locale?: string
  /** Seconds before the first word moves. Default 0 (css/split.css). */
  delay?: number
  /** Seconds between words. Default MOTION.lineStagger (css/split.css). */
  stagger?: number
  className?: string
}

/** SplitText's word delimiter when the boundaries come from markWordBoundaries. */
export const WORD_BOUNDARY = '​'

/** Breaking whitespace. No-break, narrow no-break and figure spaces are left inside their word. */
const SPACES = /[\t\n\f\r   -  -  　]+/
const SPACE_RUNS = /([\t\n\f\r   -  -  　]+)/
/** Scripts written without spaces between words. Extensions, so CJK punctuation and the long-vowel mark ー count. */
const UNSPACED = /[\p{scx=Hani}\p{scx=Hira}\p{scx=Kana}\p{scx=Thai}\p{scx=Laoo}\p{scx=Khmr}\p{scx=Mymr}]/u
const UNSPACED_START = /^[\p{scx=Hani}\p{scx=Hira}\p{scx=Kana}\p{scx=Thai}\p{scx=Laoo}\p{scx=Khmr}\p{scx=Mymr}]/u
const UNSPACED_END = /[\p{scx=Hani}\p{scx=Hira}\p{scx=Kana}\p{scx=Thai}\p{scx=Laoo}\p{scx=Khmr}\p{scx=Mymr}]$/u
const PUNCTUATION = /^\p{P}+$/u
/** Opening brackets and quotes: they belong to the word after them. */
const OPENING = /^[\p{Ps}\p{Pi}]+$/u

/** The words of `text`, in order, punctuation included. */
export function splitWords(text: string, locale?: string): string[] {
  return wordPieces(text, locale).map((piece) => piece.word)
}

/** The words of `text` with the whitespace that follows each: what the markup renders. */
export function wordPieces(text: string, locale?: string): WordPiece[] {
  const pieces: WordPiece[] = []
  for (const chunk of text.split(SPACES)) {
    if (!chunk) continue
    if (pieces.length) pieces[pieces.length - 1].space = ' '
    for (const word of chunkWords(chunk, locale)) pieces.push({ word, space: '' })
  }
  return pieces
}

/** The text the pieces spell, whitespace collapsed: the visually hidden copy. */
export function wordsText(pieces: readonly WordPiece[]): string {
  return pieces.map((piece) => piece.word + piece.space).join('')
}

/** True when `text` holds a script written without spaces: SplitText needs segmenter boundaries for it. */
export function isUnspaced(text: string): boolean {
  return UNSPACED.test(text)
}

/**
 * `text` with WORD_BOUNDARY between every two words and around every whitespace run, which stays as it was: SplitText's
 * `prepareText`, with `wordDelimiter: { delimiter: /​/, replaceWith: '' }` (S6e).
 */
export function markWordBoundaries(text: string, locale?: string): string {
  const parts: string[] = []
  for (const part of text.split(SPACE_RUNS)) {
    if (!part) continue
    if (SPACES.test(part)) parts.push(part)
    else parts.push(...chunkWords(part, locale))
  }
  return parts.join(WORD_BOUNDARY)
}

/** The root element's custom properties: only what was given, so css/split.css keeps its defaults. */
export function splitWordsStyle(delay?: number, stagger?: number): Record<string, string> | undefined {
  const style: Record<string, string> = {}
  if (delay !== undefined) style['--split-delay'] = `${delay}s`
  if (stagger !== undefined) style['--split-stagger'] = `${stagger}s`
  return Object.keys(style).length ? style : undefined
}

/** The markup motion/SplitWords.tsx renders, as a string, escaped as React escapes it. */
export function splitWordsHTML(text: string, options: SplitWordsOptions = {}): string {
  const { as = 'h1', locale, delay, stagger, className } = options
  if (!/^[a-z][a-z0-9-]*$/i.test(as)) throw new Error(`splitWordsHTML: "${as}" is not an element name`)
  const pieces = wordPieces(text, locale)
  const style = splitWordsStyle(delay, stagger)
  const attributes =
    (className ? ` class="${escapeHtml(className)}"` : '') +
    ' data-split-words=""' +
    (style ? ` style="${escapeHtml(Object.entries(style).map(([name, value]) => `${name}:${value}`).join(';'))}"` : '')
  const words = pieces
    .map(({ word, space }, i) => `<span data-split-word="" style="--i:${i}">${escapeHtml(word)}</span>${space}`)
    .join('')
  return (
    `<${as}${attributes}><span data-split-copy="">${escapeHtml(wordsText(pieces))}</span>` +
    `<span aria-hidden="true">${words}</span></${as}>`
  )
}

/** A run of text with no breaking whitespace, split at segmenter boundaries where a side is in an unspaced script. */
function chunkWords(chunk: string, locale?: string): string[] {
  const segmenter = UNSPACED.test(chunk) ? segmenterFor(locale) : null
  if (!segmenter) return [chunk]
  const words: string[] = []
  let open = ''
  for (const { segment } of segmenter.segment(chunk)) {
    if (OPENING.test(segment)) {
      open += segment
      continue
    }
    const piece = open + segment
    const last = words.length - 1
    const glue = piece === segment && PUNCTUATION.test(segment)
    if (last >= 0 && (glue || !(UNSPACED_END.test(words[last]) || UNSPACED_START.test(piece)))) words[last] += piece
    else words.push(piece)
    open = ''
  }
  if (open) {
    if (words.length) words[words.length - 1] += open
    else words.push(open)
  }
  return words
}

const segmenters = new Map<string, Intl.Segmenter | null>()

/** One segmenter per locale; an invalid tag falls back to the default locale, no Intl.Segmenter to spaces only. */
function segmenterFor(locale?: string): Intl.Segmenter | null {
  const key = locale ?? ''
  let segmenter = segmenters.get(key)
  if (segmenter === undefined) {
    try {
      segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(locale, { granularity: 'word' }) : null
    } catch {
      segmenter = locale ? segmenterFor() : null
    }
    segmenters.set(key, segmenter)
  }
  return segmenter
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c])
}
