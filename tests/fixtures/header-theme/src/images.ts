// image-ink.ts under header-theme.ts: three images whose pixels decide the header's ink. Generated as data URLs (a
// canvas reads them), except the last, loaded from another origin (localhost against 127.0.0.1) without CORS, which
// taints the canvas. `window.__ink` is what tests/header-theme.mjs drives; drawImage is counted.
import { mountHeaderTheme } from '../../../../skills/scroll-animation/assets/header-theme'
import { mountImageInk } from '../../../../skills/scroll-animation/assets/image-ink'
import darkPng from './ink-dark.png'

declare global {
  interface Window {
    __fx: { scrollTo(y: number, immediate?: boolean): void }
    __ink: { stop(): void; draws: number; warnings: string[] }
  }
}

function paint(width: number, height: number, bands: Array<[number, number, number, number, string]>): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')!
  for (const [x, y, w, h, colour] of bands) {
    g.fillStyle = colour
    g.fillRect(x, y, w, h)
  }
  return canvas.toDataURL()
}

const draw = CanvasRenderingContext2D.prototype.drawImage
let draws = 0
CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
  draws++
  return (draw as (...a: unknown[]) => void).apply(this, args)
} as typeof draw
const warnings: string[] = []
const warn = console.warn
console.warn = (...args: unknown[]) => {
  warnings.push(args.join(' '))
  warn.apply(console, args)
}

const img = (id: string) => document.querySelector<HTMLImageElement>(`#${id} img`)!
img('half').src = paint(64, 64, [
  [0, 0, 64, 32, '#111'],
  [0, 32, 64, 32, '#f4f0e9'],
])
img('crop').src = paint(64, 192, [
  [0, 0, 64, 64, '#111'],
  [0, 64, 64, 64, '#f4f0e9'],
  [0, 128, 64, 64, '#111'],
])
img('narrow').src = paint(64, 64, [[0, 0, 64, 64, '#111']])
const foreign = new URL(darkPng, location.href)
foreign.hostname = foreign.hostname === 'localhost' ? '127.0.0.1' : 'localhost'
img('foreign').src = foreign.href

window.__fx = { scrollTo: (y) => window.scrollTo({ top: y, behavior: 'instant' }) }
const stopHeader = mountHeaderTheme(document.querySelector<HTMLElement>('[data-header]')!)
const stopInk = mountImageInk(document.getElementById('page')!)
window.__ink = {
  stop() {
    stopInk()
    stopHeader()
  },
  get draws() {
    // reads to the canvas the test's own helpers make are not counted: they never draw
    return draws
  },
  warnings,
}
