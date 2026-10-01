// The texts and the split-reveal page markup, shared by the fixture pages (through Vite) and tests/text.mjs (through
// tests/unit/load-ts.mjs), so every check reads the same words the page shows.

/** SplitWords' hero and lede: spike S6d's sentences. */
export const HERO = 'Every line arrives when its reader does'
export const LEDE = 'Server-split words start moving with the first paint, before a single script has run.'

/** Spike S6e's samples: Japanese (Natsume Soseki, "I Am a Cat", 1905, public domain), Chinese and Thai. */
export const SAMPLES = {
  ja: '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。',
  zh: '我们在春天的早晨出发，沿着河边慢慢地走到城市的另一头。',
  th: 'ภาษาไทยเขียนติดกันโดยไม่เว้นวรรคระหว่างคำ แต่จะเว้นวรรคเมื่อจบประโยค',
} as const

export type Lang = keyof typeof SAMPLES

/** split-reveal's heading and paragraph, set in the late web font. */
export const HEADING =
  'Scroll-driven stories reward patience: every line arrives exactly when its reader does, and not a moment before.'
export const LINK = 'screen readers'
const PARAGRAPH = (link: string) =>
  `Split text still needs a name that ${link} can read, and <em>emphasis</em> that survives the split, whichever ` +
  'font the page finally lands in.'

/**
 * reveal.html's body. Each split element sits in a box with an invisible, inert, unsplit twin set in the same font:
 * the twin's line breaks are what the split's must be. #p-ref is the paragraph as it reads unsplit, for the
 * accessibility tree; #probe shows which font is in.
 */
export function revealMarkup(): string {
  return `
    <main>
      <section class="intro">
        <h1>Above the fold</h1>
        <p>The split text waits below the fold, in a web font the preview server sends late.</p>
      </section>
      <div class="pair">
        <h2 id="h" class="late display">${HEADING}</h2>
        <div id="h-twin" class="late display twin" aria-hidden="true" inert>${HEADING}</div>
      </div>
      <p class="nav"><a href="#before" id="before-p">Before the paragraph</a></p>
      <div class="pair">
        <p id="p" class="late copy">${PARAGRAPH(`<a href="#notes" id="p-link">${LINK}</a>`)}</p>
        <div id="p-twin" class="late copy twin" aria-hidden="true" inert>${PARAGRAPH(`<a>${LINK}</a>`)}</div>
      </div>
      <p class="nav"><a href="#after" id="after-p">After the paragraph</a></p>
      <section class="outro"></section>
      <p id="p-ref" class="late copy">${PARAGRAPH(`<a href="#notes">${LINK}</a>`)}</p>
    </main>
    <span id="probe" class="late probe" aria-hidden="true">mmmmmmmmmmiiiiiiiiii</span>`
}

/** reveal-cjk.html's body: each sample split by split-reveal below the fold, in a 320 px column. */
export function revealCjkMarkup(): string {
  const samples = Object.entries(SAMPLES)
    .map(([lang, text]) => `<p lang="${lang}" data-sample="${lang}">${text}</p>`)
    .join('\n      ')
  return `
    <main class="narrow">
      <section class="intro"><h1>Above the fold</h1></section>
      ${samples}
      <section class="outro"></section>
    </main>`
}
