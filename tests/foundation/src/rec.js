// The S4 end-of-frame recorder, copied unchanged from docs/research/spikes/src/lib/rec.js so the
// foundation checks measure lag exactly the way the spike that set the rules did, without
// depending on the research tree.
//
// End-of-frame recorder.
//
// `sample(frameT)` runs once per rendered frame inside a ResizeObserver
// callback. HTML's "update the rendering" runs every rAF callback, then style
// and layout, then delivers resize observations, then paints, so this is the
// last script that sees a frame before it is painted, whatever order the
// libraries registered their own rAF callbacks in. A 1px probe is resized from
// a rAF callback every frame to make the observation fire.
//
// Producers log with `frameKey()` (document.timeline.currentTime, which equals
// the rAF timestamp for every callback of that frame) so their rows can be
// joined to the end-of-frame row.

export function frameKey() {
  return document.timeline.currentTime
}

export function createRecorder(sample) {
  const rows = []
  let recording = false
  let frameT = 0
  let flip = false
  const probe = document.createElement('div')
  probe.setAttribute('data-rec-probe', '')
  probe.style.cssText =
    'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;opacity:0;contain:strict'
  document.body.appendChild(probe)

  const ro = new ResizeObserver(() => {
    if (!recording) return
    rows.push(sample(frameT))
  })
  ro.observe(probe)

  const tick = (t) => {
    frameT = t
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
    get rows() {
      return rows
    }
  }
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** translateX from a computed `transform` (matrix or matrix3d); 0 for none. */
export function txOf(el) {
  const t = getComputedStyle(el).transform
  if (!t || t === 'none') return 0
  const m = t.match(/matrix(3d)?\(([^)]+)\)/)
  if (!m) return NaN
  const v = m[2].split(',').map(Number)
  return m[1] ? v[12] : v[4]
}

/** translateY from a computed `transform`. */
export function tyOf(el) {
  const t = getComputedStyle(el).transform
  if (!t || t === 'none') return 0
  const m = t.match(/matrix(3d)?\(([^)]+)\)/)
  if (!m) return NaN
  const v = m[2].split(',').map(Number)
  return m[1] ? v[13] : v[5]
}

export const scrollTop = () => document.scrollingElement.scrollTop
