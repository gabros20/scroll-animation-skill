/**
 * image-ink.ts: the header's ink over images, read from the images' own pixels. header-theme.ts takes its ink from
 * the themed element under its probe line; an image has no theme of its own, so a header over a dark photograph keeps
 * its dark ink. This marks each image's strips dark or light for it: one draw of the image into a tiny canvas once it
 * has decoded, and invisible strips over the image that carry data-header-theme. Nothing runs while the page scrolls.
 *
 *   <figure data-image-ink>                                  the image's container: the strips go inside it
 *     <img src="/cover.jpg" alt="…">                          same origin, or CORS with crossorigin="anonymous"
 *   </figure>
 *
 *   const stop = mountImageInk(routeRoot)                   after mountHeaderTheme / useHeaderTheme; stop() on teardown
 *   useEffect(() => inkImage(figure.current!), [])          one container, from React
 *
 * - The tokens are the page's own: `dark` (default 'dark') where light ink reads better on the pixels, `light`
 *   (default 'light') where dark ink does. Map them to colours in CSS as for sections.
 * - The image is split into `rows` (default 8) horizontal strips. Each strip's mean colour picks the token whose ink
 *   contrasts more with it (WCAG contrast of white against black), so an image dark at the top and light at the bottom
 *   flips the header as it passes. Neighbouring strips with one token merge into one element.
 * - It samples what shows: under object-fit: cover only the visible crop (object-position centred).
 * - Only an image about as wide as the header sets its ink: one narrower than `cover` (default 0.75) of the viewport's
 *   width leaves the header over the page around it, since the header's logo and links would sit on that page, not on
 *   the image. It is checked again on resize, so a column image that goes full-bleed on a phone takes over there.
 * - An image that can't be read (cross-origin without CORS: the canvas is tainted) gets no strips, and the section's
 *   token applies; it warns once. Mark such an image by hand: data-header-theme on its container.
 * - A lazy image is read when it loads, and read again if it loads a new source (srcset). The strips follow the image's
 *   box through layout changes (a ResizeObserver) and ride along with its transforms, since they sit inside its
 *   container.
 * - Header ink by hand is simpler still, and free: data-header-theme="dark" on the image's container. Use this where
 *   images come from an editor and nobody sets that.
 * - stop() removes the strips and every listener and observer, and restores the container's position.
 */

export interface ImageInkOptions {
  /** Which containers: a selector under the root. Default '[data-image-ink]'. */
  selector?: string
  /** The token where light ink reads better. Default 'dark'. */
  dark?: string
  /** The token where dark ink reads better. Default 'light'. */
  light?: string
  /** Horizontal strips per image. Default 8. */
  rows?: number
  /** The share of the viewport's width an image must span to set the header's ink. Default 0.75. */
  cover?: number
}

const THEME = 'data-header-theme'
const STRIPS = 'data-image-ink-strips'
const SAMPLE_WIDTH = 16

let warned = false

export function mountImageInk(root: ParentNode, options: ImageInkOptions = {}): () => void {
  const stops = Array.from(root.querySelectorAll<HTMLElement>(options.selector ?? '[data-image-ink]'), (container) =>
    inkImage(container, options),
  )
  return () => stops.forEach((stop) => stop())
}

/** One container's image: the strips, and the stop that removes them. */
export function inkImage(container: HTMLElement, options: ImageInkOptions = {}): () => void {
  const o = {
    dark: options.dark ?? 'dark',
    light: options.light ?? 'light',
    rows: Math.max(1, Math.round(options.rows ?? 8)),
    cover: options.cover ?? 0.75,
  }
  const img = container.querySelector('img')
  if (!img) return () => {}
  const view = container.ownerDocument.defaultView ?? window
  const staticPosition = view.getComputedStyle(container).position === 'static'
  const inlinePosition = container.style.position
  if (staticPosition) container.style.position = 'relative'

  let strips: HTMLElement | null = null
  let stopped = false

  const place = () => {
    if (!strips) return
    // The image's layout box in its offsetParent (the container, or a positioned element inside it), which holds the
    // strips: layout offsets, so a transform on the way (a parallax) doesn't skew them.
    const wide = img.offsetWidth >= o.cover * container.ownerDocument.documentElement.clientWidth
    Object.assign(strips.style, {
      display: wide ? 'block' : 'none',
      top: `${img.offsetTop}px`,
      left: `${img.offsetLeft}px`,
      width: `${img.offsetWidth}px`,
      height: `${img.offsetHeight}px`,
    })
  }

  const read = async () => {
    try {
      await img.decode()
    } catch {
      return // not decodable (yet): the next `load` reads it
    }
    if (stopped) return
    const tokens = sample(img, o)
    strips?.remove()
    strips = null
    if (!tokens) return
    const host = (img.offsetParent as HTMLElement | null) ?? container
    strips = container.ownerDocument.createElement('span')
    strips.setAttribute(STRIPS, '')
    strips.setAttribute('aria-hidden', 'true')
    strips.style.cssText = 'position:absolute;pointer-events:none;display:block'
    for (const { token, from, to } of merge(tokens)) {
      const strip = container.ownerDocument.createElement('span')
      strip.setAttribute(THEME, token)
      const top = (from / tokens.length) * 100
      const height = ((to - from) / tokens.length) * 100
      strip.style.cssText = `position:absolute;left:0;right:0;display:block;top:${top}%;height:${height}%`
      strips.append(strip)
    }
    place()
    host.append(strips)
  }

  const resize = new ResizeObserver(place)
  resize.observe(img)
  view.addEventListener('resize', place)
  img.addEventListener('load', read)
  if (img.complete && img.naturalWidth) void read()

  return () => {
    stopped = true
    resize.disconnect()
    view.removeEventListener('resize', place)
    img.removeEventListener('load', read)
    strips?.remove()
    strips = null
    if (staticPosition) container.style.position = inlinePosition
  }
}

