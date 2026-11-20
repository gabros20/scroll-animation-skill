#!/usr/bin/env node
// generate.mjs — the scroll-animation skill's own registry generator.
//
//   node scripts/dev/generate.mjs            (currently: same as --check — see below)
//   node scripts/dev/generate.mjs --check    validate assets/registry.json; write nothing;
//                                             exit 1 if anything is wrong
//
// Validates: every block has the required fields with values in their enums, every engine's
// `files` exist under assets/, every `requires` resolves to a block that offers the same engine,
// no requires cycle, every `reference` exists under the skill, and registry.json's "version"
// equals package.json's version (the CLI, the registry and npm are pinned together). Then every example's copies
// (examples/*/src/animation, as its .scroll-animation.lock.json records them) match assets/ byte for byte and their
// lock hashes: the examples are re-copied with `scroll-animation add`, never edited by hand, and a block change that
// skipped the re-copy fails here.
//
// Doc-table generation (references/*.md tables built from registry.json, the way
// fluid-design's generate-fluid.mjs builds references/config.md from spec.mjs) is not built yet —
// this is its place: add it in the `if (!check)` branch below, after the validation still runs.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOCK_FILE, lf } from '../../skills/scroll-animation/scripts/cli/project.mjs'
import { ASSETS_DIR, REGISTRY_PATH, SKILL_DIR, fileHash, loadRegistry, validateRegistry } from '../../skills/scroll-animation/scripts/lib/registry.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolvePath(__dirname, '../..')

function main() {
  const check = process.argv.includes('--check')

  let registry
  try {
    registry = loadRegistry(REGISTRY_PATH)
  } catch (err) {
    console.error(`[scroll-animation] ${err.message}`)
    process.exit(1)
  }

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const problems = validateRegistry(registry, { assetsDir: ASSETS_DIR, skillDir: SKILL_DIR, pkgVersion: pkg.version })

  if (problems.length) {
    console.error(`[scroll-animation] ${check ? '--check' : 'generate'} found problems in assets/registry.json:`)
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }

  const blockCount = Object.keys(registry.blocks ?? {}).length
  console.log(`[scroll-animation] registry OK — ${blockCount} block(s), version ${registry.version} matches package.json`)

  const drift = exampleDrift()
  if (drift.problems.length) {
    console.error(`[scroll-animation] examples drifted from assets/ (re-copy with \`scroll-animation add <block>\` from the example):`)
    for (const p of drift.problems) console.error(`  ${p}`)
    process.exit(1)
  }
  console.log(`[scroll-animation] examples OK — ${drift.files} copied file(s) in ${drift.examples} example(s) match assets/`)

  if (!check) {
    // Doc-table generation goes here once references/*.md carry a generated block table.
  }
}

/**
 * Every example's copies against assets/: each file its lock records exists, equals the asset (line endings aside, as
 * the CLI compares) and carries the hash the lock holds (else it was edited by hand since `add` wrote it).
 */
export function exampleDrift(examplesDir = join(ROOT, 'examples'), assetsDir = ASSETS_DIR) {
  const problems = []
  let examples = 0
  let files = 0
  const dirs = existsSync(examplesDir) ? readdirSync(examplesDir, { withFileTypes: true }).filter((d) => d.isDirectory()) : []
  for (const d of dirs) {
    const animation = join(examplesDir, d.name, 'src', 'animation')
    const lockPath = join(animation, LOCK_FILE)
    if (!existsSync(lockPath)) continue
    examples++
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
    for (const [rel, hash] of Object.entries(lock.files ?? {})) {
      files++
      const where = relative(ROOT, join(animation, rel))
      const assetPath = join(assetsDir, rel)
      const copyPath = join(animation, rel)
      if (!existsSync(assetPath)) problems.push(`${where}: no assets/${rel} any more`)
      else if (!existsSync(copyPath)) problems.push(`${where}: missing (the lock records it)`)
      else {
        const copy = lf(readFileSync(copyPath, 'utf8'))
        if (copy !== lf(readFileSync(assetPath, 'utf8'))) problems.push(`${where}: differs from assets/${rel}`)
        if (fileHash(copy) !== hash) problems.push(`${where}: edited by hand (its hash isn't the lock's)`)
      }
    }
  }
  return { problems, examples, files }
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) main()
