// remove.mjs — scroll-animation remove <block…> [--dir <path>] [--dry-run] [--force]
// Deletes a block's copied files and their lock records. A file another installed block still uses stays; a block
// another installed block requires, or a file edited by hand, is refused without --force.

import { existsSync, readdirSync, readFileSync, rmdirSync, rmSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { loadRegistry } from '../../lib/registry.mjs'
import { c, fail } from '../ui.mjs'
import { LOCK_FILE, fileHash, findLockDir, findProjectRoot, lf, readLock, writeLock } from '../project.mjs'

export async function cmdRemove(flags, ids) {
  if (!ids.length) fail('remove wants at least one block id — see `scroll-animation list`', 2)
  if (flags.dir === true) fail('--dir wants a path', 2)
  const blocks = loadRegistry().blocks ?? {}
  const unknown = ids.filter((id) => !blocks[id])
  if (unknown.length) fail(`unknown block(s): ${unknown.join(', ')} — see \`scroll-animation list\``, 2)

  const root = findProjectRoot(process.cwd())
  const dir = typeof flags.dir === 'string' ? flags.dir : findLockDir(root)
  const destDir = dir ? join(root, dir) : null
  const lock = destDir ? readLock(destDir) : null
  if (!destDir || !lock) fail(`no ${LOCK_FILE} found: nothing here was copied by \`scroll-animation add\``, 1)

  // The lock records files, not blocks: a block is installed, under an engine, when all of that engine's files are.
  const recorded = new Set(Object.keys(lock.files ?? {}))
  const installed = []
  for (const [id, block] of Object.entries(blocks)) {
    for (const [engine, entry] of Object.entries(block.engines ?? {})) {
      if (entry.files.length && entry.files.every((file) => recorded.has(file))) installed.push({ id, engine, ...entry })
    }
  }
  const removing = new Set(ids)
  const mine = installed.filter((entry) => removing.has(entry.id))
  const missing = ids.filter((id) => !mine.some((entry) => entry.id === id))
  if (missing.length) fail(`not installed here (no complete set of its files in ${LOCK_FILE}): ${missing.join(', ')}`, 1)

  const others = installed.filter((entry) => !removing.has(entry.id))
  const dependents = others.filter((entry) => entry.requires.some((id) => removing.has(id)))
  const stillUsed = new Set(others.flatMap((entry) => entry.files))
  const files = [...new Set(mine.flatMap((entry) => entry.files))].filter((file) => !stillUsed.has(file))
  const shared = [...new Set(mine.flatMap((entry) => entry.files))].filter((file) => stillUsed.has(file))
  const edited = files.filter((file) => {
    const abs = join(destDir, file)
    return existsSync(abs) && fileHash(lf(readFileSync(abs, 'utf8'))) !== lock.files[file]
  })

  if ((dependents.length || edited.length) && !flags.force) {
    console.log(`${c.red('Refusing to remove')} from ${relative(root, destDir) || '.'}:`)
    for (const entry of dependents) console.log(`  ${entry.id} (${entry.engine}) requires ${entry.requires.filter((id) => removing.has(id)).join(', ')}`)
    for (const file of edited) console.log(`  ${file} — edited by hand since add wrote it`)
    console.log(`Nothing was removed. Remove the blocks that need it too, or re-run with ${c.bold('--force')}.`)
    process.exitCode = 1
    return
  }

  const where = relative(root, destDir) || '.'
  if (flags['dry-run']) {
    console.log(`${c.bold('scroll-animation remove')} ${ids.join(' ')} ${c.dim(`→ ${where}`)} ${c.dim('(dry run — nothing removed)')}`)
    for (const file of files) console.log(`  ${c.red('remove     ')}${file}`)
    for (const file of shared) console.log(`  ${c.dim('kept       ')}${file} ${c.dim('(another installed block uses it)')}`)
    return
  }

  for (const file of files) {
    const abs = join(destDir, file)
    rmSync(abs, { force: true })
    // A folder the removal emptied goes too, up to the lock's own directory.
    for (let folder = dirname(abs); folder !== destDir && folder.startsWith(destDir); folder = dirname(folder)) {
      if (!existsSync(folder) || readdirSync(folder).length) break
      rmdirSync(folder)
    }
  }
  const kept = Object.fromEntries(Object.entries(lock.files).filter(([file]) => !files.includes(file)))
  writeLock(destDir, { ...lock, files: kept })

  console.log(`${c.green('✓')} removed ${files.length} file(s) from ${where} (${ids.join(', ')})`)
  if (shared.length) console.log(c.dim(`  kept ${shared.length} file(s) another installed block uses: ${shared.join(', ')}`))
  console.log(c.dim('  Requires the block pulled in (config, base-css) stay: remove them by name once nothing needs them.'))
}
