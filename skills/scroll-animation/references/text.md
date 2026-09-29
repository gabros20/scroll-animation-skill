# Split text: words and lines

**Purpose:** Reveal a headline or paragraph word by word or line by line without costing first paint, layout,
screen readers, translation or React: `SplitWords` on the server above the fold, `split-reveal` (GSAP SplitText)
below it.

**Read when:** a headline, lede or paragraph should arrive by word or line; split text flashes, shifts the layout,
reads wrongly in a screen reader, breaks after a re-render, or splits Chinese, Japanese or Thai badly.
**Skip when:** the text rises or fades as one block ([entrances.md](entrances.md)), or it moves with a scroll-driven
scene ([scenes.md](scenes.md)).

**Inputs:** the text, whether it sits above or below the fold, what the route already loads, the text's language.
**Produces:** a `split-words` or `split-reveal` block with the right accessible name, font wait and React key,
checked for layout shift.

## Contents

1. [Which block](#1-which-block)
2. [SplitWords: words split on the server](#2-splitwords-words-split-on-the-server)
3. [split-reveal: lines below the fold](#3-split-reveal-lines-below-the-fold)
4. [Fonts first](#4-fonts-first)
5. [Accessible names](#5-accessible-names)
6. [React](#6-react)
7. [Chinese, Japanese and Thai](#7-chinese-japanese-and-thai)
8. [Words or lines, never characters](#8-words-or-lines-never-characters)
9. [Traps](#traps)

## 1. Which block

| Where the text is | Block | How it plays |
|---|---|---|
| Above the fold: the hero headline, a lede | `split-words`: `SplitWords` (a Server Component) or `splitWordsHTML()` | words in the HTML, CSS keyframes from the first frame, no JavaScript |
| Below the fold, on a GSAP route | `split-reveal`: `splitReveal(el, options)` | GSAP SplitText, at the trigger line, once the font is in |
| Below the fold, on a Motion-only route | `reveal`: one `RevealItem` per authored line ([entrances.md](entrances.md) §3) | the group's trigger |

- `SplitWords` has no trigger: its words start at first paint, so below the fold they finish before anyone scrolls
  there.
- `split-reveal` never goes above the fold: it waits for its script and its font, and the headline there is usually
  the LCP element (the largest thing in the first screen), which must never wait.
- **Splitting at the browser's line breaks needs SplitText.** On a Motion-only route that means adding GSAP: about
  49 kB gzipped for GSAP, ScrollTrigger and SplitText (3.15.0's minified files). A route uses the engine it already
  loads, so this is an exception: record it in `ANIMATION.md` with its cost, and keep one engine per element.
- `SplitWords` takes plain strings. A heading with a link or an `<em>` in it takes `split-reveal` below the fold, or
  stays unsplit above it.

## 2. SplitWords: words split on the server

```tsx
<SplitWords text="Every line arrives when its reader does" />                   // an h1
<SplitWords as="p" className="lede" text={lede} delay={0.3} stagger={0.04} />    // seconds
```

It renders, byte for byte, what `splitWordsHTML(text, options)` from `split-words.ts` returns for a static page:

```html
<h1 data-split-words>
  <span data-split-copy>Every line arrives when its reader does</span>
  <span aria-hidden="true"><span data-split-word style="--i:0">Every</span> <span data-split-word style="--i:1">line</span> …</span>
</h1>
```

- Import `css/split.css` once. Each word rises `--split-distance` (0.4em) over 1.3 s on the entrance curve, with the
  short late fade, starting at `--split-delay` plus `--i` times `--split-stagger` (defaults 0 and 0.067 s).
- **Nothing waits**: not the pre-JS gate, not a font, not hydration. Measured in Chromium, WebKit and Firefox (spike
  S6d: S1–S7 are the skill's own browser measurements, September 2026): with JavaScript off, or the bundle 2 s late,
  the words start in the first frame and finish before any script runs.
- **Keep render-blocking scripts out of `<head>`.** A classic `<script src>` there, answered 2 s late, held the first
  paint and these animations to 2 s in every engine.
- **No layout shift.** Only `transform` and `opacity` move, and the words are inline-block with or without the
  animation, so reduced motion lays out the same. Layout shift measured 0.
- **Reduced motion:** no animation at all; the keyframes sit behind `prefers-reduced-motion: no-preference`. A
  printed page shows every word at rest.
- **Render it on the server**, as a Server Component or into static HTML. Inside a client component it renders in the
  browser too, and Firefox segments Chinese, Japanese and Thai differently from Node (§7), so hydration would mismatch.

## 3. split-reveal: lines below the fold

```ts
const reveal = splitReveal(el, { type: 'lines,words' })   // every option is optional
reveal.split   reveal.done   reveal.destroy()
```

- When the element's top crosses the trigger line (`TRIGGERS.reveal`), the lines (the words, with `type: 'words'`)
  rise out of their masks on the entrance curve over 1.3 s, 0.067 s apart, with the short late fade. It plays once.
  An element above the view at load plays when the reader scrolls back up to it, and a split that lands after the
  element passed the line plays at once.
- Options: `type` (`'lines,words'`, `'lines'` or `'words'`), `revertAfter` (§5), `margin`, `stagger`, `delay` and
  `locale`. SplitText ships in the `gsap` package (free since 3.13), and `splitReveal` registers it.
- **Reduced motion is live.** The split is built inside `gsap.matchMedia(MOTION_CONDITIONS)`: under `reduce` nothing is
  split, and if `reduce` turns on after a split, the split reverts and the text counts as shown.
- **Shown stays shown** for the page's life, so a route shown again (Next's `<Activity>`) never replays it.
  `beforeprint` ends every entrance, and `destroy()` puts the element back exactly as it was.
- Call it outside your own `gsap.matchMedia()` callbacks. Its trigger lives outside the build for the reason
  `reveal`'s does: observed on GSAP 3.15.0, creating or killing a ScrollTrigger during a matchMedia rebuild leaves the
  reader at scroll 0.
- In React, call it inside `useGSAP` in a keyed component (§6). On a vanilla page, call it from the route's
  `mount(routeRoot)` with a selector of your choosing, such as `[data-split-reveal]`.
- GSAP's SplitText docs say to avoid `text-wrap: balance` on text it splits.

## 4. Fonts first

`split-reveal` measures lines, so it has to measure the final font.

- It waits for `document.fonts.load()` of every font the text uses, passing the text itself so faces split by
  `unicode-range` load too. Then it calls `SplitText.create` with `autoSplit: true` and an `onSplit` that returns the
  reveal. GSAP's docs say a returned animation keeps its place across a re-split, so a width change re-splits
  mid-entrance cleanly.
- **Why not `autoSplit` alone.** GSAP's docs say it re-splits when fonts finish loading. Measured on 3.15.0 (spike S6a),
  WebKit 26.6 (Playwright's build) never fired the `loadingdone` event that re-split waits for, so a split made before
  the font kept the fallback font's line breaks until a resize. Firefox re-split a frame late. In Chromium, a split
  made in the wrong font cost 11 times the font swap's own layout shift: 0.297 against 0.0263.
- Until the font is in, the text shows unsplit in the fallback font, for about as long as the font takes.
- `SplitWords` needs no wait: it splits words, not lines, and the browser re-wraps word spans when the font swaps.

## 5. Accessible names

| Text | What a screen reader gets |
|---|---|
| `SplitWords` | the sentence once, from a visually hidden `data-split-copy` span; the words are `aria-hidden` |
| `split-reveal` on a heading with nothing focusable inside | SplitText's `aria: 'auto'`: the heading's `aria-label` (its text, or yours); the pieces are `aria-hidden`. It stays split |
| `split-reveal` on anything else (a paragraph, a list item, a heading with a link) | the element's own nodes, visually hidden, so links keep their listeners and one Tab stop; the visible pieces are an `aria-hidden` copy split with `aria: 'hidden'`, its focusables at `tabindex="-1"` |

- **`aria: 'auto'` on headings only.** GSAP's docs say it labels the split element with its text and hides the pieces,
  and that nested elements such as links lose their meaning. ARIA doesn't allow naming a paragraph or a generic
  element: measured on a paragraph (S6b), a tree that follows the spec read it empty (only Chromium still exposes the
  label), and a link inside a split line left the tree while staying in the Tab order.
- **`aria: 'hidden'` goes on the inner copy, never on the element.** GSAP's docs say it hides the split element and all
  its children: the real text would go too.
- **Revert after the entrance.** `revertAfter` (true by default, except on a labelled heading) puts the original nodes
  back when the entrance ends: the same nodes, listeners and attributes, which is also what reader mode and browser
  translation read. Keyboard focus reaching the text ends the entrance at once.
- **`SplitWords`' copy doubles the text for tools**: `innerText`, copy and paste see the sentence twice, and WebKit
  drops the space where a line wraps between two words. That is the price of splitting with no JavaScript.

## 6. React

Never let React update text that SplitText has split. Measured in all three engines (spike S6c): new text left the old
split on screen, and React's next structural change threw `NotFoundError` and unmounted the whole root. Reverting in
`useGSAP` didn't help, with or without `revertOnUpdate`: GSAP's docs say `revert()` restores the original `innerHTML`,
which builds new nodes and leaves the text node React holds detached.

Key the component that owns the split element by its content, so new text mounts a fresh element, and split inside
`useGSAP`, which reverts on unmount:

```tsx
function Title({ text }: { text: string }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useGSAP(() => {
    const reveal = splitReveal(ref.current!)
    return () => reveal.destroy()
  })
  return <h2 ref={ref}>{text}</h2>
}

<Title key={text} text={text} />
```

Or let React render the pieces itself, as `SplitWords` does.

## 7. Chinese, Japanese and Thai

- SplitText splits words only at spaces (or at your `wordDelimiter`). Measured (S6e): a Japanese or Chinese sentence
  became one "word" and one "line" while it rendered on 2–3 lines.
- `split-words.ts` splits scripts written without spaces (Chinese, Japanese, Thai, Lao, Khmer, Burmese) at
  `Intl.Segmenter` word boundaries, in `locale` when given (`split-reveal` reads the nearest `lang`). A boundary counts
  only where one side is in such a script, so Latin text keeps its whitespace words: a split at a hyphen, a slash or a
  `$` would add line breaks the text doesn't have.
- Punctuation stays on the word before it, and an opening bracket or quote on the word after it. With the segmenter
  alone, a line started with 。 in every engine.
- `split-reveal` passes the boundaries to SplitText through `prepareText` and
  `wordDelimiter: { delimiter: /\u200B/, replaceWith: '' }`, so no zero-width space stays in the page.
- **Segment on the server.** Node segments exactly like Chromium and WebKit; Firefox 155 segmented all three test
  sentences differently. `split-reveal` has to run in the browser, so its words differ in Firefox, though no line
  starts with punctuation there either.

## 8. Words or lines, never characters

- **Lines** for paragraphs and multi-line headings below the fold: the text arrives the way it is read. **Words** for
  a short display line, above the fold (`SplitWords`) or where lines don't matter (`type: 'words'`).
- **Never characters.** Splitting into characters breaks letter joining and shaping in Arabic and Indic scripts, loses
  the font's kerning (GSAP's docs say so), and reads as a gimmick on running text. `split-reveal` has no character
  mode, and nothing splits Arabic or Indic text below the word.
- **Scale the stagger to the count.** Twenty words at 0.067 s spend 1.3 s just starting: give a lede 0.03–0.04 s, or
  reveal it by line ([craft.md](craft.md) §5).
- Keep one vocabulary: words and lines rise and fade on the entrance curve, like every other entrance.

## Traps

- [ ] Above the fold, `SplitWords`, rendered on the server; nothing split there waits for a script or a font.
- [ ] No render-blocking `<script src>` in `<head>` ahead of a `SplitWords` headline.
- [ ] Below the fold, `split-reveal` splits after `document.fonts.load()`, never on `autoSplit` alone.
- [ ] `aria: 'auto'` only on a heading with nothing focusable inside; `aria: 'hidden'` never on the element itself.
- [ ] Split running text is reverted after its entrance: the original nodes, never an `innerHTML` copy.
- [ ] React never updates split text: the component that owns it is keyed by its content.
- [ ] Chinese, Japanese and Thai go through `Intl.Segmenter`, on the server wherever the markup is rendered there.
- [ ] No character splits, and nothing below the word in Arabic or Indic scripts.
