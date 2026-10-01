/**
 * motion/SplitWords.tsx — an above-the-fold heading or lede whose words rise in from the first frame. It is split on
 * the server and animated by css/split.css alone: no 'use client', no hooks, no JavaScript in the browser (spike S6d).
 *
 *   <SplitWords text="Every line arrives when its reader does" />                     an h1
 *   <SplitWords as="p" className="lede" text={lede} delay={0.3} stagger={0.04} />     seconds
 *   <SplitWords text="吾輩は猫である。名前はまだ無い。" locale="ja" />
 *
 * renders, byte for byte, what splitWordsHTML() in split-words.ts returns for a vanilla page:
 *
 *   <h1 data-split-words>
 *     <span data-split-copy>Every line arrives when its reader does</span>        visually hidden: the name, read once
 *     <span aria-hidden="true"><span data-split-word style="--i:0">Every</span> <span data-split-word style="--i:1">line</span> …</span>
 *   </h1>
 *
 * - LCP-safe (S6d, in Chromium, WebKit and Firefox). The words animate from the first frame with JavaScript off, or
 *   with the bundle 2 s late, and finish before any script runs. Only transform and opacity move, so nothing shifts
 *   (CLS 0). Keep render-blocking scripts out of <head>: a classic <script src> there answered 2 s late held the first
 *   paint, and these animations with it, to 2 s in every engine.
 * - Nothing waits: not the pre-JS gate, not fonts, not hydration. Under reduced motion nothing animates. Import
 *   css/split.css once; the timing and the defaults (no delay, MOTION.lineStagger between words) live there.
 * - The accessible name is the sentence, read once: the copy carries it and the words are aria-hidden. innerText and
 *   copy-paste see the sentence twice, and WebKit drops the space at a line wrap between two words.
 * - Plain strings only. `text` is split by split-words.ts: at whitespace, and at Intl.Segmenter's word boundaries
 *   inside Chinese, Japanese and Thai, in `locale` when given, with punctuation kept on the word before it (S6e).
 *   A link or <em> inside a heading means split-reveal (gsap/split-reveal.ts) below the fold, or text left unsplit.
 * - Render it as a Server Component (or into static HTML with splitWordsHTML). Inside a client component it renders
 *   in the browser too. Latin text comes out the same there, but Firefox 155 segments Chinese, Japanese and Thai
 *   differently from Node (S6e), so hydration would mismatch.
 */
import { Fragment, type CSSProperties } from 'react'

import { splitWordsStyle, wordPieces, wordsText } from '../split-words'

export interface SplitWordsProps {
  text: string
  /** The element. Default 'h1'. */
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'div' | 'span'
  /** The text's language, for Intl.Segmenter. */
  locale?: string
  /** Seconds before the first word moves. */
  delay?: number
  /** Seconds between words. */
  stagger?: number
  className?: string
}

export function SplitWords({ text, as: Tag = 'h1', locale, delay, stagger, className }: SplitWordsProps) {
  const pieces = wordPieces(text, locale)
  return (
    <Tag
      className={className || undefined}
      data-split-words=""
      style={splitWordsStyle(delay, stagger) as CSSProperties | undefined}
    >
      <span data-split-copy="">{wordsText(pieces)}</span>
      <span aria-hidden="true">
        {pieces.map(({ word, space }, i) => (
          <Fragment key={i}>
            <span data-split-word="" style={{ '--i': i } as CSSProperties}>
              {word}
            </span>
            {space || null}
          </Fragment>
        ))}
      </span>
    </Tag>
  )
}
