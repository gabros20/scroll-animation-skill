// What tests/render-bridge.mjs reads, imported before anything that creates a canvas:
// - a WebGL context counter (every getContext('webgl'|'webgl2') that returns a new context; live until lost), and
//   `?nowebgl=1`, which makes those calls return null (the 3d skill's SceneCanvas then shows its poster path);
// - an end-of-frame recorder (a ResizeObserver callback is the last script before paint, spike S11's method) with a
//   frame counter, so a render logged with `frame.no` knows whether it landed in the frame it was recorded in;
// - `fakeHidden`: headless pages are never hidden, so this overrides the visibility getters and fires the event
//   (it exercises the listeners and the bridge's gate; a real hidden tab also stops rAF).

export const frame = { no: 0 }

interface ContextEntry {
  ctx: WebGLRenderingContext | WebGL2RenderingContext
  canvas: HTMLCanvasElement
}
const created: ContextEntry[] = []
const noWebgl = new URLSearchParams(location.search).get('nowebgl') === '1'
const getContext = HTMLCanvasElement.prototype.getContext
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
  if (/webgl/.test(type) && noWebgl) return null
  const ctx = (getContext as (this: HTMLCanvasElement, ...args: unknown[]) => RenderingContext | null).call(this, type, ...rest)
  if (ctx && /webgl/.test(type) && !created.some((c) => c.ctx === ctx)) {
    created.push({ ctx: ctx as WebGLRenderingContext, canvas: this })
  }
  return ctx
} as typeof HTMLCanvasElement.prototype.getContext

export function contextStats() {
  const live = created.filter((c) => !c.ctx.isContextLost())
  return {
    created: created.length,
    live: live.length,
    liveInDocument: live.filter((c) => c.canvas.isConnected).length,
    liveDetached: live.filter((c) => !c.canvas.isConnected).length,
    canvases: document.querySelectorAll('canvas').length,
  }
}

export interface Row {
  f: number
  [key: string]: unknown
}

export function createRecorder(sample: () => Record<string, unknown>, cap = 20000) {
  const rows: Row[] = []
  let recording = true
  let flip = false
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;opacity:0;contain:strict'
  document.body.appendChild(probe)
  new ResizeObserver(() => {
    if (recording && rows.length < cap) rows.push({ f: frame.no, ...sample() })
    frame.no++
  }).observe(probe)
  const tick = () => {
    flip = !flip
    probe.style.width = flip ? '2px' : '1px'
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  return {
    start() {
      rows.length = 0
      recording = true
    },
    stop() {
      recording = false
      return rows.slice()
    },
  }
}

export function fakeHidden(hidden: boolean) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}

/** Counts the live listeners a conductor hands out, so a check can see what a destroyed bridge left behind. */
export function countListeners<C extends { onInput: (fn: never) => () => unknown; subscribe: (fn: never) => () => unknown }>(
  conductor: C,
) {
  const live = { input: 0, tick: 0 }
  for (const [method, key] of [
    ['onInput', 'input'],
    ['subscribe', 'tick'],
  ] as const) {
    const original = conductor[method].bind(conductor) as (fn: never) => () => unknown
    ;(conductor as Record<string, unknown>)[method] = (fn: never) => {
      live[key]++
      const off = original(fn)
      let on = true
      return () => {
        if (on) {
          on = false
          live[key]--
        }
        return off()
      }
    }
  }
  return live
}

export const scrollTop = () => document.scrollingElement!.scrollTop
