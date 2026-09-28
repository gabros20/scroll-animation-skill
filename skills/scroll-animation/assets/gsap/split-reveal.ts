/**
 * gsap/split-reveal.ts — a heading or paragraph that reveals line by line below the fold: `splitReveal(el, options)`
 * → a handle. GSAP SplitText splits the text into masked lines once its font is in, and the lines rise into place
 * when the element's top crosses the trigger line (spike S6). Above the fold, use SplitWords (motion/SplitWords.tsx),
 * which animates from the first frame. This can't: it waits for its script and its font.
 *
 *   <h2>Every line arrives when its reader does</h2>        a heading, a paragraph, a list item: any block of text
 *
 *   const reveal = splitReveal(el)          // { type, revertAfter, margin, stagger, delay, locale }
 *   reveal.split   reveal.done   reveal.destroy()
 *
 * - Fonts first (S6a). The split waits for document.fonts.load() of every font the text uses. Then it runs
 *   SplitText.create with autoSplit, and onSplit returns the reveal, so a width change re-splits and rebuilds the
 *   reveal where it was. autoSplit alone isn't enough: Safari 26 never fires the `loadingdone` event it waits for, so
 *   a split made before the font keeps the fallback's line breaks. A wrong split cost 11× the font swap's own CLS
 *   (0.297 against 0.0263). Until the font is in, the text shows unsplit, in the fallback.
 * - Accessibility (S6b). A heading with nothing focusable inside keeps SplitText's aria: 'auto': its name is the text
 *   (or your aria-label) and the pieces are aria-hidden. It stays split after the entrance. Anything else gets
 *   aria: 'auto' wrong: a paragraph's aria-label is prohibited, so its text leaves the tree, and so does any link in a
 *   split line, which stays in the Tab order. There, the element's own nodes stay its content, visually hidden, and
 *   the pieces are aria-hidden copies with nothing in them focusable. revertAfter (default true there) puts the
 *   original nodes back when the entrance ends: the same nodes, listeners and attributes. Keyboard focus reaching
 *   the text ends the entrance at once.
 * - Words or lines, never characters: type 'lines,words' (default), 'lines' or 'words', masked by line (by word
 *   without lines). Characters would break running text for screen readers and Arabic and Indic shaping.
 * - The reveal. When the element's top crosses the trigger line (TRIGGERS.reveal, 80% of the viewport), the lines
 *   rise out of their masks on EASES.entrance over MOTION.entrance.duration, MOTION.lineStagger apart, with the short
 *   late fade (MOTION.entranceFade). It plays once. An element above the view at load reveals on the way back up.
 *   A split that lands with the element already past the line plays at once.
 * - Reduced motion is live. The split is built inside gsap.matchMedia(MOTION_CONDITIONS), and under `reduce` nothing
 *   is split. If reduce turns on after a split, the split reverts, and the text counts as shown, so turning reduce
 *   off again splits nothing (as Reveal). The trigger lives outside that build, because GSAP 3.15 throws the reader to
 *   the top when a ScrollTrigger is created or killed during a matchMedia rebuild. For the same reason, call
 *   splitReveal() outside your own gsap.matchMedia callbacks.
 * - CJK and Thai (S6e). SplitText splits words only at spaces. Text in a script written without them gets
 *   Intl.Segmenter boundaries from split-words.ts, in `locale` or the element's `lang`, with punctuation kept on the
 *   word before it. The boundaries reach SplitText through prepareText, with a U+200B wordDelimiter (replaceWith '').
 *   It runs in the browser, and Firefox 155 segments Japanese and Thai differently from Chromium and WebKit: its words
 *   differ there, and no line starts with punctuation.
 * - React (S6c): never let React update text that SplitText has split. A new text leaves the old split on screen,
 *   and React's next structural change throws NotFoundError and unmounts the root, with or without useGSAP's
 *   revertOnUpdate. Key the component that owns the split element by its content, so new text mounts a fresh
 *   element, and split in useGSAP (reverted on unmount). Or let React render the pieces itself, as SplitWords does:
 *
 *     function Title({ text }: { text: string }) {
 *       const ref = useRef<HTMLHeadingElement>(null)
 *       useGSAP(() => {
 *         const reveal = splitReveal(ref.current!)
 *         return () => reveal.destroy()
 *       })
 *       return <h2 ref={ref}>{text}</h2>
 *     }
 *     <Title key={text} text={text} />
 *
 * - Shown stays shown. The entrance plays once per element for the page's life, so hiding and showing a route
 *   (Next's Activity) never replays it. `beforeprint` ends every entrance. destroy() puts the element back exactly
 *   as it was and removes the trigger.
 */
