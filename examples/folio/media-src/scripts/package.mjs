#!/usr/bin/env node
// $WORK/encoded + CREDITS.md → $WORK/media-v1/ (the exact layout of examples/folio/public/media/)
// → $WORK/media-v1.tar.gz, whose SHA-256 goes into examples/folio/media/manifest.sha256.
//
// The tarball holds the folders at its root (hero/, journal/, …), because scripts/fetch-media.mjs
// unpacks it straight into public/media/. It is built to be reproducible: sorted entries, fixed
// mtimes, root ownership, no macOS metadata (no ._ files), gzip without a timestamp.
//
// Also written into the package: CREDITS.md (a copy of examples/folio/CREDITS.md) and
// manifest.sha256, one line per file, `shasum -a 256 -c manifest.sha256` checkable from public/media/.
//
// usage: node scripts/package.mjs

import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { SRC, ensureDir, mb, paths, sh } from './lib/work.mjs'

const FOLIO = resolve(SRC, '..')
const PKG = paths.pkg
const MTIME = new Date('2026-09-25T00:00:00Z')

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

rmSync(PKG, { recursive: true, force: true })
ensureDir(PKG)
cpSync(paths.encoded, PKG, { recursive: true, filter: (src) => !src.endsWith('report.json') && !src.endsWith('.DS_Store') })
copyFileSync(join(FOLIO, 'CREDITS.md'), join(PKG, 'CREDITS.md'))

const files = walk(PKG)
  .map((f) => relative(PKG, f))
  .filter((f) => f !== 'manifest.sha256')
  .sort()
writeFileSync(join(PKG, 'manifest.sha256'), files.map((f) => `${sha256(join(PKG, f))}  ${f}`).join('\n') + '\n')
const entries = [...files, 'manifest.sha256'].sort()
for (const f of entries) utimesSync(join(PKG, f), MTIME, MTIME)

const list = join(paths.masters, 'tar-files.txt')
writeFileSync(list, entries.join('\n') + '\n')
rmSync(paths.tarball, { force: true })
sh('sh', ['-c', `COPYFILE_DISABLE=1 tar -c -f - --format ustar --no-mac-metadata --no-xattrs --no-acls --no-fflags --uid 0 --gid 0 --uname root --gname root -n -C "${PKG}" -T "${list}" | gzip -n -9 > "${paths.tarball}"`])

const hash = sha256(paths.tarball)
const listing = sh('tar', ['-tzf', paths.tarball], { quiet: true, capture: true }).trim().split('\n')
if (listing.some((f) => f.includes('._') || f.startsWith('/') || f.startsWith('media-v1/'))) throw new Error(`unexpected tar entries: ${listing.filter((f) => f.includes('._') || f.startsWith('/')).join(', ')}`)

console.log(`media-v1.tar.gz  ${mb(statSync(paths.tarball).size)} MB, ${listing.length} files`)
console.log(`sha256 ${hash}`)
writeFileSync(join(paths.masters, 'tarball.sha256'), `${hash}  media-v1.tar.gz\n`)
