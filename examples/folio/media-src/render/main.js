// Entry point for one shot. scripts/render.mjs opens index.html?shot=<name>&…, waits for
// window.__render, then asks for frames one at a time. Nothing here reads the clock: frame i is a
// pure function of i, so a render is repeatable and never depends on real-time playback.

const params = Object.fromEntries(new URLSearchParams(location.search))
const num = (key, fallback) => (params[key] === undefined ? fallback : Number(params[key]))

try {
  const shot = await import(`./shots/${params.shot}.js`)
  const scene = await shot.setup({
    width: num('width', 1920),
    height: num('height', 1080),
    frames: num('frames', shot.defaultFrames ?? 1),
    samples: num('samples', 64),
    params
  })
  window.__render = {
    frames: scene.frames,
    /** Renders frame i and returns it as a base64 PNG (no data: prefix). */
    frame: async (i) => {
      await scene.render(i)
      return scene.canvas.toDataURL('image/png').slice('data:image/png;base64,'.length)
    },
    info: scene.info ?? {}
  }
} catch (error) {
  window.__renderError = String(error?.stack ?? error)
  throw error
}
