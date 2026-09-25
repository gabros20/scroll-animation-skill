// Shared paths and helpers for the media-src scripts. Every output lands under WORK, which is
// $FOLIO_MEDIA_WORK or <os tmpdir>/folio-media: never inside the repo.

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const WORK = resolve(process.env.FOLIO_MEDIA_WORK ?? join(tmpdir(), 'folio-media'))

/** The layout under WORK. `pkg` mirrors examples/folio/public/media/ exactly. */
export const paths = {
  model: join(WORK, 'model'),
  frames: join(WORK, 'frames'),
  masters: join(WORK, 'masters'),
  encoded: join(WORK, 'encoded'),
  stills: join(WORK, 'stills'),
  pkg: join(WORK, 'media-v1'),
  tarball: join(WORK, 'media-v1.tar.gz')
}

/** The scroll-animation CLI this repo ships; media commands are recipes over ffmpeg. */
export const CLI = resolve(SRC, '../../../skills/scroll-animation/bin/scroll-animation')

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Runs a command, echoing it; throws with the tail of stderr on a non-zero exit. */
export function sh(bin, args, { cwd, quiet = false, capture = false } = {}) {
  if (!quiet) console.log(`$ ${[bin, ...args].map(quote).join(' ')}`)
  const r = spawnSync(bin, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: capture ? 'pipe' : ['ignore', 'inherit', 'pipe'] })
  if (r.error) throw new Error(`${bin}: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`${bin} exited ${r.status}: ${(r.stderr ?? '').trim().slice(-2000)}`)
  return r.stdout ?? ''
}

/** Async twin of sh() for work that runs side by side; resolves with stdout. */
export function shAsync(bin, args, { cwd } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolvePromise(stdout) : reject(new Error(`${bin} exited ${code}: ${stderr.trim().slice(-2000)}`))))
  })
}

function quote(arg) {
  return /^[\w./:=@%+,-]+$/.test(arg) ? arg : `'${String(arg).replace(/'/g, `'\\''`)}'`
}

export const kb = (file) => Math.round(statSync(file).size / 1024)
export const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2)
