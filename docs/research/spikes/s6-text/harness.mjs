// Shared runner for S6: build once with Vite, serve with `vite preview` on a
// random port, and always close the server and every browser, even on failure
// or Ctrl-C. Same shape as ../run/harness.mjs, plus Firefox.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox, webkit } from 'playwright'
import { build, preview } from 'vite'

export const ROOT = dirname(fileURLToPath(import.meta.url))
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

export async function withServer(fn) {
  const outDir = resolve(ROOT, 'dist')
  if (!process.env.SPIKE_SKIP_BUILD) await build({ configFile: CONFIG, logLevel: 'warn', build: { outDir } })
  const server = await preview({
    configFile: CONFIG,
    logLevel: 'warn',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0, strictPort: false, open: false }
  })
  const close = () => new Promise((r) => server.httpServer.close(() => r()))
  cleanups.add(close)
  const base = `http://127.0.0.1:${server.httpServer.address().port}`
  try {
    return await fn(base)
  } finally {
    cleanups.delete(close)
    server.httpServer.closeAllConnections?.()
    await close()
  }
}

export const ENGINES = { chromium, webkit, firefox }

export async function withBrowser(name, fn) {
  const browser = await ENGINES[name].launch()
  const close = () => browser.close()
  cleanups.add(close)
  try {
    return await fn(browser)
  } finally {
    cleanups.delete(close)
    await close()
  }
}

export async function newPage(browser, { viewport = { width: 1000, height: 700 }, ...ctx } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...ctx })
  const page = await context.newPage()
  page.__errors = []
  page.on('pageerror', (e) => {
    page.__errors.push(e.message)
    if (!process.env.QUIET) console.error('[pageerror]', e.message)
  })
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      page.__errors.push(`console.${m.type()}: ${m.text()}`)
      if (!process.env.QUIET) console.error(`[console.${m.type()}]`, m.text())
    }
  })
  return page
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const frames = (page, n = 3) =>
  page.evaluate(
    (k) =>
      new Promise((res) => {
        const step = () => (--k <= 0 ? res() : requestAnimationFrame(step))
        requestAnimationFrame(step)
      }),
    n
  )

export const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x)

export function writeResult(name, data) {
  const dir = resolve(ROOT, 'results')
  mkdirSync(dir, { recursive: true })
  const file = resolve(dir, `${name}.json`)
  writeFileSync(file, JSON.stringify(data, null, 1))
  return file
}
