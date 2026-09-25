#!/usr/bin/env node
// run-smoke.mjs — builds tests/smoke-gsap with Vite (a real static build,
// not the dev server: the dev server's HMR client keeps a WebSocket open
// indefinitely, which means Playwright's `waitUntil: 'networkidle'`
// -- verify-motion.mjs's page.goto -- never resolves against it), serves
// the build with `vite preview`, points verify-motion.mjs --reveal --scenes
// at it, and shuts the server down again. This is the (b) step of the repo
// root's `npm test`: a runnable check that the GSAP engine actually mounts
// (stages, count-up, fade-on-exit, one scrub stage) against a real
// all-intra clip, not just that it type-checks.

import { build, preview } from 'vite'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname_ = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname_, '..')
const smokeRoot = join(__dirname_, 'smoke-gsap')
const outDir = join(__dirname_, '.scratch', 'smoke-dist')
const verifyMotion = join(repoRoot, 'skills', 'scroll-animation', 'scripts', 'tools', 'verify-motion.mjs')

async function main() {
  console.log(`[run-smoke] building ${smokeRoot} -> ${outDir}`)
  await build({
    root: smokeRoot,
    logLevel: 'warn',
    build: { outDir, emptyOutDir: true }
  })

  const server = await preview({
    root: smokeRoot,
    logLevel: 'warn',
    build: { outDir },
    preview: { port: 0, strictPort: false }
  })

  const addr = server.httpServer?.address()
  if (!addr || typeof addr === 'string') {
    console.error('[run-smoke] could not resolve the preview server address')
    server.httpServer?.close()
    process.exit(2)
  }
  const url = `http://localhost:${addr.port}/index.html`
  console.log(`[run-smoke] serving ${outDir} at ${url}`)

  let status = 2
  try {
    // spawn, not spawnSync: the Vite preview server runs in THIS process's
    // event loop, so a synchronous spawn would block it from ever servicing
    // the child's requests -- the browser would hang against a server that
    // is technically up but can never respond. Measured: page.goto timed
    // out waiting for networkidle every time with spawnSync, and worked
    // immediately once this ran async.
    status = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [verifyMotion, url, '--reveal', '--scenes', '--out', join(__dirname_, '.scratch', 'verify-motion-out')],
        { cwd: repoRoot, stdio: 'inherit' }
      )
      child.on('exit', (code) => resolve(code ?? 2))
      child.on('error', (err) => {
        console.error(`[run-smoke] failed to run verify-motion.mjs: ${err.message}`)
        resolve(2)
      })
    })
    if (status === 0) {
      status = await new Promise((resolve) => {
        const child = spawn(process.execPath, [join(__dirname_, 'distance-check.mjs'), url], { cwd: repoRoot, stdio: 'inherit' })
        child.on('exit', (code) => resolve(code ?? 2))
        child.on('error', () => resolve(2))
      })
    }
  } finally {
    await new Promise((resolve) => server.httpServer.close(resolve))
  }

  process.exit(status)
}

main().catch((err) => {
  console.error(err)
  process.exit(2)
})
