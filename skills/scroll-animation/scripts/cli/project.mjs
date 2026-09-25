// project.mjs — the project on disk: finding its root and package manager, picking an engine
// against what's installed, the lock file, and whether a file is safe to (over)write.

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname, relative } from 'node:path'
import { fail } from './ui.mjs'

export const LOCK_FILE = '.scroll-animation.lock.json'
export const DEFAULT_DIR = 'src/animation'

// ── package.json, and the project root it defines ──────────────────────

/** Walks up from `cwd` for the nearest package.json; falls back to `cwd` itself (a project
 * without one — e.g. a static/Rails-style site — is still a valid target for `add`). */
export function findProjectRoot(cwd) {
  let dir = cwd
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const up = dirname(dir)
    if (up === dir) return cwd
    dir = up
  }
}

export function readPackageJson(root) {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  } catch {
    return {}
  }
}

// ── package manager detection, for the install line `add` prints ──────

export function detectPackageManager(root, pkg) {
  const declared = String(pkg.packageManager ?? '').split('@')[0]
  if (['pnpm', 'yarn', 'bun', 'npm'].includes(declared)) return declared
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) return 'bun'
  return 'npm'
}

export function installCommand(pm, packages) {
  const list = [...packages].sort().join(' ')
  return { npm: `npm install ${list}`, pnpm: `pnpm add ${list}`, yarn: `yarn add ${list}`, bun: `bun add ${list}` }[pm] ?? `npm install ${list}`
}

// ── engine auto-pick ────────────────────────────────────────────────────

// The only engines that have a signature npm package to detect. css/media/agnostic have none —
// a block offering one of those alongside another engine is disambiguated by --engine only.
const ENGINE_DEP_HINTS = { gsap: 'gsap', motion: 'motion', three: 'three' }

export function installedEngines(pkg) {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  return new Set(Object.entries(ENGINE_DEP_HINTS).filter(([, dep]) => dep in deps).map(([engine]) => engine))
}

/** One engine name for `block` (a registry.json block definition): the explicit --engine if the
 * block offers it (or, being explicit about something a single-engine block doesn't have, just
 * that block's one engine — --engine only disambiguates, it can't add an engine that isn't
 * there); otherwise the block's only engine if it has just one; otherwise whichever of its
 * engines matches an installed dependency. Fails with the choices listed when that's zero or more
 * than one match. */
export function pickEngine(blockId, block, requestedEngine, installed) {
  const available = Object.keys(block.engines ?? {})
  if (requestedEngine) {
    if (available.includes(requestedEngine)) return requestedEngine
    if (available.length === 1) return available[0]
    fail(`${blockId} has no "${requestedEngine}" engine (choices: ${available.join(', ')})`, 2)
  }
  if (available.length === 1) return available[0]
  const matches = available.filter((e) => installed.has(e))
  if (matches.length === 1) return matches[0]
  const why = matches.length ? 'more than one matches an installed dependency' : 'none matches an installed dependency'
  fail(`${blockId} has ${available.length} engines (${available.join(', ')}) and ${why}; pass --engine <${available.join('|')}>`, 2)
}

// ── the lock file ───────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.turbo', 'dist', 'build', 'out', '.vercel', 'coverage'])

/** A bounded, shallow search from `root` for an existing lock file, so a bare `add` after a first
 * `add --dir custom/path` still finds it without being told again. First match wins — a project
 * is expected to have at most one. Returns a path relative to `root` (like `--dir` takes, and like
 * the lock's own "dir" field) — never absolute, so callers can `join(root, dir)` it uniformly
 * whether it came from here, from --dir, or from DEFAULT_DIR. */
export function findLockDir(root, maxDepth = 4) {
  const walk = (dir, depth) => {
    if (existsSync(join(dir, LOCK_FILE))) return dir
    if (depth >= maxDepth) return null
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return null
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
      const found = walk(join(dir, e.name), depth + 1)
      if (found) return found
    }
    return null
  }
  const found = walk(root, 0)
  return found === null ? null : relative(root, found)
}

export function readLock(dir) {
  const f = join(dir, LOCK_FILE)
  if (!existsSync(f)) return null
  try {
    return JSON.parse(readFileSync(f, 'utf8'))
  } catch {
    return null
  }
}

export function writeLock(dir, lock) {
  writeFileSync(join(dir, LOCK_FILE), JSON.stringify(lock, null, 2) + '\n')
}

// ── file hashing and the overwrite guard ────────────────────────────────

export function fileHash(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

// CRLF from a Windows checkout is not an edit. Exported: add.mjs hashes the same normalised form
// into the lock, so a later planFile() comparison (which normalises disk before hashing it) lines
// up with what was recorded.
export const lf = (t) => t.replace(/\r\n/g, '\n')

/** Where one file stands against the lock and disk:
 *  'write'       missing, or present and unchanged since we last wrote it (safe — the source may
 *                have moved on, that's an ordinary update, not an edit)
 *  'ok'          already exactly the content we'd write; nothing to do
 *  'hand-edited' the lock recorded a hash for this file and disk no longer matches it
 *  'unowned'     the file is here but the lock has no entry for it at all
 * Only 'hand-edited' and 'unowned' are refused without --force. */
export function planFile(rel, content, destDir, lock) {
  const abs = join(destDir, rel)
  if (!existsSync(abs)) return { rel, state: 'write' }
  const disk = lf(readFileSync(abs, 'utf8'))
  const wanted = lf(content)
  if (disk === wanted) return { rel, state: 'ok' }
  const recorded = lock?.files?.[rel]
  if (recorded === undefined) return { rel, state: 'unowned' }
  if (recorded === fileHash(disk)) return { rel, state: 'write' }
  return { rel, state: 'hand-edited' }
}