/** One token per row, or null if the pixels can't be read (a tainted canvas). */
function sample(img: HTMLImageElement, o: { dark: string; light: string; rows: number }): string[] | null {
  if (!readable(img)) return unreadable()
  const canvas = img.ownerDocument.createElement('canvas')
  canvas.width = SAMPLE_WIDTH
  canvas.height = o.rows
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  const [sx, sy, sw, sh] = visibleSource(img)
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, SAMPLE_WIDTH, o.rows)
  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, SAMPLE_WIDTH, o.rows).data
  } catch {
    return unreadable()
  }
  const tokens: string[] = []
  for (let row = 0; row < o.rows; row++) {
    let r = 0
    let g = 0
    let b = 0
    for (let x = 0; x < SAMPLE_WIDTH; x++) {
      const i = (row * SAMPLE_WIDTH + x) * 4
      r += linear(data[i])
      g += linear(data[i + 1])
      b += linear(data[i + 2])
    }
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / SAMPLE_WIDTH
    // WCAG contrast of white ink and of black ink against the strip's mean colour: the higher one wins.
    const onWhiteInk = 1.05 / (luminance + 0.05)
    const onBlackInk = (luminance + 0.05) / 0.05
    tokens.push(onWhiteInk > onBlackInk ? o.dark : o.light)
  }
  return tokens
}

/**
 * Whether the canvas can read the image: same origin (data: and blob: URLs included), or fetched with CORS. Checked
 * before drawing, since a read of a tainted canvas throws and WebKit also logs it as a console error.
 */
function readable(img: HTMLImageElement): boolean {
  const src = img.currentSrc || img.src
  if (!src || src.startsWith('data:') || src.startsWith('blob:') || img.crossOrigin !== null) return true
  return new URL(src, img.baseURI).origin === new URL(img.baseURI).origin
}

function unreadable(): null {
  if (!warned) {
    warned = true
    console.warn(
      '[scroll-animation] image-ink: an image could not be read (cross-origin without CORS). Serve it from the ' +
        'same origin or with CORS and crossorigin="anonymous", or mark its container with data-header-theme.',
    )
  }
  return null
}

/** The part of the image's intrinsic pixels that shows in its box: all of it, or the centred crop of `cover`. */
function visibleSource(img: HTMLImageElement): [number, number, number, number] {
  const w = img.naturalWidth
  const h = img.naturalHeight
  const fit = (img.ownerDocument.defaultView ?? window).getComputedStyle(img).objectFit
  if (fit !== 'cover' || !img.offsetWidth || !img.offsetHeight) return [0, 0, w, h]
  const scale = Math.max(img.offsetWidth / w, img.offsetHeight / h)
  const sw = img.offsetWidth / scale
  const sh = img.offsetHeight / scale
  return [(w - sw) / 2, (h - sh) / 2, sw, sh]
}

/** Runs of equal tokens: [{ token, from, to }) in row indices. */
function merge(tokens: string[]): Array<{ token: string; from: number; to: number }> {
  const runs: Array<{ token: string; from: number; to: number }> = []
  tokens.forEach((token, i) => {
    const last = runs[runs.length - 1]
    if (last && last.token === token) last.to = i + 1
    else runs.push({ token, from: i, to: i + 1 })
  })
  return runs
}

/** An sRGB channel (0–255) as linear light (0–1). */
function linear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
