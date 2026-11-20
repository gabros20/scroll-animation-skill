// scripts/dev/generate.mjs --check, the examples half: every copy an example's lock records matches assets/ and the
// lock's hash, so a block change that skipped `scroll-animation add` in the example fails the check.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { exampleDrift } from '../../scripts/dev/generate.mjs'
import { fileHash } from '../../skills/scroll-animation/scripts/lib/registry.mjs'

const ASSET = 'export const A = 1\n'

/** An assets/ dir with a.ts and an example whose copy and lock are given. */
function fixture({ copy = ASSET, hash = fileHash(ASSET), files = { 'a.ts': null } } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'generate-'))
  const assets = join(root, 'assets')
  const animation = join(root, 'examples', 'site', 'src', 'animation')
  mkdirSync(assets, { recursive: true })
  mkdirSync(animation, { recursive: true })
  writeFileSync(join(assets, 'a.ts'), ASSET)
  if (copy !== null) writeFileSync(join(animation, 'a.ts'), copy)
  const lock = Object.fromEntries(Object.keys(files).map((rel) => [rel, hash]))
  writeFileSync(join(animation, '.scroll-animation.lock.json'), JSON.stringify({ files: lock }))
  return { root, run: () => exampleDrift(join(root, 'examples'), assets), done: () => rmSync(root, { recursive: true }) }
}

test('a copy equal to its asset, with the lock hash add wrote, passes (CRLF in the copy counts as equal)', () => {
  for (const copy of [ASSET, ASSET.replace('\n', '\r\n')]) {
    const f = fixture({ copy })
    assert.deepEqual(f.run(), { problems: [], examples: 1, files: 1 })
    f.done()
  }
})

test('a copy behind its asset fails, and so does one edited by hand', () => {
  const stale = fixture({ copy: 'export const A = 0\n', hash: fileHash('export const A = 0\n') })
  assert.match(stale.run().problems.join('\n'), /a\.ts: differs from assets\/a\.ts/)
  stale.done()
  const edited = fixture({ hash: fileHash('export const A = 0\n') })
  assert.match(edited.run().problems.join('\n'), /a\.ts: edited by hand/)
  edited.done()
})

test('a recorded copy that is missing, or an asset that is gone, fails', () => {
  const missing = fixture({ copy: null })
  assert.match(missing.run().problems.join('\n'), /a\.ts: missing/)
  missing.done()
  const gone = fixture({ files: { 'a.ts': null, 'b.ts': null } })
  assert.match(gone.run().problems.join('\n'), /b\.ts: no assets\/b\.ts any more/)
  gone.done()
})
