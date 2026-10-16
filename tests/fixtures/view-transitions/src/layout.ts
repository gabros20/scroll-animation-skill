// The view-transitions fixture's two views, shared by every page: an index whose card cover (240 × 180, 4:3) is the
// shared element of the article's hero (960 × 540, 16:9). The views live in <main id="page">, named `page` with both
// directional classes; the fixed 64 px header is the block's [data-header]. Tall enough to scroll 4000 px.

export const HEADER_H = 64
export const COVER = { index: { width: 240, height: 180 }, article: { width: 960, height: 540 } }

const filler = (n: number) =>
  `<div class="filler">${Array.from({ length: n }, (_, i) => `<p>Paragraph ${i + 1}</p>`).join('')}</div>`

export function headerMarkup(): string {
  return `<header data-header data-header-ink="day"><a href="#">Folio</a><button id="menu" type="button">Menu</button></header>`
}

export function indexView(): string {
  return (
    `<section class="index" data-view="index"><h1>Index</h1>` +
    `<a class="card" href="#kiln"><div class="cover" style="view-transition-name: cover; view-transition-class: vt-morph"></div></a>` +
    `${filler(40)}</section>`
  )
}

export function articleView(): string {
  return (
    `<article class="article" data-view="article">` +
    `<div class="cover" style="view-transition-name: cover; view-transition-class: vt-morph"></div>` +
    `<h1>The Kiln That Never Went Cold</h1>${filler(40)}</article>`
  )
}

/** The <main> both views render into: named, so the directional slides apply to it. */
export const MAIN_STYLE = 'view-transition-name: page; view-transition-class: vt-forward vt-back'
