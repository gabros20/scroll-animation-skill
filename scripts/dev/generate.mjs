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
// equals package.json's version (the CLI, the registry and npm are pinned together).
//
// Doc-table generation (references/*.md tables built from registry.json, the way
// fluid-design's generate-fluid.mjs builds references/config.md from spec.mjs) is not built yet —
// this is its place: add it in the `if (!check)` branch below, after the validation still runs.

import { readFileSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ASSETS_DIR, REGISTRY_PATH, SKILL_DIR, loadRegistry, validateRegistry } from '../../skills/scroll-animation/scripts/lib/registry.mjs'

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

  if (!check) {
    // Doc-table generation goes here once references/*.md carry a generated block table.
  }
}

main()
