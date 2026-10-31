// S11's end-of-frame recorder: ../lib/rec.js's method (a ResizeObserver callback is the last script before paint),
// plus a frame counter. A render logs `frameNo` at render time, so a row knows whether the canvas rendered in its
// own frame even when the render ran from a `scroll` event, which is dispatched before the frame's timeline time
// (document.timeline.currentTime) advances. Recording starts at boot (`boot: true`), so a reload's first frames
// are in the log; start() clears it.

export const frame = { no: 0 }

export function createRecorder(sample, { boot = false, cap = 20000 } = {}) {
  const rows = []
  let recording = boot
  let flip = false
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;opacity:0;contain:strict'
  document.body.appendChild(probe)

  const ro = new ResizeObserver(() => {
    if (recording && rows.length < cap) rows.push({ f: frame.no, ...sample(frame.no) })
    frame.no++
  })
  ro.observe(probe)

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
    mark() {
      return rows.length
    },
    rows
  }
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
export const scrollTop = () => document.scrollingElement.scrollTop
