// Shared runner: build once, serve with `vite preview` on a random port, hand
// the URL to the spike, and always close the server and every browser, even on
// failure or Ctrl-C.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, webkit } from 'playwright'
import { build, preview } from 'vite'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = resolve(ROOT, 'vite.config.mjs')

const cleanups = new Set()
const cleanupAll = async () => {
  for (const fn of [...cleanups].reverse()) {
    try {
      await fn()
    } catch {}
  }
  cleanups.clear()
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await cleanupAll()
    process.exit(130)
  })
}

/**
 * Builds only this spike's pages (pages/<spike>*.html) into dist/<spike>, so
 * spikes can run concurrently without emptying each other's output.
 */
export async function withServer(spike, fn) {
  const outDir = resolve(ROOT, 'dist', spike)
  process.env.SPIKE_PAGES = spike
  if (!process.env.SPIKE_SKIP_BUILD) await build({ configFile: CONFIG, logLevel: 'warn', build: { outDir } })
  const server = await preview({
    configFile: CONFIG,
    logLevel: 'warn',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0, strictPort: false, open: false }
  })
  const close = () => new Promise((r) => server.httpServer.close(() => r()))
  cleanups.add(close)
  const addr = server.httpServer.address()
  const base = `http://127.0.0.1:${addr.port}`
  try {
    return await fn(base)
  } finally {
    cleanups.delete(close)
    server.httpServer.closeAllConnections?.()
    await close()
  }
}

export const ENGINES = { chromium, webkit }

// Headless Chromium drops to SwiftShader for WebGL only with this switch
// (the automatic fallback was removed). Harmless for the non-WebGL spikes.
const LAUNCH = {
  chromium: { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  webkit: {}
}

export async function withBrowser(name, fn) {
  const browser = await ENGINES[name].launch(LAUNCH[name])
  const close = () => browser.close()
  cleanups.add(close)
  try {
    return await fn(browser)
  } finally {
    cleanups.delete(close)
    await close()
  }
}

export async function newPage(browser, viewport = { width: 1000, height: 600 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.error('[pageerror]', e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.error(`[console.${m.type()}]`, m.text())
  })
  return page
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A mouse-wheel gesture: `steps` notches of `delta` px, `gap` ms apart. */
export async function wheel(page, { steps = 12, delta = 100, gap = 40 } = {}) {
  await page.mouse.move(300, 300)
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, delta)
    await sleep(gap)
  }
}

export function stats(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return { n: 0 }
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))]
  const mean = v.reduce((a, b) => a + b, 0) / v.length
  return { n: v.length, max: r3(v[v.length - 1]), p95: r3(q(0.95)), median: r3(q(0.5)), mean: r3(mean) }
}

export const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x)

export function writeResult(name, data) {
  const dir = resolve(ROOT, 'results')
  mkdirSync(dir, { recursive: true })
  const file = resolve(dir, `${name}.json`)
  writeFileSync(file, JSON.stringify(data, null, 1))
  return file
}

/** Frame-to-frame rAF interval summary, to show the headless frame rate. */
export function frameIntervals(rows, key = 't') {
  const d = []
  for (let i = 1; i < rows.length; i++) d.push(rows[i][key] - rows[i - 1][key])
  return stats(d)
}