import { SplitText } from 'gsap/SplitText'

import { MOTION, TRIGGERS, failsafeFired } from '../config'
import { WORD_BOUNDARY, isUnspaced, markWordBoundaries } from '../split-words'
import {
  EASES,
  MOTION_CONDITIONS,
  ScrollTrigger,
  gsap,
  lineFromMargin,
  setupGsap,
  type MotionConditions,
} from './setup'

export interface SplitRevealOptions {
  /** What SplitText splits. Default 'lines,words'; the lines rise (the words when there are no lines). */
  type?: 'lines,words' | 'lines' | 'words'
  /**
   * Put the original nodes back once the entrance ends. Default true, except on a heading with nothing focusable
   * inside, which stays split and keeps its name from aria-label.
   */
  revertAfter?: boolean
  /** The trigger line, as an IntersectionObserver rootMargin. Default TRIGGERS.reveal. */
  margin?: string
  /** Seconds between lines. Default MOTION.lineStagger. */
  stagger?: number
  /** Seconds from the trigger to the first line. Default 0. */
  delay?: number
  /** The text's language, for Intl.Segmenter. Default: the closest `lang`. */
  locale?: string
}

export interface SplitRevealHandle {
  readonly el: HTMLElement
  /** The live split: null before the font is in, under reduced motion and once reverted. */
  readonly split: SplitText | null
  /** Shown for good: the entrance ended, or reduced motion, the failsafe, focus or print showed the text. */
  readonly done: boolean
  /** Puts the element back exactly as it was (a triggered entrance counts as shown) and removes the trigger. */
  destroy(): void
}

const HEADING = 'h1, h2, h3, h4, h5, h6, [role="heading"]'
const FOCUSABLE =
  'a[href], area[href], button, input, select, textarea, summary, iframe, audio[controls], video[controls], ' +
  '[tabindex], [contenteditable]:not([contenteditable="false"])'
const VISUALLY_HIDDEN: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: '0',
  border: '0',
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
}

/** Elements whose entrance has played: a new splitReveal on one (a route shown again) leaves it as it is. */
const shown = new WeakSet<Element>()

