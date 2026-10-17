// The scrolly-steps fixture page, described once. The static pages get it as markup (tests/scrolly-steps.mjs injects
// `markup()` at build time) and motion-app.tsx renders it with motion/ScrollySteps.tsx, so every page has the same
// geometry: a fixed 64 px header, an intro taller than the viewport, then the scrolly section at the very end of the
// page (so the last step reaches the line only through the block's tail). Six steps and five states: steps 2 and 3
// both show state "2", so a step can name its state. Every step has a link (the keyboard checks) and an inline figure
// (stacked mode). Plain TypeScript with no imports: Node loads it too.

export const HEADER_H = 64
export const INTRO_H = 1200
/** Each step's height in sticky mode (min-height; stacked steps grow by their inline figure). */
export const STEP_H = 360

export interface StepSpec {
  /** data-scrolly-show; undefined: the step's own index. */
  show?: string
}

export const STEPS: StepSpec[] = [{}, {}, {}, { show: '2' }, { show: '3' }, { show: '4' }]
export const STATES = ['0', '1', '2', '3', '4']

/** The state a step shows. */
export const shows = (i: number) => STEPS[i]?.show ?? String(i)

export function headerMarkup(): string {
  return '<header id="header" data-header><span class="logo">Folio</span><nav><a href="#intro">Index</a></nav></header>'
}

/** The page under the header, as attribute markup. */
export function markup(): string {
  const states = STATES.map(
    (v) => `<figure data-scrolly-state="${v}" id="state-${v}"><div class="art">State ${v}</div><figcaption>Caption ${v}</figcaption></figure>`,
  ).join('')
  const steps = STEPS.map(
    (s, i) =>
      `<li data-scrolly-step id="step-${i}"${s.show ? ` data-scrolly-show="${s.show}"` : ''}>` +
      `<h3>Step ${i}</h3><p>Step ${i} tells part of the story.</p><a href="#step-${i}" id="link-${i}">Link ${i}</a>` +
      `<figure data-scrolly-inline id="inline-${i}"><div class="art">Inline ${i}</div></figure></li>`,
  ).join('')
  return (
    `<section id="intro" class="intro"><h1>Intro</h1><a href="#scrolly" id="intro-link">Skip to the story</a></section>` +
    `<section id="scrolly" data-scrolly><div data-scrolly-graphic id="graphic">${states}</div>` +
    `<ol data-scrolly-steps id="steps">${steps}</ol></section>`
  )
}
