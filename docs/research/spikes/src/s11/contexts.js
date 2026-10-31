// Counts WebGL contexts: every getContext('webgl'|'webgl2') that returns a new context is recorded, and a context is
// live until it is lost (isContextLost()). Import this module before anything that creates a canvas.
const created = []
const original = HTMLCanvasElement.prototype.getContext
HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
  const ctx = original.call(this, type, ...rest)
  if (ctx && /webgl/.test(type) && !created.some((c) => c.ctx === ctx)) {
    const entry = { ctx, canvas: this, type, lostEvents: 0 }
    this.addEventListener('webglcontextlost', () => entry.lostEvents++)
    created.push(entry)
  }
  return ctx
}

export function contextStats() {
  const live = created.filter((c) => !c.ctx.isContextLost())
  return {
    created: created.length,
    live: live.length,
    liveInDocument: live.filter((c) => c.canvas.isConnected).length,
    liveDetached: live.filter((c) => !c.canvas.isConnected).length,
    canvasesInDocument: document.querySelectorAll('canvas').length
  }
}
