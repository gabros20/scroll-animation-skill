// registry.mjs — load, validate and resolve assets/registry.json: the block catalogue the CLI
// (cli/commands/add.mjs, cli/commands/list.mjs) and the skill's own scripts/dev/generate.mjs share.
// Nothing here hard-codes a block id: every name comes out of registry.json.

import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// scripts/lib/registry.mjs -> scripts/lib -> scripts -> skills/scroll-animation
export const SKILL_DIR = join(__dirname, '../..')
export const ASSETS_DIR = join(SKILL_DIR, 'assets')
export const REGISTRY_PATH = join(ASSETS_DIR, 'registry.json')

export const ENGINES = ['css', 'motion', 'gsap', 'three', 'media', 'agnostic']
export const CLOCKS = ['trigger', 'scroll', 'media', 'render', 'none']
export const TIERS = ['primitive', 'recipe']
export const PROFILES = ['reading', 'expressive', 'immersive']

export function fileHash(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/** Parses; throws a plain Error with the path in it on bad JSON (the CLI/generate wrap this in
 * their own error handling — this module never calls process.exit). */
export function loadRegistry(path = REGISTRY_PATH) {
  const raw = readFileSync(path, 'utf8')
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(`${path}: invalid JSON — ${err.message}`)
  }
}

export function blockIds(registry) {
  return Object.keys(registry.blocks ?? {})
}

export function engineNames(block) {
  return Object.keys(block.engines ?? {})
}

/** The engine `id` actually resolves to when reached from a requirer resolved under
 * `requestedEngine`: `id`'s own `requestedEngine` entry if it has one (an engine-specific block
 * requiring another engine-specific one, matched) — else `id`'s one engine, if it has only one (an
 * engine-specific block requiring an engine-agnostic/css/media-only one, which doesn't need to
 * duplicate itself under every consumer's engine to be required) — else a plain Error: `id` has
 * several engines and none is `requestedEngine`, and nothing here should guess which. Shared by
 * resolveTransitive, validateRegistry's per-block requires check and its cycle walk, so all three
 * agree on exactly one resolution rule. */
export function resolveEngineFor(blocks, id, requestedEngine) {
  const block = blocks[id]
  if (!block) throw new Error(`unknown block ${JSON.stringify(id)}`)
  if (block.engines?.[requestedEngine]) return requestedEngine
  const available = Object.keys(block.engines ?? {})
  if (available.length === 1) return available[0]
  throw new Error(`${id} has no "${requestedEngine}" engine and several others (${available.join(', ')}): add a "${requestedEngine}" entry or split the block`)
}

/** Every problem found, as plain printable strings. Empty = clean. Checked: required fields and
 * their enums, every file exists under assetsDir, every requires resolves per resolveEngineFor
 * (the same engine, or the required block's one engine if it only has one), no requires cycle
 * (per engine, walked through that same resolution), every reference exists under skillDir, and —
 * when pkgVersion is passed — registry.version matches it. */
