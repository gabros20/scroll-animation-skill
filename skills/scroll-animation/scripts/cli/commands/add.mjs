// add.mjs — scroll-animation add <block…> [--engine <e>] [--dir <path>] [--dry-run] [--force]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { ASSETS_DIR, loadRegistry, resolveTransitive } from '../../lib/registry.mjs'
import { CliError, c, fail } from '../ui.mjs'
import { DEFAULT_DIR, LOCK_FILE, detectPackageManager, fileHash, findLockDir, findProjectRoot, installCommand, installedEngines, lf, pickEngine, planFile, readLock, readPackageJson, writeLock } from '../project.mjs'

export async function cmdAdd(flags, ids) {
  if (!ids.length) fail('add wants at least one block id — see `scroll-animation list`', 2)
  if (flags.engine === true) fail('--engine wants a value (e.g. --engine gsap)', 2)
  if (flags.dir === true) fail('--dir wants a path', 2)

  const registry = loadRegistry()
  const blocks = registry.blocks ?? {}
  const unknown = ids.filter((id) => !blocks[id])
  if (unknown.length) fail(`unknown block(s): ${unknown.join(', ')} — see \`scroll-animation list\``, 2)

  const root = findProjectRoot(process.cwd())
  const pkg = readPackageJson(root)
  const installed = installedEngines(pkg)
  const requestedEngine = typeof flags.engine === 'string' ? flags.engine : undefined

  // One engine per requested block. In practice every multi-engine block in one invocation lands
  // on the same engine (one package.json, one --engine flag) — the merge below still checks.
  const engineByBlock = new Map(ids.map((id) => [id, pickEngine(id, blocks[id], requestedEngine, installed)]))

  // resolveTransitive throws a plain Error (unknown block, an unresolvable engine — see
  // registry.mjs#resolveEngineFor — or a cycle): a registry-data problem, not a usage mistake, so
  // it's reported as one clean line at exit 1, not a stack trace. mergeResolved's own conflict
  // check throws a CliError already coded 2 (a usage fix: split into two `add` runs) — that one
  // passes through unchanged, the same fix applied in media.mjs's outer catch.
  let merged
  try {
    merged = mergeResolved(registry, engineByBlock)
  } catch (err) {
    if (err instanceof CliError) throw err
    fail(err instanceof Error ? err.message : String(err), 1)
  }

  const dir = typeof flags.dir === 'string' ? flags.dir : (findLockDir(root) ?? DEFAULT_DIR)
  const destDir = join(root, dir)
  const lock = readLock(destDir)

  // The full write plan, file by file, decided before anything touches disk.
  const plan = []
  for (const { id, files } of merged) {
    for (const rel of files) {
      const content = readFileSync(join(ASSETS_DIR, rel), 'utf8')
      plan.push({ id, rel, content, ...planFile(rel, content, destDir, lock) })
    }
  }

  const blocking = plan.filter((p) => p.state === 'hand-edited' || p.state === 'unowned')
  if (blocking.length && !flags.force) {
    console.log(`${c.red('Refusing to overwrite')} in ${relative(root, destDir) || '.'}:`)
    for (const p of blocking) console.log(`  ${p.rel} — ${p.state === 'hand-edited' ? 'edited by hand since add wrote it' : `exists, and ${LOCK_FILE} has no record of it`}`)
    console.log(`Nothing was written. Re-run with ${c.bold('--force')} to overwrite.`)
    process.exitCode = 1
    return
  }

  const toWrite = plan.filter((p) => p.state !== 'ok')
  if (flags['dry-run']) {
    console.log(`${c.bold('scroll-animation add')} ${ids.join(' ')} ${c.dim(`→ ${relative(root, destDir) || '.'}`)} ${c.dim('(dry run — nothing written)')}`)
    for (const p of plan) console.log(`  ${p.state === 'ok' ? c.dim('unchanged  ') : c.green('write      ')}${p.rel}`)
    printPackages(merged, root, pkg)
    return
  }

  for (const p of toWrite) {
    const abs = join(destDir, p.rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, p.content)
  }

  const newLock = {
    skillVersion: registry.version,
    dir,
    engines: [...new Set([...(lock?.engines ?? []), ...merged.map((m) => m.engine)])].sort(),
    files: { ...(lock?.files ?? {}), ...Object.fromEntries(plan.map((p) => [p.rel, fileHash(lf(p.content))])) }
  }
  writeLock(destDir, newLock)

  const upToDate = plan.length - toWrite.length
  console.log(`${c.green('✓')} ${toWrite.length ? `wrote ${toWrite.length} file(s)` : 'nothing to write'} to ${relative(root, destDir) || '.'} (${merged.map((m) => m.id).join(', ')})`)
  if (upToDate) console.log(c.dim(`  ${upToDate} file(s) already up to date`))
  printPackages(merged, root, pkg)
}

/** Resolves each requested block's requires under its own picked engine, then merges into one
 * ordered, deduped list. resolveTransitive already resolves each entry's own engine (a gsap or
 * motion block's requires can pull in an agnostic/css/media-only dependency without it duplicating
 * itself per engine — see registry.mjs#resolveEngineFor), so entries here can legitimately span
 * more than one engine; this merge only rejects the same block resolving to two different engines
 * ACROSS separate top-level `add` requests (resolveTransitive itself already rejects that within
 * one request) — that would mean copying it twice, to the same paths. */
function mergeResolved(registry, engineByBlock) {
  const engineOf = new Map()
  const byId = new Map()
  const order = []
  for (const [id, engine] of engineByBlock) {
    for (const entry of resolveTransitive(registry, [id], engine)) {
      const already = engineOf.get(entry.id)
      if (already && already !== entry.engine) fail(`${entry.id} is needed under both "${already}" and "${entry.engine}" in this one add — split it into two \`add\` runs with an explicit --engine`, 2)
      if (already) continue
      engineOf.set(entry.id, entry.engine)
      byId.set(entry.id, { id: entry.id, engine: entry.engine, files: entry.files, packages: entry.packages })
      order.push(entry.id)
    }
  }
  return order.map((id) => byId.get(id))
}

function printPackages(merged, root, pkg) {
  const have = new Set([...Object.keys(pkg?.dependencies ?? {}), ...Object.keys(pkg?.devDependencies ?? {})])
  const packages = [...new Set(merged.flatMap((m) => m.packages))].filter((name) => !have.has(name)).sort()
  if (!packages.length) return
  const pm = detectPackageManager(root, pkg)
  console.log(`\n${c.bold('Install')}: ${installCommand(pm, packages)}`)
}