export function splitReveal(el: HTMLElement, options: SplitRevealOptions = {}): SplitRevealHandle {
  setupGsap({ plugins: [SplitText] })
  const labelled = el.matches(HEADING) && !el.querySelector(FOCUSABLE)
  const revertAfter = options.revertAfter ?? !labelled
  const type = options.type ?? 'lines,words'
  const stagger = options.stagger ?? MOTION.lineStagger
  const delay = options.delay ?? 0
  const locale = options.locale ?? (el.closest('[lang]')?.getAttribute('lang') || undefined)

  const fonts = fontsIn(el)

  let split: SplitText | null = null
  let timeline: gsap.core.Timeline | null = null
  let restore: (() => void) | null = null
  let label = ''
  let arrived = false
  let done = shown.has(el)
  let destroyed = false

  /** Runs on every split, autoSplit's re-splits included; SplitText carries the returned reveal's time across. */
  function onSplit(self: SplitText) {
    if (labelled) el.setAttribute('aria-label', label)
    const pieces = self.lines.length ? self.lines : self.words
    if (done || !pieces.length) {
      // A re-split after the entrance, at rest and unclipped; or nothing to reveal.
      unclip(self)
      if (!done) finish()
      return
    }
    const reveal = gsap.timeline({ paused: !arrived, onComplete: finish })
    reveal.from(pieces, { yPercent: 100, duration: MOTION.entrance.duration, ease: EASES.entrance, stagger }, delay)
    reveal.from(
      pieces,
      { opacity: 0, duration: MOTION.entranceFade.duration, ease: 'none', stagger },
      delay + MOTION.entranceFade.delay,
    )
    timeline = reveal
    return reveal
  }

  /** Splits a copy of the text, the element's own nodes put aside. Runs inside the matchMedia build's context. */
  function build() {
    // Read now, not at creation: the page may have changed the text while the font loaded.
    const nodes = Array.from(el.childNodes)
    const text = el.textContent ?? ''
    label = el.getAttribute('aria-label') ?? text.replace(/\s+/g, ' ').trim()
    const copies = nodes.map((node) => node.cloneNode(true))
    let target = el
    if (labelled) {
      el.replaceChildren(...copies)
    } else {
      const copy = document.createElement('span')
      Object.assign(copy.style, VISUALLY_HIDDEN)
      copy.append(...nodes)
      target = document.createElement('span')
      target.style.display = 'block'
      target.append(...copies)
      // Ids stay, so #id rules style the copies alike; the originals come first, so getElementById finds them.
      target.querySelectorAll(FOCUSABLE).forEach((node) => node.setAttribute('tabindex', '-1'))
      el.replaceChildren(copy, target)
      el.addEventListener('focusin', land)
    }
    restore = () => {
      const focused = document.activeElement
      el.removeEventListener('focusin', land)
      // Reverted by the context already on a matchMedia revert; SplitText puts back the aria it found.
      split?.revert()
      split = null
      timeline = null
      el.replaceChildren(...nodes)
      if (focused instanceof HTMLElement && focused !== document.activeElement && el.contains(focused)) {
        focused.focus({ preventScroll: true })
      }
    }
    split = SplitText.create(target, {
      type,
      mask: type === 'words' ? 'words' : 'lines',
      aria: labelled ? 'auto' : 'hidden',
      autoSplit: true,
      onSplit,
      ...(isUnspaced(text) && {
        prepareText: (part: string) => markWordBoundaries(part, locale),
        wordDelimiter: { delimiter: new RegExp(WORD_BOUNDARY), replaceWith: '' },
      }),
    })
  }

  function unsplit() {
    const put = restore
    restore = null
    put?.()
  }

  /** The entrance ended: the text is shown for good. */
  function finish() {
    if (done) return
    done = true
    shown.add(el)
    // Out of GSAP's render: reverting reverts this very timeline.
    if (revertAfter) queueMicrotask(unsplit)
    else if (split) unclip(split)
  }

  /** Shows the text now: focus reached it, or the page is printing. */
  function land() {
    arrived = true
    if (timeline) timeline.progress(1)
    else finish()
  }

  const mm = gsap.matchMedia()
  mm.add(MOTION_CONDITIONS, (context) => {
    if ((context.conditions as MotionConditions).reduce || failsafeFired()) {
      done = true
      shown.add(el)
    }
    if (done) return
    let live = true
    fonts.then(() => {
      if (live && !done) context.add(build)
    })
    return () => {
      live = false
      unsplit()
      // Triggered means shown.
      if (arrived) {
        done = true
        shown.add(el)
      }
    }
  })

  // Outside the build, for the handle's life (see the header). Killed once it fires: the reveal plays once.
  const trigger = done
    ? null
    : ScrollTrigger.create({
        trigger: el,
        ...lineFromMargin(options.margin ?? TRIGGERS.reveal),
        onEnter: arrive,
        onEnterBack: arrive,
      })
  function arrive(self: ScrollTrigger) {
    self.kill()
    arrived = true
    timeline?.play()
  }

  window.addEventListener('beforeprint', land)

  return {
    el,
    get split() {
      return split
    },
    get done() {
      return done
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      window.removeEventListener('beforeprint', land)
      trigger?.kill()
      mm.revert()
      unsplit()
    },
  }
}

/** A split kept after its entrance: the masks let descenders and accents out, and GSAP's inline values go. */
function unclip(self: SplitText) {
  for (const mask of self.masks as HTMLElement[]) mask.style.overflow = ''
  const pieces = self.lines.length ? self.lines : self.words
  if (pieces.length) gsap.set(pieces, { clearProps: 'transform,opacity' })
}

/**
 * Every font the text is set in, loaded (or failed): SplitText measures lines, so it has to measure the final font.
 * The text goes along so faces split by unicode-range load too.
 */
function fontsIn(el: HTMLElement): Promise<unknown> {
  const set = document.fonts
  if (!set?.load) return Promise.resolve()
  const text = el.textContent ?? ''
  const used = new Set<string>()
  for (const node of [el, ...Array.from(el.querySelectorAll('*'))]) {
    const style = getComputedStyle(node)
    used.add(`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`)
  }
  return Promise.allSettled(Array.from(used, (font) => set.load(font, text || ' ')))
}
