#!/usr/bin/env node
// Renders a shot headless, one deterministic frame at a time, to $WORK/frames/<shot>/0001.png…
//
// Chromium runs on the real GPU (ANGLE Metal on macOS; SwiftShader elsewhere works, slowly). No
// server: Playwright routes http://folio.render/* straight to files, so there's nothing to kill.
//
// usage: node scripts/render.mjs <shot|all> [--frames N] [--width W] [--height H] [--samples S]
//                                [--only 0,59,…] [--out dir] [--set key=value …]

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright'
import { SRC, WORK, ensureDir, paths } from './lib/work.mjs'

// Each shot's delivery spec. Params are the art-directed values; --set overrides for tests.
export const SHOTS = {
  orbit: { frames: 240, width: 1920, height: 1080, samples: 128, params: {} },
  'lab-poster': { shot: 'orbit', frames: 1, width: 1920, height: 1080, samples: 256, params: { az0: -40, elev: 14, fill: 0.84, aimY: 0.47 } },
  'kiln-loop': { frames: 180, width: 1280, height: 720, samples: 1, params: {} },
  'rust-loop': { frames: 180, width: 1280, height: 720, samples: 1, params: {} }
}

const ORIGIN = 'http://folio.render'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm' }

function parseArgs(argv) {
  const opts = { set: {} }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--set') {
      const [k, ...v] = argv[++i].split('=')
      opts.set[k] = v.join('=')
    } else if (a.startsWith('--')) opts[a.slice(2)] = argv[++i]
    else rest.push(a)
  }
  return { name: rest[0], opts }
}

/** Maps a request path to a file: /render and /node_modules from media-src, /work from WORK. */
function resolveFile(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  if (clean.startsWith('/work/')) return join(WORK, clean.slice('/work/'.length))
  if (clean.startsWith('/render/') || clean.startsWith('/node_modules/')) return join(SRC, clean)
  return null
}

export async function renderShot(name, opts = {}) {
  const spec = SHOTS[name]
  if (!spec) throw new Error(`unknown shot "${name}" (have: ${Object.keys(SHOTS).join(', ')})`)
  const frames = Number(opts.frames ?? spec.frames)
  const width = Number(opts.width ?? spec.width)
  const height = Number(opts.height ?? spec.height)
  const samples = Number(opts.samples ?? spec.samples)
  const out = ensureDir(opts.out ?? join(paths.frames, name))
  const only = opts.only ? opts.only.split(',').map(Number) : null
  const query = new URLSearchParams({ shot: spec.shot ?? name, frames, width, height, samples, ...spec.params, ...(opts.set ?? {}) })

  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] })
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
    page.on('console', (msg) => console.log(`  [page] ${msg.text()}`))
    page.on('pageerror', (err) => console.error(`  [page error] ${err.message}`))
    await page.route(`${ORIGIN}/**`, (route) => {
      const url = new URL(route.request().url())
      const file = resolveFile(url.pathname)
      if (!file || !existsSync(file)) return route.fulfill({ status: 404, body: `not found: ${url.pathname}` })
      return route.fulfill({ status: 200, body: readFileSync(file), contentType: TYPES[extname(file)] ?? 'application/octet-stream' })
    })
    await page.goto(`${ORIGIN}/render/index.html?${query}`)
    await page.waitForFunction(() => window.__render || window.__renderError, null, { timeout: 120_000 })
    const error = await page.evaluate(() => window.__renderError)
    if (error) throw new Error(`shot ${name} failed to set up:\n${error}`)
    const gpu = await page.evaluate(() => {
      const gl = document.querySelector('canvas')?.getContext('webgl2')
      const ext = gl?.getExtension('WEBGL_debug_renderer_info')
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'
    })
    const info = await page.evaluate(() => window.__render.info)
    console.log(`${name}: ${frames} frames ${width}x${height}, ${samples} passes/frame on ${gpu}`)
    if (opts.verbose) console.log(JSON.stringify(info))

    const started = Date.now()
    const list = only ?? Array.from({ length: frames }, (_, i) => i)
    for (const [k, i] of list.entries()) {
      const b64 = await page.evaluate((index) => window.__render.frame(index), i)
      writeFileSync(join(out, `${String(i + 1).padStart(4, '0')}.png`), Buffer.from(b64, 'base64'))
      if (k % 20 === 0 || k === list.length - 1) {
        const elapsed = (Date.now() - started) / 1000
        console.log(`  frame ${i + 1}/${frames}  ${elapsed.toFixed(0)}s elapsed, ~${((elapsed / (k + 1)) * (list.length - k - 1)).toFixed(0)}s left`)
      }
    }
    writeFileSync(join(out, 'render.json'), JSON.stringify({ shot: name, frames, width, height, samples, query: Object.fromEntries(query), gpu, info, rendered: new Date().toISOString() }, null, 2) + '\n')
    return out
  } finally {
    await browser.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { name, opts } = parseArgs(process.argv.slice(2))
  const names = name === 'all' || !name ? Object.keys(SHOTS) : [name]
  for (const n of names) await renderShot(n, opts)
}