export function validateRegistry(registry, { assetsDir = ASSETS_DIR, skillDir = SKILL_DIR, pkgVersion } = {}) {
  const problems = []
  const blocks = registry.blocks ?? {}
  const ids = Object.keys(blocks)
  if (!registry.version) problems.push('registry.json: missing "version"')
  else if (pkgVersion !== undefined && registry.version !== pkgVersion) {
    problems.push(`registry.json version ${JSON.stringify(registry.version)} does not match package.json version ${JSON.stringify(pkgVersion)}`)
  }
  if (!ids.length) problems.push('registry.json: no blocks')

  for (const id of ids) {
    const block = blocks[id] ?? {}
    if (!block.summary) problems.push(`${id}: missing "summary"`)
    if (!CLOCKS.includes(block.clock)) problems.push(`${id}: clock ${JSON.stringify(block.clock)} is not one of ${CLOCKS.join('|')}`)
    if (!TIERS.includes(block.tier)) problems.push(`${id}: tier ${JSON.stringify(block.tier)} is not one of ${TIERS.join('|')}`)
    if (!block.profiles?.length) problems.push(`${id}: "profiles" is empty`)
    for (const p of block.profiles ?? []) if (!PROFILES.includes(p)) problems.push(`${id}: profile ${JSON.stringify(p)} is not one of ${PROFILES.join('|')}`)
    if (!block.reference) problems.push(`${id}: missing "reference"`)
    else if (!existsSync(join(skillDir, block.reference))) problems.push(`${id}: reference does not exist: ${block.reference}`)

    const engines = block.engines ?? {}
    if (!Object.keys(engines).length) problems.push(`${id}: no engines`)
    for (const [engine, def] of Object.entries(engines)) {
      if (!ENGINES.includes(engine)) problems.push(`${id}.${engine}: engine is not one of ${ENGINES.join('|')}`)
      if (!def.files?.length) problems.push(`${id}.${engine}: no files`)
      for (const rel of def.files ?? []) {
        if (!existsSync(join(assetsDir, rel))) problems.push(`${id}.${engine}: file does not exist: assets/${rel}`)
      }
      for (const req of def.requires ?? []) {
        try {
          resolveEngineFor(blocks, req, engine)
        } catch (err) {
          problems.push(`${id}.${engine} requires ${req}: ${err.message}`)
        }
      }
    }
  }

  // Cycles, walked separately from every block that directly offers each engine, following
  // requires through resolveEngineFor — so a chain that dips into an engine-agnostic/css/media
  // block and back is followed correctly, on (block, resolvedEngine) pairs, not bare ids (the same
  // block can legitimately appear under more than one resolved engine across different walks).
  for (const engine of ENGINES) {
    const done = new Set()
    const visiting = new Set()
    const stack = []
    const visit = (id, requestedEngine) => {
      let resolvedEngine
      try {
        resolvedEngine = resolveEngineFor(blocks, id, requestedEngine)
      } catch {
        return // already reported by the per-block requires check above; don't duplicate it here
      }
      const key = `${id}::${resolvedEngine}`
      if (done.has(key)) return
      if (visiting.has(key)) {
        const start = stack.indexOf(key)
        problems.push(`requires cycle (${resolvedEngine}): ${[...stack.slice(start), key].map((k) => k.split('::')[0]).join(' -> ')}`)
        return
      }
      visiting.add(key)
      stack.push(key)
      for (const req of blocks[id].engines[resolvedEngine].requires ?? []) visit(req, resolvedEngine)
      stack.pop()
      visiting.delete(key)
      done.add(key)
    }
    for (const id of ids) if (blocks[id]?.engines?.[engine]) visit(id, engine)
  }

  return problems
}

/** Every block+engine reachable from `ids` under one `engine`, dependency-first (a block's
 * requires appear before the block itself) and deduped. A require resolves through
 * resolveEngineFor — the requiring block's own (resolved) engine when the required block offers
 * it, else that block's one engine if it has only one — so the returned entries can carry more
 * than one distinct `engine` (an agnostic/css/media-only dependency pulled in by a gsap or motion
 * block); each entry says which. Throws a plain Error — never exits — on an unknown block, an
 * engine that can't be resolved (resolveEngineFor), the same block resolving to two different
 * engines within this one call, or a cycle (generate --check is what guards the registry itself;
 * these guards just keep a malformed one from hanging or corrupting the CLI's own resolution). */
export function resolveTransitive(registry, ids, engine) {
  const blocks = registry.blocks ?? {}
  const order = []
  const done = new Set() // "id::resolvedEngine"
  const visiting = new Set()
  const resolvedEngineOf = new Map() // id -> the one engine it has resolved to so far in this call
  const visit = (id, requestedEngine) => {
    const resolvedEngine = resolveEngineFor(blocks, id, requestedEngine)
    const already = resolvedEngineOf.get(id)
    if (already !== undefined && already !== resolvedEngine) {
      throw new Error(`${id} is needed under both "${already}" and "${resolvedEngine}" in this one resolution — add an explicit engine, or split the block`)
    }
    const key = `${id}::${resolvedEngine}`
    if (done.has(key)) return
    if (visiting.has(key)) throw new Error(`requires cycle at "${id}" (${resolvedEngine}) — run \`node scripts/dev/generate.mjs --check\``)
    resolvedEngineOf.set(id, resolvedEngine)
    visiting.add(key)
    const def = blocks[id].engines[resolvedEngine]
    for (const req of def.requires ?? []) visit(req, resolvedEngine)
    visiting.delete(key)
    done.add(key)
    order.push({ id, engine: resolvedEngine, files: def.files ?? [], requires: def.requires ?? [], packages: def.packages ?? [] })
  }
  for (const id of ids) visit(id, engine)
  return order
}
